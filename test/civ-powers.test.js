/* ==========================================================================
   THE CIVILIZATIONS' POWERS

   Four powers and one rule they all share: the gift belongs to that seat's
   FIRST throw of the die, it fires at most once, and it expires with that
   throw whether or not the landing kept its promise.

   Both halves of the rule live in the state the server owns - `firstRoll`
   says the throw has gone, `civGift` carries whatever it promised - so these
   tests are also the proof that a refresh, a reconnect or a second press
   cannot make a power fire twice.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PHASE,
  applyAction,
  createGame,
  pieceAt,
  restoreGame,
  serializeGame,
} from "../shared/game.js";
import { moneyOf, ownerOf } from "../shared/ledger.js";
import { priceOf } from "../shared/economy.js";
import { CELLS } from "../shared/spaces.js";
import { WEAPONS } from "../shared/weapons.js";

/** A two-player game in which seat 0 plays `civ`. */
function game(civ, opponent = "ancient-greek") {
  return createGame([
    { name: "Aster", civ },
    { name: "Vega", civ: opponent },
  ]);
}

/** An rng that always lands the die on `n`. */
const face = (n) => () => (n - 0.5) / 6;

/** Apply an action and insist it was accepted. */
function take(state, action, rng) {
  const result = applyAction(state, action, rng);
  const no = result.events.find((e) => e.type === "refused");
  assert.equal(no, undefined, `refused: ${no?.why}`);
  return result;
}

/** Apply an action and insist it was refused, returning the reason. */
function refuse(state, action, rng) {
  const result = applyAction(state, action, rng);
  const no = result.events.find((e) => e.type === "refused");
  assert.ok(no, "expected a refusal");
  assert.equal(result.state, state, "a refusal changes nothing");
  return no;
}

/** The board index of a square, by id. */
const idx = (id) => CELLS.find((c) => c.id === id).index;

/** Answer a decision the way a player would, then walk the turn to its end. */
function passAndEnd(state) {
  let s = state;
  // The coin has to stop first: `continue` is what walks MOVING into whatever
  // the square wants to ask.
  while (s.phase === PHASE.MOVING) s = take(s, { type: "continue" }).state;
  if (s.phase === PHASE.DECISION && ["buy", "own"].includes(s.landing?.kind)) {
    s = take(s, { type: "pass" }).state;
  }
  for (let i = 0; i < 6 && s.phase !== PHASE.AWAITING_ROLL; i += 1) {
    s = take(s, { type: "continue" }).state;
  }
  assert.equal(s.phase, PHASE.AWAITING_ROLL, "the turn is over and the die is back");
  return s;
}

/* ------------------------------------------------------------- Indus Valley */

test("Indus Valley's first acquisition is blessed with â‚¹50", () => {
  let state = game("indus-valley");
  state = take(state, { type: "roll" }, face(1)).state; // one step: the Moon
  assert.equal(state.firstRoll[0], true, "the first throw has been spent");
  assert.equal(state.civGift[0], "first-acquisition", "the landing kept the promise");

  state = take(state, { type: "continue" }).state;
  assert.equal(state.landing.kind, "buy");

  const { state: bought, events } = take(state, { type: "buy" });
  assert.equal(ownerOf(bought.ledger, "moon"), 0, "the square is theirs");
  assert.equal(moneyOf(bought.ledger, 0), 5000 - 200 + 50, "the price, and the gods' return");
  assert.equal(events[0].blessing, 50, "the blessing is said in the event");
  assert.equal(bought.civGift[0], null, "the promise is spent");
  assert.ok(
    bought.ledger.history.some((h) => h.kind === "blessing" && h.amount === 50),
    "and recorded in the ledger",
  );
});

test("Indus Valley's blessing expires with the first throw if it is not used", () => {
  let state = game("indus-valley");
  state = take(state, { type: "roll" }, face(1)).state; // the Moon, unowned
  state = take(state, { type: "continue" }).state;
  state = take(state, { type: "pass" }).state; // ... and not bought
  state = passAndEnd(state);

  assert.equal(state.civGift[0], null, "nothing survived the turn");
  assert.equal(state.firstRoll[0], true, "and the first throw has gone for good");

  // A later throw onto an unowned square promises nothing.
  state = take(state, { type: "roll" }, face(1)).state; // Vega's throw
  state = passAndEnd(state);
  assert.equal(state.firstRoll[1], true);

  const second = take(state, { type: "roll" }, face(1)).state; // Aster again
  assert.equal(second.firstRoll[0], true);
  assert.equal(second.civGift[0], null, "the second throw carries no promise");
  const decided = take(second, { type: "continue" }).state;
  assert.equal(decided.landing.kind, "buy");
  const { state: paid } = take(decided, { type: "buy" });
  assert.equal(
    moneyOf(paid.ledger, 0),
    5000 - priceOf(decided.landing.id),
    "the second acquisition is ordinary - no blessing",
  );
});

/* ------------------------------------------------------------ Mesopotamian */

test("Mesopotamian's first journey to Ragnarok brings two weapons", () => {
  let state = game("mesopotamian");
  state = take(state, { type: "roll" }, face(4)).state; // four steps: Ragnarok
  assert.equal(state.landing.id, "ragnarok");
  assert.equal(state.civGift[0], "two-weapons", "the heavens were asked");

  state = take(state, { type: "continue" }).state;
  state = take(state, { type: "drawWeapon" }, () => 0.15).state; // antimatter
  const { state: collected } = take(state, { type: "collectWeapon" }, () => 0);

  assert.deepEqual(
    collected.pieces[0].weapons,
    [WEAPONS[0].id, WEAPONS[1].id],
    "two cards arrive from one press",
  );
  assert.equal(collected.civGift[0], null, "the promise is spent");
});

test("Mesopotamian's later visit to Ragnarok brings one weapon", () => {
  let state = game("mesopotamian");
  state = take(state, { type: "roll" }, face(1)).state; // the Moon: not Ragnarok
  assert.equal(state.civGift[0], null);
  state = take(state, { type: "continue" }).state;
  state = passAndEnd(state);

  state = take(state, { type: "roll" }, face(1)).state; // Vega's throw
  state = passAndEnd(state);

  // Two steps from the Moon: 1 -> 4, Ragnarok - on the SECOND throw.
  const atChest = take(state, { type: "roll" }, face(3)).state;
  assert.equal(atChest.landing.id, "ragnarok");
  assert.equal(atChest.civGift[0], null, "the second throw promises nothing");

  const walked = take(atChest, { type: "continue" }).state;
  const drawn = take(walked, { type: "drawWeapon" }, () => 0.15).state;
  const { state: collected } = take(drawn, { type: "collectWeapon" }, () => 0);
  assert.deepEqual(collected.pieces[0].weapons, [WEAPONS[0].id], "one card, as ever");
});

/* ------------------------------------------------------------ Ancient Greek */

test("Ancient Greek takes Jupiter without tribute on the first throw", () => {
  let state = game("ancient-greek");
  state = take(state, { type: "roll" }, face(5)).state; // five steps: Jupiter
  assert.equal(state.landing.id, "jupiter");
  assert.equal(state.civGift[0], "free-jupiter", "the throne is promised");

  state = take(state, { type: "continue" }).state;
  const { state: bought, events } = take(state, { type: "buy" });

  assert.equal(ownerOf(bought.ledger, "jupiter"), 0, "the throne is theirs");
  assert.equal(events[0].price, 0, "no tribute was taken");
  assert.equal(moneyOf(bought.ledger, 0), 5000, "and the purse did not move");
  assert.equal(bought.civGift[0], null, "the promise is spent");
});

test("Ancient Greek pays for Jupiter on every throw after the first", () => {
  let state = game("ancient-greek");
  state = take(state, { type: "roll" }, face(1)).state; // the Moon: no promise
  assert.equal(state.civGift[0], null);
  state = take(state, { type: "continue" }).state;
  state = passAndEnd(state);

  state = take(state, { type: "roll" }, face(1)).state; // Vega's throw
  state = passAndEnd(state);

  // From the Moon, four steps: 1 -> 5, Jupiter - on the SECOND throw.
  const atThrone = take(state, { type: "roll" }, face(4)).state;
  assert.equal(atThrone.landing.id, "jupiter");
  assert.equal(atThrone.civGift[0], null, "the second throw promises nothing");

  const walked = take(atThrone, { type: "continue" }).state;
  const { state: bought } = take(walked, { type: "buy" });
  assert.equal(ownerOf(bought.ledger, "jupiter"), 0);
  assert.equal(moneyOf(bought.ledger, 0), 5000 - priceOf("jupiter"), "full tribute is paid");
});

/* ----------------------------------------------------------- Ancient Roman */

test("Ancient Roman's first throw is a six and carries them to Pluto", () => {
  let state = game("ancient-roman");
  const { state: rolled, events } = take(state, { type: "roll" }, face(1)); // the rng says ONE

  assert.equal(rolled.lastRoll.face, 6, "the die itself is a six");
  assert.equal(events.find((e) => e.type === "moved").face, 6, "and the walk is that six");
  assert.equal(pieceAt(rolled, 0).position, idx("pluto"), "six steps from Start: Pluto");
  assert.equal(rolled.landing.id, "pluto");
  assert.equal(rolled.firstRoll[0], true, "the first throw is spent");

  // And Pluto is bought the ordinary way, at the ordinary price.
  const walked = take(rolled, { type: "continue" }).state;
  assert.equal(walked.landing.kind, "buy");
  const { state: bought } = take(walked, { type: "buy" });
  assert.equal(moneyOf(bought.ledger, 0), 5000 - priceOf("pluto"));
});

test("Ancient Roman's throws after the first are ordinary", () => {
  let state = game("ancient-roman");
  state = take(state, { type: "roll" }, face(1)).state; // forced six, to Pluto
  state = take(state, { type: "continue" }).state;
  state = passAndEnd(state);

  state = take(state, { type: "roll" }, face(1)).state; // Vega's throw
  state = passAndEnd(state);

  const second = take(state, { type: "roll" }, face(1)).state; // Aster again, rng says ONE
  assert.equal(second.lastRoll.face, 1, "the second throw is whatever the rng says");
  assert.equal(pieceAt(second, 0).position, idx("pluto") + 1, "one step from Pluto");
});

/* ------------------------------------------------------ the fact, persisted */

test("the first throw is remembered across a refresh, and cannot fire twice", () => {
  let state = game("ancient-roman");
  state = take(state, { type: "roll" }, face(1)).state;

  // What a refresh does: the state is serialised and read back.
  const restored = restoreGame(JSON.parse(JSON.stringify(serializeGame(state))));
  assert.equal(restored.firstRoll[0], true, "the throw is still spent");
  assert.equal(pieceAt(restored, 0).position, idx("pluto"), "and so is its six");

  // A retried press of the same throw changes nothing the power cares about.
  const retried = applyAction(restored, { type: "roll", seat: 0 }, face(6));
  assert.ok(
    retried.events.some((e) => e.type === "refused"),
    "a second throw in the same phase is refused",
  );
  assert.equal(retried.state.firstRoll[0], true);
});

test("a refused press never spends the first throw", () => {
  const state = game("ancient-roman");
  const no = refuse(state, { type: "roll", seat: 1 }, face(1)); // the wrong seat
  assert.match(no.why, /not your turn/i);
  assert.equal(state.firstRoll[0], false, "nothing was spent");
  assert.equal(state.firstRoll[1], false);
});

/* ------------------------------------------- the same promise on a test move */

test("a test move to Ragnarok brings Mesopotamian its two weapons", () => {
  const state = createGame(
    [
      { name: "Aster", civ: "mesopotamian" },
      { name: "Vega", civ: "ancient-greek" },
    ],
    { testMode: true },
  );

  const { state: moved } = take(state, { type: "testRoll", steps: 4 });
  assert.equal(moved.landing.id, "ragnarok", "four steps from Start: Ragnarok");
  assert.equal(moved.civGift[0], "two-weapons", "the promise reaches a test move too");
  assert.equal(moved.firstRoll[0], true, "and the throw is spent with it");

  const walked = take(moved, { type: "continue" }).state;
  const drawn = take(walked, { type: "drawWeapon" }, () => 0.15).state;
  const { state: collected } = take(drawn, { type: "collectWeapon" }, () => 0);
  assert.equal(collected.pieces[0].weapons.length, 2, "two actual cards in the arsenal");
  assert.equal(collected.civGift[0], null, "spent");
});

test("a test move to Jupiter is free for Ancient Greek, and only for the first", () => {
  const state = createGame(
    [
      { name: "Aster", civ: "ancient-greek" },
      { name: "Vega", civ: "indus-valley" },
    ],
    { testMode: true },
  );

  const { state: moved } = take(state, { type: "testRoll", steps: 5 });
  assert.equal(moved.landing.id, "jupiter", "five steps from Start: Jupiter");
  assert.equal(moved.civGift[0], "free-jupiter");

  const walked = take(moved, { type: "continue" }).state;
  const { state: bought, events } = take(walked, { type: "buy" });
  assert.equal(ownerOf(bought.ledger, "jupiter"), 0, "the throne is theirs");
  assert.equal(events[0].price, 0, "no tribute was taken");
  assert.equal(moneyOf(bought.ledger, 0), 5000, "and the purse did not move");
  assert.equal(bought.civGift[0], null, "the promise is spent");
});

test("a test move leaves Ancient Roman's first throw exactly as it was", () => {
  const state = createGame(
    [
      { name: "Aster", civ: "ancient-roman" },
      { name: "Vega", civ: "mesopotamian" },
    ],
    { testMode: true },
  );

  // A test move is a chosen number, not a die: it moves exactly as asked and
  // does not spend the throw Roman's six is written on.
  const { state: moved } = take(state, { type: "testRoll", steps: 3 });
  assert.equal(pieceAt(moved, 0).position, 3, "three steps, as asked");
  assert.equal(moved.firstRoll[0], false, "the first throw is still owed");
  assert.equal(moved.civGift[0], null, "and no promise was made");

  // Walking to the square it stopped on leaves that throw exactly where it
  // was: the first real die still decides Roman's six.
  const walked = take(moved, { type: "continue" }).state;
  assert.equal(walked.firstRoll[0], false, "the throw is still owed");
  assert.equal(walked.civGift[0], null);
});




