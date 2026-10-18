/* ==========================================================================
   SAMRAJYA - THE BOARD

   Twenty-eight cells in a six-by-ten grid, and nothing else.

   THE GEOMETRY IS THE REQUIREMENT, so it is declared once, as a grid, and every
   cell is placed into it by the coordinates the data gives it:

        cols   1  2  3  4  5  6
   row  1    .  .  .  .  .  .
        2    .  .  .  .  .  .
        ...
       10    .  .  .  .  .  .

   Every track is the same length, `--cell`, so all twenty-eight cells are the
   same square by construction - corners included. There is no code that could
   make two of them differ, and nothing to keep in step. The earlier board was
   8x8 with corner tracks at 16.85% and six 1fr tracks beside them, which made
   the corners a third larger than the cells next to them and gave the top row
   a different orientation from the sides; a square board cannot do that without
   one of the two orientations being wrong, and it was.

   Cells are numbered in the order a game travels them, starting at START in the
   bottom-left and going clockwise - up the left column, across the top, down
   the right, back along the bottom. That index and the cell's coordinates are
   the same fact, and both come from the same record in shared/spaces.js, so
   they cannot drift apart.

   WHAT IS IN A CELL RIGHT NOW
   --------------------------
   The four corners carry their mark, their name and the rule beneath it. Every
   other cell is a plain square. The reference layout this is built to puts a
   set-colour pill and a name in each tile; that is the next piece of work, and
   the card artwork that belongs behind it the one after, so neither is drawn
   here. The cells are real elements with their own ids and indices from the
   first commit, so filling them in later is adding a child rather than
   rebuilding the board.
   ========================================================================== */

import { el } from "./dom.js";
import { cornerMark } from "./corner-art.js";
import { CELLS, CORNER_IDS } from "./shared/spaces.js";

/**
 * The four corners, and the mark each one carries.
 *
 * The ids are the cell ids from the data. The marks are the project's own -
 * `corner-art.js` draws all four as one-stroke instruments in a single weight,
 * and they are not being redrawn for a new size, only laid out again at it.
 */
const CORNER_MARKS = Object.freeze({
  start: "start",
  omega: "omega",
  "akash-core": "core",
  marketplace: "market",
});


/**
 * The centre: a black star on a line that runs out to either side.
 *
 * The lines taper. They are drawn as wedges rather than rules because a rule of
 * constant weight reads as a divider and a taper reads as a horizon, which is
 * the whole point of putting a mark in the middle of an empty field.
 */
function centre() {
  return `
    <svg viewBox="0 0 240 60" class="board__centre-mark" aria-hidden="true" focusable="false">
      <path class="board__line" d="M4 30 L99 26.4 L99 33.6 Z"/>
      <path class="board__line" d="M236 30 L141 26.4 L141 33.6 Z"/>
      <path class="board__star"
            d="M120 8 C126 22 131 26 148.5 30 C131 34 126 38 120 52
               C114 38 109 34 91.5 30 C109 26 114 22 120 8 Z"/>
    </svg>`;
}

/** One corner: its mark, its name, and a rule beneath. */
function cornerCell(cell) {
  return el(
    "div",
    {
      class: "board__cell board__cell--corner",
      style: { gridColumn: String(cell.col), gridRow: String(cell.row) },
      "data-id": cell.id,
      "data-index": String(cell.index),
      "data-cell": cell.type,
      "data-corner": cell.id,
    },
    [
      el("span", {
        class: "board__mark board__mark--corner",
        html: cornerMark(CORNER_MARKS[cell.id]),
      }),
      el("span", {
        class: "board__corner-name",
        // The name is set on the lines the data gives, which is how "Akash Core"
        // becomes AKASH / CORE and "Marketplace" becomes MARKET- / PLACE - the
        // same break the reference layout draws, and the only reason a corner
        // name is ever more than one line.
        html: cell.lines.map((line) => `<span>${line}</span>`).join(""),
      }),
      el("span", { class: "board__corner-rule" }),
    ],
  );
}

/**
 * Any other cell. A square with its own coordinates on it and nothing else in
 * it yet.
 */
function plainCell(cell) {
  return el("div", {
    class: `board__cell board__cell--${cell.type}`,
    style: { gridColumn: String(cell.col), gridRow: String(cell.row) },
    "data-id": cell.id,
    "data-index": String(cell.index),
    "data-cell": cell.type,
    ...(cell.set ? { "data-set": cell.set } : {}),
    ...(cell.chest ? { "data-chest": cell.chest } : {}),
  });
}

/**
 * Build the board.
 *
 * Returns the element. It is built in one go rather than patched, because the
 * board does not change while it is on screen and there is nothing to
 * reconcile.
 */
export function board() {
  const frame = el("div", {
    class: "board",
    role: "group",
    "aria-label": "The board of Samrajya",
  });

  // Columns 2 to 5, rows 2 to 9 - the four by eight that is not part of the
  // ring. Placed on lines rather than on a named area, because the grid's cells
  // are placed individually now and there is no template for a name to sit in.
  //
  // It covers the gaps inside its own span on purpose. In the reference the
  // middle is one unbroken field with a line of text on it, so the grid's lines
  // do not cross it - they stop where the ring stops. Lines 2 to 4 across and
  // lines 2 to 8 down are drawn only in the two side columns and the two end
  // rows, which is what the reference draws.
  const centreArea = el("div", {
    id: "board-center",
    class: "board__centre",
    "aria-hidden": "true",
    html: centre(),
  });
  centreArea.style.gridColumn = "2 / 6";
  centreArea.style.gridRow = "2 / 10";

  const cells = CELLS.map((cell) =>
    isCornerCell(cell) ? cornerCell(cell) : plainCell(cell),
  );

  frame.append(centreArea, ...cells);
  return frame;
}

/** Whether a cell is one of the four corners. */
export function isCornerCell(cell) {
  return CORNER_IDS.includes(cell.id);
}

/** How many of each kind of cell a board has. Used by the geometry check. */
export function tileCensus() {
  return {
    total: CELLS.length,
    corners: CELLS.filter(isCornerCell).length,
    edges: CELLS.filter((c) => !isCornerCell(c)).length,
    // one per grid position, so no two cells can be sitting on the same square
    positions: new Set(CELLS.map((c) => `${c.col},${c.row}`)).size,
  };
}