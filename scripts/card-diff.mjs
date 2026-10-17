// Render card-compare.html and report its element-by-element geometry diff for
// all six cards. Temporary; goes with the preview page.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9700 + (process.pid % 200);
const [url, out, w = "760", h = "340"] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return; } catch {}
    await sleep(250);
  }
  throw new Error("chrome devtools never came up");
}

class Session {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m.result); this.pending.delete(m.id); }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
}

const profile = await mkdtemp(join(tmpdir(), "carddiff-"));
const child = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  "--window-size=800,600", "about:blank",
], { stdio: "ignore" });

try {
  await waitForDevtools();
  const tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const s = new Session(ws);
  await s.send("Page.enable"); await s.send("Runtime.enable");
  await s.send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 2, mobile: false });
  await s.send("Page.navigate", { url });

  let got = null;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    const r = await s.send("Runtime.evaluate", {
      expression: "window.__diff ? JSON.stringify(window.__diff) : ''", returnByValue: true });
    if (r?.result?.value) { got = JSON.parse(r.result.value); break; }
  }
  if (!got) throw new Error("the comparison never ran");

  for (const [key, r] of Object.entries(got.results)) {
    const n = r.mineCount;
    console.log(`${r.diffs.length ? "DIFF " : "ok   "} ${key.padEnd(15)} reference ${r.refCount} elements, transcription ${n}`);
    for (const d of r.diffs) console.log(`      ${d}`);
  }
  console.log(got.totalDiffs === 0
    ? "\nALL SIX: every element matches the reference on every attribute checked"
    : `\n${got.totalDiffs} DIFFERENCES`);

  await sleep(250);
  const shot = await s.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(out, Buffer.from(shot.data, "base64"));
  console.log(`wrote ${out}`);
} finally {
  child.kill();
  await sleep(400);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}