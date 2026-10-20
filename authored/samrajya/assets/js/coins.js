/* ==========================================================================
   SAMRAJYA - THE COIN RULES

   Where a coin goes, and how two coins stand on one square. Nothing else.

   WHY THERE IS A FILE WITH NO IMPORTS IN IT
   ----------------------------------------
   The board's other modules reach into shared/ for the cells, the properties
   and the civilizations, and that import only resolves in the built tree. It is
   why dice.js takes its face colours as an argument rather than importing them
   - a module that reached for shared/ could not be tested without a build step
   in front of every test.

   So the rules are kept here, importing nothing, and the layer that draws them
   is in coin-layer.js. That is not architecture for its own sake: `advance` and
   `slotAt` are the two functions in this feature whose behaviour is worth being
   sure about, and being sure about them should not require a browser, a build
   or a browser again.

   THE ARITHMETIC
   --------------
   A cell's index is its place in the order a game travels, 0 to 27, and it is
   the same number the board already carries on every cell. A move ADDS the roll
   and wraps at 28, so 27 + 1 is 0 - a coin laps the board rather than walking
   off the end of it.

   Wrapping is where this kind of arithmetic usually goes wrong, and it goes
   wrong quietly: `from + steps` with a negative or an oversized `steps` lands
   outside the array and the coin vanishes rather than wraps. So the modulus is
   written to normalise negatives as well, and test/coins.test.js drives the
   four cases that pin it down - 0+1, 0+6, 25+6, 27+1.

   SLOTS, SO TWO COINS DO NOT SIT ON TOP OF EACH OTHER
   --------------------------------------------------
   Two coins on one square would overlap at a glance and neither could be picked
   out, which is worse than not having coins at all. So every square's coins are
   laid out on slots: one centred, two side by side, three in a triangle, four
   in a 2x2. The offsets are fractions of the cell, so the arrangement is the
   same shape at every cell size and needs nothing recalculated when the board
   resizes.

   The offsets are chosen so that no two coin centres come closer than
   COIN_DIAMETER, which is what makes them not overlap rather than approximately
   not overlap. `slotSpread` measures that, and the test asks it of every layout
   rather than trusting that eight pairs of numbers were eyeballed.

   A PLAYER IS A SEAT
   ------------------
   Not an id. The roster the browser is given carries `name`, `civ`, `joined`
   and `role`, and deliberately no `id`, because `id` is the identity token and
   the design of it is that the far end of the socket is not handed it back. The
   seat is the only name a coin can have here, and it is the same seat the turn
   pill already counts on.
   ========================================================================== */

/** How many squares the board has. The wrap is at this number and no other. */
export const BOARD_SIZE = 28;

/** A coin's diameter, as a fraction of one cell. */
export const COIN_DIAMETER = 0.23;

/** One hop, and the ceiling on a whole move however many hops that is. */
export const STEP_MS = 160;
export const MOVE_BUDGET_MS = 1200;

/** How far a coin rises at the top of a hop, as a fraction of its own diameter. */
export const LIFT = 0.06;

/** How long the final slide into a shared square takes. */
export const SETTLE_MS = 260;

/** How far down the cell the coin strip sits, as a fraction from the centre. */
export const COIN_ROW_Y = 0.32;

/**
 * The name a coin knows its player by.
 *
 * A seat, because that is the only identity the roster carries - see the note
 * above. Exported so that whatever asks "whose coin is this" builds the same
 * name rather than inventing a second one.
 */
export function seatId(seat) {
  return `seat-${Math.max(0, Math.trunc(Number(seat) || 0))}`;
}

/**
 * Where a coin standing on `from` ends up after `steps`.
 *
 * The one function the whole movement rests on. `total` is a parameter rather
 * than the constant so the rule can be stated against a board of any size, but
 * every caller passes BOARD_SIZE.
 */
export function advance(from, steps, total = BOARD_SIZE) {
  if (!(total > 0)) return 0;
  const start = Number(from) || 0;
  const move = Math.trunc(Number(steps) || 0);
  // Two roundings, because one of them alone does not fix a negative: -1 % 28 is
  // -1 in JavaScript, and a coin on -1 is not on the board at all.
  return ((((start + move) % total) + total) % total);
}

/**
 * Every index a move touches, starting where the coin already is.
 *
 * The first entry is where it is NOW, so a caller can walk this and use every
 * entry: index 0 is the coin's current square, and the last is where it lands.
 * A six takes seven entries; a zero takes one, and nothing happens.
 *
 * A negative `steps` walks backwards rather than being clamped to no move at
 * all. Nothing in this game moves a coin backwards, so the question should never
 * arrive - but two functions that answer differently for the same input is a
 * trap, and this one was caught having exactly that: `advance(7, -3)` is 4 and
 * `pathFrom(7, -3)` used to be `[7]`. A caller that animated the walk and then
 * asked `advance` where the coin ended would be told it had not moved.
 */
export function pathFrom(from, steps, total = BOARD_SIZE) {
  const start = advance(from, 0, total);
  const move = Math.trunc(Number(steps) || 0);
  const hops = Math.abs(move);
  const towards = Math.sign(move);

  const path = [start];
  for (let n = 1; n <= hops; n++) path.push(advance(start + towards * n, 0, total));
  return path;
}

/** The layouts, by how many coins a square is holding. One row, in the lower
    strip of the tile, so a coin can never sit on the name above it. */
const LAYOUTS = Object.freeze({
  1: [[0, COIN_ROW_Y]],
  2: [[-0.2, COIN_ROW_Y], [0.2, COIN_ROW_Y]],
  3: [[-0.3, COIN_ROW_Y], [0, COIN_ROW_Y], [0.3, COIN_ROW_Y]],
  4: [
    [-0.375, COIN_ROW_Y],
    [-0.125, COIN_ROW_Y],
    [0.125, COIN_ROW_Y],
    [0.375, COIN_ROW_Y],
  ],
});

/** Past four, the four-square layout is reused. There is no fifth player. */
const layoutFor = (count) =>
  LAYOUTS[Math.min(Math.max(1, Math.trunc(Number(count) || 1)), 4)];

/**
 * Where the nth of `count` coins stands on a shared square, as a fraction of the
 * cell from its centre.
 *
 * One is in the lower strip. Two, three and four are a single row in that strip
 * - side by side at first, then closer together as the square fills - because
 * the lower strip is the only part of a tile the name does not use.
 *
 * Asking for a slot past the end of the layout returns the last one rather than
 * undefined, so a fifth coin lands beside the others on a real square instead of
 * at NaN.
 */
export function slotAt(count, n) {
  const layout = layoutFor(count);
  return layout[Math.min(Math.max(0, Math.trunc(Number(n) || 0)), layout.length - 1)];
}

/**
 * The smallest gap a layout puts between two coins, as a fraction of a cell.
 *
 * This is what makes the slots an arrangement rather than an approximation: if
 * the number it returns is below COIN_DIAMETER, two of those coins overlap. It
 * is exported so the test can ask the question of every layout at once.
 */
export function slotSpread(count) {
  const layout = layoutFor(count);
  if (layout.length < 2) return Infinity;

  let closest = Infinity;
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const d = Math.hypot(layout[i][0] - layout[j][0], layout[i][1] - layout[j][1]);
      if (d < closest) closest = d;
    }
  }
  return closest;
}