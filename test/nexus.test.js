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
import { RAGNAROK } from "../shared/weapons.js";

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
  /* A chest is open whenever the square is one, and it is a fact about the
     state - so a test that stands on the Nexus stands on it with the chest
     open, exactly as the server would leave it. */
  state.chest =
    id === NEXUS.id
      ? { kind: "nexus", playerId: state.active, phase: "open", startedAt: 1, choice: null, result: null }
      : id === RAGNAROK.id
        ? { kind: "ragnarok", playerId: state.active, phase: "open", startedAt: 1, choice: null, result: null }
        : null;
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

test("pray costs the fixed amount and says so in the chest", () => {
  const state = createGame(PLAYERS);
  standOn(state, 11, NEXUS.id, "chest");
  const before = moneyOf(state.ledger, 0);
  const { state: after, events } = take(state, { type: "pray" });
  assert.equal(events[0].type, "prayed");
  assert.equal(events[0].amount, NEXUS_PRAY_COST);
  assert.equal(moneyOf(after.ledger, 0), before - NEXUS_PRAY_COST);
  assert.equal(after.visit.prayed, true);
  /* The chest is a shared screen, and it says what has happened. */
  assert.equal(after.chest.phase, "praying");
  assert.equal(after.chest.choice, "pray");
  assert.equal(after.chest.result.amount, -NEXUS_PRAY_COST);
});

test("the ledger says the offering was a temple offering", () => {
  const state = createGame(PLAYERS);
  standOn(state, 11, NEXUS.id, "chest");
  const { state: after } = take(state, { type: "pray" });
  const entry = after.ledger.history.find((h) => h.kind === "nexus");
  assert.ok(entry, "the offering is written into the ledger");
  assert.equal(entry.text, "Temple offering");
});

test("drawNexus picks a card and stores it, and the money waits for the reveal", () => {
  /* THE CARD IS CHOSEN FIRST, AND THE MONEY MOVES AT THE REVEAL.

     The server picks the card the moment the button is pressed and writes it
     into the chest. The clients show it once the shuffle has run, and the
     money moves when it is turned over - so the balance changes once, and at
     the moment the player sees the number. */
  const state = createGame(PLAYERS);
  standOn(state, 11, NEXUS.id, "chest");
  const before = moneyOf(state.ledger, 0);
  const { state: after, events } = take(state, { type: "drawNexus" });
  assert.equal(events[0].type, "nexusDrawn");
  const card = events[0].card;
  assert.ok(NEXUS_CARDS.includes(card), "drawn card is one of the thirty");
  assert.equal(moneyOf(after.ledger, 0), before, "no money has moved yet");
  assert.equal(after.visit.nexusDrawn, true);
  assert.equal(after.chest.phase, "shuffling");
  assert.equal(after.chest.choice, "draw");
  assert.equal(after.chest.result.card.id, card.id);
  assert.equal(after.chest.result.revealed, false);

  /* And now the card is turned over, and the money moves. */
  const { state: revealed, events: shown } = take(after, { type: "revealNexus" });
  assert.equal(shown[0].type, "nexusRevealed");
  assert.equal(moneyOf(revealed.ledger, 0), before + card.amount);
  assert.equal(revealed.chest.phase, "revealed");
  assert.equal(revealed.chest.result.revealed, true);
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
