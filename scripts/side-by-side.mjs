/* ==========================================================================
   THE BOARD, BESIDE THE REFERENCE

   Two images in one frame: board-layout-reference.png on the left, and what
   the board actually renders on the right, at the same height. It is built in
   the browser and screenshotted, so the comparison is a picture of both at
   once rather than two pictures the reader has to hold in their head.

   Usage:  node scripts/side-by-side.mjs [out.png] [width] [height]
   ========================================================================== */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const HANDOFF =
  "C:\\Users\\samra\\AppData\\Local\\Temp\\opencode\\handoff\\open-code-handoff";
const SHOTS = join(process.env.TEMP || ".", "opencode", "board");
const REFERENCE = join(HANDOFF, "board-layout-reference.png");

const OUT = process.argv[2] || join(SHOTS, "side-by-side.png");
const W = Number(process.argv[3] || 360);
const H = Number(process.argv[4] || 700);

const SIZE = `${W}x${H}`;

const dataUri = async (path) =>
  `data:image/png;base64,${(await readFile(path)).toString("base64")}`;

async function main() {
  await mkdir(SHOTS, { recursive: true });

  const reference = await dataUri(REFERENCE);
  const ours = await dataUri(join(SHOTS, `board-${SIZE}.png`));

  const page = `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: Jost; src: local("Jost"); }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 20px; background: #ffffff;
    font: 13px/1.4 "Jost", "Helvetica Neue", Arial, sans-serif;
    color: #121110;
  }
  .row { display: flex; gap: 20px; align-items: flex-start; }
  figure { margin: 0; flex: 1 1 0; min-width: 0; }
  figcaption {
    text-transform: uppercase; letter-spacing: 0.14em; font-size: 10px;
    padding-bottom: 8px; color: #6b6660;
  }
  .frame {
    height: ${H * 2}px; display: flex; align-items: flex-start;
    justify-content: center; background: #ffffff;
  }
  img { display: block; height: 100%; width: auto; image-rendering: auto; }
</style>
<div class="row">
  <figure>
    <figcaption>board-layout-reference.png &mdash; the brief</figcaption>
    <div class="frame"><img src="${reference}"></div>
  </figure>
  <figure>
    <figcaption>the board as rendered &mdash; ${W} &times; ${H}</figcaption>
    <div class="frame"><img src="${ours}"></div>
  </figure>
</div>`;

  await writeFile(join(SHOTS, "side-by-side.html"), page);

  const chrome = await launch({ port: 9788 });
  try {
    const tab = await chrome.newPage();
    // A tall viewport: the reference is 1119 x 1900, so it has to fit.
    await tab.setViewport(1500, H * 2 + 80, 1, false);
    await tab.goto(`file:///${join(SHOTS, "side-by-side.html").replace(/\\/g, "/")}`);
    await sleep(600);
    await writeFile(OUT, await tab.screenshot());
    await tab.close();
  } finally {
    await chrome.close();
  }

  console.log(`\nside by side: ${OUT}\n`);
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  process.exit(1);
});