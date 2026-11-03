/* ==========================================================================
   SAMRAJYA - THE DIE

   The board's one object. Small, quiet, and made of the same colours as the
   properties, because a die that introduces colours of its own would be a
   second palette on a page that has one.

   SIX FACES, SIX COLOURS, ONE ELEMENT
   -----------------------------------
   Each face is drawn in one of the board's own set colours, taken from
   spaces.js rather than typed here, so the die cannot drift from the pills it
   sits among: one is purple, two terracotta, three teal, four rose, five sage,
   six gold. A result is therefore recognisable before it is read.

   All six faces are in the markup at once and switching is a `hidden`
   attribute. That is what makes a throw cheap, and it is what lets the rules
   turn or tap the die later without touching the drawing.

   THE FINISH
   ----------
   A cube, seen slightly from above and to the left: the side material shows
   under and beside the face, so the die has thickness rather than an outline.
   The face is the board's brightest paper with a thin metallic rim, a soft
   highlight in the upper left and a little weight in the lower right; the
   pips are drilled into it, each in its own set colour so a face is
   recognisable before it is read. The shadow beneath is a CSS filter rather
   than a box-shadow precisely because a filter paints outside the element
   without taking part in layout, so throwing the die cannot move anything
   around it - and it deepens while the die tumbles, which is what lifting an
   object off a table looks like.

   Note that this is a departure from the flat, gradient-free vocabulary the
   rest of the board is drawn in. It was asked for by name, and the die is the
   one object on the board rather than a diagram of one, so the two do not have
   to match.

   UNTHROWN
   --------
   A die that has not been thrown shows the die and nothing else - no pips, no
   number. It is thrown on tap and only on tap: the number arrives because a
   player asked for it, which is the whole difference between a die and a
   decoration with digits in it.

   THE THROW
   --------
   The result is drawn BEFORE the animation starts, by a single call to
   Math.random mapped into six equal buckets. A roll that searched for its face
   as it played could be interrupted, and a die caught mid-throw would be
   showing a number nobody chose. Chosen first, the animation is decoration on
   a decision already made.

   The ticks get slower, so it decelerates into its result. A reader who has
   asked for reduced motion gets the number and no throw: the same draw, shown
   at once.
   ========================================================================== */

export const DICE_FACES = Object.freeze([1, 2, 3, 4, 5, 6]);

/* The timings live in one place, so the player who threw and the player
   watching are reading the same numbers. */
import { DICE_ROLL_MS } from "./timing.js";

/**
 * The pips, on a three-by-three lattice inside the rim.
 *
 * `faceColors` is one colour per face and is handed in rather than imported,
 * because the board's palette arrives from shared/spaces.js and that module
 * only exists in the built tree - so a die that reached for it would be a die
 * nobody could test. board.js passes the set colours straight through, and the
 * check that they really are the set colours lives there too.
 */
const A = 30;
const B = 50;
const C = 70;

const LAYOUT = Object.freeze({
  1: [[B, B]],
  2: [[A, A], [C, C]],
  3: [[A, A], [B, B], [C, C]],
  4: [[A, A], [C, A], [A, C], [C, C]],
  5: [[A, A], [C, A], [B, B], [A, C], [C, C]],
  6: [[A, A], [C, A], [A, B], [C, B], [A, C], [C, C]],
});

/**
 * One pip, drilled rather than painted.
 *
 * A dot on a die is a hole in the material, and two circles are enough to
 * say so: the pip's own colour fills the drill, and a smaller, darker centre
 * sitting a hair down and to the right is the depth below the rim - the
 * light comes from the upper left, so the shadow is in the lower right. It
 * costs nothing to draw and it is what separates a die from a card with
 * dots printed on it.
 */
const pips = (n) =>
  LAYOUT[n]
    .map(
      ([x, y]) =>
        `<circle class="dice__pip" cx="${x}" cy="${y}" r="7.2"/>` +
        `<circle class="dice__pip-hole" cx="${x + 0.8}" cy="${y + 1}" r="4.4"/>`,
    )
    .join("");

/**
 * The die's markup: a cube with one face turned towards the reader.
 *
 * THE SHAPE IS THREE-DIMENSIONAL. The body is the die's material and it is
 * drawn 4.5 units down and to the right of the face, so the side shows under
 * and beside it - thickness, which is the whole difference between a die and
 * a rounded square. The face is the board's brightest paper, rimmed with the
 * metallic hairline, and it carries the light in one corner and a little
 * weight in the other. Under it: the pips, drilled.
 *
 * Everything else about the markup is as it was - the six faces are all in
 * the DOM at once and a throw is a `hidden` attribute - so a throw is still
 * one attribute and no redraw, and the rules that turn the die later do not
 * care how it is drawn.
 */
export function dice(faceColors = []) {
  const faces = DICE_FACES.map((n) => {
    const colour = faceColors[n - 1] || "var(--ink)";
    return (
      `<g class="dice__face" data-face="${n}" hidden style="--pip: ${colour}">` +
      `${pips(n)}</g>`
    );
  }).join("");

  return (
    `<svg class="board__dice" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"` +
    ` role="button" tabindex="0" aria-label="Dice, not yet thrown"` +
    ` data-face="0" data-rolling="false" focusable="true">` +
    `<defs>` +
    `<linearGradient id="dice-rim" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="currentColor" stop-opacity="0.30"/>` +
    `<stop offset="0.42" stop-color="currentColor" stop-opacity="0.95"/>` +
    `<stop offset="0.68" stop-color="currentColor" stop-opacity="0.55"/>` +
    `<stop offset="1" stop-color="currentColor" stop-opacity="0.90"/>` +
    `</linearGradient>` +
    `<linearGradient id="dice-shade" x1="0" y1="0" x2="1" y2="1">` +
    `<stop class="dice__shade-stop" offset="0.28" stop-opacity="0"/>` +
    `<stop class="dice__shade-stop" offset="1" stop-opacity="0.17"/>` +
    `</linearGradient>` +
    `<radialGradient id="dice-sheen" cx="0.32" cy="0.24" r="0.62">` +
    `<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.55"/>` +
    `<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<clipPath id="dice-clip"><rect x="8" y="8" width="84" height="84" rx="16"/></clipPath>` +
    `</defs>` +
    /* The side material, drawn first so the face always sits on top of it. */
    `<rect class="dice__side" x="12.5" y="12.5" width="84" height="84" rx="16"/>` +
    `<rect class="dice__body" x="8" y="8" width="84" height="84" rx="16"/>` +
    `<g clip-path="url(#dice-clip)">` +
    `<rect class="dice__shade" x="8" y="8" width="84" height="84" rx="16"/>` +
    `<rect class="dice__sheen" x="8" y="8" width="84" height="84" rx="16"/>` +
    `</g>` +
    faces +
    `</svg>`
  );
}

const WORDS = Object.freeze({
  0: "not yet thrown",
  1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
});

/** Show one face, or none at all with 0. Returns what is shown. */
export function showFace(root, n) {
  const face = DICE_FACES.includes(n) ? n : 0;
  for (const group of root.querySelectorAll(".dice__face")) {
    group.toggleAttribute("hidden", group.dataset.face !== String(face));
  }
  root.dataset.face = String(face);
  root.setAttribute("aria-label", `Dice, ${WORDS[face]}`);
  return face;
}

/** Unthrow it: no pips, no number. Cancels anything in the air. */
export function reset(root) {
  if (root.__diceRun) root.__diceRun.cancelled = true;
  root.dataset.rolling = "false";
  return showFace(root, 0);
}

export function prefersStill() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Whether the die is on the board.
 *
 * One place decides it, and it is asked every time the board is repainted.
 * The die used to come and go with the phase: a tap changed the phase, the
 * phase took the die away, and the die came back a second later - a flicker
 * nobody had asked for, and the reason the die seemed to vanish.
 *
 * It is also not the active player's private object. Both phones are watching
 * the same turn, so the waiting player sees the die settle on the number that
 * moved the other coin. Only the right to PRESS it belongs to the active seat,
 * and that is `rollable` in board.js, not visibility here.
 *
 * The die is out of the way only when something else wants the middle: a card,
 * a transient announcement, or a player's record. The resting turn status is
 * not one of those - it sits above the die and leaves it in view.
 *
 * @param {object} state  the game: whose turn it is, and what phase
 * @param {object} ui    what is in the middle: card, announcement, profile,
 *                       throwing, and the seat this board belongs to
 */
export function dieVisible(state, ui = {}) {
  if (ui.card || ui.announcement || ui.profile) return false;
  if (ui.throwing) return true;
  return Boolean(
    state &&
      state.active !== null &&
      state.active !== undefined &&
      ui.seat !== null &&
      ui.seat !== undefined,
  );
}

/**
 * Throw the die and settle on a face already chosen.
 *
 * This is the half of `roll` that draws nothing: the game has rolled, the face
 * is a fact, and the die is catching up. Kept separate so the screen can animate
 * the same number the state machine already moved a coin by - a die and a coin
 * that disagreed about the throw would be the worst kind of bug, because both
 * would look right on their own.
 */
export function throwTo(root, chosen, { random = Math.random, wait = defaultWait, ticks = TICKS } = {}) {
  if (!DICE_FACES.includes(chosen)) return Promise.resolve(showFace(root, 0));

  // A throw while one is in the air restarts it rather than queueing behind it,
  // so a second tap is never swallowed by the first.
  if (root.__diceRun) root.__diceRun.cancelled = true;
  const run = { cancelled: false };
  root.__diceRun = run;

  if (prefersStill()) {
    root.dataset.rolling = "false";
    return Promise.resolve(showFace(root, chosen));
  }

  root.dataset.rolling = "true";
  const turns = ticks.length;
  let step = 0;

  return ticks
    .reduce(
      (chain, ms) =>
        chain.then(() => {
          if (run.cancelled) return false;
          step += 1;
          // The last turn is the result itself, so the die is never seen to
          // stop on a number that was not the one chosen.
          showFace(root, step === turns ? chosen : DICE_FACES[Math.floor(random() * DICE_FACES.length)]);
          return wait(ms);
        }),
      Promise.resolve(),
    )
    .then(() => {
      if (run.cancelled) return null;
      root.__diceRun = null;
      root.dataset.rolling = "false";
      return showFace(root, chosen);
    });
}

/**
 * Throw the die and settle on a random face.
 *
 * Resolves with the face shown. `random` and `wait` are injectable so a check
 * can drive it deterministically instead of by chance and a clock.
 */
export function roll(root, { random = Math.random, wait = defaultWait, ticks = TICKS } = {}) {
  // One draw, uniformly across the six, and it is the answer.
  const drawn = random();
  const chosen = DICE_FACES[Math.min(5, Math.floor(drawn * DICE_FACES.length))];
  return throwTo(root, chosen, { random, wait, ticks });
}

/** setTimeout as a promise, so the throw's waits are one thing. */
function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fast, then slower, then slower again: the shape of a die finding its face. */
const WEIGHTS = Object.freeze([...Array(6).fill(55), ...Array(4).fill(95), ...Array(2).fill(150)]);

/**
 * The ticks, scaled to fill DICE_ROLL_MS exactly.
 *
 * The shape is the shape it always was - quick ticks that get slower - and
 * the length is the one the timings say. The last tick takes up whatever the
 * rounding leaves over, so the throw is exactly as long as DICE_ROLL_MS and
 * not a few milliseconds more.
 */
const weightSum = WEIGHTS.reduce((a, b) => a + b, 0);
const scaled = WEIGHTS.map((w) => Math.round((w * DICE_ROLL_MS) / weightSum));
const TICKS = Object.freeze(
  scaled.map((ms, n) => (n === scaled.length - 1 ? ms + DICE_ROLL_MS - scaled.reduce((a, b) => a + b, 0) : ms)),
);

/**
 * Make the die throwable by pointer and by keyboard, once.
 *
 * `onThrown` is called with the face once the die has LANDED, not when it is
 * touched - so whatever is waiting on the result hears about it when the answer
 * is on the die rather than when it starts moving.
 */
export function makeThrowable(root, onThrown) {
  if (!root || root.dataset.throwable === "true") return root;
  root.dataset.throwable = "true";
  reset(root);

  const throwIt = () => {
    const landed = roll(root);
    if (typeof onThrown !== "function") return landed;
    // A throw that was cancelled by a second one resolves null; there is no
    // result to report and nothing should be told there is.
    return landed.then((face) => {
      if (face) onThrown(face);
      return face;
    });
  };

  root.addEventListener("click", throwIt);
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    throwIt();
  });
  return root;
}