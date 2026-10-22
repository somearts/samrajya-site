/* ==========================================================================
   THE GAME

   One turn, one state machine, tested without a browser. This is the file that
   has to be right before anything is drawn: the phase route, the one place the
   active player changes, and every refusal a card can show.

   The dice are seeded by handing `applyAction` an rng that returns the middle of
   the band for a face, so "roll a four" is a fact in the test rather than a
   thing that happens nine times out of ten.

   Where a test needs a position a real game would take several laps to reach -
   landing on your own square, landing on somebody else's - the ledger is set up
   directly. That is not a shortcut around a rule: the rule under test is the
   landing, and the test says plainly what the board looked like before it.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ENABLE_SELL,
  PHASE,
  SALE_RATE,
  activeName,
  activeSeat,
  applyAction,
  advance,
  createGame,
  decisionFor,
  landingCell,
  pathFrom,
  pieceAt,
  seatAfter,
  sellOffer,
  upgradeOffer,
  visitOf,
  wantsDecision,
} from "../shared/game.js";
import {
  buy,
  canBuy,
  levelOf,
  moneyOf,
  ownerOf,
  payRent,
  saleValue,
  sell,
  sheetFor,
  upgrade,
} from "../shared/ledger.js";
import { baseRentOf, priceOf, upgradeAt } from "../shared/economy.js";
import { BAD_LUCK, RAGNAROK } from "../shared/weapons.js";
import { advance as coinAdvance } from "../authored/samrajya/assets/js/coins.js";

const PLAYERS = [
  { name: "Sam", civ: "indus-valley" },
  { name: "Smith", civ: "aztec" },
];

/** An rng that always lands the die on `n`. */
const face = (n) => () => (n - 0.5) / 6;

/** A fresh two-player game. */
function game(players = PLAYERS) {
  return createGame(players);
}

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

/** Move the active player onto a square, as if a roll had just put them there. */
function standOn(state, index, kind = "none") {
  const cell = { index, id: `cell-${index}` };
  state.pieces.find((p) => p.seat === state.active).position = index;
  state.landing = { seat: state.active, index, id: cell.id, kind };
  state.visit = {
    seat: state.active,
    bought: false,
    upgrades: 0,
    drawn: null,
    collected: false,
    rent: 0,
    paid: false,
  };
  state.phase = PHASE.DECISION;
  return state;
}

/* ------------------------------------------------------------- a new game */

test("a new game starts before the first throw, with every piece on Start", () => {
  const state = game();
  assert.equal(state.phase, PHASE.AWAITING_ROLL);
  assert.equal(state.active, 0);
  assert.equal(activeName(state), "Sam");
  assert.equal(state.turn, 0);
  assert.equal(state.seq, 0);
  assert.deepEqual(
    state.pieces.map((p) => p.position),
    [0, 0],
  );
  assert.deepEqual(
    state.pieces.map((p) => p.weapons),
    [[], []],
  );
  assert.equal(moneyOf(state.ledger, 0), 2000);
  assert.equal(moneyOf(state.ledger, 1), 2000);
  assert.equal(ownerOf(state.ledger, "moon"), null);
});

test("a game with no players has no active seat, and refuses everything", () => {
  const state = createGame([]);
  assert.equal(activeSeat(state), null);
  assert.equal(refuse(state, { type: "roll" }).why, "Nobody is playing.");
  assert.equal(refuse(state, { type: "upgrade" }).why, "Nobody is playing.");
});

/* ------------------------------------------------------------- the route */

test("a throw moves the piece and changes no turn", () => {
  const before = game();
  const { state, events } = take(before, { type: "roll" }, face(1));

  assert.equal(state.active, 0, "the active player did not move");
  assert.equal(state.phase, PHASE.MOVING);
  assert.equal(pieceAt(state, 0).position, 1);
  assert.deepEqual(
    events.map((e) => e.type),
    ["moved", "landed"],
  );
  assert.equal(events[0].from, 0);
  assert.equal(events[0].to, 1);
  assert.equal(events[0].steps, 1);
  assert.equal(events[1].id, "moon");
  assert.equal(state.landing.kind, "buy");
  assert.equal(before.pieces[0].position, 0, "the state handed in was not changed");
});

test("every event from one action carries one action number", () => {
  const { state, events } = take(game(), { type: "roll" }, face(2));
  assert.equal(state.seq, 1);
  assert.ok(events.every((e) => e.seq === 1), "one action, one number");
});

test("the coin stops in MOVING until the client says it has landed", () => {
  const { state } = take(game(), { type: "roll" }, face(1));
  assert.equal(state.phase, PHASE.MOVING);
  assert.equal(wantsDecision(state), false);

  const opened = take(state, { type: "continue" });
  assert.equal(opened.state.phase, PHASE.DECISION);
  assert.equal(opened.state.landing.kind, "buy");
  assert.equal(opened.state.active, 0, "still the same player's turn");
  assert.ok(wantsDecision(opened.state));
});

test("a square with nothing to decide goes to RESOLVING, not DECISION", () => {
  const before = game();
  before.pieces[0].position = 8; // Halley's Comet
  const { state } = take(before, { type: "roll" }, face(1)); // outer-space corner
  assert.equal(state.landing.kind, "none");
  const resolving = take(state, { type: "continue" }).state;
  assert.equal(resolving.phase, PHASE.RESOLVING);
  assert.equal(wantsDecision(resolving), false);
});

test("the turn ends only when TURN_END is continued, and then moves to the next seat", () => {
  let state = take(game(), { type: "roll" }, face(1)).state;
  state = take(state, { type: "continue" }).state; // DECISION
  state = take(state, { type: "buy" }).state; // RESOLVING
  assert.equal(state.active, 0);

  state = take(state, { type: "continue" }).state; // TURN_END
  assert.equal(state.phase, PHASE.TURN_END);
  assert.equal(state.active, 0, "still seat 0 until TURN_END is left");

  const changed = take(state, { type: "continue" });
  state = changed.state;
  assert.equal(state.active, 1);
  assert.equal(state.phase, PHASE.AWAITING_ROLL);
  assert.equal(state.turn, 1);
  assert.deepEqual(
    changed.events.map((e) => e.type),
    ["turnChanged"],
  );
  assert.equal(changed.events[0].from, 0);
  assert.equal(changed.events[0].to, 1);
  assert.equal(changed.events[0].name, "Smith");
  assert.equal(state.landing, null);
  assert.equal(state.visit, null);
});

test("the seats alternate, and a two-player game comes back round", () => {
  const state = game();
  assert.equal(seatAfter(state, 0), 1);
  assert.equal(seatAfter(state, 1), 0);
  assert.equal(seatAfter(game([{ name: "Only", civ: "aztec" }]), 0), 0);
});

/* --------------------------------------------------------------- throwing */

test("the die cannot be thrown while a visit is open", () => {
  let state = take(game(), { type: "roll" }, face(1)).state;
  state = take(state, { type: "continue" }).state;
  assert.equal(
    refuse(state, { type: "roll" }).why,
    "The die waits until the visit is over.",
  );
});

test("a seat that is not playing cannot throw or act", () => {
  const state = game();
  assert.equal(refuse(state, { type: "roll", seat: 1 }).why, "It is not your turn.");

  const atBuy = take(
    take(state, { type: "roll" }, face(1)).state,
    { type: "continue" },
  ).state;
  assert.equal(refuse(atBuy, { type: "buy", seat: 1 }).why, "It is not your turn.");
});

test("a move wraps at the end of the board, and the path is every square it touches", () => {
  const before = game();
  before.pieces[0].position = 26;
  const { state, events } = take(before, { type: "roll" }, face(4));
  assert.equal(pieceAt(state, 0).position, 2);
  // Crossing Start now emits a salary event first, so find the move itself.
  assert.deepEqual(events.find((e) => e.type === "moved").path, [26, 27, 0, 1, 2]);
});

test("the game's wrap and the coin layer's wrap cannot disagree", () => {
  for (let from = 0; from < 28; from += 1) {
    for (let steps = 1; steps <= 6; steps += 1) {
      assert.equal(advance(from, steps), coinAdvance(from, steps), `${from}+${steps}`);
    }
  }
});

/* --------------------------------------------------------------- buying */

test("landing on an unowned square offers Buy and Pass", () => {
  let state = take(game(), { type: "roll" }, face(1)).state;
  state = take(state, { type: "continue" }).state;
  const decision = decisionFor(state, "moon");
  assert.equal(decision.kind, "buy");
  assert.equal(decision.canBuy.ok, true);
  assert.equal(decision.owner, null);
  assert.deepEqual(
    [decision.canBuy.ok, decision.canSell.ok].filter(Boolean),
    [true],
    "a square nobody owns cannot be sold",
  );
});

test("Buy takes the square and the price, and ends the visit", () => {
  let state = take(game(), { type: "roll" }, face(1)).state;
  state = take(state, { type: "continue" }).state;
  const { state: bought, events } = take(state, { type: "buy" });

  assert.equal(bought.phase, PHASE.RESOLVING, "buying ends the visit");
  assert.equal(ownerOf(bought.ledger, "moon"), 0);
  assert.equal(moneyOf(bought.ledger, 0), 2000 - 200);
  assert.equal(events[0].type, "bought");
  assert.equal(events[0].price, 200);
  assert.equal(events[0].name, "Moon");
  assert.equal(visitOf(bought).bought, true);
});

test("Pass leaves the square unowned and ends the visit", () => {
  let state = take(game(), { type: "roll" }, face(1)).state;
  state = take(state, { type: "continue" }).state;
  const { state: passed, events } = take(state, { type: "pass" });
  assert.equal(passed.phase, PHASE.RESOLVING);
  assert.equal(ownerOf(passed.ledger, "moon"), null);
  assert.equal(moneyOf(passed.ledger, 0), 2000);
  assert.equal(events[0].type, "passed");
});

test("a square you cannot afford is offered, and refused by the rule", () => {
  const before = game();
  before.ledger.players[0].money = 10;
  let state = take(before, { type: "roll" }, face(1)).state;
  state = take(state, { type: "continue" }).state;
  const decision = decisionFor(state, "moon");
  assert.equal(decision.canBuy.ok, false);
  assert.match(decision.canBuy.why, /more/);
  assert.equal(refuse(state, { type: "buy" }).why, decision.canBuy.why);
  assert.equal(ownerOf(state.ledger, "moon"), null);
});

test("an owned square is not offered to the next player", () => {
  const before = game();
  buy(before.ledger, "moon", 0);
  before.active = 1;
  before.turn = 1;
  const { state } = take(before, { type: "roll" }, face(1));
  const opened = take(state, { type: "continue" }).state;
  assert.equal(opened.landing.kind, "rent");
  assert.equal(decisionFor(opened, "moon").canBuy.ok, false);
});

/* ---------------------------------------------------------------- building */

test("landing on your own square offers one upgrade this visit", () => {
  const before = game();
  buy(before.ledger, "moon", 0);
  buy(before.ledger, "lagrange-l2", 0);
  before.pieces[0].position = 0;
  let state = take(before, { type: "roll" }, face(1)).state;
  state = take(state, { type: "continue" }).state;

  assert.equal(state.landing.kind, "own");
  const offer = upgradeOffer(state, "moon");
  assert.equal(offer.ok, true);
  assert.equal(offer.upgrade.name, "Lunar Outpost");

  const built = take(state, { type: "upgrade" });
  state = built.state;
  assert.equal(levelOf(state.ledger, "moon"), 1);
  assert.equal(moneyOf(state.ledger, 0), 2000 - 200 - 250 - 100);
  assert.equal(built.events[0].type, "upgraded");
  assert.equal(built.events[0].level, 1);
  assert.equal(built.events[0].cost, 100);
  assert.equal(state.phase, PHASE.DECISION, "the card stays open for Done");

  const again = refuse(state, { type: "upgrade" });
  assert.equal(again.why, "One upgrade per visit. Land here again to upgrade.");
  assert.equal(levelOf(state.ledger, "moon"), 1);
});

test("a second visit allows the second level, in order", () => {
  const before = game();
  buy(before.ledger, "moon", 0);
  buy(before.ledger, "lagrange-l2", 0);
  upgrade(before.ledger, "moon", 0);
  // Even building: the mate of the set stands at the same level, or the second
  // level is refused - which is a rule, not a lost turn.
  upgrade(before.ledger, "lagrange-l2", 0);
  before.pieces[0].position = 0;
  let state = take(before, { type: "roll" }, face(1)).state;
  state = take(state, { type: "continue" }).state;
  const built = take(state, { type: "upgrade" }).state;
  assert.equal(levelOf(built.ledger, "moon"), 2);
  assert.equal(built.visit.upgrades, 1);
});

test("you cannot upgrade on the visit you bought the square", () => {
  const owned = game();
  buy(owned.ledger, "moon", 0);
  standOn(owned, 1, "own");
  owned.landing.id = "moon";
  owned.visit.bought = true;
  assert.equal(
    refuse(owned, { type: "upgrade" }).why,
    "You bought this square this visit.",
  );
  assert.equal(levelOf(owned.ledger, "moon"), 0);
});

test("there is no way to upgrade outside a landing", () => {
  const before = game();
  buy(before.ledger, "moon", 0);
  assert.equal(before.phase, PHASE.AWAITING_ROLL);
  assert.equal(refuse(before, { type: "upgrade" }).why, "Land on your own square to upgrade.");
  assert.equal(upgradeOffer(before, "moon").ok, false);
  assert.equal(levelOf(before.ledger, "moon"), 0);
});

test("a finished square stays finished", () => {
  const before = game();
  before.ledger.players[0].money = 9000;
  buy(before.ledger, "moon", 0);
  buy(before.ledger, "lagrange-l2", 0);
  // Even building: both colonies of the set climb together.
  for (let n = 0; n < 3; n += 1) {
    assert.equal(upgrade(before.ledger, "moon", 0).ok, true);
    assert.equal(upgrade(before.ledger, "lagrange-l2", 0).ok, true);
  }
  standOn(before, 1, "own");
  before.landing.id = "moon";
  assert.equal(upgradeOffer(before, "moon").why, "This square is upgraded as far as it goes.");
});

/* ------------------------------------------------------------------ rent */

test("landing on somebody else's square pays the right rent to the right seat", () => {
  const before = game();
  buy(before.ledger, "moon", 0);
  before.active = 1;
  before.turn = 1;
  const { state, events } = take(before, { type: "roll" }, face(1));

  assert.equal(state.active, 1, "the payer is still the active player");
  assert.equal(events.at(-1).type, "rentPaid");
  assert.equal(events.at(-1).amount, baseRentOf("moon"));
  assert.equal(events.at(-1).from, 1);
  assert.equal(events.at(-1).to, 0);
  assert.equal(moneyOf(state.ledger, 0), 2000 - priceOf("moon") + baseRentOf("moon"));
  assert.equal(moneyOf(state.ledger, 1), 2000 - baseRentOf("moon"));

  const opened = take(state, { type: "continue" }).state;
  assert.equal(opened.landing.kind, "rent");
  assert.equal(decisionFor(opened, "moon").rentPaid, baseRentOf("moon"));
  assert.equal(decisionFor(opened, "moon").paid, true);
  assert.equal(take(opened, { type: "continue" }).state.phase, PHASE.TURN_END);
});

test("rent follows the upgrade level", () => {
  const before = game();
  buy(before.ledger, "moon", 0);
  buy(before.ledger, "lagrange-l2", 0);
  upgrade(before.ledger, "moon", 0);
  before.active = 1;
  before.turn = 1;
  const { state } = take(before, { type: "roll" }, face(1));
  assert.equal(
    moneyOf(state.ledger, 0),
    2000 - priceOf("moon") - priceOf("lagrange-l2") - upgradeAt("moon", 0).cost + upgradeAt("moon", 0).rentAfter,
  );
});

test("a rent that cannot be fully paid takes everything the payer holds and records the short", () => {
  const before = game();
  buy(before.ledger, "moon", 0);
  before.active = 1;
  before.turn = 1;
  before.ledger.players[1].money = 5;
  const { state, events } = applyAction(before, { type: "roll" }, face(1));

  const rent = baseRentOf("moon");
  assert.equal(moneyOf(state.ledger, 1), 0, "the payer hands over everything they hold");
  assert.equal(moneyOf(state.ledger, 0), 2000 - priceOf("moon") + 5, "the owner takes it");
  assert.equal(state.ledger.players[1].short, rent - 5, "the short is recorded on the payer");

  const short = events.find((e) => e.type === "rentShort");
  assert.ok(short, "a short rent is its own event");
  assert.equal(short.amount, 5);
  assert.equal(short.shortfall, rent - 5);
  assert.equal(short.short, rent - 5);
  assert.equal(events.find((e) => e.type === "refused"), undefined, "it is not a refusal");

  const opened = take(state, { type: "continue" }).state;
  assert.equal(opened.landing.kind, "rent");
  const decision = decisionFor(opened, "moon");
  assert.equal(decision.rentPaid, 5, "the card says what actually moved");
  assert.equal(decision.short, rent - 5);
  assert.equal(decision.paid, false);
  // The visit can still be acknowledged; nothing is owed at TURN_END.
  assert.equal(take(opened, { type: "continue" }).state.phase, PHASE.TURN_END);
});

test("a rent paid in full is not a short", () => {
  const before = game();
  buy(before.ledger, "moon", 0);
  before.active = 1;
  before.turn = 1;
  const { state, events } = applyAction(before, { type: "roll" }, face(1));
  assert.equal(events.find((e) => e.type === "rentShort"), undefined);
  assert.equal(events.find((e) => e.type === "rentPaid").amount, baseRentOf("moon"));
  assert.equal(state.ledger.players[1].short, 0);
});

/* ---------------------------------------------------------------- monopoly */

test("upgrades stay locked without a monopoly", () => {
  const before = game();
  buy(before.ledger, "asteroid-belt", 0);
  before.active = 0;
  before.turn = 0;
  before.landing = { seat: 0, index: 3, id: "asteroid-belt", kind: "own" };
  before.visit = { seat: 0, bought: false, upgrades: 0, drawn: null, collected: false, rent: 0, paid: false, short: 0 };
  before.phase = PHASE.DECISION;
  const offer = upgradeOffer(before, "asteroid-belt");
  assert.equal(offer.ok, false);
  assert.match(offer.why, /set/);
});

test("a monopoly unlocks upgrades", () => {
  const before = game();
  buy(before.ledger, "asteroid-belt", 0);
  buy(before.ledger, "jupiter", 0);
  buy(before.ledger, "pluto", 0);
  before.active = 0;
  before.turn = 0;
  before.landing = { seat: 0, index: 3, id: "asteroid-belt", kind: "own" };
  before.visit = { seat: 0, bought: false, upgrades: 0, drawn: null, collected: false, rent: 0, paid: false, short: 0 };
  before.phase = PHASE.DECISION;
  const offer = upgradeOffer(before, "asteroid-belt");
  assert.equal(offer.ok, true);
});

test("a sale that breaks the monopoly re-locks further upgrades", () => {
  const before = game();
  buy(before.ledger, "asteroid-belt", 0);
  buy(before.ledger, "jupiter", 0);
  buy(before.ledger, "pluto", 0);
  // sell pluto
  sell(before.ledger, "pluto", 0);
  before.active = 0;
  before.turn = 0;
  before.landing = { seat: 0, index: 3, id: "asteroid-belt", kind: "own" };
  before.visit = { seat: 0, bought: false, upgrades: 0, drawn: null, collected: false, rent: 0, paid: false, short: 0 };
  before.phase = PHASE.DECISION;
  const offer = upgradeOffer(before, "asteroid-belt");
  assert.equal(offer.ok, false);
  assert.match(offer.why, /set/);
});

/* ---------------------------------------------------------------- selling */

test("a square sells for half the price and half the builds, to a multiple of five", () => {
  const before = game();
  buy(before.ledger, "moon", 0);
  buy(before.ledger, "lagrange-l2", 0);
  upgrade(before.ledger, "moon", 0);
  assert.equal(saleValue(before.ledger, "moon"), Math.round((200 / 2 + 100 / 2) / 5) * 5);
  assert.equal(SALE_RATE, 0.5);
});

test("selling returns the square to the bank, clears its builds, and pays", () => {
  assert.equal(ENABLE_SELL, true);
  const before = game();
  buy(before.ledger, "moon", 0);
  buy(before.ledger, "lagrange-l2", 0);
  upgrade(before.ledger, "moon", 0);
  const payout = saleValue(before.ledger, "moon");
  const { state, events } = take(before, { type: "sell", id: "moon" });

  assert.equal(state.phase, PHASE.AWAITING_ROLL, "selling does not end a turn");
  assert.equal(ownerOf(state.ledger, "moon"), null);
  assert.equal(levelOf(state.ledger, "moon"), 0);
  assert.equal(moneyOf(state.ledger, 0), 2000 - 200 - 250 - 100 + payout);
  assert.equal(events[0].type, "sold");
  assert.equal(events[0].payout, payout);
});

test("selling is only for the holder, and only before the throw", () => {
  const before = game();
  buy(before.ledger, "moon", 0);
  assert.equal(sellOffer(before, "moon", 1).ok, false);
  assert.equal(refuse(before, { type: "sell", id: "moon", seat: 1 }).why, "It is not your turn.");

  let after = take(before, { type: "roll" }, face(1)).state;
  after = take(after, { type: "continue" }).state;
  assert.equal(
    refuse(after, { type: "sell", id: "moon" }).why,
    "Sell between turns, before you throw.",
  );
});

/* --------------------------------------------------------------- Ragnarok */

test("Ragnarok is a decision, and a draw is one action", () => {
  let state = take(game(), { type: "roll" }, face(4)).state;
  assert.equal(state.landing.id, RAGNAROK.id);
  state = take(state, { type: "continue" }).state;
  assert.equal(state.landing.kind, "chest");
  assert.equal(wantsDecision(state), true);

  const drawn = take(state, { type: "drawWeapon" }, () => 0.15);
  state = drawn.state;
  assert.equal(drawn.events[0].type, "weaponDrawn");
  assert.equal(drawn.events[0].weapon, "antimatter");
  assert.equal(drawn.events[0].badLuck, false);
  assert.equal(take(state, { type: "collectWeapon" }).state.pieces[0].weapons[0], "antimatter");
});

test("the chest opens once, and the weapon is collected once", () => {
  let state = take(game(), { type: "roll" }, face(4)).state;
  state = take(state, { type: "continue" }).state;
  state = take(state, { type: "drawWeapon" }, () => 0.15).state;

  assert.match(refuse(state, { type: "drawWeapon" }).why, /already/);
  assert.equal(refuse(state, { type: "continue" }).why, "Collect the weapon first.");

  state = take(state, { type: "collectWeapon" }).state;
  assert.match(
    refuse(state, { type: "collectWeapon" }).why,
    /no chest|no weapon/,
  );
  assert.equal(take(state, { type: "continue" }).state.phase, PHASE.TURN_END);
});

test("bad luck ends the visit without a weapon", () => {
  let state = take(game(), { type: "roll" }, face(4)).state;
  state = take(state, { type: "continue" }).state;
  const drawn = take(state, { type: "drawWeapon" }, () => 0.99).state;
  assert.equal(drawn.visit.drawn, BAD_LUCK);
  assert.equal(refuse(drawn, { type: "collectWeapon" }).why, "There is no weapon to collect.");
  assert.equal(take(drawn, { type: "continue" }).state.phase, PHASE.TURN_END);
  assert.deepEqual(drawn.pieces[0].weapons, []);
});

test("the chest cannot be left before it is drawn from", () => {
  let state = take(game(), { type: "roll" }, face(4)).state;
  state = take(state, { type: "continue" }).state;
  assert.equal(refuse(state, { type: "continue" }).why, "Draw from the chest first.");
});

/* --------------------------------------------------------------- the card */

test("the decision names the square, the seat, and what may be done", () => {
  let state = take(game(), { type: "roll" }, face(1)).state;
  state = take(state, { type: "continue" }).state;
  const decision = decisionFor(state, "moon");
  assert.equal(decision.kind, "buy");
  assert.equal(decision.seat, 0);
  assert.equal(decision.price, priceOf("moon"));
  assert.equal(decision.rent, baseRentOf("moon"));
  assert.equal(decision.bought, false);
  assert.equal(decision.canSell.ok, false);
  assert.equal(decisionFor(state, "jupiter"), null, "a square not landed on has no decision");
});

test("the card's upgrade offer and the rule cannot disagree", () => {
  const before = game();
  buy(before.ledger, "moon", 0);
  buy(before.ledger, "lagrange-l2", 0);
  standOn(before, 1, "own");
  before.landing.id = "moon";
  assert.equal(decisionFor(before, "moon").canUpgrade.ok, true);
  assert.equal(upgradeOffer(before, "moon").ok, true);

  before.visit.upgrades = 1;
  assert.equal(decisionFor(before, "moon").canUpgrade.ok, false);
  assert.equal(upgradeOffer(before, "moon").ok, false);
});

test("a landing reports the cell it is on", () => {
  const state = take(game(), { type: "roll" }, face(4)).state;
  assert.equal(landingCell(state).id, "ragnarok");
  assert.equal(state.landing.index, 4);
});

test("an unknown action is refused, not thrown", () => {
  const state = game();
  assert.equal(
    refuse(state, { type: "dance" }).why,
    "That is not something the game can do.",
  );
  assert.equal(refuse(state, null).why, "That is not something the game can do.");
});

test("the ledger's starting money is the game's opening money", () => {
  const custom = createGame(PLAYERS, { opening: 750 });
  assert.equal(moneyOf(custom.ledger, 0), 750);
  assert.equal(custom.ledger.players[0].money, 750);
});

test("a fresh game's ledger is a real ledger with a sheet for every property", () => {
  const state = game();
  for (const id of ["moon", "jupiter", "sagittarius-a-star"]) {
    const sheet = sheetFor(state.ledger, id);
    assert.equal(sheet.owner, null);
    assert.equal(sheet.upgradeLevel, 0);
  }
  assert.equal(canBuy(state.ledger, "moon", 0).ok, true);
  assert.deepEqual(payRent(state.ledger, "moon", 1), {
    ok: true,
    why: "",
    rent: 0,
    from: 1,
    to: null,
    paid: false,
    amount: 0,
    short: 0,
    shortfall: 0,
  });
});

/* ------------------------------------------------------- the ledger's history */

test("crossing Start pays a salary and writes it in the ledger first", () => {
  const before = game();
  before.pieces[0].position = 26;
  const { state, events } = take(before, { type: "roll" }, face(4));

  assert.equal(events[0].type, "salary");
  assert.equal(events[0].amount, 200);
  assert.equal(events[0].seat, 0);
  assert.equal(moneyOf(state.ledger, 0), 2200, "the salary arrives before the landing");

  const first = state.ledger.history[0];
  assert.equal(first.seat, 0);
  assert.equal(first.kind, "salary");
  assert.equal(first.text, "Salary · lap complete");
  assert.equal(first.amount, 200);
  assert.equal(first.balance, 2200);
  assert.equal(first.turn, before.turn);
});

test("the first move out of Start does not pay a salary", () => {
  const { state, events } = take(game(), { type: "roll" }, face(1));
  assert.equal(events.some((e) => e.type === "salary"), false);
  assert.equal(moneyOf(state.ledger, 0), 2000);
  assert.equal(state.ledger.history.length, 0);
});

test("buying, upgrading, selling and rent all reach the history", () => {
  // Buy.
  let state = take(game(), { type: "roll" }, face(1)).state;
  state = take(state, { type: "continue" }).state;
  state = take(state, { type: "buy" }).state;
  assert.equal(state.ledger.history[0].text, "Bought Moon");
  assert.equal(state.ledger.history[0].amount, -priceOf("moon"));
  assert.equal(state.ledger.history[0].balance, moneyOf(state.ledger, 0));

  // Upgrade, on the next visit to a square in a full set.
  const before = game();
  buy(before.ledger, "moon", 0);
  buy(before.ledger, "lagrange-l2", 0);
  before.pieces[0].position = 0;
  let own = take(before, { type: "roll" }, face(1)).state;
  own = take(own, { type: "continue" }).state;
  own = take(own, { type: "upgrade" }).state;
  assert.equal(own.ledger.history[0].text, "Upgraded Moon to Lunar Outpost");
  assert.equal(own.ledger.history[0].amount, -upgradeAt("moon", 0).cost);

  // A sale, written as a positive amount.
  const seller = game();
  buy(seller.ledger, "moon", 0);
  const payout = saleValue(seller.ledger, "moon");
  const sold = take(seller, { type: "sell", id: "moon" }).state;
  assert.equal(sold.ledger.history[0].text, "Sold Moon");
  assert.equal(sold.ledger.history[0].amount, payout);
  assert.equal(sold.ledger.history[0].balance, moneyOf(sold.ledger, 0));

  // Rent, written once for each side.
  const rented = game();
  buy(rented.ledger, "moon", 0);
  rented.active = 1;
  rented.turn = 1;
  const after = take(rented, { type: "roll" }, face(1)).state;
  const paid = after.ledger.history.find(
    (e) => e.seat === 1 && e.text.startsWith("Rent paid to"),
  );
  const received = after.ledger.history.find(
    (e) => e.seat === 0 && e.text.startsWith("Rent received from"),
  );
  assert.equal(paid.text, "Rent paid to Sam · Moon");
  assert.equal(paid.amount, -baseRentOf("moon"));
  assert.equal(received.text, "Rent received from Smith · Moon");
  assert.equal(received.amount, baseRentOf("moon"));
});

test("collecting a weapon writes what was drawn", () => {
  let state = take(game(), { type: "roll" }, face(4)).state;
  state = take(state, { type: "continue" }).state;
  state = take(state, { type: "drawWeapon" }, () => 0.15).state;
  state = take(state, { type: "collectWeapon" }).state;
  assert.equal(state.ledger.history[0].text, "Drew Antimatter Weapon");
  assert.equal(state.ledger.history[0].amount, 0);
  assert.equal(state.ledger.history[0].kind, "weapon");
});

test("a refused action leaves the sequence number alone", () => {
  const state = game();
  const before = state.seq;
  refuse(state, { type: "buy" });
  assert.equal(state.seq, before);
});
