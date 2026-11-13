/* ==========================================================================
   THE INTRODUCTION

   Once per game: both players are shown it when the game begins, and only
   `intro.seat` - the player who takes the first throw - holds the button
   that dismisses it and lets the game start. `intro.done` is that press, and
   it lives in the state the server owns, so a refresh or a reconnect reads
   the same answer instead of showing the introduction again: it cannot come
   back for either player, on any turn, for the rest of that game.

   The board draws from exactly this fact, so what these tests hold is what
   both screens see.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import { applyAction, createGame, restoreGame, serializeGame } from "../shared/game.js";

const PLAYERS = [
  { name: "Aster", civ: "indus-valley" },
  { name: "Vega", civ: "mesopotamian" },
];

/** Apply an action and insist it was accepted. */
function take(state, action) {
  const result = applyAction(state, action);
  const no = result.events.find((e) => e.type === "refused");
  assert.equal(no, undefined, `refused: ${no?.why}`);
  return result;
}

/** Apply an action and insist it was refused, returning the reason. */
function refuse(state, action) {
  const result = applyAction(state, action);
  const no = result.events.find((e) => e.type === "refused");
  assert.ok(no, "expected a refusal");
  assert.equal(result.state, state, "a refusal changes nothing");
  return no;
}

test("a new game opens with the introduction owed to the player who starts it", () => {
  const state = createGame(PLAYERS);
  assert.deepEqual(state.intro, { seat: 0, done: false });
  assert.equal(state.intro.seat, state.active, "the button belongs to the first throw");
});

test("it is persisted with the game, so a refresh does not show it again", () => {
  let state = createGame(PLAYERS);
  state = take(state, { type: "introSeen", seat: 0 }).state;

  const restored = restoreGame(JSON.parse(JSON.stringify(serializeGame(state))));
  assert.equal(restored.intro.done, true, "the press survived the refresh");
  assert.equal(restored.intro.seat, 0);
});

test("the first player begins the game, and only once", () => {
  const state = createGame(PLAYERS);
  const mine = take(state, { type: "introSeen", seat: 0 });
  assert.equal(mine.state.intro.done, true, "one press and the introduction is over");
  assert.equal(mine.events.find((e) => e.type === "introSeen").seat, 0);

  // Pressing it again says nothing at all - the fact is already true.
  const again = applyAction(mine.state, { type: "introSeen", seat: 0 });
  assert.equal(
    again.events.some((e) => e.type === "introSeen"),
    false,
    "a second press announces nothing",
  );
  assert.equal(again.state.intro.done, true);
});

test("the opponent can neither begin the game nor dismiss anything", () => {
  const state = createGame(PLAYERS);
  const no = refuse(state, { type: "introSeen", seat: 1 });
  assert.match(no.why, /first throw/i);
  assert.deepEqual(state.intro, { seat: 0, done: false }, "nothing changed");

  // And after the first player has begun, a stray press from anywhere is
  // simply the same true fact again - never a second dismissal, never a
  // change to whose turn it is.
  const begun = take(state, { type: "introSeen", seat: 0 }).state;
  const stray = applyAction(begun, { type: "introSeen", seat: 1 });
  assert.equal(stray.state.intro.done, true);
  assert.equal(stray.events.some((e) => e.type === "refused"), false, "not a fault");
  assert.equal(stray.state.active, begun.active, "and the turn order is untouched");
});

test("a game that predates the introduction is left alone", () => {
  // A room saved before this rule existed has no `intro` at all: nothing to
  // show, nothing to press, and no action that can invent one.
  const legacy = { ...createGame(PLAYERS) };
  delete legacy.intro;

  const result = applyAction(legacy, { type: "introSeen", seat: 0 });
  assert.equal(result.events.some((e) => e.type === "refused"), false, "not a fault");
  assert.equal(result.state.intro, undefined, "and nothing was written");
});
