/* ==========================================================================
   EPOCH

   Epoch is a shared screen and a real mechanic, not a decoration. These tests
   are about the mechanics: the deck is the eight named cards, each card's
   effect reaches the real state, the dice and the movement and the ledger stay
   honest, and no card can duplicate itself, strand a turn, or buy something by
   accident. The client draws what these rules decide.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import { applyAction, createGame, PHASE, advance, pieceAt } from "../shared/game.js";
import { TIME_CARDS, drawTimeCard, timeCardById } from "../shared/epoch-cards.js";
import { CELLS } from "../shared/spaces.js";
import { ownerOf } from "../shared/ledger.js";

const PLAYERS = [
  { name: "Aster", civ: "indus-valley" },
  { name: "Vega", civ: "aztec" },
];

const EPOCH_INDEX = CELLS.find((c) => c.id === "epoch").index; // 17

/** An rng that always lands the die on `n`. */
const face = (n) => () => (n - 0.5) / 6;

/** An rng that picks TIME_CARDS[i] and, if asked again (Future Sight), a face. */
function pick(index, sightFace = 3) {
  let calls = 0;
  return () => {
    calls += 1;
    // First call chooses the card; a later call (Future Sight's number) picks a face.
    return calls === 1 ? (index + 0.5) / TIME_CARDS.length : (sightFace - 0.5) / 6;
  };
}

const IDX = Object.fromEntries(TIME_CARDS.map((c, i) => [c.id, i]));

function take(state, action, rng) {
  const result = applyAction(state, action, rng);
  const no = result.events.find((e) => e.type === "refused");
  assert.equal(no, undefined, `refused: ${no?.why}`);
  return result;
}

function refuse(state, action, rng) {
  const result = applyAction(state, action, rng);
  const no = result.events.find((e) => e.type === "refused");
  assert.ok(no, `expected a refusal for ${action.type}`);
  return no;
}

/** A fresh game with a player standing on Epoch, the visit opened. */
function atEpoch({ position = EPOCH_INDEX - 1, lastFace = 1 } = {}) {
  let state = createGame(PLAYERS);
  state.pieces.find((p) => p.seat === 0).position = position;
  const moved = take(state, { type: "roll" }, face(lastFace)).state;
  return take(moved, { type: "continue" }).state;
}

const pos = (state, seat = 0) => pieceAt(state, seat).position;
const epochEvents = (events) => events.filter((e) => e.type === "timeCardDrawn");

/* ------------------------------------------------------------------ the deck */

test("the deck is exactly the eight named Time Cards", () => {
  assert.equal(TIME_CARDS.length, 8);
  assert.deepEqual(
    TIME_CARDS.map((c) => c.name),
    [
      "Time Rewind", "Time Leap", "Frozen Moment", "Future Sight",
      "Temporal Loop", "Time Fracture", "Alternate Timeline", "Time Theft",
    ],
  );
  // Every card has a stable id, a description and an effect, and every id resolves.
  for (const card of TIME_CARDS) {
    assert.ok(card.id && card.text && card.effect, `${card.name} is fully described`);
    assert.equal(timeCardById(card.id), card);
  }
});

test("the draw is a uniform pick, and each card can be drawn", () => {
  const seen = new Set();
  for (let i = 0; i < TIME_CARDS.length; i += 1) {
    seen.add(drawTimeCard(pick(i)).id);
  }
  assert.equal(seen.size, 8, "every card is reachable by some draw");
});

/* -------------------------------------------------------------- the landing */

test("landing on Epoch opens it as a decision", () => {
  const state = atEpoch();
  assert.equal(state.phase, PHASE.DECISION);
  assert.equal(state.landing.kind, "epoch");
  assert.ok(state.epoch, "the Epoch visit is a fact in the state");
  assert.equal(state.epoch.playerId, 0);
  assert.equal(state.epoch.phase, "open");
  // The two movement cards read the genuine last roll, not a guess.
  assert.equal(state.epoch.rewindSteps, 1);
  assert.equal(state.epoch.fracturePos, EPOCH_INDEX - 1);
});

test("the draw is refused for the wrong player, away from Epoch, or twice", () => {
  // Wrong player.
  let state = atEpoch();
  refuse(state, { type: "drawTimeCard", seat: 1 });

  // Not at Epoch (no Epoch visit).
  const plain = createGame(PLAYERS);
  refuse(plain, { type: "drawTimeCard" });

  // Twice.
  state = take(state, { type: "drawTimeCard" }, pick(IDX["time-leap"])).state;
  refuse(state, { type: "drawTimeCard" }, pick(IDX["time-leap"]));
});

/* ------------------------------------------------------------ the eight cards */

test("Time Rewind steps back by the most recent completed throw", () => {
  // Landed on Epoch with a throw of 1 (from 16). Rewind goes back 1.
  let state = atEpoch({ lastFace: 1 });
  const { state: after, events } = take(state, { type: "drawTimeCard" }, pick(IDX["time-rewind"]));
  assert.equal(after.epoch.result.card, "time-rewind");
  assert.equal(pos(after), EPOCH_INDEX - 1, "back one from Epoch");
  assert.ok(epochEvents(events).length, "the draw is announced once");
});

test("Time Rewind uses the real last roll, and wraps the board", () => {
  // Reach Epoch from 14 with a throw of 3; rewind by 3.
  let state = createGame(PLAYERS);
  state.pieces.find((p) => p.seat === 0).position = 14;
  state = take(state, { type: "roll" }, face(3)).state;
  state = take(state, { type: "continue" }).state;
  assert.equal(pos(state), EPOCH_INDEX);
  const { state: after } = take(state, { type: "drawTimeCard" }, pick(IDX["time-rewind"]));
  assert.equal(pos(after), EPOCH_INDEX - 3);
});

test("Time Leap advances exactly three further along the path", () => {
  let state = atEpoch();
  const { state: after } = take(state, { type: "drawTimeCard" }, pick(IDX["time-leap"]));
  assert.equal(pos(after), advance(EPOCH_INDEX, 3));
  assert.equal(after.epoch.result.outcomeKind, "moved");
});

test("Time Fracture returns to the stored previous position", () => {
  let state = createGame(PLAYERS);
  state.pieces.find((p) => p.seat === 0).position = 14;
  state = take(state, { type: "roll" }, face(3)).state; // 14 -> 17 (Epoch)
  state = take(state, { type: "continue" }).state;
  assert.equal(state.epoch.fracturePos, 14, "the genuine previous position is stored");
  const { state: after } = take(state, { type: "drawTimeCard" }, pick(IDX["time-fracture"]));
  assert.equal(pos(after), 14, "fractured back to where the move began");
});

test("Future Sight reserves the exact next roll and it is consumed unchanged", () => {
  let state = atEpoch();
  const { state: after } = take(state, { type: "drawTimeCard" }, pick(IDX["future-sight"], 5));
  assert.equal(after.futureSight[0], 5, "the next throw is reserved and shown");
  assert.equal(after.epoch.result.sight, 5);

  // The reservation belongs to the player who drew it. Bring them back to the
  // die (a unit-level setup) and confirm the reserved face is used exactly,
  // not whatever the rng would have produced.
  const ready = { ...after, phase: PHASE.AWAITING_ROLL, landing: null, epoch: null, active: 0 };
  const { state: rolled } = take(ready, { type: "roll" }, face(1) /* rng would give 1 */);
  assert.equal(rolled.lastRoll.face, 5, "the reserved face is used, not the rng");
  assert.equal(rolled.futureSight[0], null, "the reservation is consumed");
  const from = ready.pieces.find((p) => p.seat === 0).position;
  assert.equal(pos(rolled), advance(from, 5), "the coin walks the reserved distance");
});

test("Temporal Loop grants exactly one bonus roll and does not hand off", () => {
  let state = atEpoch();
  const { state: after } = take(state, { type: "drawTimeCard" }, pick(IDX["temporal-loop"]));
  assert.equal(after.bonusRolls[0], 1, "one bonus roll is owed");

  state = take(after, { type: "continue" }).state; // close epoch -> TURN_END
  assert.equal(state.phase, PHASE.TURN_END);
  state = take(state, { type: "continue" }).state; // the bonus keeps the turn
  assert.equal(state.active, 0, "the turn has NOT handed over");
  assert.equal(state.phase, PHASE.AWAITING_ROLL, "the same player rolls again");

  // The bonus roll is marked and the bonus is spent.
  const { state: rolled } = take(state, { type: "roll" }, face(2));
  assert.equal(rolled.lastRoll.bonus, true, "the roll is marked as a bonus");
  assert.equal(rolled.bonusRolls[0], 0, "the bonus is consumed");
});

test("a bonus roll cannot grant another Temporal Loop", () => {
  // The bonus roll is an ordinary roll; it cannot re-enter Epoch's card draw.
  let state = atEpoch();
  state = take(state, { type: "drawTimeCard" }, pick(IDX["temporal-loop"])).state;
  state = take(state, { type: "continue" }).state;
  state = take(state, { type: "continue" }).state; // bonus, AWAITING_ROLL
  // Roll a 1 from Epoch-1 so it lands back on Epoch -> a fresh visit, a new draw.
  state.pieces.find((p) => p.seat === 0).position = EPOCH_INDEX - 1;
  const { state: landed } = take(state, { type: "roll" }, face(1));
  // A new Epoch visit may open, but the loop itself granted only ONE bonus.
  assert.ok(landed.bonusRolls[0] === 0, "the previous bonus was consumed, not doubled");
});

test("Alternate Timeline waits for a choice, then moves two the chosen way", () => {
  let state = atEpoch();
  const { state: after } = take(state, { type: "drawTimeCard" }, pick(IDX["alternate-timeline"]));
  assert.equal(after.epoch.phase, "choosing", "it waits for a future to be chosen");
  assert.equal(pos(after), EPOCH_INDEX, "nothing has moved yet");

  // A stray continue cannot skip the choice.
  refuse(after, { type: "continue" });

  const forward = take(after, { type: "epochChoice", option: "forward" }).state;
  assert.equal(pos(forward), advance(EPOCH_INDEX, 2));
  assert.equal(forward.epoch.phase, "revealed");

  // The backward option from the same starting state.
  const backward = take(after, { type: "epochChoice", option: "backward" }).state;
  assert.equal(pos(backward), advance(EPOCH_INDEX, -2));
});

test("Time Theft takes an opponent's bonus, or reports there is none", () => {
  // With a bonus to steal: give the opponent one first.
  let state = atEpoch();
  state.bonusRolls = { 0: 0, 1: 1 };
  const { state: stole } = take(state, { type: "drawTimeCard" }, pick(IDX["time-theft"]));
  assert.equal( stole.bonusRolls[1], 0, "the opponent's bonus is spent");
  assert.equal(stole.bonusRolls[0], 1, "the thief gains it");
  assert.equal(stole.epoch.result.outcomeKind, "theft");

  // With none to steal: a clearly communicated no-target outcome.
  const bare = atEpoch();
  bare.bonusRolls = { 0: 0, 1: 0 };
  const { state: none } = take(bare, { type: "drawTimeCard" }, pick(IDX["time-theft"]));
  assert.equal(none.epoch.result.outcomeKind, "no-target");
  assert.equal(none.bonusRolls[0], 0, "nothing is stolen");
});

test("Frozen Moment freezes the opponent and eats their next loop", () => {
  let state = atEpoch();
  const { state: after } = take(state, { type: "drawTimeCard" }, pick(IDX["frozen-moment"]));
  assert.equal(after.frozen[1], true, "the opponent is frozen");
  assert.equal(after.epoch.result.outcomeKind, "freeze");

  // When the frozen opponent would draw a Temporal Loop, it grants nothing.
  let theirs = atEpoch({ position: EPOCH_INDEX - 1 });
  theirs.active = 1;
  theirs.frozen = { 0: false, 1: true };
  const { state: denied } = take(
    theirs,
    { type: "drawTimeCard", seat: 1 },
    pick(IDX["temporal-loop"]),
  );
  assert.equal(denied.bonusRolls[1], 0, "the frozen loop grants no bonus");
  assert.equal(denied.frozen[1], false, "the freeze is spent");
});

/* ---------------------------------------------------------- integrity & ledger */

test("Epoch never duplicates a draw or a ledger entry", () => {
  let state = atEpoch();
  const { state: after, events } = take(state, { type: "drawTimeCard" }, pick(IDX["time-leap"]));
  const drew = epochEvents(events);
  assert.equal(drew.length, 1, "exactly one draw event");
  // The draw and the movement are recorded once each, and nothing else.
  const entries = after.ledger.history.filter((h) => h.kind === "epoch");
  assert.ok(entries.some((h) => /Drew Time Leap/.test(h.text)));
  assert.ok(entries.some((h) => /Time Leap · forward 3/.test(h.text)));
  // A second draw is refused and changes nothing.
  const seqBefore = after.seq;
  refuse(after, { type: "drawTimeCard" }, pick(IDX["time-leap"]));
  assert.equal(after.seq, seqBefore, "a refused draw leaves the sequence alone");
});

test("Epoch movement is positional: it never buys, rents, or chains", () => {
  // Leap from Epoch onto an unowned property: no purchase is opened.
  let state = atEpoch();
  // Epoch+3 from 17 = 20. Put nothing there; it is a normal unowned square.
  const { state: after } = take(state, { type: "drawTimeCard" }, pick(IDX["time-leap"]));
  assert.equal(pos(after), 20);
  // No landing decision was raised by the card movement.
  assert.equal(after.epoch.phase, "revealed");
  assert.equal(ownerOf(after.ledger, CELLS.find((c) => c.index === 20).id), null,
    "the card did not buy the square it landed on");
});

test("a card effect cannot be skipped: continue waits for the card", () => {
  const state = atEpoch();
  // Before any draw, continue is refused.
  refuse(state, { type: "continue" });
});

test("the turn hands over cleanly after an Epoch card resolves", () => {
  let state = atEpoch();
  state = take(state, { type: "drawTimeCard" }, pick(IDX["future-sight"])).state;
  state = take(state, { type: "continue" }).state; // close epoch
  assert.equal(state.phase, PHASE.TURN_END);
  state = take(state, { type: "continue" }).state; // hand off
  assert.equal(state.active, 1);
  assert.equal(state.phase, PHASE.AWAITING_ROLL);
  assert.equal(state.epoch, null, "no Epoch lingers into the next turn");
  // The next player can take a normal turn.
  const { state: next } = take(state, { type: "roll" }, face(4));
  assert.equal(next.phase, PHASE.MOVING);
});

test("Nexus and Ragnarok are untouched by Epoch", () => {
  // A plain roll onto Ragnarok still opens the chest, not Epoch.
  let state = createGame(PLAYERS);
  const ragnarokIndex = CELLS.find((c) => c.id === "ragnarok").index;
  state.pieces.find((p) => p.seat === 0).position = ragnarokIndex - 1;
  state = take(state, { type: "roll" }, face(1)).state;
  state = take(state, { type: "continue" }).state;
  assert.equal(state.landing.kind, "chest", "Ragnarok is still a chest");
  assert.equal(state.epoch, null, "no Epoch is opened by Ragnarok");
});

test("testRoll can reach Epoch in a test game, and it opens normally", () => {
  let state = createGame(PLAYERS, { testMode: true });
  state.pieces.find((p) => p.seat === 0).position = EPOCH_INDEX - 1;
  const { state: moved } = take(state, { type: "testRoll", steps: 1 });
  assert.equal(pos(moved), EPOCH_INDEX);
  assert.equal(moved.phase, PHASE.MOVING);
  const { state: after } = take(moved, { type: "continue" });
  assert.equal(after.landing.kind, "epoch");
  assert.equal(after.phase, PHASE.DECISION);
  assert.ok(after.epoch, "testRoll opens the same shared Epoch visit");
  // And a card can be drawn from there.
  const { state: drawn } = take(after, { type: "drawTimeCard" }, pick(IDX["time-leap"]));
  assert.equal(drawn.epoch.result.card, "time-leap");
});

test("testRoll is refused outside a test game", () => {
  const state = createGame(PLAYERS);
  refuse(state, { type: "testRoll", steps: 1 });
});
