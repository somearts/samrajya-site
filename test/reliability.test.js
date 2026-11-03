/* ==========================================================================
   FINAL RELIABILITY AUDIT - targeted regression tests

   Every money path, every ending boundary, every duplicate/out-of-turn
   guard, and the START/Epoch reward question, exercised through the real
   applyAction pipeline:

   - OBLIVION fires from CARD effects (Nexus) as well as rent, inclusive at
     -500, and never at -499; the end is recorded once and gates everything.
   - Boundary transactions: vessel at 500/499, suits at price/price-1,
     discounts applied exactly once, double presses refused with the state
     untouched, prayers charged once.
   - START: a die landing on Start pays ₹200 once per lap; an Epoch card's
     move crossing Start earns the same lap on the same terms (it is a
     movement, and it lands by the same rules), and a backward rewind never
     earns.
   - Out-of-turn and duplicate actions change nothing and do not advance seq.
   - Circuit expiry of a carried suit, with and without an unused discount.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  OBLIVION_AT,
  PHASE,
  applyAction,
  createGame,
  serializeGame,
  restoreGame,
} from "../shared/game.js";
import { CELLS } from "../shared/spaces.js";
import { priceOf, REDEMPTION } from "../shared/economy.js";
import { SUITS, suitById, discountPrice } from "../shared/suits.js";
import { moneyOf, rentAt, sheetFor } from "../shared/ledger.js";
import { drawNexusCard, NEXUS_PRAY_COST } from "../shared/nexus-cards.js";
import { drawTimeCard } from "../shared/epoch-cards.js";

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
  assert.equal(result.state.seq, state.seq, "a refusal does not advance the sequence");
  return result;
}

/** An rng value in [0,1) that makes a drawer pick the wanted item. */
function rngFor(draw, wanted) {
  for (let x = 0; x < 2000; x += 1) {
    const v = x / 2000;
    if (wanted(draw(() => v))) return () => v;
  }
  throw new Error("no rng value found");
}

const outerIndex = CELLS.findIndex((c) => c.id === "outer-space");

/* --------------------------------------------- OBLIVION through a card effect */

test("a Nexus card can carry a purse across the threshold: exactly -500 ends the game", () => {
  const minus150 = rngFor(drawNexusCard, (card) => card.amount === -150);
  const state = createGame(PLAYERS, {});
  sheetFor(state.ledger, "moon").owner = 1;
  state.ledger.players[0].money = OBLIVION_AT + 150; // -350 before the reveal
  state.phase = PHASE.DECISION;
  state.landing = { seat: 0, index: 10, id: "nexus", kind: "chest" };
  state.visit = { seat: 0, prayed: false, nexusDrawn: false, nexusCard: null, drawn: null, collected: false, bought: false, upgrades: 0, rent: 0, paid: false, short: 0, redemption: 0 };
  state.chest = { kind: "nexus", playerId: 0, phase: "open", startedAt: 1, choice: null, result: null };

  const drawn = take(state, { type: "drawNexus" }, minus150);
  const { state: revealed, events } = take(drawn.state, { type: "revealNexus" }, rngNothing);

  assert.equal(moneyOf(revealed.ledger, 0), -500, "the card pushed the purse to exactly the threshold");
  assert.ok(revealed.over, "the game ended inside the card effect's action");
  assert.equal(revealed.over.loser, 0);
  assert.equal(revealed.over.winner, 1);
  assert.equal(events.filter((e) => e.type === "oblivion").length, 1, "recorded exactly once");
  assert.equal(events.filter((e) => e.type === "nexusRevealed").length, 1, "the card resolved exactly once");

  // From here, nothing at all is accepted - including the chest's own closing.
  refuse(revealed, { type: "revealNexus" }, "This game has ended.");
  refuse(revealed, { type: "continue" }, "This game has ended.");
  refuse(revealed, { type: "done" }, "This game has ended.");
  refuse(revealed, { type: "roll", seat: 1 }, "This game has ended.");
});

test("a card landing on -499 is only debt: the game continues", () => {
  const minus150 = rngFor(drawNexusCard, (card) => card.amount === -150);
  const state = createGame(PLAYERS, {});
  state.ledger.players[0].money = -349;
  state.phase = PHASE.DECISION;
  state.landing = { seat: 0, index: 10, id: "nexus", kind: "chest" };
  state.visit = { seat: 0, prayed: false, nexusDrawn: false, nexusCard: null, drawn: null, collected: false, bought: false, upgrades: 0, rent: 0, paid: false, short: 0, redemption: 0 };
  state.chest = { kind: "nexus", playerId: 0, phase: "open", startedAt: 1, choice: null, result: null };

  const drawn = take(state, { type: "drawNexus" }, minus150);
  const revealed = take(drawn.state, { type: "revealNexus" }).state;

  assert.equal(moneyOf(revealed.ledger, 0), -499, "one above the threshold");
  assert.equal(revealed.over, null, "no ending");
  // The reveal cannot resolve twice: the second attempt changes nothing.
  refuse(revealed, { type: "revealNexus" }, "That card has already been turned over.");
  assert.equal(moneyOf(revealed.ledger, 0), -499, "the duplicate press moved nothing");
});

/* ------------------------------------------------------- transaction boundaries */

test("the escape vessel at exactly ₹500 leaves the purse at zero and the game alive", () => {
  const state = createGame(PLAYERS, {});
  state.pieces[0].position = 14;
  state.phase = PHASE.DECISION;
  state.landing = { seat: 0, index: 14, id: "black-hole", kind: "hole" };
  state.hole = { playerId: 0, phase: "confined", startedAt: 1, entropy: 0, entropyRoll: false, escape: false };
  state.ledger.players[0].money = 500;

  const { state: bought, events } = take(state, { type: "acquireVessel" });
  assert.equal(moneyOf(bought.ledger, 0), 0, "charged exactly the price");
  assert.equal(bought.hole.phase, "released");
  assert.ok(events.some((e) => e.type === "holeVessel"));
  assert.equal(bought.over, null, "zero is not elimination");
});

test("the escape vessel at ₹499 is refused and changes nothing", () => {
  const state = createGame(PLAYERS, {});
  state.pieces[0].position = 14;
  state.phase = PHASE.DECISION;
  state.landing = { seat: 0, index: 14, id: "black-hole", kind: "hole" };
  state.hole = { playerId: 0, phase: "confined", startedAt: 1, entropy: 0, entropyRoll: false, escape: false };
  state.ledger.players[0].money = 499;

  refuse(state, { type: "acquireVessel" }, "A Relativistic Escape Vessel costs ₹500, and you do not hold that much.");
  assert.equal(moneyOf(state.ledger, 0), 499, "not a coin was taken");
  assert.equal(state.hole.phase, "confined", "still confined");
});

function atSpace(money) {
  const state = createGame(PLAYERS, {});
  state.phase = PHASE.DECISION;
  state.landing = { seat: 0, index: outerIndex, id: "outer-space", kind: "space" };
  state.space = { playerId: 0, phase: "selecting", startedAt: 1, expired: null, expiredNotice: false };
  state.ledger.players[0].money = money;
  return state;
}

test("a suit bought at exactly its price leaves zero; one rupee short is refused", () => {
  const quantum = suitById("quantum-one");
  const exact = atSpace(quantum.price);
  const { state: bought, events } = take(exact, { type: "acquireSuit", suitId: "quantum-one" });
  assert.equal(moneyOf(bought.ledger, 0), 0, "charged exactly the price");
  assert.ok(bought.suits?.[0], "the suit is carried");
  assert.equal(bought.space.phase, "acquired", "the acquisition popup is the state");
  assert.ok(events.some((e) => e.type === "suitAcquired"));
  assert.equal(bought.over, null, "zero is not elimination");

  const short = atSpace(quantum.price - 1);
  refuse(short, { type: "acquireSuit", suitId: "quantum-one" }, `You need 1 more for the ${quantum.name}.`);
  assert.equal(moneyOf(short.ledger, 0), quantum.price - 1, "nothing was taken");
  assert.equal(short.suits?.[0], undefined, "no suit was carried");
  assert.equal(short.space.phase, "selecting", "still choosing");

  // A second acquisition is refused from either guard: the popup has moved on...
  refuse(bought, { type: "acquireSuit", suitId: "quantum-one" }, "You have already chosen your suit.");
  // ...and a stale selection with a carried suit cannot stack one.
  const stacked = atSpace(2000);
  stacked.suits = { 0: { id: "quantum-one", discount: 15, price: 150, used: false, since: 0 } };
  refuse(stacked, { type: "acquireSuit", suitId: "photon-weave" }, "You are already carrying a suit.");
  assert.equal(stacked.suits[0].id, "quantum-one", "the carried suit is untouched");
});

test("the suit discount is charged exactly once: the first buy, never the second", () => {
  const photon = suitById("photon-weave"); // 25%
  const state = createGame(PLAYERS, {});
  state.phase = PHASE.DECISION;
  state.landing = { seat: 0, index: 1, id: "moon", kind: "buy" };
  state.visit = { seat: 0, bought: false, upgrades: 0, drawn: null, collected: false, rent: 0, paid: false, short: 0, redemption: 0 };
  state.suits = { 0: { id: "photon-weave", discount: photon.discount, price: photon.price, used: false, since: 0 } };
  state.ledger.players[0].money = 2000;

  const before = moneyOf(state.ledger, 0);
  const discounted = discountPrice(priceOf("moon"), photon.discount);
  const { state: bought, events } = take(state, { type: "buy" });
  assert.equal(before - moneyOf(bought.ledger, 0), discounted, "the discount applied on the purchase price");
  assert.equal(bought.suits[0].used, true, "consumed by that very purchase");
  assert.ok(events.find((e) => e.type === "bought").price === discounted, "the event carries the charged figure");

  // Later, with the same suit marked used, a buy pays the full price.
  const later = createGame(PLAYERS, {});
  later.phase = PHASE.DECISION;
  later.landing = { seat: 0, index: 1, id: "moon", kind: "buy" };
  later.visit = { seat: 0, bought: false, upgrades: 0, drawn: null, collected: false, rent: 0, paid: false, short: 0, redemption: 0 };
  later.suits = { 0: { id: "photon-weave", discount: photon.discount, price: photon.price, used: true, since: 0 } };
  later.ledger.players[0].money = 2000;
  const full = take(later, { type: "buy" }).state;
  assert.equal(2000 - moneyOf(full.ledger, 0), priceOf("moon"), "a used suit charges nothing extra off");
});

test("the temple offering is charged once: a second prayer is refused", () => {
  const state = createGame(PLAYERS, {});
  state.phase = PHASE.DECISION;
  state.landing = { seat: 0, index: 10, id: "nexus", kind: "chest" };
  state.visit = { seat: 0, prayed: false, nexusDrawn: false, nexusCard: null, drawn: null, collected: false, bought: false, upgrades: 0, rent: 0, paid: false, short: 0, redemption: 0 };
  state.chest = { kind: "nexus", playerId: 0, phase: "open", startedAt: 1, choice: null, result: null };
  state.ledger.players[0].money = 1000;

  const { state: prayed } = take(state, { type: "pray" });
  assert.equal(moneyOf(prayed.ledger, 0), 1000 - NEXUS_PRAY_COST, "charged once");
  refuse(prayed, { type: "pray" }, "You have already made your offering.");
  assert.equal(moneyOf(prayed.ledger, 0), 1000 - NEXUS_PRAY_COST, "the duplicate press moved nothing");
});

test("a duplicate buy is refused and the purchase is charged once", () => {
  const state = createGame(PLAYERS, {});
  state.phase = PHASE.DECISION;
  state.landing = { seat: 0, index: 1, id: "moon", kind: "buy" };
  state.visit = { seat: 0, bought: false, upgrades: 0, drawn: null, collected: false, rent: 0, paid: false, short: 0, redemption: 0 };
  state.ledger.players[0].money = 2000;

  const first = take(state, { type: "buy" });
  assert.equal(2000 - moneyOf(first.state.ledger, 0), priceOf("moon"), "charged once");
  // The phase has moved: the repeat cannot charge again.
  refuse(first.state, { type: "buy" }, "There is nothing to buy here.");
  assert.equal(moneyOf(first.state.ledger, 0), 2000 - priceOf("moon"), "still one charge");
});

/* ------------------------------------------------------- out of turn, stale seq */

test("an out-of-turn action is refused without touching state or seq", () => {
  const state = createGame(PLAYERS, {});
  const before = state.seq;
  refuse(state, { type: "roll", seat: 1 }, "It is not your turn.");
  assert.equal(state.seq, before, "the sequence stands");
  // The test throw is gated behind test mode first, ownership second.
  refuse(state, { type: "testRoll", steps: 3 }, "Test mode is not enabled for this game.");
  assert.equal(state.seq, before, "still standing");
  const tm = createGame(PLAYERS, { testMode: true });
  const tmBefore = tm.seq;
  refuse(tm, { type: "testRoll", steps: 3, seat: 1 }, "It is not your turn.");
  assert.equal(tm.seq, tmBefore, "test throws obey the same ownership");
});

/* --------------------------------------------------- START and Epoch rewards */

test("landing exactly on Start pays the lap reward once, at the turn's end", () => {
  const state = createGame(PLAYERS, {});
  state.pieces[0].position = 27;
  const rolled = take(state, { type: "roll" }, face(1)); // 27 + 1 = 28 -> 0

  assert.equal(rolled.state.pieces[0].position, 0, "landed exactly on Start");
  assert.equal(rolled.state.visit.redemption, 200, "the lap is earned once");
  assert.equal(moneyOf(rolled.state.ledger, 0), 2000, "paid only when the turn resolves");

  const resolving = take(rolled.state, { type: "continue" }).state; // kind "none" -> RESOLVING
  const atTurnEnd = take(resolving, { type: "continue" }).state; // -> TURN_END
  assert.equal(atTurnEnd.phase, PHASE.TURN_END);
  const { state: ended, events } = take(atTurnEnd, { type: "continue" }); // the handover pays
  const paid = events.filter((e) => e.type === "redemption");
  assert.equal(paid.length, 1, "exactly one reward for one crossing");
  assert.equal(paid[0].amount, 200, "and it is the full ₹200");
  assert.equal(moneyOf(ended.ledger, 0), 2200, "the purse carries it");
  assert.equal(ended.visit, null, "the visit is cleared with the turn - a later lap must earn again");
});

test("Epoch forward movement across START earns the lap reward like a throw", () => {
  // Time Leap (3 forward) from 26 lands on 1: the same crossing a throw makes.
  // A Time Card's move is a movement, and a movement crossing START earns the
  // lap - recorded on the visit, paid when the turn resolves, never twice.
  const leapRng = rngFor(drawTimeCard, (card) => card.effect === "leap");
  const state = createGame(PLAYERS, {});
  state.pieces[0].position = 26;
  state.phase = PHASE.DECISION;
  state.landing = { seat: 0, index: 26, id: "epoch", kind: "epoch" };
  state.visit = { seat: 0, bought: false, upgrades: 0, drawn: null, collected: false, rent: 0, paid: false, short: 0, redemption: 0 };
  state.epoch = { playerId: 0, phase: "open", startedAt: 1, cardId: null, result: null, rewindSteps: 0, fracturePos: 0 };

  // The draw reads the card; the wheel has not turned yet.
  const { state: drawn } = take(state, { type: "drawTimeCard" }, leapRng);
  assert.equal(drawn.pieces[0].position, 26, "nothing moves on the draw");

  // DONE walks it across START, and the square answers by the normal rules.
  const { state: moved, events } = take(drawn, { type: "continue" });
  assert.equal(moved.pieces[0].position, 1, "the leap crossed START");
  assert.equal(moved.visit.redemption, REDEMPTION, "the lap credit rides on the visit");
  assert.equal(events.some((e) => e.type === "redemption"), false, "the reward is paid when the turn resolves, not now");
  assert.equal(moneyOf(moved.ledger, 0), 2000, "the purse did not move yet");
});

test("the Alternate Timeline's forward step across START earns the same reward", () => {
  const state = createGame(PLAYERS, {});
  state.pieces[0].position = 27;
  state.phase = PHASE.DECISION;
  state.landing = { seat: 0, index: 27, id: "epoch", kind: "epoch" };
  state.visit = { seat: 0, bought: false, upgrades: 0, drawn: null, collected: false, rent: 0, paid: false, short: 0, redemption: 0 };
  state.epoch = { playerId: 0, phase: "choosing", startedAt: 1, cardId: "timeline", result: {}, rewindSteps: 0, fracturePos: 0 };

  const { state: chosen } = take(state, { type: "epochChoice", option: "forward" });
  assert.equal(chosen.pieces[0].position, 27, "the choice is read before the wheel turns");
  const { state: moved, events } = take(chosen, { type: "continue" });
  assert.equal(moved.pieces[0].position, 1, "27 + 2 wrapped to 1");
  assert.equal(moved.visit.redemption, REDEMPTION, "the lap credit rides on the visit");
  assert.equal(events.some((e) => e.type === "redemption"), false, "no reward before the turn resolves");
  assert.equal(moneyOf(moved.ledger, 0), 2000, "the purse did not move");
});

test("a Time Rewind never earns a reward going backward", () => {
  const rewindRng = rngFor(drawTimeCard, (card) => card.effect === "rewind");
  const state = createGame(PLAYERS, {});
  state.pieces[0].position = 2;
  state.phase = PHASE.DECISION;
  state.landing = { seat: 0, index: 2, id: "epoch", kind: "epoch" };
  state.visit = { seat: 0, bought: false, upgrades: 0, drawn: null, collected: false, rent: 0, paid: false, short: 0, redemption: 0 };
  state.epoch = { playerId: 0, phase: "open", startedAt: 1, cardId: null, result: null, rewindSteps: 5, fracturePos: 0 };

  const { state: drawn } = take(state, { type: "drawTimeCard" }, rewindRng);
  assert.equal(drawn.pieces[0].position, 2, "the rewind waits for DONE");
  const { state: moved, events } = take(drawn, { type: "continue" });
  assert.equal(moved.pieces[0].position, 25, "wrapped backward around START");
  assert.equal(moved.visit.redemption, 0, "backward movement never earns");
  assert.equal(events.some((e) => e.type === "redemption"), false, "no reward");
  assert.equal(moneyOf(moved.ledger, 0), 2000, "the purse did not move");
});

/* ------------------------------------------------- circuit expiry of a suit */

test("returning to Outer Space retires a carried suit, announcing only an unused one", () => {
  const outer = outerIndex;
  const mk = (used) => {
    const s = createGame(PLAYERS, { testMode: true });
    s.pieces[0].position = (outer - 1 + 28) % 28;
    s.suits = { 0: { id: "quantum-one", discount: 15, price: 150, used: used, since: 0 } };
    return s;
  };

  const unused = mk(false);
  const risen = take(unused, { type: "testRoll", steps: 1 });
  assert.equal(risen.state.landing.id, "outer-space", "back where it began");
  assert.equal(risen.state.landing.kind, "space");
  const opened = take(risen.state, { type: "continue" }).state;
  assert.equal(opened.phase, PHASE.DECISION, "the counter is the decision");
  assert.ok(opened.suits[0] == null, "the carried suit is retired");
  assert.equal(opened.space.expired, "quantum-one", "the panel knows what fell");
  assert.equal(opened.space.expiredNotice, true, "the unused discount is announced");

  const spent = mk(true);
  const risen2 = take(spent, { type: "testRoll", steps: 1 });
  const opened2 = take(risen2.state, { type: "continue" }).state;
  assert.ok(opened2.suits[0] == null, "retired either way");
  assert.equal(opened2.space.expiredNotice, false, "a spent discount is retired silently");
});

/* --------------------------------- THE REPORTED FREEZE, REPLAYED END TO END

   The production report: land at Outer Space, buy a suit, play a full
   circuit, land again - and the game froze with no way to finish the turn.
   The engine was clean (the freeze was a client draw crash), so this pins
   the SEQUENCE itself at the rules level for every suit state, including
   the serialize/restore a refresh performs mid-visit, and proves the turn
   always hands over. The client half of the fix is covered by
   `scripts/e2e-space-return.mjs` (four scenarios, real browser, real
   clicks) - see package.json `test:space`. */
test("the reported sequence resolves for every suit state: land, buy, circuit, land again, hand over", () => {
  for (const mode of ["buy-unused", "buy-used", "never"]) {
    const label = `${mode}: `;
    let state = createGame(PLAYERS, { testMode: true });
    const act = (action, rng) => {
      const res = applyAction(state, action, rng || rngNothing);
      const no = res.events.find((e) => e.type === "refused");
      assert.equal(no, undefined, `${label}refused ${action.type}: ${no?.why}`);
      state = res.state;
      return res;
    };
    /** Let a throw's walk finish: MOVING/RESOLVING settle into the decision
        (the client's `settle()` does this; the engine waits for it). */
    const toDecision = () => {
      for (let i = 0; i < 8 && state.phase !== PHASE.DECISION; i += 1) {
        act({ type: "continue" });
      }
      assert.equal(state.phase, PHASE.DECISION, `${label}the walk settles into the decision`);
    };
    /** Walk any post-landing phases until the seat is waiting to throw. */
    const untilAwaiting = (seat) => {
      for (let i = 0; i < 12; i += 1) {
        if (state.phase === PHASE.AWAITING_ROLL && state.active === seat) return;
        if (state.phase === PHASE.DECISION) {
          // A property the player does not want; every decision resolves forward.
          act(state.landing?.kind === "buy" || state.landing?.kind === "own"
            ? { type: "pass" }
            : { type: "continue" });
          continue;
        }
        act({ type: "continue" });
      }
      throw new Error(`${label}never reached AWAITING_ROLL for seat ${seat}`);
    };

    /* 1. First landing at Outer Space. */
    act({ type: "testRoll", steps: outerIndex });
    assert.equal(state.landing.id, "outer-space", `${label}first landing`);
    toDecision();

    /* 2. The visit: buy, decline, or buy-and-spend. */
    if (mode === "never") {
      act({ type: "continue" }); // close the counter without buying
      untilAwaiting(1);
    } else {
      act({ type: "acquireSuit", suitId: "quantum-one" });
      assert.equal(state.space.phase, "acquired", `${label}the popup is the state`);
      assert.ok(state.suits[0] && state.suits[0].used === false, `${label}carried unspent`);
      if (mode === "buy-used") {
        state.suits = { ...state.suits, 0: { ...state.suits[0], used: true } };
      }
      act({ type: "continue" }); // leave the popup
      untilAwaiting(1);
    }

    /* 3. The opponent throws one square and passes. */
    act({ type: "testRoll", steps: 1 });
    untilAwaiting(0);

    /* 4. The full circuit back to Outer Space, from wherever the walk left
       them (the buy-used detour moved them off the start-relative spot). */
    const here = state.pieces[0].position;
    act({ type: "testRoll", steps: (outerIndex - here + 28) % 28 || 28 });
    assert.equal(state.landing.id, "outer-space", `${label}second landing`);
    toDecision();
    assert.ok((state.suits || {})[0] == null, `${label}the suit retired on return`);

    /* The second landing exactly as both clients hold it - and exactly as a
       REFRESH rebuilds it: serialize, restore, same facts, still resolvable. */
    const restored = restoreGame(serializeGame(state));
    assert.deepEqual(
      { space: restored.space, suits: restored.suits, phase: restored.phase },
      { space: state.space, suits: state.suits, phase: state.phase },
      `${label}the restored visit is the same visit`,
    );
    state = restored;

    /* What this visit shows, per suit state (the client draws from these). */
    if (mode === "buy-unused") {
      assert.equal(state.space.expired, "quantum-one", `${label}expiry notice state`);
      assert.equal(state.space.expiredNotice, true, `${label}unused -> announced`);
    } else {
      assert.equal(state.space.expiredNotice, false, `${label}silent retirement`);
    }

    /* 5. THE FIX'S GUARANTEE: the visit finishes and the turn hands over. */
    act({ type: "continue" });
    assert.equal(state.phase, PHASE.TURN_END, `${label}the leave closes the visit`);
    assert.equal(state.space, null, `${label}the counter is cleared`);
    act({ type: "continue" });
    assert.equal(state.phase, PHASE.AWAITING_ROLL, `${label}the game continues`);
    assert.equal(state.active, 1, `${label}handed to the opponent`);
  }
});
