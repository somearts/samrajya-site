/* ==========================================================================
   OBLIVION - THE GAME'S ONE VICTORY CONDITION

   These tests are the ending's rules and nothing else:

   - debt: rent is always charged in full and the purse may cross zero;
   - zero is not elimination, and debt between zero and the threshold is
     ordinary play;
   - the threshold is inclusive: exactly -500 ends the game;
   - the end is written once, by applyAction, in the transaction that
     caused it, and announced as an `oblivion` event to both screens;
   - once `over` exists every action by either seat is refused, so no
     further transaction, duplicate trigger, or walk can happen; and
   - the result persists through the wire: a refresh repaints it.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  OBLIVION_AT,
  PHASE,
  applyAction,
  createGame,
  restoreGame,
  serializeGame,
} from "../shared/game.js";
import { moneyOf, rentAt, sheetFor } from "../shared/ledger.js";

const PLAYERS = [
  { name: "Aster", civ: "indus-valley" },
  { name: "Vega", civ: "aztec" },
];

const rngNothing = () => 0;
const face = (n) => () => (n - 0.5) / 6;

function take(state, action, rng = rngNothing) {
  const result = applyAction(state, action, rng);
  const no = result.events.find((e) => e.type === "refused");
  assert.equal(no, undefined, `refused: ${no?.why}`);
  return result;
}

function refuse(state, action, why) {
  const result = applyAction(state, action, rngNothing);
  const no = result.events.find((e) => e.type === "refused");
  assert.ok(no, "expected a refusal");
  if (why) assert.equal(no.why, why);
  assert.equal(result.state, state, "a refusal changes nothing");
  return result;
}

/** Seat 0 at the start, owning nothing, with the given purse; moon owned by
    seat 1 so a roll of 1 charges its rent. */
function brokeGame(money) {
  const state = createGame(PLAYERS, {});
  sheetFor(state.ledger, "moon").owner = 1;
  state.pieces[0].position = 0;
  state.ledger.players[0].money = money;
  return state;
}

const MOON_RENT = rentAt(brokeGame(0).ledger, "moon");

test("the threshold is inclusive: a rent landing on exactly -500 ends the game", () => {
  const state = brokeGame(MOON_RENT + OBLIVION_AT); // after the rent: exactly -500
  const { state: ended, events } = take(state, { type: "roll" }, face(1));

  assert.equal(moneyOf(ended.ledger, 0), -500, "exactly the threshold");
  assert.ok(ended.over, "the game is over");
  assert.equal(ended.over.kind, "oblivion");
  assert.equal(ended.over.loser, 0, "the seat that fell");
  assert.equal(ended.over.winner, 1, "the opponent wins");
  const ev = events.find((e) => e.type === "oblivion");
  assert.ok(ev, "the end carries an event for both screens");
  assert.equal(ev.loser, 0);
  assert.equal(ev.winner, 1);
});

test("one rupee above the threshold is only debt: play continues", () => {
  const state = brokeGame(MOON_RENT - 499); // after the rent: -499
  const { state: inDebt } = take(state, { type: "roll" }, face(1));

  assert.equal(moneyOf(inDebt.ledger, 0), -499, "in debt, one above the threshold");
  assert.equal(inDebt.over, null, "no ending");
  const opened = take(inDebt, { type: "continue" });
  assert.equal(opened.state.phase, PHASE.RESOLVING, "the visit resolves normally");
});

test("zero is not elimination: a purse that lands on ₹0 plays on", () => {
  const state = brokeGame(MOON_RENT); // after the rent: exactly 0
  const { state: atZero } = take(state, { type: "roll" }, face(1));

  assert.equal(moneyOf(atZero.ledger, 0), 0, "exactly zero");
  assert.equal(atZero.over, null, "a seat at zero is still in the game");
  const opened = take(atZero, { type: "continue" });
  assert.equal(opened.state.phase, PHASE.RESOLVING, "the visit resolves normally");
});

test("once over, neither seat can act and the ending cannot repeat", () => {
  const state = brokeGame(MOON_RENT + OBLIVION_AT);
  const ended = take(state, { type: "roll" }, face(1)).state;

  // Every kind of action, by either seat, is refused by the same gate.
  refuse(ended, { type: "roll" }, "This game has ended.");
  refuse(ended, { type: "roll", seat: 1 }, "This game has ended.");
  refuse(ended, { type: "continue" }, "This game has ended.");
  refuse(ended, { type: "continue", seat: 1 }, "This game has ended.");
  refuse(ended, { type: "buy" }, "This game has ended.");
  refuse(ended, { type: "done" }, "This game has ended.");
  refuse(ended, { type: "drawWeapon" }, "This game has ended.");

  assert.equal(ended.over.loser, 0, "over is untouched by the refused presses");
  const again = applyAction(ended, { type: "roll" }, rngNothing);
  assert.equal(again.events.filter((e) => e.type === "oblivion").length, 0, "no duplicate trigger");
});

test("the result survives the wire: serialize, restore, still over", () => {
  const state = brokeGame(MOON_RENT + OBLIVION_AT);
  const ended = take(state, { type: "roll" }, face(1)).state;

  const back = restoreGame(JSON.parse(JSON.stringify(serializeGame(ended))));
  assert.deepEqual(back.over, ended.over, "the result persists through a refresh");
  refuse(back, { type: "continue" }, "This game has ended.");
});

test("a voluntary purchase never triggers the ending: it is refused long before", () => {
  const state = brokeGame(50); // far above the threshold
  const res = applyAction(state, { type: "buy" }, rngNothing); // no landing to buy at
  assert.ok(res.events.find((e) => e.type === "refused"));
  assert.equal(res.state.over, null, "a refused press cannot end anything");
});
