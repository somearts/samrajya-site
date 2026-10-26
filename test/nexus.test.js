/* ==========================================================================
   THE NEXUS

   The Nexus is a chest tile that offers two actions: a fixed prayer offering
   or a random draw from thirty cards. The rule tests cover the phase checks,
   the money change, and the refusal of a second action.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import { applyAction, createGame, PHASE } from "../shared/game.js";
import { moneyOf } from "../shared/ledger.js";
import { NEXUS, NEXUS_CARDS, NEXUS_PRAY_COST, drawNexusCard } from "../shared/nexus-cards.js";

const PLAYERS = [
  { name: "Sam", civ: "indus-valley" },
  { name: "Smith", civ: "aztec" },
];

/** An rng that always lands the die on `n`. */
const face = (n) => () => (n - 0.5) / 6;

/** Move the active player onto a square, as if a roll had just put them there. */
function standOn(state, index, id, kind = "none") {
  state.pieces.find((p) => p.seat === state.active).position = index;
  state.landing = { seat: state.active, index, id, kind };
  state.visit = {
    seat: state.active,
    bought: false,
    upgrades: 0,
    drawn: null,
    collected: false,
    rent: 0,
    paid: false,
    short: 0,
    redemption: 0,
    prayed: false,
    nexusDrawn: false,
    nexusCard: null,
    declined: false,
  };
  state.phase = PHASE.DECISION;
  return state;
}

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

test("landing on Nexus sets the decision kind to chest", () => {
  const state = createGame(PLAYERS);
  // Nexus is index 11. Stand eight squares before it so a roll of 3 lands there.
  state.pieces.find((p) => p.seat === state.active).position = 8;
  const { state: after } = take(state, { type: "roll" }, face(3));
  assert.equal(after.landing.id, NEXUS.id);
  assert.equal(after.landing.kind, "chest");
});

test("pray costs the fixed amount and resolves the visit", () => {
  const state = createGame(PLAYERS);
  standOn(state, 11, NEXUS.id, "chest");
  const before = moneyOf(state.ledger, 0);
  const { state: after, events } = take(state, { type: "pray" });
  assert.equal(events[0].type, "prayed");
  assert.equal(events[0].amount, NEXUS_PRAY_COST);
  assert.equal(moneyOf(after.ledger, 0), before - NEXUS_PRAY_COST);
  assert.equal(after.phase, PHASE.RESOLVING);
  assert.equal(after.visit.prayed, true);
});

test("drawNexus picks a card and changes money", () => {
  const state = createGame(PLAYERS);
  standOn(state, 11, NEXUS.id, "chest");
  const before = moneyOf(state.ledger, 0);
  const { state: after, events } = take(state, { type: "drawNexus" });
  assert.equal(events[0].type, "nexusDrawn");
  const card = events[0].card;
  assert.ok(NEXUS_CARDS.includes(card), "drawn card is one of the thirty");
  assert.equal(moneyOf(after.ledger, 0), before + card.amount);
  assert.equal(after.phase, PHASE.RESOLVING);
  assert.equal(after.visit.nexusDrawn, true);
});

test("the second Nexus action is refused", () => {
  const state = createGame(PLAYERS);
  standOn(state, 11, NEXUS.id, "chest");
  const { state: afterPray } = take(state, { type: "pray" });
  const no = refuse(afterPray, { type: "drawNexus" });
  assert.match(no.why, /already/i);
});

test("a visit can always be left, so the turn can never be stranded", () => {
  /* THE NEXUS VISIT CANNOT BE A TRAP.

     The visit used to be refused: "Choose how to approach the Nexus." The
     client closed the card anyway, asked to continue, was refused again, and
     the game sat in DECISION for ever - no card, no die, and the only way out
     was to reload the page.

     So the visit is never refused. A player who has neither prayed nor drawn
     is leaving the Nexus without approaching it: no money moves, the turn
     carries on, and both screens are told so in one sentence. */
  const state = createGame(PLAYERS);
  standOn(state, 11, NEXUS.id, "chest");
  const { state: after, events } = take(state, { type: "continue" });
  assert.equal(after.phase, PHASE.TURN_END);
  assert.equal(after.visit.declined, true);
  assert.ok(events.some((e) => e.type === "nexusDeclined"));
});

test("a visit that has been answered still ends the turn", () => {
  const state = createGame(PLAYERS);
  standOn(state, 11, NEXUS.id, "chest");
  const { state: prayed } = take(state, { type: "pray" });
  const { state: after, events } = take(prayed, { type: "continue" });
  assert.equal(after.phase, PHASE.TURN_END);
  assert.equal(after.visit.declined, false);
  assert.ok(!events.some((e) => e.type === "nexusDeclined"));
});

test("a draw can be taken once and only once", () => {
  const state = createGame(PLAYERS);
  standOn(state, 11, NEXUS.id, "chest");
  const { state: drawn } = take(state, { type: "drawNexus" });
  const no = refuse(drawn, { type: "drawNexus" });
  assert.match(no.why, /already/i);
});

test("drawNexusCard always returns one of the thirty", () => {
  for (let n = 0; n < 200; n += 1) {
    const card = drawNexusCard();
    assert.ok(NEXUS_CARDS.includes(card));
  }
});

test("the deck has exactly fifteen takes and fifteen gives", () => {
  const takes = NEXUS_CARDS.filter((c) => c.amount < 0);
  const gives = NEXUS_CARDS.filter((c) => c.amount > 0);
  assert.equal(takes.length, 15);
  assert.equal(gives.length, 15);
  for (const card of NEXUS_CARDS) {
    assert.ok(Math.abs(card.amount) >= 50 && Math.abs(card.amount) <= 150);
  }
});
