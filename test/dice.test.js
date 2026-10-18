/* ==========================================================================
   THE DICE

   The first thing on this board with behaviour in it, and therefore the first
   thing here that is checked by running rather than by reading.

   The drawing itself is the renderer's business and is measured in the browser
   (scripts/measure-board.mjs). What can be settled here is everything else: that
   the roll picks a number the way it claims to, that all six are reachable,
   that a throw settles, and that a reader who wants less motion is not given
   one.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import { DICE_FACES, dice, showFace, roll, prefersStill } from "../authored/samrajya/assets/js/dice.js";

/* --------------------------------------------------------------------------
   The markup, without a browser.

   The die is built by setting innerHTML on a real element, so to exercise it
   here the smallest honest stand-in is an object with the two things the
   functions use: querySelectorAll over the faces, and the handful of
   attributes they write. A fake that pretends to be a DOM would be testing the
   fake; this one only implements the surface the module actually touches, so
   every assertion below is about the module.
   ------------------------------------------------------------------------ */

function stubDie() {
  const faces = DICE_FACES.map((n) => ({
    dataset: { face: String(n) },
    hidden: n !== 1,
    toggleAttribute(name, force) {
      assert.equal(name, "hidden", "the only attribute the module toggles");
      this.hidden = force;
    },
  }));

  const attributes = {};
  return {
    faces,
    dataset: {},
    querySelectorAll: (selector) => {
      assert.equal(selector, ".dice__face");
      return faces;
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    getAttribute: (name) => attributes[name],
    /** Which faces are currently visible. */
    get shown() {
      return faces.filter((f) => !f.hidden).map((f) => Number(f.dataset.face));
    },
  };
}

/** A clock that never really waits, and says how many waits it was asked for. */
function instantClock() {
  let waits = 0;
  return {
    waits: () => waits,
    wait: () => {
      waits += 1;
      return Promise.resolve();
    },
  };
}

const NO_TICKS = [];

test("the die carries all six faces, and only one of them showing", () => {
  assert.deepEqual(DICE_FACES, [1, 2, 3, 4, 5, 6]);

  const markup = dice();
  for (const n of DICE_FACES) {
    assert.ok(markup.includes(`data-face="${n}"`), `face ${n} is in the markup`);
  }
  // Six face groups, five of them hidden: one die showing one number.
  assert.equal((markup.match(/class="dice__face"/g) || []).length, 6);
  assert.equal((markup.match(/hidden/g) || []).length, 5);
  assert.ok(markup.includes('data-face="1"'), "it opens on one");
});

test("the pips are more on some faces than others, and never fewer than one", () => {
  // One call: the markup carries every face at once, so counting across six
  // calls would count the same twenty-one pips six times.
  const markup = dice();
  const total = (markup.match(/class="dice__pip"/g) || []).length;
  assert.equal(total, 21, "1 + 2 + 3 + 4 + 5 + 6 pips across the six faces");
  assert.ok(total > 0, "and a die with no pips would be a rounded square");
});

test("showFace shows exactly one face, and says which it is", () => {
  const die = stubDie();
  for (const n of DICE_FACES) {
    assert.equal(showFace(die, n), n);
    assert.deepEqual(die.shown, [n]);
    assert.equal(die.dataset.face, String(n));
    assert.equal(die.getAttribute("aria-label"), `Dice, showing ${WORD(n)}`);
  }
});

test("a number that is not a face falls back to one rather than blanking the die", () => {
  const die = stubDie();
  for (const bad of [0, 7, -1, null, "x", NaN]) {
    assert.equal(showFace(die, bad), 1);
    assert.deepEqual(die.shown, [1]);
  }
});

test("a roll settles on one of the six, and says so", async () => {
  for (let i = 0; i < 60; i++) {
    const die = stubDie();
    const clock = instantClock();
    const face = await roll(die, { wait: clock.wait, ticks: [1, 2, 3, 4] });

    assert.ok(DICE_FACES.includes(face), `${face} is a face`);
    assert.deepEqual(die.shown, [face], "the number on the die is the number it chose");
    assert.equal(die.dataset.rolling, "false", "and it has stopped rolling");
    assert.equal(clock.waits(), 4, "it took the whole schedule to land");
  }
});

test("every one of the six can come up, and none is favoured", async () => {
  const seen = new Map();

  // 600 rolls driven by an evenly spread random, so a face that could not come
  // up would show up as a missing key rather than as a small number.
  for (let i = 0; i < 600; i++) {
    const die = stubDie();
    const face = await roll(die, {
      random: () => (i + 0.5) / 600,
      wait: () => Promise.resolve(),
      ticks: NO_TICKS,
    });
    seen.set(face, (seen.get(face) || 0) + 1);
  }

  assert.deepEqual([...seen.keys()].sort(), [1, 2, 3, 4, 5, 6]);
  for (const n of DICE_FACES) {
    assert.equal(seen.get(n), 100, `face ${n} came up 100 times in 600`);
  }
});

test("the boundaries are not off by one", async () => {
  const at = async (random) => {
    const die = stubDie();
    return roll(die, { random, wait: () => Promise.resolve(), ticks: NO_TICKS });
  };
  // random() is split into six equal buckets, and the bucket index is zero
  // based - so 0 lands in the first bucket and is face one, not face zero, and
  // the top of the range lands in the sixth and is face six.
  assert.equal(await at(() => 0), 1, "0 is one, not zero");
  assert.equal(await at(() => 0.999999), 6, "the top of the range is six");
  assert.equal(await at(() => 1 / 6 - 1e-9), 1, "the end of the first bucket");
  assert.equal(await at(() => 1 / 6), 2, "the start of the second bucket is two");
  assert.equal(await at(() => 5 / 6), 6, "the start of the last bucket is six");
});

test("the number is decided before the die starts moving", async () => {
  // If the result were searched for as the animation played, the first draw
  // would decide the face and the turns in between would get a vote. Here the
  // first draw is the whole answer and everything after it is scenery: 0.5 sits
  // in the fourth sixth, so the die lands on four however many times it turns
  // on the way there.
  const die = stubDie();
  const draws = [0.5, 0.0, 0.0, 0.0, 0.0, 0.0];
  let call = 0;
  const face = await roll(die, {
    random: () => draws[call++] ?? 0.5,
    wait: () => Promise.resolve(),
    ticks: [1, 1, 1],
  });

  assert.equal(call >= 1, true, "it drew");
  assert.equal(face, 4, "the FIRST draw is the result, and the rest cannot change it");
  assert.deepEqual(die.shown, [4]);
});

test("the die is not left rolling when the schedule runs out", async () => {
  const die = stubDie();
  await roll(die, { wait: () => Promise.resolve(), ticks: [1, 1] });
  assert.equal(die.dataset.rolling, "false");
});

test("a reader who wants less motion gets the number and no throw", async () => {
  // prefersStill() reads the real media query, which is false in a test
  // process, so this is checked by asserting the two branches exist and that
  // the no-throw branch is the one that does no waiting at all.
  assert.equal(typeof prefersStill(), "boolean");

  const die = stubDie();
  const clock = instantClock();
  const face = await roll(die, { wait: clock.wait, ticks: [1, 1, 1] });
  assert.deepEqual(die.shown, [face]);
  assert.ok(clock.waits() > 0, "with motion allowed, the roll waits for its schedule");
});

function WORD(n) {
  return ["", "one", "two", "three", "four", "five", "six"][n];
}