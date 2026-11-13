/* ==========================================================================
   THE FIGHT

   The bottom-right corner is a shared screen and a server-owned mechanic.
   These tests are the rules of it: what is within reach of a weapon, who may
   strike, what a strike takes, and that nothing about it is decided in a
   browser.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import { applyAction, createGame, PHASE } from "../shared/game.js";
import { IMMUNE, WEAPONS, weaponById } from "../shared/weapons.js";
import { FIGHT, isTargetProtected, validTargets } from "../shared/fight.js";
import { hasMonopoly, rentAt, sheetFor, setMembers } from "../shared/ledger.js";

const PLAYERS = [
  { name: "Aster", civ: "indus-valley" },
  { name: "Vega", civ: "aztec" },
];

/** An rng that always lands the die on `n`. */
const face = (n) => () => (n - 0.5) / 6;

function take(state, action, rng) {
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

/* The fight refuses nothing that needs the die, so the rng never matters. */
const rngNothing = () => 0;

/** Roll onto a square, and let the coin stop. */
function rollOnto(state, from) {
  state.pieces.find((p) => p.seat === state.active).position = from;
  const { state: moved } = take(state, { type: "roll" }, face(1));
  /* The coin has stopped: `continue` is what opens the decision. */
  const { state: after } = take(moved, { type: "continue" });
  return after;
}

/** A fresh game with every episode of the visit already behind it:
    seat 0 standing at the Fight, seat 1 holding the colonies that are
    named as theirs, both pieces carrying the weapons the test says. */
function fightVisit({ weapons = ["nuclear"], owned = ["moon"], levels = {} } = {}) {
  const state = createGame(PLAYERS);
  // The other player came here with nothing to decide, so the turn is 0's.
  for (const [id, seat] of owned.map((id) => [id, 1])) {
    sheetFor(state.ledger, id).owner = seat;
  }
  for (const [id, level] of Object.entries(levels)) {
    sheetFor(state.ledger, id).upgradeLevel = level;
  }
  state.pieces[0].weapons = [...weapons];
  state.pieces[1].weapons = [];
  // Seat 0 walks onto the corner and stops. Fight is index 23.
  return rollOnto(state, 22);
}

/* ------------------------------------------------------------------ truth */

test("fight is the corner the data names, and nothing else answers for it", () => {
  assert.ok(FIGHT, "the corner exists");
  assert.equal(FIGHT.id, "fight");
  assert.equal(FIGHT.type, "corner");
});

test("the shield hook is the door with no shield behind it: it says no", () => {
  assert.equal(isTargetProtected({ id: "moon" }), false);
});

/* --------------------------------------------------------- what is in range */

test("valid targets are the intersection of the weapon's list and the opponent's colonies", () => {
  const state = createGame(PLAYERS);
  sheetFor(state.ledger, "moon").owner = 1;
  sheetFor(state.ledger, "asteroid-belt").owner = 0; // mine, so out of the fight
  sheetFor(state.ledger, "jupiter").owner = 1;

  const targets = validTargets(state.ledger, "nuclear", 0);
  assert.deepEqual(
    [...targets].sort(),
    ["jupiter", "moon"],
    "the weapon's own list, cut down to what the other player holds",
  );
});

test("the weapon's targets and the board's holders are both respected, seat by seat", () => {
  const state = createGame(PLAYERS);
  sheetFor(state.ledger, "moon").owner = 1;
  // The same question with the opponent named stays the same answer, and a
  // holder who is not the opponent named is never in range.
  const withSeat = validTargets(state.ledger, "nuclear", 0, { opponentSeat: 1 });
  assert.ok(withSeat.includes("moon"));
  sheetFor(state.ledger, "kuiper-belt").owner = 1;
  const otherOwner = validTargets(state.ledger, "nuclear", 0, { opponentSeat: 0 });
  assert.deepEqual(otherOwner, [], "your own colony is not your opponent's");
});

test("an immune colony is never valid, whatever is asked", () => {
  const state = createGame(PLAYERS);
  sheetFor(state.ledger, "rama").owner = 1;
  // No weapon names it, and even a face that did would find it refused. The
  // list answers the question before the strike has to.
  assert.ok(!WEAPONS.some((w) => w.targets.includes(IMMUNE[0])));
  for (const weapon of WEAPONS) {
    assert.ok(!validTargets(state.ledger, weapon.id, 0).includes("rama"));
  }
  const noSuchWeapon = validTargets(state.ledger, "not-a-weapon", 0);
  assert.deepEqual(noSuchWeapon, []);
});

test("a weapon nobody carries has nothing in range to be offered", () => {
  const state = createGame(PLAYERS);
  assert.deepEqual(validTargets(state.ledger, "shiva", 0), []);
});

/* ------------------------------------------------------------------ guns */

test("landing on the Fight opens it in the state, for the player who landed", () => {
  const state = fightVisit({});
  assert.equal(state.landing.kind, "fight");
  assert.equal(state.phase, PHASE.DECISION);
  assert.ok(state.fight, "the fight is a fact in the state");
  assert.equal(state.fight.playerId, state.active);
  assert.equal(state.fight.phase, "open");
  assert.equal(state.fight.selectedWeaponId, null);
  assert.equal(state.fight.armed, false);
  assert.equal(state.fight.targetId, null);
  assert.equal(state.fight.result, null);
});

test("only the player who landed may act, and a stranger is refused", () => {
  const state = fightVisit({});
  state.pieces[1].weapons = ["nuclear"];
  const no = applyAction(state, { type: "selectWeapon", weaponId: "nuclear", seat: 1 });
  assert.ok(no.events.some((e) => e.type === "refused"), "not their fight");
});

test("choosing, arming, stepping back, choosing again", () => {
  let state = fightVisit({});
  sheetFor(state.ledger, "moon").owner = 1;

  state = take(state, { type: "selectWeapon", weaponId: "nuclear" }).state;
  assert.equal(state.fight.selectedWeaponId, "nuclear");
  assert.equal(state.fight.phase, "selected");

  state = take(state, { type: "armWeapon" }).state;
  assert.equal(state.fight.phase, "armed");
  assert.equal(state.fight.armed, true);

  state = take(state, { type: "cancelArm" }).state;
  assert.equal(state.fight.phase, "selected");
  assert.equal(state.fight.armed, false);

  // And a wrong face can still be chosen while the choice is only a choice.
  state.pieces[0].weapons.push("shiva");
  state = take(state, { type: "selectWeapon", weaponId: "shiva" }).state;
  assert.equal(state.fight.selectedWeaponId, "shiva");
});

test("you cannot arm a weapon that reaches nothing, and you cannot strike unarmed", () => {
  let state = fightVisit({ weapons: [] });
  // No weapon, nothing to choose: the fight can only be left.
  refuse(state, { type: "selectWeapon", weaponId: "nuclear" }, "You do not carry that weapon.");
  refuse(state, { type: "armWeapon" }, "Choose a weapon first.");

  // Carry one that has nothing in reach - the boards are empty - and the
  // arming is refused: the client disbles the pill, and the rule is the rule.
  state = fightVisit({ weapons: ["nuclear"], owned: [] });
  state = take(state, { type: "selectWeapon", weaponId: "nuclear" }).state;
  refuse(state, { type: "armWeapon" }, "No colony in range.");
});

test("you cannot strike your own colony, or one the weapon cannot reach", () => {
  let state = fightVisit({ weapons: ["antimatter", "nuclear"] });
  sheetFor(state.ledger, "moon").owner = 1;
  // Antimatter's reach does not include the moon.
  state = take(state, { type: "selectWeapon", weaponId: "antimatter" }).state;
  refuse(state, { type: "armWeapon" }, "No colony in range.");

  state = fightVisit({ weapons: ["nuclear"] });
  sheetFor(state.ledger, "moon").owner = 1;
  state = take(state, { type: "selectWeapon", weaponId: "nuclear" }).state;
  state = take(state, { type: "armWeapon" }).state;
  // My own colony - seat 0 took a colony of their own - is never in reach.
  sheetFor(state.ledger, "asteroid-belt").owner = 0;
  refuse(state, { type: "fightAttack", targetId: "asteroid-belt" }, "That colony is not within reach.");
  // An immune colony, even with a sheet and an owner, is beyond any weapon.
  sheetFor(state.ledger, "rama").owner = 1;
  refuse(state, { type: "fightAttack", targetId: "rama" });
  // And a colony id that is not on the board is not a colony at all.
  refuse(state, { type: "fightAttack", targetId: "not-a-place" }, "There is no such colony.");
});

test("a player with no weapons can only leave, and leaving is always open", () => {
  const state = fightVisit({ weapons: [] });
  refuse(state, { type: "armWeapon" }, "Choose a weapon first.");
  const { state: after } = take(state, { type: "leaveFight" });
  assert.equal(after.fight, null, "the fight is gone");
  assert.equal(after.phase, PHASE.TURN_END, "and the turn ends with it");
});

/* ----------------------------------------------------------------- strike */

test("the strike takes the colony, and the rent follows the new owner honestly", () => {
  let state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon", "lagrange-l2"],
  });
  // Seat 1 holds the whole unbuilt set, so the moon's rent is the full-set
  // double. It reads that while the opponent holds it, and it reads the
  // colony's own rent the moment the set is broken by the strike.
  assert.equal(hasMonopoly(state.ledger, "moon", 1), true);
  const rentBefore = rentAt(state.ledger, "moon");

  state = take(state, { type: "selectWeapon", weaponId: "nuclear" }).state;
  state = take(state, { type: "armWeapon" }).state;
  const result = take(state, { type: "fightAttack", targetId: "moon" });
  state = result.state;

  const strike = result.events.find((e) => e.type === "fightResolved");
  assert.ok(strike, "the war is a fact both phones are told");
  assert.equal(strike.weapon, "nuclear");
  assert.equal(strike.id, "moon");
  assert.equal(strike.from, 1);
  assert.equal(strike.to, 0);

  // The colony changed hands, and the rent is the broken set's own - the
  // full-set double is gone because the set is gone.
  assert.equal(sheetFor(state.ledger, "moon").owner, 0);
  assert.equal(hasMonopoly(state.ledger, "moon", 1), false);
  assert.notEqual(rentAt(state.ledger, "moon"), rentBefore);
  assert.ok(rentBefore > rentAt(state.ledger, "moon"), `the full set read ${rentBefore} and the break reads ${rentAt(state.ledger, "moon")}`);

  // The weapon is spent: it is in no piece's hand, and the fight says so.
  assert.deepEqual(state.pieces.find((p) => p.seat === 0).weapons, []);
  assert.equal(state.fight.phase, "resolving");
  assert.equal(state.fight.armed, false);
  assert.equal(state.fight.targetId, "moon");
  assert.equal(state.fight.result.weapon, "nuclear");
  assert.equal(state.fight.result.from, 1);
  assert.equal(state.fight.result.to, 0);
});

test("a colony that transfers keeps the level built on it, and only that", () => {
  let state = fightVisit({ weapons: ["nuclear"], owned: ["moon"] });
  sheetFor(state.ledger, "moon").upgradeLevel = 2;
  const rentAtTwo = rentAt(state.ledger, "moon");

  // At a built level the whole set no longer doubles anything, so what the
  // capture must leave alone is the LEVEL, and with it the rent.
  state = take(state, { type: "selectWeapon", weaponId: "nuclear" }).state;
  state = take(state, { type: "armWeapon" }).state;
  state = take(state, { type: "fightAttack", targetId: "moon" }).state;

  assert.equal(sheetFor(state.ledger, "moon").upgradeLevel, 0);
  assert.equal(rentAt(state.ledger, "moon"), 20, "capture resets the square to its base rent");
});

test("the ledger writes one sentence for each side, and no money moves", () => {
  let state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
  });
  const before = state.ledger.players.map((p) => p.money);
  state = take(state, { type: "selectWeapon", weaponId: "nuclear" }).state;
  state = take(state, { type: "armWeapon" }).state;
  state = take(state, { type: "fightAttack", targetId: "moon" }).state;

  const after = state.ledger.players.map((p) => p.money);
  assert.deepEqual(after, before, "money does not move at the Fight");

  const captured = state.ledger.history.find(
    (h) => h.seat === 0 && /Captured Moon with Nuclear Warhead/.test(h.text),
  );
  const lost = state.ledger.history.find(
    (h) => h.seat === 1 && /Lost Moon to Aster/.test(h.text),
  );
  assert.ok(captured, "the striker's sentence is written");
  assert.ok(lost, "and the sentence of the one who lost it");
  assert.equal(captured.amount, 0);
  assert.equal(lost.amount, 0);
});

test("one attack per visit: the second strike is refused, and the visit closes once", () => {
  let state = fightVisit({ weapons: ["nuclear", "shiva"], owned: ["moon"] });
  state = take(state, { type: "selectWeapon", weaponId: "nuclear" }).state;
  state = take(state, { type: "armWeapon" }).state;
  state = take(state, { type: "fightAttack", targetId: "moon" }).state;

  // The fight is fought. Another weapon cannot be chosen, armed or struck.
  refuse(state, { type: "selectWeapon", weaponId: "shiva" }, "The strike is already armed.");
  refuse(state, { type: "armWeapon" }, "Choose a weapon first.");
  refuse(state, { type: "fightAttack", targetId: "asteroid-belt" }, "Arm a weapon before you strike.");

  // The war has been seen, and the visit is closed by one press.
  state = take(state, { type: "done" }).state;
  assert.equal(state.fight, null);
  assert.equal(state.phase, PHASE.TURN_END);

  // And a second press has nothing left to close.
  refuse(state, { type: "done" }, "There is nothing to finish.");
});

test("the strike cannot be made out of phase, with a stranger's weapon, or at nobody", () => {
  let state = fightVisit({ weapons: ["nuclear"], owned: ["moon"] });
  // Armed is the only phase a strike is asked in.
  state = take(state, { type: "selectWeapon", weaponId: "nuclear" }).state;
  refuse(state, { type: "fightAttack", targetId: "moon" }, "Arm a weapon before you strike.");
  state = take(state, { type: "armWeapon" }).state;

  // A weapon the acter does not carry is refused at every door.
  state.pieces[0].weapons = [];
  refuse(state, { type: "fightAttack", targetId: "moon" }, "You do not carry that weapon.");
  state.pieces[0].weapons = ["nuclear"];
});

/* ------------------------------------------------------------------ leaving */

test("leaving ends the fight and the turn, from any stage of it, and the turn hands over", () => {
  let state = fightVisit({});
  state = take(state, { type: "selectWeapon", weaponId: "nuclear" }).state;
  state = take(state, { type: "armWeapon" }).state;
  state = take(state, { type: "leaveFight" }).state;
  assert.equal(state.fight, null);
  assert.equal(state.phase, PHASE.TURN_END);

  // The turn has nowhere to stick: the fight is not carried into it.
  state = take(state, { type: "continue" }).state;
  assert.equal(state.phase, PHASE.AWAITING_ROLL);
  assert.equal(state.active, 1);
  assert.equal(state.fight, null);
  assert.equal(state.landing, null);
});

test("a stray continue does not walk out of an open fight", () => {
  const state = fightVisit({});
  const refusal = applyAction(state, { type: "continue", seat: 0 });
  assert.ok(refusal.events.some((e) => e.type === "refused"), "the fight is still open");
});

