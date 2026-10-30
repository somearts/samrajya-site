/* ==========================================================================
   THE BLACK HOLE CONFINEMENT

   The corner at index 14 takes a seat and holds it across turns. These
   tests are the rules of that holding and nothing else:

   - the capture opens the confinement with entropy at zero, once;
   - a held seat may not throw the die except the two rolls its panel has
     decided - entropy, and the committed escape;
   - an entropy roll converts the face into energy and never moves the
     piece;
   - the threshold is ten, halved to five while the seat holds Event
     Horizon, read fresh so it can never be applied twice;
   - ESCAPE NEXT TURN commits the seat and holds it until its own roll;
   - the Relativistic Escape Vessel costs exactly ₹500, deducts once,
     releases at once, and cannot be charged or spent twice.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  HOLE_THRESHOLD,
  HOLE_THRESHOLD_HELD,
  PHASE,
  VESSEL_PRICE,
  applyAction,
  createGame,
  holeThreshold,
  restoreGame,
  serializeGame,
} from "../shared/game.js";
import { sheetFor } from "../shared/ledger.js";

const PLAYERS = [
  { name: "Aster", civ: "indus-valley" },
  { name: "Vega", civ: "aztec" },
];

const HOLE_INDEX = 14;
const QUIET_INDEX = 9; // outer-space, a corner with nothing to decide

const rngNothing = () => 0;

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
  return result;
}

/** Move the active piece by the test throw, and let the coin stop. */
function goTo(state, index) {
  const piece = state.pieces.find((p) => p.seat === state.active);
  const steps = (index - piece.position + 28) % 28 || 28;
  const rolled = take(state, { type: "testRoll", steps }).state;
  return take(rolled, { type: "continue" }).state;
}

/** End the active player's turn on a quiet square and hand it over. */
function passTurn(state, index = QUIET_INDEX) {
  const landed = goTo(state, index);
  const resolved = take(landed, { type: "continue" }).state;
  return take(resolved, { type: "continue" }).state;
}

/** A fresh test-mode game with seat 0 freshly held at the Black Hole. */
function captured() {
  return goTo(createGame(PLAYERS, { testMode: true }), HOLE_INDEX);
}

/** The whole cycle: press BUILD ENTROPY, play the opponent, throw the face. */
function buildAndThrow(state, steps) {
  const armed = take(state, { type: "buildEntropy" }).state;
  const handed = take(armed, { type: "continue" }).state; // TURN_END -> seat 1
  const back = passTurn(handed); // seat 1 plays; seat 0 returns with the die
  const rolled = take(back, { type: "testRoll", steps }).state; // entropy, no walk
  const resolved = take(rolled, { type: "continue" }).state; // RESOLVING -> TURN_END
  return take(resolved, { type: "continue" }).state; // -> seat 1 again
}

/* ---------------------------------------------------------------- arrival */

test("landing on the Black Hole opens the confinement: held, entropy zero", () => {
  const state = captured();
  assert.equal(state.landing.kind, "hole");
  assert.ok(state.hole, "the confinement is a fact in the state");
  assert.equal(state.hole.playerId, 0, "the seat that landed is the seat held");
  assert.equal(state.hole.phase, "confined");
  assert.equal(state.hole.entropy, 0, "entropy begins at zero");
  assert.equal(state.hole.entropyRoll, false);
  assert.equal(state.hole.escape, false);
  assert.equal(state.phase, PHASE.DECISION, "the panel is the decision");
  assert.ok(state.hole.startedAt > 0, "the capture has its moment - the cinematic's key");
});

test("the ordinary throw opens the same confinement", () => {
  const state = createGame(PLAYERS);
  state.pieces[0].position = HOLE_INDEX - 1;
  const rolled = take(state, { type: "roll" }, () => (1 - 0.5) / 6).state;
  const after = take(rolled, { type: "continue" }).state;
  assert.ok(after.hole);
  assert.equal(after.hole.playerId, 0);
});

test("the corner is silent while somebody is already held", () => {
  let state = captured();
  state = take(state, { type: "buildEntropy" }).state;
  state = take(state, { type: "continue" }).state; // -> seat 1

  // Seat 1 throws onto the same corner: it does nothing, and seat 0's
  // confinement is untouched - one hole, and never two.
  const atHole = goTo(state, HOLE_INDEX);
  assert.equal(atHole.hole.playerId, 0, "still seat 0's confinement");
  assert.equal(atHole.hole.entropy, 0, "still at zero - nothing fed it");
  assert.equal(atHole.landing.kind, "none", "the corner is an ordinary silent square");
});

/* ------------------------------------------------------- the held seat's die */

test("a held seat may not throw the die until its panel decides the roll", () => {
  const state = captured();
  // At the panel turn the phase itself refuses the throw...
  const first = applyAction(state, { type: "testRoll", steps: 5 }, rngNothing);
  assert.ok(first.events.find((e) => e.type === "refused"), "the test throw is refused");
  const second = applyAction(state, { type: "roll" }, rngNothing);
  assert.ok(second.events.find((e) => e.type === "refused"), "the real throw is refused");

  // ...and the confinement itself refuses it, even at the die - the second
  // net, for any state that ever hands a held seat the die undecided.
  const atDie = { ...state, phase: PHASE.AWAITING_ROLL };
  refuse(atDie, { type: "testRoll", steps: 5 }, "The singularity holds you. The panel decides your roll.");
  refuse(atDie, { type: "roll" }, "The singularity holds you. The panel decides your roll.");
});

test("BUILD ENTROPY arms the next roll and ends this turn at once", () => {
  const state = captured();
  const { state: armed, events } = take(state, { type: "buildEntropy" });
  assert.equal(armed.hole.entropyRoll, true, "the next roll is decided");
  assert.equal(armed.phase, PHASE.TURN_END, "the turn is over the moment it is pressed");
  assert.ok(events.some((e) => e.type === "holeBuilt"));
  assert.equal(armed.pieces[0].position, state.pieces[0].position, "nothing moved");

  // The turn hands over, and the opponent plays an ordinary one.
  const handed = take(armed, { type: "continue" }).state;
  assert.equal(handed.active, 1);
  const back = passTurn(handed);
  assert.equal(back.active, 0, "the held seat is up again");
  assert.equal(back.phase, PHASE.AWAITING_ROLL, "its turn begins with the die");
  assert.ok(back.hole && !back.hole.escape, "and it is still held");
});

test("the entropy roll converts the face and never moves the piece", () => {
  let state = captured();
  state = take(state, { type: "buildEntropy" }).state;
  state = take(state, { type: "continue" }).state;
  state = passTurn(state);

  const before = state.pieces[0].position;
  const lastRoll = state.lastRoll;
  const { state: rolled, events } = take(state, { type: "testRoll", steps: 5 });
  assert.equal(rolled.hole.entropy, 5, "a roll of 5 takes entropy from 0 to 5");
  assert.equal(rolled.hole.entropyRoll, false, "the commitment is spent");
  assert.equal(rolled.pieces[0].position, before, "the piece never moved");
  assert.equal(rolled.landing, null, "and no square was landed on");
  assert.equal(rolled.lastRoll, lastRoll, "lastRoll records movement, and there was none");
  const gain = events.find((e) => e.type === "holeEntropy");
  assert.ok(gain, "the gain is said to both screens");
  assert.equal(gain.face, 5);
  assert.equal(gain.entropy, 5);
  assert.equal(gain.threshold, HOLE_THRESHOLD);
  assert.equal(rolled.phase, PHASE.RESOLVING, "the beat that shows the gain");
});

test("a roll of 5 and then a roll of 6 carries entropy from 0 to 11", () => {
  let state = captured();
  state = buildAndThrow(state, 5);
  assert.equal(state.hole.entropy, 5);
  state = passTurn(state); // back to the held seat's own panel turn
  state = buildAndThrow(state, 6);
  assert.equal(state.hole.entropy, 11, "past the threshold, still held until it escapes");
});

/* ------------------------------------------------------------- the threshold */

test("the threshold is ten, and Event Horizon halves it for its owner", () => {
  const state = captured();
  assert.equal(HOLE_THRESHOLD, 10);
  assert.equal(HOLE_THRESHOLD_HELD, 5);
  assert.equal(holeThreshold(state.ledger, 0), 10, "without the property, ten");

  // The bonus is a read, not a stamp: holding the property is the whole of
  // it, so it cannot be applied twice and a transfer moves it at once.
  sheetFor(state.ledger, "event-horizon").owner = 0;
  assert.equal(holeThreshold(state.ledger, 0), 5, "with it, five");
  assert.equal(holeThreshold(state.ledger, 0), 5, "still five - it cannot double");

  sheetFor(state.ledger, "event-horizon").owner = 1;
  assert.equal(holeThreshold(state.ledger, 0), 10, "sold while held: ten again");
  assert.equal(holeThreshold(state.ledger, 1), 5, "and the buyer's own confinement would be five");
});

test("ownership changes while confined flip the threshold the panel would show", () => {
  let state = captured();
  state = buildAndThrow(state, 5);
  assert.equal(state.hole.entropy, 5);
  assert.ok(5 < holeThreshold(state.ledger, 0), "five of ten: not enough to escape");

  sheetFor(state.ledger, "event-horizon").owner = 0;
  assert.ok(5 >= holeThreshold(state.ledger, 0), "five of five: enough, the moment it is owned");
});

/* -------------------------------------------------------------- the escape */

test("ESCAPE NEXT TURN is refused below the threshold and commits at it", () => {
  let state = captured();
  refuse(state, { type: "escapeNext" }, "You do not hold the energy to escape yet.");

  state = buildAndThrow(state, 5);
  state = passTurn(state); // back to the held seat's own panel turn
  refuse(state, { type: "escapeNext" }, "You do not hold the energy to escape yet.");

  // The property halves the threshold, and the same five now walks out.
  sheetFor(state.ledger, "event-horizon").owner = 0;
  const { state: committed, events } = take(state, { type: "escapeNext" });
  assert.equal(committed.hole.escape, true);
  assert.equal(committed.phase, PHASE.TURN_END);
  assert.ok(events.some((e) => e.type === "holeCommitted"));
});

test("the committed seat stays held until its own roll releases it", () => {
  let state = captured();
  sheetFor(state.ledger, "event-horizon").owner = 0;
  state = buildAndThrow(state, 5);
  state = passTurn(state); // the held seat's own panel turn
  state = take(state, { type: "escapeNext" }).state;
  state = take(state, { type: "continue" }).state; // -> seat 1

  // The opponent's turn passes; the held seat is up with the die, still held.
  const back = passTurn(state);
  assert.equal(back.active, 0);
  assert.equal(back.phase, PHASE.AWAITING_ROLL, "the committed turn begins with the die");
  assert.ok(back.hole, "and the commitment has not released it early");

  // Nothing may replace the commitment, and nothing may skip the turn.
  refuse(back, { type: "buildEntropy" }, "There is no confinement here.");
  refuse(back, { type: "escapeNext" }, "There is no confinement here.");
  refuse(back, { type: "acquireVessel" }, "There is no confinement here.");
  refuse(back, { type: "continue" }, "There is no turn to end.");

  // The roll frees them: the hole is gone before the walk, and the move is
  // an ordinary move.
  const from = back.pieces[0].position;
  const { state: freed, events } = take(back, { type: "testRoll", steps: 3 });
  assert.equal(freed.hole, null, "released");
  assert.ok(events.some((e) => e.type === "holeEscaped"));
  assert.equal(freed.pieces[0].position, (from + 3) % 28, "the coin walked");
  assert.notEqual(freed.landing.kind, "hole", "and the square it reached answers ordinarily");
  assert.ok(freed.epoch, "here, Epoch opens as it would for any free player");
});

/* ------------------------------------------------------------- the vessel */

test("the vessel refuses a seat that cannot pay, and takes nothing", () => {
  const state = captured();
  // Spend down below the price; the purse is a fact and the test may set it.
  state.ledger.players.find((p) => p.seat === 0).money = VESSEL_PRICE - 1;

  refuse(state, { type: "acquireVessel" }, "A Relativistic Escape Vessel costs ₹500, and you do not hold that much.");
  assert.equal(state.ledger.players.find((p) => p.seat === 0).money, VESSEL_PRICE - 1, "not a coin was taken");
  assert.equal(state.hole.phase, "confined", "and nothing was released");
});

test("the vessel deducts exactly ₹500, releases at once, and cannot be charged twice", () => {
  const state = captured();
  const purse = state.ledger.players.find((p) => p.seat === 0).money;
  const { state: bought, events } = take(state, { type: "acquireVessel" });

  assert.equal(bought.ledger.players.find((p) => p.seat === 0).money, purse - VESSEL_PRICE, "exactly the price");
  assert.equal(bought.hole.phase, "released", "released in the same action that was paid for");
  assert.equal(bought.phase, PHASE.RESOLVING, "the beat that shows the release");
  const paid = events.find((e) => e.type === "holeVessel");
  assert.ok(paid);
  assert.equal(paid.price, VESSEL_PRICE);
  assert.ok(
    bought.ledger.history.some((entry) => entry.text.includes("Escape Vessel") && entry.amount === -VESSEL_PRICE),
    "the ledger says what the money bought",
  );

  // The repeated tap finds nothing to buy and nothing to charge.
  refuse(bought, { type: "acquireVessel" }, "There is no confinement here.");

  // And the release clears with the turn: normal movement resumes.
  const resolved = take(bought, { type: "continue" }).state; // TURN_END
  const handed = take(resolved, { type: "continue" }).state;
  assert.equal(handed.hole, null, "the confinement is gone with the turn");
  assert.equal(handed.phase, PHASE.AWAITING_ROLL, "and the seat plays ordinarily again");
});

test("a seat that has committed to escaping cannot buy the vessel", () => {
  let state = captured();
  sheetFor(state.ledger, "event-horizon").owner = 0;
  state = buildAndThrow(state, 5);
  state = passTurn(state); // the held seat's own panel turn
  state = take(state, { type: "escapeNext" }).state;
  // The commitment ends the turn at once, so the vessel's press has no
  // panel to press it from - refused by the first guard, and nothing moves.
  refuse(state, { type: "acquireVessel" }, "There is no confinement here.");
});

/* ------------------------------------------------------------ the panel's turn */

test("a confined turn cannot be walked out of, and the panel is its only door", () => {
  const state = captured();
  refuse(state, { type: "continue" }, "The singularity holds you. The panel decides your turn.");
  refuse(state, { type: "done" }, "There is nothing to finish.");
  // No property decision, no chest, no fight: there is no landing to answer.
  refuse(state, { type: "buy" });
  refuse(state, { type: "selectWeapon", weaponId: "nuclear" });
});

/* -------------------------------------------------------------- persistence */

test("a confinement crosses the wire and comes back unchanged", () => {
  const state = buildAndThrow(captured(), 5);
  const back = restoreGame(JSON.parse(JSON.stringify(serializeGame(state))));
  assert.deepEqual(back.hole, state.hole);
});

test("a refused panel press cannot move the confinement", () => {
  const state = captured();
  const before = state.hole;
  refuse(state, { type: "escapeNext" }, "You do not hold the energy to escape yet.");
  assert.equal(state.hole, before, "the refused press left the state itself untouched");
});
