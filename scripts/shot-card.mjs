// Screenshot a page once it has painted an element. Temporary: the preview
// page is temporary, and this exists only so the card can be looked at on its
// own before the other five are built.
//
//   node scripts/shot-card.mjs <url> <out.png> [width] [height]

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9500 + (process.pid % 200);
const [url, out, w = "760", h = "900"] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome devtools never came up");
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        // Resolve with the command's own result, so callers read `r.result.value`
        // rather than `r.result.result.value`. Same convention as shot.mjs.
        this.pending.get(m.id)(m.result);
        this.pending.delete(m.id);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const profile = await mkdtemp(join(tmpdir(), "cardshot-"));
const child = spawn(
  CHROME,
  [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    "--window-size=800,600", "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  await waitForDevtools();
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const s = new Session(ws);

  // Anything the page complains about is the answer to "why did it never
  // appear", so it is collected rather than swallowed.
  const noise = [];
  await s.send("Page.enable");
  await s.send("Runtime.enable");
  await s.send("Log.enable");
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown") {
      noise.push(`EXCEPTION ${m.params.exceptionDetails.text} ` +
        `${m.params.exceptionDetails.exception?.description || ""}`);
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      noise.push(`CONSOLE ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    }
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      noise.push(`LOG ${m.params.entry.text} ${m.params.entry.url || ""}`);
    }
  });

  await s.send("Emulation.setDeviceMetricsOverride", {
    width: +w, height: +h, deviceScaleFactor: 2, mobile: false,
  });

  const nav = await s.send("Page.navigate", { url });
  if (nav.error) {
    console.error("navigate failed:", JSON.stringify(nav.error));
    throw new Error("navigate failed");
  }

  let painted = false;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    const r = await s.send("Runtime.evaluate", {
      expression: `(() => {
        const n = document.querySelectorAll('svg[data-card]').length;
        const b = document.querySelector('svg[data-card]');
        return n > 0 && b && b.getBoundingClientRect().width > 0 ? 'painted' : '';
      })()`,
      returnByValue: true,
    });
    if (r.result?.value === "painted") { painted = true; break; }
  }
  if (!painted) {
    const d = await s.send("Runtime.evaluate", {
      expression: `JSON.stringify({
        ready: document.readyState,
        scripts: [...document.querySelectorAll('script')].map(s => s.src || 'inline'),
        bodyLen: document.body ? document.body.innerHTML.length : -1,
        ids: [...document.querySelectorAll('[id]')].map(n => n.id + ':' + (n.children.length)),
      })`,
      returnByValue: true,
    });
    console.error("the card never appeared");
    console.error("page state:", d.result.value);
    if (noise.length) console.error("page said:\n  " + noise.join("\n  "));
    throw new Error("the card never appeared");
  }

  await sleep(300);
  const shot = await s.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(out, Buffer.from(shot.data, "base64"));

  // Report what it actually measured, so the claim is not the screenshot's.
  const m = await s.send("Runtime.evaluate", {
    expression: `JSON.stringify([...document.querySelectorAll('svg[data-card]')].map(s => {
      const r = s.getBoundingClientRect();
      return { card: s.dataset.card, label: s.getAttribute('aria-label'),
               w: +r.width.toFixed(2), h: +r.height.toFixed(2),
               ratio: +(r.width / r.height).toFixed(4),
               viewBox: s.getAttribute('viewBox'),
               clip: s.querySelector('clipPath').id };
    }))`,
    returnByValue: true,
  });
  console.log(m.result.value);
  console.log(`wrote ${out}`);
} finally {
  child.kill();
  // Chrome's crashpad keeps a handle on the profile for a moment after the
  // process goes, and unlinking it while it does throws EBUSY - which would
  // otherwise fail a run that had already written its screenshot.
  await sleep(400);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}