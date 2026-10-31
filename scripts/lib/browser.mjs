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
    /* Everything the page said while it was being watched: uncaught errors and
       console output. A board that throws does not say so on the screen, it just
       stops - so the log is the only place the reason is written down. */
    this.logs = [];
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        const details = message.params?.exceptionDetails;
        this.logs.push({
          kind: "error",
          text:
            details?.exception?.description ||
            details?.text ||
            "an uncaught error",
        });
        return;
      }
      if (message.method === "Runtime.consoleAPICalled") {
        const type = message.params?.type || "log";
        const text = (message.params?.args || [])
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? "")
          .join(" ");
        this.logs.push({ kind: type, text });
        return;
      }
      const handler = this.pending.get(message.id);
      if (!handler) return;
      this.pending.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
    });
  }

  /** The uncaught errors the page has thrown, as one string.
   *
   *  `ignore` is the one error a test caused on purpose: a fault injection is
   *  reported by the app exactly like a real one (a console error and a trace),
   *  and the test that injected it is the only caller that may say so. Every
   *  other entry is a failure. */
  errors(ignore = null) {
    return this.logs
      .filter((entry) => entry.kind === "error" || entry.kind === "assert")
      .filter((entry) => !(ignore && ignore.test(entry.text)))
      .map((entry) => entry.text)
      .join("\n");
  }

  send(method, params = {}, timeout = 30000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      /* A COMMAND THAT NEVER COMES BACK IS A BUG REPORT, NOT A HANG.

         The protocol answers every command or reports an error, and a harness
         that waits forever on a missing answer produces nothing at all - no
         screenshot, no failure, no line saying which call went quiet. So a
         command that has not been answered in half a minute fails loudly with
         its own name. */
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} did not answer in ${timeout}ms`));
      }, timeout);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
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
    // Async, because a probe that has to wait - to watch an animation settle,
    // say - has to be able to.
    return this.eval(`(async () => { ${body} })()`);
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

  // The browser's own connection, for the calls a page's connection refuses.
  const rootWs = new WebSocket(
    (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl,
  );
  await new Promise((resolve, reject) => {
    rootWs.addEventListener("open", resolve);
    rootWs.addEventListener("error", () => reject(new Error("could not attach to Chrome")));
  });
  const root = new Page(rootWs);

  return {
    /**
     * A fresh, isolated storage context. Two players in the same game have to
     * be two separate browsers - each holds its own identity and its own room
     * code - and this is how one Chrome is asked for two of them. Some CDP calls
     * are only allowed on the browser's own connection and never on a page's,
     * which is why there is a root session here and not one per tab.
     */
    async newContext() {
      const { browserContextId } = await root.send("Target.createBrowserContext", {});
      return browserContextId;
    },

    async newPage(browserContextId) {
      let target;

      if (browserContextId) {
        const created = await root.send("Target.createTarget", {
          url: "about:blank",
          browserContextId,
        });
        for (let attempt = 0; attempt < 40; attempt++) {
          const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
          const found = list.find((t) => t.id === created.targetId);
          if (found?.webSocketDebuggerUrl) {
            target = found;
            break;
          }
          await sleep(150);
        }
        if (!target) throw new Error("could not open a page in that context");
      } else {
        target = await (
          await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
        ).json();
      }

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
      /* Bounded: on Windows a profile directory can still be held by the
         dying renderer, and `fs.rm` will retry a locked file for a long time.
         A harness that cannot exit is worse than a temporary directory that
         outlives it. */
      await Promise.race([
        rm(profile, { recursive: true, force: true }).catch(() => {}),
        sleep(5000),
      ]);
    },
  };
}