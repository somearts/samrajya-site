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
import { CELLS } from "../shared/spaces.js";

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

          /* The property card, and the die it must not disturb.

             Pressed open by name before anything is measured, because a card
             sitting in the middle of the board is underneath everything else -
             and because "the card fits its rectangle" is a claim that has to be
             made at every board size, not at one. The rectangle is taken from
             the six tiles that bound it rather than from the stylesheet, so a
             change to the CSS cannot quietly widen the card past what was
             agreed. */
          card: (() => {
            const board = document.querySelector(".board");
            const moon = board.querySelector('.board__cell[data-id="moon"]');
            if (!moon) return null;
            moon.click();
            const at = (id) =>
              board.querySelector('.board__cell[data-id="' + id + '"]').getBoundingClientRect();
            const holder = board.querySelector(".board__card");
            const c = holder.querySelector(".property-card");
            if (!c) return { open: false };
            // The card's turn is a transform, and a transformed element's
            // bounding rect is its PROJECTED box - a card mid-turn at eighty-eight
            // degrees measures 3.5% of its width, which is a truer reading of
            // the animation than of the layout. The turn is finished first so
            // that what is measured is where the card sits, not how far it has
            // turned. finish() leaves it at its end state, so this does not skip
            // or fake anything.
            for (const a of holder.getAnimations()) a.finish();
            const cb = c.getBoundingClientRect();
            const db = board.querySelector(".board__dice").getBoundingClientRect();
            const leftIds = ["halleys-comet", "kuiper-belt", "pluto"];
            const rightIds = ["earth-137", "orions-belt", "epoch"];
            const six = leftIds.concat(rightIds);
            const allowed = {
              l: Math.max(...leftIds.map((i) => at(i).right)),
              r: Math.min(...rightIds.map((i) => at(i).left)),
              top: Math.min(...six.map((i) => at(i).top)),
              bottom: Math.max(...six.map((i) => at(i).bottom)),
            };
            const gaps = [
              cb.left - allowed.l, allowed.r - cb.right,
              cb.top - allowed.top, allowed.bottom - cb.bottom,
            ];
            const clipped = [...c.querySelectorAll(".property-card__description span, .property-card__name span")]
              .filter((s) => s.scrollWidth > s.clientWidth + 1).length;
            return {
              open: true,
              left: cb.left, right: cb.right, top: cb.top, bottom: cb.bottom,
              allowed,
              cardW: cb.width,
              holderW: holder.getBoundingClientRect().width,
              gaps, minGap: Math.min(...gaps), spread: Math.max(...gaps) - Math.min(...gaps),
              inside: gaps.every((g) => g >= 1.5),
              clearsLowerRows: cb.bottom < allowed.bottom - 2,
              dieTop: db.top, dieBelow: db.top >= allowed.bottom - 1,
              dieW: db.width,
              clipped,
            };
          })(),

          /* EVERY property's card, at this size.

             The probe above opens Moon, which is one property with one
             description. The typography on these cards was raised thirty per
             cent, and the thing a raise like that breaks is a long line - so
             all twenty are opened and asked, including the ones written to be
             the longest.

             It runs AFTER the geometry probe, and the order is the point. The
             geometry probe needs the card at rest: a turning card's rect is its
             PROJECTED box, and 213px turned eighty-eight degrees measures 7.4px.
             Its first click is the card's first appearance, so finishing that
             animation leaves it at zero degrees and its rect is its own. If this
             sweep ran first, Moon would already be on the board there, that
             click would be a change rather than an appearance, and finishing it
             would leave the card turned away.

             No geometry is measured here, so the transform left on the card at
             the end does not matter: an element is clipped when its SCROLL size
             exceeds its client size, and neither is changed by a transform. */
          cardSweep: (() => {
            const board = document.querySelector(".board");
            const holder = board.querySelector(".board__card");
            const bad = [];
            const ids = [...board.querySelectorAll(".board__cell[data-cell='property']")]
              .map((c) => c.dataset.id);
            const over = (s) => s.scrollWidth > s.clientWidth + 1;
            for (const id of ids) {
              board.querySelector('.board__cell[data-id="' + id + '"]').click();
              const card = holder.querySelector(".property-card");
              if (!card) { bad.push(id + ": no card"); continue; }
              const name = [...card.querySelectorAll(".property-card__name span")].filter(over);
              const desc = [...card.querySelectorAll(".property-card__description span")].filter(over);
              const adv = card.querySelector(".property-card__advantage-text");
              const advantage = adv && adv.scrollHeight > adv.clientHeight + 1;
              if (name.length || desc.length || advantage) {
                bad.push(id + ": " + [
                  name.length ? "name" : "",
                  desc.length ? "description" : "",
                  advantage ? "advantage" : "",
                ].filter(Boolean).join("+"));
              }
            }
            return { opened: ids.length, bad };
          })(),

          /* Is every cell on the square the data says it is?

             This exists because a version of this board put all twenty
             properties in the wrong places and every other check passed. The
             cells lost their gridColumn/gridRow, the grid auto-placed them, and
             auto-placement fills a grid correctly - 28 squares on 28 board
             positions, all the same size, all inside a cell, no scrollbar. It
             simply was not the right 28 squares. So the count is not evidence
             of the layout, and the layout has to be asked for by name. */
          placement: cells.map((c) => {
            const s = getComputedStyle(c);
            return {
              id: c.dataset.id,
              col: s.gridColumnStart,
              row: s.gridRowStart,
            };
          }),
          cellCount: cells.length,
          sizes: [...new Set(cells.map(
            (c) => c.getBoundingClientRect().width.toFixed(3) + " x " +
                   c.getBoundingClientRect().height.toFixed(3),
          ))],
          scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,

          // Does any name overflow the cell it is in? A label is a nowrap span
          // per line, so its width is its longest line and its height is the
          // stack. A name is safe when the widest line fits the cell's content
          // box and the stack fits its height; a name that does not fit is
          // clipped by overflow:hidden, which is worse than overflowing -
          // it looks like the word is simply cut off.
          labels: cells.map((c) => {
            const label = c.querySelector(".board__label");
            if (!label) return null;
            const cs = getComputedStyle(c);
            const cb = c.getBoundingClientRect();
            const lb = label.getBoundingClientRect();
            const spans = [...label.querySelectorAll("span")];
            const rects = spans.map((s) => s.getBoundingClientRect());
            const widest = Math.max(...rects.map((s) => s.width));
            const innerW =
              cb.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const innerH =
              cb.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
            return {
              id: c.dataset.id,
              text: spans.map((s) => s.textContent.trim()).join(" "),
              lines: spans.length,
              widest,
              innerW,
              innerH,
              stackH: lb.height,
              // How much too wide the widest line is, or negative if it fits.
              overW: widest - innerW,
              overH: lb.height - innerH,
              // How far the label sits outside the cell's own border box.
              outside: Math.max(
                0,
                cb.left - lb.left,
                lb.right - cb.right,
                cb.top - lb.top,
                lb.bottom - cb.bottom,
              ),
            };
          }).filter(Boolean),

          pills: cells.map((c) => {
            const pill = c.querySelector(".board__pill");
            if (!pill) return null;
            const cb = c.getBoundingClientRect();
            const pb = pill.getBoundingClientRect();
            return {
              id: c.dataset.id,
              color: getComputedStyle(pill).backgroundColor,
              // The four numbers the layout brief fixes, read back off the page.
              top: +((pb.top - cb.top) / cb.height * 100).toFixed(1),
              left: +((pb.left - cb.left) / cb.width * 100).toFixed(1),
              width: +(pb.width / cb.width * 100).toFixed(1),
              height: +(pb.height / cb.height * 100).toFixed(1),
            };
          }).filter(Boolean),
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
      const tooWide = geometry.labels.filter((l) => l.overW > 0);
      const tooTall = geometry.labels.filter((l) => l.overH > 0);
      const outside = geometry.labels.filter((l) => l.outside > 0.5);
      const tightest = [...geometry.labels]
        .sort((a, b) => b.widest / b.innerW - a.widest / a.innerW)
        .slice(0, 4);

      const misPlaced = CELLS.filter((c) => {
        const at = geometry.placement.find((p) => p.id === c.id);
        return !at || at.col !== String(c.col) || at.row !== String(c.row);
      }).map((c) => {
        const at = geometry.placement.find((p) => p.id === c.id);
        return `${c.id} should be ${c.col},${c.row} and is ${at ? at.col + "," + at.row : "nowhere"}`;
      });

      const ok =
        cleanLines.length === all.length &&
        all.every((l) => l.total > 0) &&
        cellWhole &&
        tracksEven &&
        geometry.cellCount === 28 &&
        misPlaced.length === 0 &&
        geometry.scrollX === 0 &&
        geometry.scrollY === 0 &&
        tooWide.length === 0 &&
        tooTall.length === 0 &&
        outside.length === 0 &&
        geometry.labels.length === 24 &&
        geometry.card !== undefined &&
        geometry.card !== null &&
        geometry.card.open &&
        geometry.card.inside &&
        geometry.card.clearsLowerRows &&
        geometry.card.dieBelow &&
        geometry.card.clipped === 0 &&
        geometry.card.minGap >= 1.5 &&
        geometry.card.spread <= 2.5 &&
        geometry.cardSweep.opened === 20 &&
        geometry.cardSweep.bad.length === 0;

      console.log(`${width} x ${height}   ${ok ? "OK" : "PROBLEM"}`);
      console.log(`  cell ${cell}px ${cellWhole ? "(whole)" : "(FRACTIONAL)"}  tracks ${tracksEven ? "six and ten, all equal" : "NOT equal"}  gap ${geometry.gapX}/${geometry.gapY}px  frame ${geometry.padTop}px`);
      console.log(`  board ${w.toFixed(2)} x ${h.toFixed(2)} at ${x.toFixed(2)}, ${y.toFixed(2)}  ${boardSnap ? "on whole pixels" : "at a half pixel (Chrome snaps it)"}`);
      console.log(`  cells ${geometry.cellCount}, sizes ${geometry.sizes.join(" | ")}`);
      console.log(`  placement ${misPlaced.length === 0
        ? `all 28 cells on the column and row the data gives them`
        : `${misPlaced.length} MISPLACED: ${misPlaced.slice(0, 6).join("; ")}`}`);
      console.log(`  centre ${geometry.centre?.pos} box ${geometry.centre?.x.toFixed(2)},${geometry.centre?.y.toFixed(2)} ${geometry.centre?.w.toFixed(2)}x${geometry.centre?.h.toFixed(2)}`);
      console.log(`  scroll x ${geometry.scrollX}  y ${geometry.scrollY}`);
      console.log(`  labels         ${geometry.labels.length} named cells, ` +
        `${tooWide.length} too wide, ${tooTall.length} too tall, ${outside.length} outside the cell`);
      console.log(`    tightest four, widest line as a share of the cell's content box:`);
      for (const l of tightest) {
        console.log(`      ${(l.widest / l.innerW * 100).toFixed(1).padStart(5)}%  ${l.text.padEnd(18)} ${l.widest.toFixed(1)} of ${l.innerW.toFixed(1)}px  ${l.lines} line${l.lines > 1 ? "s" : ""}`);
      }
      for (const id of ["proxima-centauri", "lagrange-l2", "wormhole"]) {
        const l = geometry.labels.find((x) => x.id === id);
        if (l) {
          console.log(`    asked about ${l.text.padEnd(18)} ${(l.widest / l.innerW * 100).toFixed(1)}% of the box, overflow ${l.overW > 0 ? "YES " + l.overW.toFixed(1) + "px" : "none"}`);
        }
      }
      const pill = geometry.pills[0];
      if (pill) {
        console.log(`    pill ${pill.width}% wide, ${pill.height}% tall, at ${pill.left}%,${pill.top}% of its cell  (brief: 46.7 / 10 / 26.7 / 13.3)`);
      }
      // The card, at this size. Pressed open by the probe above, so this is what
      // a player would see here, not a reading of the stylesheet.
      const c = geometry.card;
      if (!c || !c.open) {
        console.log(`  card      PROBLEM: pressing Moon opened no card`);
      } else {
        const sweep = geometry.cardSweep;
      console.log(`  all cards ${sweep.opened} opened, ${sweep.bad.length === 0
        ? "not one of them clips a word"
        : sweep.bad.length + " CLIPPING: " + sweep.bad.join(", ")}`);
      console.log(`  card      ${c.inside ? "inside the rectangle the six tiles bound" : "OUTSIDE ITS RECTANGLE"}` +
          `  margins ${c.gaps.map((g) => g.toFixed(1)).join(" / ")}` +
          `  tightest ${c.minGap.toFixed(1)}px, spread ${c.spread.toFixed(1)}px`);
        console.log(`            ${c.clearsLowerRows ? "clear of" : "INTO"} the lower rows` +
          `   ${c.clipped === 0 ? "no text clipped" : c.clipped + " LINES CLIPPED"}` +
          `   die ${c.dieW.toFixed(1)}px (${(c.dieW / cell * 100).toFixed(0)}% of a cell), ${c.dieBelow ? "below the card" : "NOT BELOW"}`);
        console.log(`            card ${c.cardW.toFixed(1)}px in a ${c.holderW.toFixed(1)}px holder` +
          `  allowed ${c.allowed.l.toFixed(1)}..${c.allowed.r.toFixed(1)}  card ${c.left.toFixed(1)}..${c.right.toFixed(1)}`);
      }

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