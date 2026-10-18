/* ==========================================================================
   CHROME, OVER CDP, WITHOUT A FRAMEWORK

   Every rendered check in this repository - the board's lines, the labels that
   must not overflow, the screenshots - needs a real browser, because what is
   being asked about is what the renderer drew and not what the stylesheet said
   it would draw.

   So this drives the Chrome that is already installed, over the DevTools
   Protocol, which is a WebSocket with a JSON message format. No Playwright, no
   Puppeteer, no download: the connection is node:http to find the socket and
   the global WebSocket to speak it.

   Usage:
     const chrome = await launch();
     const page = await chrome.newPage();
     await page.setViewport(390, 850, 2);
     await page.goto(url);
     const png = await page.screenshot();
     await chrome.close();
   ========================================================================== */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!found) {
    throw new Error(
      "no Chrome found. The rendered checks need a real browser; install Chrome " +
        "or set CHROME_PATH to the executable.",
    );
  }
  return found;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One tab, as a flat set of methods over the protocol. */
export class Page {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const handler = this.pending.get(message.id);
      if (!handler) return;
      this.pending.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression in the page and return its value. */
  async eval(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      // Quote the offending source. A string that is well-formed here is very
      // often not well-formed once it has been interpolated into the page,
      // and the browser's message alone does not say which line it choked on.
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text ||
          "evaluation failed",
      );
    }
    return result.result.value;
  }

  /**
   * Evaluate a function body in the page and return its value. The body may be
   * any number of statements and must `return`; it is wrapped in braces rather
   * than in a `return`, because a block is what callers actually want to write.
   */
  async json(body) {
    return this.eval(`(() => { ${body} })()`);
  }

  async setViewport(width, height, deviceScaleFactor = 1, mobile = true) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor,
      mobile,
    });
  }

  async goto(url) {
    await this.send("Page.navigate", { url });
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(150);
      try {
        if (await this.eval("document.readyState === 'complete'")) return;
      } catch {
        /* the context can be gone mid-navigation; keep waiting */
      }
    }
    throw new Error(`page did not finish loading: ${url}`);
  }

  /** A PNG buffer of what is on screen right now. */
  async screenshot() {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    return Buffer.from(data, "base64");
  }

  /** Click by real mouse events, which is the only kind that survives overlays. */
  async clickText(text, tag = "button,.btn,a,[role=button]") {
    const box = await this.eval(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find(
        (e) => (e.textContent || "").trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}),
      );
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) return false;
    for (const type of ["mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", {
        type,
        x: box.x,
        y: box.y,
        button: "left",
        clickCount: 1,
      });
    }
    return true;
  }

  async close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

export async function launch({ port = 9777 } = {}) {
  const profile = await mkdtemp(join(tmpdir(), "samrajya-chrome-"));
  const child = spawn(
    findChrome(),
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  if (!ready) {
    child.kill();
    throw new Error("Chrome did not open a debugging port");
  }

  return {
    async newPage() {
      const target = await (
        await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
      ).json();
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve);
        ws.addEventListener("error", () => reject(new Error("could not attach to Chrome")));
      });
      const page = new Page(ws);
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      return page;
    },
    async close() {
      child.kill();
      await sleep(300);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}