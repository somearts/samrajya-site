/* ==========================================================================
   SAMRAJYA - THE TIMINGS, AND THE DIE

   The die goes first and the coin follows, and the gap between them is the
   same on every device. These checks are about the numbers and about the one
   function that decides whether the die is on the board at all.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DICE_DELAY_MS,
  DICE_HOLD_MS,
  DICE_ROLL_MS,
  pause,
} from "../authored/samrajya/assets/js/timing.js";
import { dieVisible } from "../authored/samrajya/assets/js/dice.js";

test("the die is given a second longer to be read than it used to be", () => {
  // The throw as it stood took 1086ms from the tap to the face settling.
  assert.equal(DICE_ROLL_MS, 1086 + 1000);
  assert.equal(DICE_HOLD_MS, 800);
  assert.equal(DICE_DELAY_MS, DICE_ROLL_MS + DICE_HOLD_MS);
});

test("the delay is long enough to read and short enough to be a game", () => {
  assert.ok(DICE_DELAY_MS > 2000, "the die is read, not glanced at");
  assert.ok(DICE_DELAY_MS < 10000, "a turn is not a minute of waiting");
  assert.ok(DICE_HOLD_MS >= 500, "the face is held long enough to be believed");
});

/* Let the promises the clock woke up settle. */
const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

test("with a clock it controls, the coin does not move before the delay is up", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const marks = [];
  const throw_ = (async () => {
    await pause(DICE_ROLL_MS);
    marks.push("held");
    await pause(DICE_HOLD_MS);
    marks.push("moved");
  })();

  t.mock.timers.tick(DICE_ROLL_MS - 1);
  await flush();
  assert.deepEqual(marks, [], "the throw is still running a millisecond before it is over");

  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(marks, ["held"], "the throw is over and the face is being held");

  t.mock.timers.tick(DICE_HOLD_MS);
  await throw_;
  assert.deepEqual(marks, ["held", "moved"], "the coin moves the moment the hold is up");
});

test("and the two waits together are exactly the delay, not a moment more", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const started = Date.now();
  let movedAt = null;
  const throw_ = (async () => {
    await pause(DICE_ROLL_MS);
    await pause(DICE_HOLD_MS);
    movedAt = Date.now() - started;
  })();

  t.mock.timers.tick(DICE_ROLL_MS);
  await flush();
  t.mock.timers.tick(DICE_HOLD_MS);
  await throw_;
  assert.equal(movedAt, DICE_DELAY_MS);
});

test("the die is on the board for both players while they wait for the roll", () => {
  const state = { active: 0, phase: "AWAITING_ROLL" };
  assert.equal(dieVisible(state, { seat: 0 }), true, "the player to move sees it");
  assert.equal(dieVisible(state, { seat: 1 }), true, "and the waiting player watches the same die");
});

test("the die stays on the board through the throw, the hold and the walk", () => {
  const state = { active: 0, phase: "MOVING" };
  assert.equal(dieVisible(state, { seat: 0 }), true);
  assert.equal(dieVisible(state, { seat: 0, throwing: true }), true);
  // Both phones are watching the same throw, so neither loses the die when the
  // state leaves AWAITING_ROLL.
  assert.equal(dieVisible(state, { seat: 1 }), true);
  assert.equal(dieVisible(state, { seat: 1, throwing: true }), true);
});

test("the die gives way to whatever wants the middle", () => {
  const state = { active: 0, phase: "AWAITING_ROLL" };
  assert.equal(dieVisible(state, { seat: 0, card: true }), false, "a card");
  assert.equal(dieVisible(state, { seat: 0, announcement: true }), false, "an announcement");
  assert.equal(dieVisible(state, { seat: 0, profile: true }), false, "a player's record");
  assert.equal(
    dieVisible(state, { seat: 0, throwing: true, card: true }),
    false,
    "a card wins over a throw",
  );
});
