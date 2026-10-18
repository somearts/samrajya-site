/* ==========================================================================
   SAMRAJYA - THE DICE

   One die, drawn as outline and six filled pips, sitting in the middle of the
   board. It replaces the star-and-horizon that used to be there, and it is a
   module of its own rather than part of board.js because it is the first thing
   on the board that has behaviour: it rolls.

   SIX FACES, ONE ELEMENT
   ---------------------
   All six faces are in the markup at once and only one is shown. Switching face
   is a `hidden` attribute rather than a re-render, which is what makes a roll
   cheap enough to do twenty times a second and, more importantly, what makes it
   possible to swap the visible face from a timer without touching the DOM
   structure - so the die can be turned, tapped or thrown by whatever the rules
   eventually decide, and the drawing is already there.

   THE ROLL
   --------
   The result is chosen FIRST, before anything moves, and the animation is then
   played on the way to it. That ordering matters: a roll that picked its face
   as it landed could be interrupted, and a die that has been mid-animation
   would be showing a number nobody chose. Chosen first, the animation is
   decoration on a decision that has already been made.

   Every one of the six is equally likely - Math.random, once, mapped into
   1..6 - and the ticks get slower as the roll goes on, so it decelerates into
   its result instead of stopping dead.

   A reader who has asked for reduced motion gets the die without the roll: the
   same chosen number, shown at once. The decision is identical; only the
   theatre is dropped.
   ========================================================================== */

/** How many faces, and therefore what a roll can land on. */
export const DICE_FACES = Object.freeze([1, 2, 3, 4, 5, 6]);

/** Where the pips sit, on a three-by-three lattice inside the square. */
const LATTICE = Object.freeze({ a: 27, b: 50, c: 73 });

const LAYOUT = Object.freeze({
  1: [[LATTICE.b, LATTICE.b]],
  2: [[LATTICE.a, LATTICE.a], [LATTICE.c, LATTICE.c]],
  3: [[LATTICE.a, LATTICE.a], [LATTICE.b, LATTICE.b], [LATTICE.c, LATTICE.c]],
  4: [[LATTICE.a, LATTICE.a], [LATTICE.c, LATTICE.a], [LATTICE.a, LATTICE.c], [LATTICE.c, LATTICE.c]],
  5: [
    [LATTICE.a, LATTICE.a], [LATTICE.c, LATTICE.a], [LATTICE.b, LATTICE.b],
    [LATTICE.a, LATTICE.c], [LATTICE.c, LATTICE.c],
  ],
  6: [
    [LATTICE.a, LATTICE.a], [LATTICE.c, LATTICE.a],
    [LATTICE.a, LATTICE.b], [LATTICE.c, LATTICE.b],
    [LATTICE.a, LATTICE.c], [LATTICE.c, LATTICE.c],
  ],
});

/** The die's markup. All six faces, face one showing. */
export function dice() {
  const faces = DICE_FACES.map((n) => {
    const pips = LAYOUT[n]
      .map(([x, y]) => `<circle class="dice__pip" cx="${x}" cy="${y}" r="7.5"/>`)
      .join("");
    return (
      `<g class="dice__face" data-face="${n}"${n === 1 ? "" : " hidden"}>${pips}</g>`
    );
  }).join("");

  return (
    `<svg class="board__dice" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"` +
    ` role="img" aria-label="Dice, showing one" focusable="false"` +
    ` data-face="1" data-rolling="false">` +
    `<rect class="dice__body" x="5" y="5" width="90" height="90" rx="17"/>` +
    faces +
    `</svg>`
  );
}

const WORD = Object.freeze({
  1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
});

/** Show one face and hide the rest. Returns the face shown. */
export function showFace(root, n) {
  const face = DICE_FACES.includes(n) ? n : 1;
  for (const group of root.querySelectorAll(".dice__face")) {
    group.toggleAttribute("hidden", group.dataset.face !== String(face));
  }
  root.dataset.face = String(face);
  root.setAttribute("aria-label", `Dice, showing ${WORD[face]}`);
  return face;
}

/** True when the reader has asked for less motion. */
export function prefersStill() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Roll the die and settle on a random face.
 *
 * Resolves with the face shown. `random` and `wait` are injectable so a check
 * can drive the roll deterministically instead of by chance and a clock.
 */
export function roll(root, { random = Math.random, wait = defaultWait, ticks = TICKS } = {}) {
  // Chosen before the first tick, and by a single call to random: one draw,
  // uniformly across the six. Everything the animation does afterwards is on the
  // way to this number, not a search for it.
  const drawn = random();
  const chosen = DICE_FACES[Math.min(DICE_FACES.length - 1, Math.floor(drawn * DICE_FACES.length))];

  if (prefersStill()) {
    root.dataset.rolling = "false";
    return Promise.resolve(showFace(root, chosen));
  }

  root.dataset.rolling = "true";

  // Each tick turns the die to some other face. The last tick before the result
  // is deliberately not the result, so the die never appears to have stopped on
  // its own - it is put there.
  const turns = ticks.length;
  let step = 0;

  return ticks
    .reduce((chain, ms) =>
      chain.then(() => {
        step += 1;
        const face = step === turns ? chosen : DICE_FACES[Math.floor(random() * DICE_FACES.length)];
        showFace(root, face);
        return wait(ms);
      }), Promise.resolve())
    .then(() => {
      root.dataset.rolling = "false";
      return showFace(root, chosen);
    });
}

/** setTimeout as a promise, so the roll's waits are one thing. */
function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fast, then slower, then slower again.
 *
 * Six quick ticks to carry the die up to speed, four middling ones, and two
 * slow ones to let it arrive - about 660ms in all, which is long enough to read
 * as a throw and short enough not to hold anyone up.
 */
const TICKS = Object.freeze([
  ...Array(6).fill(55),
  ...Array(4).fill(95),
  ...Array(2).fill(150),
]);