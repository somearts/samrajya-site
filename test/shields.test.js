/* ==========================================================================
   THE KRONOS SHIELDS

   One popup, three stages: DRAW (the server decides, the clients shuffle
   and reveal in the same card), COLLECT (the server computes which colonies
   the shield can legally stand on), and a tap on a highlighted colony -
   deployment.

   These tests are the rules of that flow and nothing else:

   - the draw REVEALS a shield and deploys NOTHING;
   - compatibility is the countered weapon's own reach, intersected with
     what the deploying player owns - never "any colony";
   - deployment validates fresh, happens once, names its colony in the
     ledger, and carries colony + owner + weapon;
   - a standing shield blocks ONLY strikes aimed at its own colony with the
     exact weapon it counters, and is spent on that block;
   - a shield stands until it is broken - it does not expire after turns;
   - nothing is ever stored in an inventory.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PHASE,
  applyAction,
  createGame,
  restoreGame,
  serializeGame,
} from "../shared/game.js";
import { SHIELDS, SHIELD_IDS, drawShield, shieldById, shieldFor, weaponById } from "../shared/weapons.js";
import { sheetFor } from "../shared/ledger.js";

const PLAYERS = [
  { name: "Aster", civ: "indus-valley" },
  { name: "Vega", civ: "ancient-roman" },
];

const KRONOS_INDEX = 26;
const FIGHT_INDEX = 23;
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

/** A fresh test-mode game with seat 0 standing at the Kronos chest. */
function atKronos() {
  return goTo(createGame(PLAYERS, { testMode: true }), KRONOS_INDEX);
}

/** The whole visit: draw, collect, and deploy onto `colonyId`. */
function deployed(state, colonyId, slot = 0, rng = () => 0) {
  const drawn = take(state, { type: "drawShield", slot }, rng).state;
  const targeting = take(drawn, { type: "collectShield" }).state;
  return take(targeting, { type: "deployShield", colonyId }).state;
}

/** A fresh game with seat 0 at the Fight, armed, shield state as given. */
function fightVisit({ weapons = ["nuclear"], owned = ["moon"], shields = [] } = {}) {
  const state = createGame(PLAYERS, { testMode: true });
  for (const id of owned) sheetFor(state.ledger, id).owner = 1;
  state.pieces[0].weapons = [...weapons];
  state.shields = shields.map((shield) => ({ ...shield }));
  const atFight = goTo(state, FIGHT_INDEX);
  const selected = take(atFight, { type: "selectWeapon", weaponId: weapons[0] }).state;
  return take(selected, { type: "armWeapon" }).state;
}

/* ------------------------------------------------------------------- data */

test("the three shields are named, and each answers one real weapon", () => {
  assert.equal(SHIELDS.length, 3, "exactly three shields");
  assert.deepEqual(SHIELD_IDS, ["kavacha", "matterforge", "nuclear-aegis"]);
  assert.equal(shieldById("kavacha").name, "Kavacha of Parvati");
  assert.equal(shieldById("matterforge").name, "Matterforge Shield");
  assert.equal(shieldById("nuclear-aegis").name, "Nuclear Aegis");

  assert.equal(shieldFor("shiva")?.id, "kavacha", "Kavacha answers the Eye of Shiva");
  assert.equal(shieldFor("antimatter")?.id, "matterforge", "Matterforge answers Antimatter");
  assert.equal(shieldFor("nuclear")?.id, "nuclear-aegis", "the Aegis answers the Warhead");
  for (const shield of SHIELDS) {
    assert.ok(weaponById(shield.counters), `${shield.counters} is a weapon that exists`);
  }
  // The three weapons' reach lists are disjoint, so two shields can never
  // be deployed to the same colony.
  const lists = SHIELDS.map((s) => weaponById(s.counters).targets);
  for (let i = 0; i < lists.length; i += 1) {
    for (let j = i + 1; j < lists.length; j += 1) {
      assert.equal(
        lists[i].some((id) => lists[j].includes(id)),
        false,
        "the reach lists share no colony",
      );
    }
  }
});

test("a fresh game has no shields and no chest", () => {
  const state = createGame(PLAYERS, { testMode: true });
  assert.deepEqual(state.shields, []);
  assert.equal(state.chest, null);
});

/* --------------------------------------------------------------- the draw */

test("landing on Kronos opens the shield chest, and the draw deploys nothing", () => {
  const state = atKronos();
  assert.equal(state.landing.id, "kronos");
  assert.equal(state.chest.kind, "kronos");
  assert.equal(state.chest.phase, "open");

  const { state: drawn, events } = take(state, { type: "drawShield", slot: 0 }, () => 0);
  assert.equal(drawn.chest.phase, "revealed", "the card is revealed in the same popup");
  assert.ok(drawn.chest.result?.shield, "a shield was chosen");
  assert.deepEqual(drawn.shields, [], "NOTHING IS DEPLOYED OR STORED by the draw");
  assert.equal(drawn.visit.shieldDrawn, drawn.chest.result.shield, "the visit is answered");
  assert.equal(drawn.pieces[0].weapons.length, 0, "no inventory of any kind");
  assert.ok(
    !drawn.ledger.history.some((entry) => entry.kind === "shield"),
    "the ledger says nothing about a shield that does not stand yet",
  );
  assert.ok(events.some((e) => e.type === "shieldDrawn"));
});

test("the draw refuses twice and refuses strangers", () => {
  const state = atKronos();
  refuse(state, { type: "drawShield", seat: 1 }, "It is not your turn.");
  const drawn = take(state, { type: "drawShield" }, () => 0).state;
  refuse(drawn, { type: "drawShield" }, "This chest has already been drawn from.");
});

test("with all three standing the draw is a miss that deploys nothing", () => {
  const state = atKronos();
  state.shields = SHIELDS.map((shield) => ({
    id: shield.id,
    owner: 0,
    weapon: shield.counters,
    colony: weaponById(shield.counters).targets[0],
  }));
  const { state: drawn } = take(state, { type: "drawShield" }, () => 0);
  assert.equal(drawn.visit.shieldDrawn, "none");
  assert.equal(drawn.chest.result.none, true);
  assert.equal(drawn.shields.length, 3, "the three standing shields are untouched");

  refuse(drawn, { type: "collectShield" }, "There is no shield to deploy.");
  const closed = take(drawn, { type: "done" }).state;
  assert.equal(closed.chest, null);
});

test("a standing shield is never offered by the draw again", () => {
  for (let i = 0; i < 256; i += 1) {
    const drawn = drawShield(() => i / 256, ["kavacha"]);
    assert.notEqual(drawn, "kavacha");
    assert.ok(drawn === null || SHIELD_IDS.includes(drawn));
  }
});

/* ---------------------------------------------------------- COLLECT first */

test("COLLECT computes compatibility as the countered weapon's reach that this player owns", () => {
  const state = atKronos();
  // Owned but irrelevant: moon belongs to the Warhead's reach only.
  sheetFor(state.ledger, "moon").owner = 0;
  // Owned and in the Eye of Shiva's reach.
  sheetFor(state.ledger, "earth-137").owner = 0;

  const drawn = take(state, { type: "drawShield", slot: 0 }, () => 0).state;
  assert.equal(drawn.chest.result.shield, "kavacha", "rng 0 draws the first shield going");

  const { state: targeting, events } = take(drawn, { type: "collectShield" });
  assert.equal(targeting.chest.phase, "targeting");
  assert.deepEqual(
    targeting.chest.result.compatible,
    ["earth-137"],
    "the weapon's own reach, owned - nothing else",
  );
  assert.ok(events.some((e) => e.type === "shieldTargeting"));
  assert.deepEqual(targeting.shields, [], "COLLECT deploys nothing either");
});

test("COLLECT with no compatible colony answers with an empty list, not a refusal", () => {
  const state = atKronos();
  sheetFor(state.ledger, "moon").owner = 0; // owned, wrong reach entirely

  const drawn = take(state, { type: "drawShield", slot: 0 }, () => 0).state;
  const { state: targeting, events } = take(drawn, { type: "collectShield" });
  assert.equal(targeting.chest.phase, "targeting", "the player stays inside the popup with the answer");
  assert.deepEqual(targeting.chest.result.compatible, []);
  assert.ok(events.some((e) => e.type === "shieldTargeting"));
  assert.equal(targeting.shields.length, 0, "nothing enters any inventory");
});

test("opponent colonies are never offered", () => {
  const state = atKronos();
  sheetFor(state.ledger, "earth-137").owner = 1; // the weapon's reach, but theirs

  const drawn = take(state, { type: "drawShield", slot: 0 }, () => 0).state;
  const targeting = take(drawn, { type: "collectShield" }).state;
  assert.deepEqual(targeting.chest.result.compatible, []);
});

test("COLLECT needs a revealed card and cannot run twice", () => {
  const state = atKronos();
  refuse(state, { type: "collectShield" }, "The colonies are already highlighted.");

  const drawn = take(state, { type: "drawShield" }, () => 0).state;
  const targeting = take(drawn, { type: "collectShield" }).state;
  refuse(targeting, { type: "collectShield" }, "The colonies are already highlighted.");
});

/* -------------------------------------------------------------- deployment */

test("a tap on a compatible colony deploys the shield there, once", () => {
  const state = atKronos();
  sheetFor(state.ledger, "earth-137").owner = 0;
  const drawn = take(state, { type: "drawShield", slot: 0 }, () => 0).state;
  const targeting = take(drawn, { type: "collectShield" }).state;

  const { state: standing, events } = take(targeting, { type: "deployShield", colonyId: "earth-137" });
  assert.equal(standing.shields.length, 1);
  const shield = standing.shields[0];
  assert.equal(shield.id, "kavacha");
  assert.equal(shield.owner, 0, "the player who deployed it");
  assert.equal(shield.colony, "earth-137", "the protected colony");
  assert.equal(shield.weapon, "shiva", "the weapon it counters");
  assert.equal(standing.chest.phase, "deployed");
  assert.equal(standing.chest.result.colony, "earth-137", "the card can say where it stands");
  const deployedEvent = events.find((e) => e.type === "shieldDeployed");
  assert.ok(deployedEvent);
  assert.equal(deployedEvent.colony, "earth-137");
  assert.ok(
    standing.ledger.history.some(
      (entry) =>
        entry.kind === "shield" &&
        entry.text.includes("Kavacha of Parvati") &&
        entry.text.includes("Earth 137") &&
        entry.text.includes("Eye of Shiva"),
    ),
    "the ledger says what stands, where, and what it stops",
  );

  // Twice from the same reveal: the phase has moved, so nothing stands twice.
  refuse(standing, { type: "deployShield", colonyId: "earth-137" }, "There is no colony to deploy to.");
  assert.equal(standing.shields.length, 1);
});

test("an incompatible colony cannot take the shield, even when owned", () => {
  const state = atKronos();
  sheetFor(state.ledger, "moon").owner = 0; // owned, but not the Eye's reach
  sheetFor(state.ledger, "earth-137").owner = 0;
  const drawn = take(state, { type: "drawShield", slot: 0 }, () => 0).state;
  const targeting = take(drawn, { type: "collectShield" }).state;

  refuse(targeting, { type: "deployShield", colonyId: "moon" }, "That colony cannot receive this shield.");
  assert.deepEqual(targeting.shields, [], "the refused tap deploys nothing");
  assert.equal(targeting.chest.phase, "targeting", "the choice is still open");

  // And the fresh recomputation refuses a colony that changed hands since.
  sheetFor(targeting.ledger, "earth-137").owner = 1;
  refuse(targeting, { type: "deployShield", colonyId: "earth-137" }, "That colony cannot receive this shield.");
});

test("deployment needs a targeting state", () => {
  const state = atKronos();
  const drawn = take(state, { type: "drawShield" }, () => 0).state;
  refuse(drawn, { type: "deployShield", colonyId: "earth-137" }, "There is no colony to deploy to.");
});

test("Done after deployment closes the visit and keeps what it deployed", () => {
  const state = atKronos();
  sheetFor(state.ledger, "earth-137").owner = 0;
  const standing = deployed(state, "earth-137");

  const closed = take(standing, { type: "done" }).state;
  assert.equal(closed.chest, null, "the chest is gone");
  assert.equal(closed.phase, PHASE.TURN_END);
  assert.equal(closed.shields.length, 1, "and the shield it deployed still stands");
});

test("Done during targeting abandons the placement without stranding the board", () => {
  const state = atKronos();
  sheetFor(state.ledger, "earth-137").owner = 0;
  const drawn = take(state, { type: "drawShield", slot: 0 }, () => 0).state;
  const targeting = take(drawn, { type: "collectShield" }).state;

  const closed = take(targeting, { type: "done" }).state;
  assert.equal(closed.chest, null, "the chest closes: no selection mode survives it");
  assert.deepEqual(closed.shields, [], "and nothing was deployed");
});

/* ----------------------------------------------------- the standing shield */

test("a standing shield blocks the strike it answers, once, and is spent", () => {
  const state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    shields: [{ id: "nuclear-aegis", owner: 1, weapon: "nuclear", colony: "moon" }],
  });
  const { state: struck, events } = take(state, { type: "fightAttack", targetId: "moon" });

  assert.equal(sheetFor(struck.ledger, "moon").owner, 1, "the colony is untouched");
  assert.deepEqual(struck.pieces[0].weapons, ["nuclear"], "the attacker keeps the weapon");
  assert.deepEqual(struck.shields, [], "the shield is spent on its block, once");
  assert.equal(struck.fight.phase, "resolving");
  assert.equal(struck.fight.result.blocked, true);
  assert.equal(struck.fight.result.shield, "nuclear-aegis");
  const blocked = events.find((e) => e.type === "shieldBlocked");
  assert.ok(blocked);
  assert.equal(blocked.weapon, "nuclear");
  assert.equal(blocked.colony, "moon");
  assert.equal(events.some((e) => e.type === "fightResolved"), false, "no second answer");
  assert.ok(
    struck.ledger.history.some(
      (entry) => entry.text.includes("Nuclear Aegis") && entry.text.includes("Moon"),
    ),
    "the ledger says what stopped the strike and where",
  );
});

test("the same weapon on any OTHER colony passes the shield entirely", () => {
  const state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon", "jupiter"],
    shields: [{ id: "nuclear-aegis", owner: 1, weapon: "nuclear", colony: "moon" }],
  });
  // Jupiter is in the Warhead's reach and held by the same player - but the
  // shield stands on the Moon, so the strike lands.
  const { state: struck, events } = take(state, { type: "fightAttack", targetId: "jupiter" });
  assert.equal(sheetFor(struck.ledger, "jupiter").owner, 0, "captured");
  assert.equal(struck.shields.length, 1, "the shield on the Moon is not involved");
  assert.ok(events.some((e) => e.type === "fightResolved"));
});

test("a weapon the shield does not counter passes even its own colony", () => {
  const state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    // Unreachable through the draw (the reach lists are disjoint), but it
    // pins the rule down: the match is on the EXACT weapon.
    shields: [{ id: "matterforge", owner: 1, weapon: "antimatter", colony: "moon" }],
  });
  const { state: struck } = take(state, { type: "fightAttack", targetId: "moon" });
  assert.equal(sheetFor(struck.ledger, "moon").owner, 0, "captured - that shield counters another weapon");
});

test("an attacker's own shield does not defend the defender", () => {
  const state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    shields: [{ id: "nuclear-aegis", owner: 0, weapon: "nuclear", colony: "jupiter" }],
  });
  const { state: struck } = take(state, { type: "fightAttack", targetId: "moon" });
  assert.equal(sheetFor(struck.ledger, "moon").owner, 0, "captured");
  assert.equal(struck.shields.length, 1, "and the attacker's shield still stands at home");
});

test("a standing shield is permanent: it survives the turns", () => {
  let state = atKronos();
  sheetFor(state.ledger, "earth-137").owner = 0;
  const standing = deployed(state, "earth-137");

  // The deployment turn ends, the opponent's turn runs, the owner takes
  // another turn - the shield is still standing.
  state = take(standing, { type: "done" }).state;
  state = take(state, { type: "continue" }).state; // -> seat 1
  assert.equal(state.shields.length, 1, "still standing after the deployment turn ends");
  state = passTurn(state);
  assert.equal(state.active, 0, "back to the shield's owner");
  assert.equal(state.shields.length, 1, "still standing after the opponent's turn");
  assert.equal(state.shields.length, 1, "the shield is permanent and still stands");
});

/* ------------------------------------------------- TWO STAGES TO CAPTURE */

test("a shield absorbs the first strike; only a second one takes the colony", () => {
  // STAGE ONE - the block. The shield answers the compatible weapon, the
  // colony does not change hands, and the shield is spent.
  const firstVisit = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    shields: [{ id: "nuclear-aegis", owner: 1, weapon: "nuclear", colony: "moon" }],
  });
  const first = take(firstVisit, { type: "fightAttack", targetId: "moon" }).state;
  assert.equal(sheetFor(first.ledger, "moon").owner, 1, "FIRST ATTACK: the colony is untouched");
  assert.deepEqual(first.shields, [], "FIRST ATTACK: the shield is gone");
  assert.equal(first.fight.result.blocked, true, "FIRST ATTACK: the strike was caught");

  // STAGE TWO - a fresh Fight visit, the same weapon, no shield standing.
  const secondVisit = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    shields: [],
  });
  const second = take(secondVisit, { type: "fightAttack", targetId: "moon" }).state;
  assert.equal(sheetFor(second.ledger, "moon").owner, 0, "SECOND ATTACK: captured by Player B");
  assert.equal(second.fight.result?.blocked, undefined, "an ordinary capture, not a block");
});

test("a captured colony does not keep the previous owner's shield", () => {
  // A shield that counters ANOTHER weapon stands on the Moon the strike is
  // about to take. The strike lands, and what the losing player left
  // standing there leaves with the capture.
  const state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    shields: [{ id: "matterforge", owner: 1, weapon: "antimatter", colony: "moon" }],
  });
  const { state: struck } = take(state, { type: "fightAttack", targetId: "moon" });
  assert.equal(sheetFor(struck.ledger, "moon").owner, 0, "captured");
  assert.deepEqual(struck.shields, [], "the captured colony carries no shield of its old keeper");
});

/* -------------------------------------------------------------- persistence */

test("a standing shield crosses the wire and comes back unchanged", () => {
  const state = atKronos();
  sheetFor(state.ledger, "earth-137").owner = 0;
  const standing = deployed(state, "earth-137");
  const back = restoreGame(JSON.parse(JSON.stringify(serializeGame(standing))));
  assert.deepEqual(back.shields, standing.shields);
  assert.equal(back.shields[0].colony, "earth-137");
});

test("a refused press cannot move the shield state", () => {
  const state = atKronos();
  const before = state.shields;
  refuse(state, { type: "deployShield", colonyId: "moon" }, "There is no colony to deploy to.");
  assert.equal(state.shields, before);
});
