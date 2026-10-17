// Render a page to a PNG, and report what the layout actually measured.
//
//   node scripts/shot.mjs <url> <out.png> [width] [height]
//   node scripts/shot.mjs <url> --measure [width] [height]
//
// Why DevTools Protocol rather than --screenshot: Chrome on Windows clamps an
// ordinary window to a 500px minimum width, headless mode or not. A "390px
// phone" render therefore comes back as a 500px layout cropped to 390, which
// looks exactly like a horizontal overflow and is not one. Emulation is the
// only way to see what a phone actually sees.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333 + (process.pid % 200);

const [url, arg2, w = "390", h = "844"] = process.argv.slice(2);
const measureOnly = arg2 === "--measure";
const out = measureOnly ? null : arg2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("chrome devtools never came up");
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const slot = this.pending.get(msg.id);
      if (!slot) return;
      this.pending.delete(msg.id);
      if (msg.error) slot.reject(new Error(msg.error.message));
      else slot.resolve(msg.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const profile = await mkdtemp(join(tmpdir(), "kc-cdp-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

let session;
try {
  await waitForDevtools();
  const created = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  session = new Session(ws);

  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: Number(w),
    height: Number(h),
    deviceScaleFactor: 1,
    mobile: true,
  });

  await session.send("Page.navigate", { url });

  // Wait for the app to have painted its screen, not merely for the document.
  // The static shell ships a #stage-body, so its presence proves nothing: the
  // welcome composition is drawn by the client, and a screenshot taken before
  // that arrives is a blank rectangle that looks exactly like a broken page.
  let painted = false;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    const r = await session.send("Runtime.evaluate", {
      expression: `(() => {
        const mark = document.querySelector('.wordmark--samrajya');
        return mark && mark.getBoundingClientRect().width > 0 ? 'painted' : '';
      })()`,
      returnByValue: true,
    });
    if (r.result.value === "painted") {
      painted = true;
      break;
    }
  }
  if (!painted) throw new Error("the composition never appeared");

  // Two frames, so the compositor has the frame on screen and not just in the
  // layout tree. captureScreenshot reads the surface, not the DOM.
  await session.send("Runtime.evaluate", {
    expression: "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))",
    awaitPromise: true,
    returnByValue: true,
  });
  await sleep(300);

  const report = await session.send("Runtime.evaluate", {
    expression: `(() => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;
      const wide = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right > vw + 0.5 || r.left < -0.5) {
          wide.push({
            el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : ''),
            left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
          });
        }
      }
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      return JSON.stringify({
        viewport: vw,
        scrollWidth: doc.scrollWidth,
        scrollHeight: doc.scrollHeight,
        overflowX: doc.scrollWidth > vw,
        overflowing: wide.slice(0, 8),
        composition: box('.composition'),
        samrajya: box('.wordmark--samrajya'),
        kalchakra: box('.wordmark--kalchakra'),
        ornament: box('.ornament'),
        tagline: box('.tagline'),
        actions: box('.actions'),
        buttons: [...document.querySelectorAll('.actions .btn')].map(b => {
          const r = b.getBoundingClientRect();
          return { t: b.textContent.trim(), x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) };
        }),
        screen: document.querySelector('.panel__title')?.textContent || 'welcome',
      });
    })()`,
    returnByValue: true,
  });

  const data = JSON.parse(report.result.value);
  console.log(JSON.stringify(data, null, 1));

  if (!measureOnly) {
    const shot = await session.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    });
    await writeFile(out, Buffer.from(shot.data, "base64"));
    console.log("wrote", out);
  }
} finally {
  chrome.kill();
  // Chrome can still be holding its own profile lock as it dies. A leftover
  // temporary directory is not worth failing a render over.
  await sleep(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
    () => {},
  );
}
