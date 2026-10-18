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
   A thin rim with a metallic gradient across it, a soft highlight in the
   upper left, and a drop shadow beneath - the three things that separate a die
   from a rounded square. The shadow is a CSS filter rather than a box-shadow
   precisely because a filter paints outside the element without taking part in
   layout, so throwing the die cannot move anything around it.

   Note that this is a departure from the flat, gradient-free vocabulary the
   rest of the board is drawn in. It was asked for by name, and the die is the
   one object on the board rather than a diagram of one, so the two do not have
   to match.

   UNTHROWN
   --------
   A die that has not been thrown shows its rim and nothing else - no pips, no
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

const pips = (n, size) =>
  LAYOUT[n]
    .map(([x, y]) => `<circle class="dice__pip" cx="${x}" cy="${y}" r="${size}"/>`)
    .join("");

/** The die's markup: unthrown, rim and highlight only. */
export function dice(faceColors = []) {
  const faces = DICE_FACES.map((n) => {
    const colour = faceColors[n - 1];
    return (
      `<g class="dice__face" data-face="${n}" hidden style="--pip: ${colour}">` +
      `${pips(n, 6.2)}</g>`
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
    `<radialGradient id="dice-sheen" cx="0.32" cy="0.24" r="0.62">` +
    `<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.55"/>` +
    `<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<clipPath id="dice-clip"><rect x="8" y="8" width="84" height="84" rx="15"/></clipPath>` +
    `</defs>` +
    `<rect class="dice__body" x="8" y="8" width="84" height="84" rx="15"/>` +
    `<g clip-path="url(#dice-clip)">` +
    `<rect class="dice__sheen" x="8" y="8" width="84" height="84" rx="15"/>` +
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
 * Throw the die and settle on a random face.
 *
 * Resolves with the face shown. `random` and `wait` are injectable so a check
 * can drive it deterministically instead of by chance and a clock.
 */
export function roll(root, { random = Math.random, wait = defaultWait, ticks = TICKS } = {}) {
  // One draw, uniformly across the six, and it is the answer.
  const drawn = random();
  const chosen = DICE_FACES[Math.min(5, Math.floor(drawn * DICE_FACES.length))];

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

/** setTimeout as a promise, so the throw's waits are one thing. */
function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fast, then slower, then slower again: about 660ms. */
const TICKS = Object.freeze([...Array(6).fill(55), ...Array(4).fill(95), ...Array(2).fill(150)]);

/** Make the die throwable by pointer and by keyboard, once. */
export function makeThrowable(root) {
  if (!root || root.dataset.throwable === "true") return root;
  root.dataset.throwable = "true";
  reset(root);
  root.addEventListener("click", () => roll(root));
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    roll(root);
  });
  return root;
}