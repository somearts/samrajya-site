/* ==========================================================================
   ARE THE BOARD'S LINES VISIBLE?

   The board is a six-by-ten grid whose lines are not drawn on the cells at
   all. The board itself is a dark field and the cells sit on it with a gap
   between them, so every line - seven vertical, eleven horizontal - is the
   board's ground showing through. That is what stops a shared edge being two
   lines deep, and it is also what makes the lines fragile: if the gap is
   sub-pixel, or if it does not line up with a device pixel, the renderer
   antialiases it and the line comes out faint or vanishes.

   So this does not read the stylesheet. It screenshots the board and looks at
   the pixels, at several phone sizes, and asks of every one of the eighteen
   lines: is the whole of you the colour of the ground?

   Run it:  node scripts/measure-board.mjs [baseUrl]
   ========================================================================== */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { joinToBoard } from "./lib/room.mjs";
import { decodePng, pixel, rgb, distance } from "./lib/png.mjs";

const BASE = process.argv[2] || "http://127.0.0.1:8791/samrajya/";
const OUT = process.argv[3] || join(process.env.TEMP || ".", "opencode", "board");

const SIZES = [
  [360, 700],
  [390, 700],
  [430, 700],
  [360, 850],
  [390, 850],
  [430, 850],
];

const GROUND = rgb("#2a2a2a");

// How far a sample may stray from the ground colour and still count as a line.
// A crisp line is exact. A half-strength line blends towards the cream and
// lands around 145, which is a hundred away - so this threshold is loose
// enough for a compositing rounding and nowhere near loose enough to miss the
// failure it exists to catch.
const TOLERANCE = 12;

const WHOLE = (n) => Number.isInteger(n);

/** Walk one line across the image and describe what it found. */
function scanLine(image, axis, at, segments) {
  const samples = [];
  for (const [from, to] of segments) {
    const step = Math.max(1, Math.floor((to - from) / 40));
    for (let p = Math.ceil(from); p <= Math.floor(to); p += step) {
      const x = axis === "v" ? at : p;
      const y = axis === "v" ? p : at;
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      samples.push({ p, off: distance(pixel(image, x, y), GROUND) });
    }
  }
  const clean = samples.filter((s) => s.off <= TOLERANCE);
  const worst = samples.reduce((m, s) => Math.max(m, s.off), 0);
  return {
    total: samples.length,
    clean: clean.length,
    worst,
    // Where the line first stops being the ground colour.
    firstBad: samples.find((s) => s.off > TOLERANCE)?.p ?? null,
  };
}

async function main() {
  await mkdir(OUT, { recursive: true });

  console.log(`\nBoard lines\n${"=".repeat(66)}`);
  console.log(`  ground #2a2a2a, tolerance ${TOLERANCE}, whole-pixel cells\n`);

  const chrome = await launch();
  let problems = 0;
  const summary = [];

  try {
    for (const [width, height] of SIZES) {
      const page = await chrome.newPage();

      // Measured at a scale factor of one, where a CSS pixel is exactly one
      // device pixel. That is the strictest case: if a line is crisp here it
      // is crisp on a retina screen, where it would have twice the pixels.
      await page.setViewport(width, height, 1);
      await page.goto(BASE);
      await joinToBoard(page);

      const geometry = await page.json(`
        const board = document.querySelector(".board");
        if (!board) return null;
        const cs = getComputedStyle(board);
        const cells = [...board.querySelectorAll(".board__cell")];
        const b = board.getBoundingClientRect();
        // The grid's own tracks, resolved by the engine. A custom property is
        // not a length in computed style - it is the token stream it was
        // written as, so "--cell" reads back as the round(min(calc(...))) that
        // produced it. The tracks are where the number actually lands.
        const px = (list) => list.trim().split(/\\s+/).map(parseFloat);
        return {
          cols: px(cs.gridTemplateColumns),
          rows: px(cs.gridTemplateRows),
          cellDeclared: cs.getPropertyValue("--cell").trim(),
          gapX: parseFloat(cs.columnGap),
          gapY: parseFloat(cs.rowGap),
          padTop: parseFloat(cs.paddingTop),
          padLeft: parseFloat(cs.paddingLeft),
          board: { x: b.left, y: b.top, w: b.width, h: b.height },
          centre: (() => {
            const c = document.querySelector("#board-center");
            if (!c) return null;
            const r = c.getBoundingClientRect();
            const s = getComputedStyle(c);
            return { x: r.left, y: r.top, w: r.width, h: r.height, pos: s.position, inset: s.inset };
          })(),
          cellCount: cells.length,
          sizes: [...new Set(cells.map(
            (c) => c.getBoundingClientRect().width.toFixed(3) + " x " +
                   c.getBoundingClientRect().height.toFixed(3),
          ))],
          scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
        };
      `);

      if (!geometry) throw new Error(`no board at ${width} x ${height}`);

      const raw = await page.screenshot();
      await writeFile(join(OUT, `lines-${width}x${height}.png`), raw);
      const image = decodePng(raw);

      const { x, y, w, h } = geometry.board;
      const cell = geometry.cols[0];
      const hair = geometry.gapX;
      const pitch = cell + hair;

      // WHERE a line is drawn
// -----------------------
// The reference draws one plain field in the middle and the grid's lines stop
// where the ring stops - they do not cross the centre. So a line is not a
// single stripe across the board; each of the eighteen is drawn in segments,
// and a line is fully visible when every segment it should have is present.
//
// In board-local coordinates, line n lies at [n * pitch, n * pitch + hair],
// and cell k spans [hair + k * pitch, hair + k * pitch + cell].
//
//   vertical   lines 0, 1, 5, 6 run the full height. 0 and 6 are the outer
//              frames; 1 and 5 divide an edge cell from the middle, which is
//              a real edge. Lines 2, 3 and 4 have a cell on neither side for
//              rows 1 to 8, so they exist only in the top and bottom rows.
//   horizontal lines 0, 1, 9, 10 run the full width, on the same reasoning.
//              Lines 2 to 8 exist only in the left and right columns.
const FULL_VERTICAL = new Set([0, 1, 5, 6]);
const FULL_HORIZONTAL = new Set([0, 1, 9, 10]);

// A cell of the grid, in board-local coordinates, so the arithmetic can be
// read off the geometry. Lines are scanned in viewport coordinates, so
// `at` offsets it back to where the board actually is on the screen.
const cellBox = (k) => [1 + k * pitch, 1 + k * pitch + cell];

const verticals = [];
for (let i = 0; i < 7; i++) {
  const centre = x + i * pitch + hair / 2;
  const segments = FULL_VERTICAL.has(i)
    ? [[y, y + h]]
    : [0, 9].map((k) => cellBox(k).map((v) => v + y));
  verticals.push({
    i,
    centre,
    at: Math.floor(centre),
    segments,
    ...scanLine(image, "v", Math.floor(centre), segments),
  });
}

const horizontals = [];
for (let j = 0; j < 11; j++) {
  const centre = y + j * pitch + hair / 2;
  const segments = FULL_HORIZONTAL.has(j)
    ? [[x, x + w]]
    : [0, 5].map((k) => cellBox(k).map((v) => v + x));
  horizontals.push({
    j,
    centre,
    at: Math.floor(centre),
    segments,
    ...scanLine(image, "h", Math.floor(centre), segments),
  });
}

      const all = [...verticals, ...horizontals];
      const cleanLines = all.filter((l) => l.clean === l.total && l.total > 0);

      // The cell has to be a whole pixel, because that is what puts every line
      // on a device pixel. The board's own offset does not have to be: Chrome
      // snaps a one-pixel feature to the pixel grid when it paints, which is
      // why the board sits at 11.5 and its frame still comes out crisp. That is
      // reported rather than asserted - the pixels are the proof either way.
      const boardSnap = WHOLE(x) && WHOLE(y);
      const cellWhole = WHOLE(cell);
      const tracksEven =
        geometry.cols.length === 6 &&
        geometry.rows.length === 10 &&
        geometry.cols.every((v) => v === cell) &&
        geometry.rows.every((v) => v === cell);
      const ok =
        cleanLines.length === all.length &&
        all.every((l) => l.total > 0) &&
        cellWhole &&
        tracksEven &&
        geometry.cellCount === 28 &&
        geometry.scrollX === 0 &&
        geometry.scrollY === 0;

      console.log(`${width} x ${height}   ${ok ? "OK" : "PROBLEM"}`);
      console.log(`  cell ${cell}px ${cellWhole ? "(whole)" : "(FRACTIONAL)"}  tracks ${tracksEven ? "six and ten, all equal" : "NOT equal"}  gap ${geometry.gapX}/${geometry.gapY}px  frame ${geometry.padTop}px`);
      console.log(`  board ${w.toFixed(2)} x ${h.toFixed(2)} at ${x.toFixed(2)}, ${y.toFixed(2)}  ${boardSnap ? "on whole pixels" : "at a half pixel (Chrome snaps it)"}`);
      console.log(`  cells ${geometry.cellCount}, sizes ${geometry.sizes.join(" | ")}`);
      console.log(`  centre ${geometry.centre?.pos} box ${geometry.centre?.x.toFixed(2)},${geometry.centre?.y.toFixed(2)} ${geometry.centre?.w.toFixed(2)}x${geometry.centre?.h.toFixed(2)}`);
      console.log(`  scroll x ${geometry.scrollX}  y ${geometry.scrollY}`);
      console.log(`  vertical lines   ${cleanLines.filter((l) => l.i !== undefined).length}/7 clean` +
        (verticals.some((l) => l.clean !== l.total)
          ? `   offenders: ${verticals.filter((l) => l.clean !== l.total).map((l) => `#${l.i} (${l.clean}/${l.total}, off by ${l.worst}, first bad at ${l.firstBad})`).join(", ")}`
          : "   (0 and 6 full height; 1 and 5 full height; 2,3,4 in the end rows)"));
      console.log(`  horizontal lines ${cleanLines.filter((l) => l.j !== undefined).length}/11 clean` +
        (horizontals.some((l) => l.clean !== l.total)
          ? `   offenders: ${horizontals.filter((l) => l.clean !== l.total).map((l) => `#${l.j} (${l.clean}/${l.total}, off by ${l.worst}, first bad at ${l.firstBad})`).join(", ")}`
          : "   (0,1,9,10 full width; 2 to 8 in the side columns)"));
      console.log(`  line centres     ${all.map((l) => l.at).join(" ")}`);

      if (!ok) problems += 1;
      summary.push({ size: `${width}x${height}`, ok, geometry, lines: { verticals, horizontals } });

      // A second screenshot at a higher scale factor, for looking at rather
      // than measuring.
      await page.setViewport(width, height, 2);
      await sleep(400);
      await writeFile(join(OUT, `board-${width}x${height}.png`), await page.screenshot());

      await page.close();
    }
  } finally {
    await chrome.close();
  }

  await writeFile(join(OUT, "lines.json"), JSON.stringify(summary, null, 2));

  console.log(`\n${"=".repeat(66)}`);
  console.log(problems === 0 ? `all eighteen lines visible at all ${SIZES.length} sizes` : `${problems} size(s) with a problem`);
  console.log(`screenshots and raw measurements in ${OUT}\n`);
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`\n${error.message}\n`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exit(1);
});