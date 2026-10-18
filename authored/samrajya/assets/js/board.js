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

   WHAT IS IN A CELL NOW
   --------------------
   The four corners carry their mark, their name and the rule beneath it. A
   property carries a pill in its set's colour and its name. A chest carries
   its name in cream on the dark ground and no pill. The card artwork that
   belongs behind the pill is the next piece of work and is not drawn here; the
   cells have their ids, indices and art paths on them from the start, so
   putting artwork in is adding a child rather than rebuilding the board.
   ========================================================================== */

import { el } from "./dom.js";
import { cornerMark } from "./corner-art.js";
import { dice, makeThrowable } from "./dice.js";
import { showCard } from "./property-card.js";
import { turnPill } from "./turn.js";
import { isPurchasable } from "./shared/properties.js";
import { CELLS, CORNER_IDS, SETS } from "./shared/spaces.js";

/**
 * The four corners, and the mark each one carries.
 *
 * The keys are the cell ids from the data, and each one is now the same word as
 * the corner it names. The marks are the project's own - `corner-art.js` draws
 * all four as one-stroke instruments in a single weight, and they are not being
 * redrawn for a new size, only laid out again at it.
 *
 * The three that were renamed used to carry ids from a board that no longer
 * exists - `omega`, `akash-core`, `marketplace` - and were kept that way on the
 * argument that ids are wiring, not display. They are wiring, and they have been
 * rewritten everywhere they are used, so the argument held for a change nobody
 * asked for rather than for one worth making.
 */
const CORNER_MARKS = Object.freeze({
  start: "start",
  "outer-space": "space",
  "black-hole": "hole",
  fight: "fight",
});


/**
 * The middle: a die, in the board's own colours.
 *
 * One set colour per face, taken from the pills themselves rather than written
 * out here, so a set whose colour is changed on the board changes the die with
 * it. The die takes them as an argument so that it has no import of its own
 * into the shared modules - those only exist in the built tree, and a die that
 * reached for one could not be tested.
 */
function centre() {
  return dice(Object.values(SETS).map((set) => set.color));
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
        // The name is set on the lines the data gives, which is how "Outer Space"
        // becomes OUTER / SPACE and "Black Hole" becomes BLACK / HOLE - the
        // same break the reference layout draws, and the only reason a corner
        // name is ever more than one line.
        html: cell.lines.map((line) => `<span>${line}</span>`).join(""),
      }),
      el("span", { class: "board__corner-rule" }),
    ],
  );
}

/**
 * The name, set on the lines the data gives.
 *
 * "Proxima Centauri" becomes PROXIMA / CENTAURI and "Lagrange Point L2" becomes
 * LAGRANGE / POINT L2 - the breaks are in the data, not guessed here, so the
 * drawing and board-cells.json cannot disagree about where a name wraps.
 */
function nameLines(cell) {
  return el("span", {
    class: "board__label",
    html: cell.lines.map((line) => `<span>${line}</span>`).join(""),
  });
}

/**
 * Any cell that is not a corner.
 *
 * A property carries a pill in its set's colour above its name. A chest carries
 * only its name, in cream on the dark ground, because a chest belongs to no set
 * and a pill in no set's colour would be saying something false about it.
 *
 * Properties are real buttons, so a property is reachable by keyboard and
 * announces itself as one; the cells have no handler yet and that is deliberate -
 * a button that does nothing is still a button the reader can find, and it is
 * the same element that will take the tap when there is one. Chests are
 * ordinary cells for now and become buttons the same way when they do.
 */
function plainCell(cell) {
  const isChest = cell.type === "chest";

  // One style object, built once. It was two, and the second replaced the first:
  // a `style` key written after the spread overwrites the gridColumn and
  // gridRow that came with it, every property button lost its coordinates and
  // the grid auto-placed them - which still puts 28 squares on 28 board
  // positions, and still passes a count, and still leaves every pixel inside a
  // cell. The cells were simply in the wrong places. A cell's position is not
  // optional, so it is assembled alongside everything else the cell needs and
  // handed over once.
  const style = {
    gridColumn: String(cell.col),
    gridRow: String(cell.row),
    // The wash is the same colour as the pill, from the same field in the same
    // record, so the tint on the ground and the pill above it cannot disagree.
    // A chest has no colour of its own to wash with and is left to the
    // stylesheet, which gives it black.
    ...(isChest ? {} : { "--wash": cell.color }),
  };

  const props = {
    class: `board__cell board__cell--${cell.type}`,
    style,
    "data-id": cell.id,
    "data-index": String(cell.index),
    "data-cell": cell.type,
    ...(cell.set ? { "data-set": cell.set } : {}),
    ...(cell.chest ? { "data-chest": cell.chest } : {}),
    ...(cell.art ? { "data-art": cell.art } : {}),
  };

  if (isChest) {
    // A chest's wash is black, set by the stylesheet, because a chest belongs
    // to no set and has no colour of its own to tint with.
    return el("div", props, [nameLines(cell)]);
  }

  // A property is a button because it is a place a player can buy, and the card
  // that says so comes up when it is pressed. The handler lives on the board
  // rather than on the cell so that the cell carries no behaviour of its own.
  return el(
    "button",
    {
      ...props,
      type: "button",
      "aria-label": `${cell.name}, ${isPurchasable(cell.id) ? "show details" : "not for sale"}`,
    },
    [
      el("span", {
        class: "board__pill",
        style: { backgroundColor: cell.color },
        "aria-hidden": "true",
      }),
      nameLines(cell),
    ],
  );
}

/**
 * Build the board.
 *
 * Returns the element. It is built in one go rather than patched, because the
 * board does not change while it is on screen and there is nothing to
 * reconcile.
 *
 * `players` is the roster, and is only read for the turn pill: a board built
 * without one still renders, and the pill simply stays hidden rather than
 * naming a turn nobody has.
 */
export function board({ players = [] } = {}) {
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
  //
  // No longer aria-hidden: it used to hold only decoration, but it now holds the
  // die, and a die that says which number it came up is the one thing in here
  // worth reading out.
  const centreArea = el("div", {
    id: "board-center",
    class: "board__centre",
    html: centre(),
  });
  centreArea.style.gridColumn = "2 / 6";
  centreArea.style.gridRow = "2 / 10";

  const cells = CELLS.map((cell) =>
    isCornerCell(cell) ? cornerCell(cell) : plainCell(cell),
  );

  frame.append(centreArea, ...cells);

  // The card's box. It is empty and hidden until a property is pressed; the
  // stylesheet is what puts it in the upper middle, inside the rectangle the
  // six tiles named in property-card.js bound off.
  const card = el("div", { class: "board__card", hidden: true });
  frame.append(card);

  // The die. It arrives unthrown and is thrown by pressing it, never on its
  // own - a die that rolls by itself is a decoration, and the number on it has
  // to mean something a player asked for.
  const die = centreArea.querySelector(".board__dice");

  // The turn pill, under the die. It is put in the middle rather than over the
  // board so that it lands in the same two rows the die is in and can be
  // positioned from the die's own edge. It advances when the die has LANDED,
  // not when it is touched, so the pill never names a player who is still
  // mid-throw.
  const turn = turnPill(players);
  centreArea.append(turn.node);

  if (die) makeThrowable(die, () => turn.next());

  // One handler for every property, on the board rather than twenty times on
  // the cells. The cells that are not purchasable are not buttons at all, so
  // pressing a corner or a chest cannot reach this.
  for (const cell of cells) {
    if (!cell.matches?.("button[data-id]")) continue;
    cell.addEventListener("click", () => {
      showCard(frame, cell.dataset.id);
    });
  }

  return frame;
}

/** The die on this board, or null. A handle for whoever throws it next. */
export function theDice(root) {
  return (root || document).querySelector(".board__dice");
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