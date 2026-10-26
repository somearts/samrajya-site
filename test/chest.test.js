/* ==========================================================================
   THE SHARED CHEST

   Ragnarok and Nexus are shared screens: they are a fact about the game, and
   the fact is in the state. These tests are about that fact - that it is
   there, that it moves the way it should, and that both players read the
   same one.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import { applyAction, createGame, PHASE } from "../shared/game.js";
import { NEXUS } from "../shared/nexus-cards.js";
import { RAGNAROK } from "../shared/weapons.js";

const PLAYERS = [
  { name: "Sakshi", civ: "indus-valley" },
  { name: "Vikram", civ: "aztec" },
];

/** An rng that always lands the die on `n`. */
const face = (n) => () => (n - 0.5) / 6;

function take(state, action, rng) {
  const result = applyAction(state, action, rng);
  const no = result.events.find((e) => e.type === "refused");
  assert.equal(no, undefined, `refused: ${no?.why}`);
  return result;
}

function refuse(state, action, rng) {
  const result = applyAction(state, action, rng);
  const no = result.events.find((e) => e.type === "refused");
  assert.ok(no, "expected a refusal");
  return no;
}

/** Roll onto a square, and let the coin stop. */
function rollOnto(state, index) {
  state.pieces.find((p) => p.seat === state.active).position = index;
  const { state: moved } = take(state, { type: "roll" }, face(1));
  /* The coin has stopped: `continue` is what opens the decision. */
  const { state: after } = take(moved, { type: "continue" });
  return after;
}

test("a fresh game has no chest", () => {
  const state = createGame(PLAYERS);
  assert.equal(state.chest, null);
});

test("landing on Ragnarok opens the chest, and it is in the state", () => {
  const state = createGame(PLAYERS);
  // Ragnarok is index 4.
  const after = rollOnto(state, 3);
  assert.equal(after.landing.id, RAGNAROK.id);
  assert.equal(after.landing.kind, "chest");
  assert.ok(after.chest, "the chest is in the state, not in a browser");
  assert.equal(after.chest.kind, "ragnarok");
  assert.equal(after.chest.playerId, after.active);
  assert.equal(after.chest.phase, "open");
  assert.equal(after.chest.choice, null);
  assert.equal(after.chest.result, null);
  assert.ok(Number(after.chest.startedAt) > 0, "the chest has a moment");
});

test("landing on the Nexus opens the Nexus chest", () => {
  const state = createGame(PLAYERS);
  // Nexus is index 11.
  const after = rollOnto(state, 10);
  assert.equal(after.landing.id, NEXUS.id);
  assert.equal(after.landing.kind, "chest");
  assert.equal(after.chest.kind, "nexus");
  assert.equal(after.chest.phase, "open");
});

test("the chest is gone when the turn ends", () => {
  const state = createGame(PLAYERS);
  const after = rollOnto(state, 10);
  assert.ok(after.chest);
  /* The visit is answered and the turn carries on. */
  const { state: done } = take(after, { type: "done" });
  assert.equal(done.chest, null, "the chest goes with the turn");
});

test("the chest closes only when the acting player says Done", () => {
  const state = createGame(PLAYERS);
  const after = rollOnto(state, 10);
  assert.equal(after.chest.phase, "open");

  /* The other player cannot close it. */
  const no = refuse(after, { type: "done", seat: 1 });
  assert.match(no.why, /turn/i);

  /* The acting player can - once the visit has been answered. */
  const { state: praying } = take(after, { type: "pray" });
  const { state: done, events } = take(praying, { type: "done" });
  assert.equal(done.chest, null);
  assert.equal(done.phase, PHASE.TURN_END);
  assert.ok(events.some((e) => e.type === "chestClosed"));
});

test("the chest cannot be closed before it has been answered", () => {
  const state = createGame(PLAYERS);
  const after = rollOnto(state, 3);
  const no = refuse(after, { type: "done" });
  assert.match(no.why, /draw/i);
});

test("both players read the same chest", () => {
  /* THE STATE IS THE SHARED SCREEN.

     Two devices apply the same actions to the same state and read the same
     chest out of it. There is no message between them that could be missed,
     so a device that joins late or reconnects shows the same thing. */
  const state = createGame(PLAYERS);
  const after = rollOnto(state, 10);

  /* The acting player's device. */
  const acting = take(after, { type: "drawNexus" }).state;

  /* The other player's device reads the same state - not an event. */
  const waiting = acting;

  assert.deepEqual(waiting.chest, acting.chest);
  assert.equal(waiting.chest.kind, "nexus");
  assert.equal(waiting.chest.phase, "shuffling");
  assert.equal(waiting.chest.playerId, acting.active);
  assert.ok(waiting.chest.result.card, "the card is already known");
});

test("the chest's story is the server's, and it only moves forward", () => {
  const state = createGame(PLAYERS);
  const after = rollOnto(state, 10);

  const { state: praying } = take(after, { type: "pray" });
  assert.equal(praying.chest.phase, "praying");
  /* A second action is refused: the chest has been answered. */
  const no = refuse(praying, { type: "drawNexus" });
  assert.match(no.why, /already/i);
});

test("a Nexus card is turned over before the chest can be closed", () => {
  const state = createGame(PLAYERS);
  const after = rollOnto(state, 10);
  const { state: drawn } = take(after, { type: "drawNexus" });
  assert.equal(drawn.chest.phase, "shuffling");

  /* The card has not been turned over yet, so the chest cannot be closed. */
  const no = refuse(drawn, { type: "done" });
  assert.match(no.why, /turn the card/i);

  const { state: revealed } = take(drawn, { type: "revealNexus" });
  assert.equal(revealed.chest.phase, "revealed");
  const { state: done } = take(revealed, { type: "done" });
  assert.equal(done.chest, null);
});

test("the Ragnarok draw is stored in the chest at once", () => {
  const state = createGame(PLAYERS);
  const after = rollOnto(state, 3);
  const { state: drawn } = take(after, { type: "drawWeapon" });
  assert.equal(drawn.chest.phase, "drawing");
  assert.equal(drawn.chest.choice, "draw");
  assert.ok(drawn.chest.result, "the weapon is known before the animation");
});

test("a chest cannot be opened twice", () => {
  const state = createGame(PLAYERS);
  const after = rollOnto(state, 10);
  const { state: praying } = take(after, { type: "pray" });
  const no = refuse(praying, { type: "pray" });
  assert.match(no.why, /already/i);
});
