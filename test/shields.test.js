/* ==========================================================================
   THE KRONOS SHIELDS

   Three counter-shields drawn at the Kronos chest, reusing the Ragnarok
   chest's own architecture: the draw is decided server-side and stored, the
   reveal is its own moment, and the whole fact lives in the state.

   These tests are the RULES of the shield and nothing else:

   - each shield names exactly one weapon, by the weapon's own id;
   - a drawn shield deploys at once, for its owner, with two owned turns;
   - it blocks its own weapon exactly once and is spent on the block;
   - the other two weapons walk straight past it;
   - it can never be redrawn, refreshed, overwritten or stacked;
   - it expires after the owner's second turn and blocks nothing after that.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PHASE,
  SHIELD_TURNS,
  applyAction,
  createGame,
  opponentOf,
  restoreGame,
  serializeGame,
  shieldsOf,
} from "../shared/game.js";
import {
  SHIELDS,
  SHIELD_IDS,
  drawShield,
  shieldById,
  shieldFor,
  weaponById,
} from "../shared/weapons.js";
import { CELLS } from "../shared/spaces.js";
import { sheetFor } from "../shared/ledger.js";

const PLAYERS = [
  { name: "Aster", civ: "indus-valley" },
  { name: "Vega", civ: "aztec" },
];

const KRONOS_INDEX = CELLS.find((cell) => cell.id === "kronos").index;
const FIGHT_INDEX = CELLS.find((cell) => cell.id === "fight").index;
/** A corner the coin can stop on with nothing to decide. */
const QUIET_INDEX = CELLS.find((cell) => cell.id === "outer-space").index;

/* The rng the actions that do not draw never need. */
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

/**
 * Move the active piece to a square, by the test throw, and let the coin
 * stop. Test mode is on throughout these tests because it is the precise
 * way to stand anywhere on the board - the same door a player under Test
 * mode uses to walk to Kronos and try the chest.
 */
function goTo(state, index) {
  const piece = state.pieces.find((p) => p.seat === state.active);
  const steps = (index - piece.position + 28) % 28 || 28;
  const rolled = take(state, { type: "testRoll", steps }).state;
  return take(rolled, { type: "continue" }).state;
}

/** A fresh test-mode game with seat 0 standing at the Kronos chest. */
function atKronos() {
  return goTo(createGame(PLAYERS, { testMode: true }), KRONOS_INDEX);
}

/** Draw from the chest and turn the face over - the whole visit, up to Done. */
function drawAt(state, slot = 1, rng = () => 0) {
  const drawn = take(state, { type: "drawShield", slot }, rng).state;
  return take(drawn, { type: "revealShield" }).state;
}

/** End the active player's turn on a quiet square and hand it over. */
function passTurn(state, index = QUIET_INDEX) {
  const landed = goTo(state, index);
  const resolved = take(landed, { type: "continue" }).state; // -> TURN_END
  return take(resolved, { type: "continue" }).state; // -> the next seat
}

/** A fresh game with seat 0 at the Fight, armed to strike `targetId`. */
function fightVisit({
  weapons = ["nuclear"],
  owned = ["moon"],
  shields = [],
  targetId = "moon",
} = {}) {
  const state = createGame(PLAYERS, { testMode: true });
  for (const id of owned) sheetFor(state.ledger, id).owner = 1;
  state.pieces[0].weapons = [...weapons];
  state.shields = shields.map((shield) => ({ ...shield }));
  const atFight = goTo(state, FIGHT_INDEX);
  const selected = take(atFight, { type: "selectWeapon", weaponId: weapons[0] }).state;
  return take(selected, { type: "armWeapon" }, () => 0).state;
}

/* ------------------------------------------------------------------- data */

test("the three shields are named, and each answers one real weapon", () => {
  assert.equal(SHIELDS.length, 3, "exactly three shields");
  assert.deepEqual(SHIELD_IDS, ["kavacha", "matterforge", "nuclear-aegis"]);
  assert.equal(shieldById("kavacha").name, "Kavacha of Parvati");
  assert.equal(shieldById("matterforge").name, "Matterforge Shield");
  assert.equal(shieldById("nuclear-aegis").name, "Nuclear Aegis");

  // The counters are the WEAPONS' OWN ids, never a name retyped.
  assert.equal(shieldFor("shiva")?.id, "kavacha", "Kavacha answers the Eye of Shiva");
  assert.equal(shieldFor("antimatter")?.id, "matterforge", "Matterforge answers Antimatter");
  assert.equal(shieldFor("nuclear")?.id, "nuclear-aegis", "the Aegis answers the Warhead");
  for (const shield of SHIELDS) {
    assert.ok(weaponById(shield.counters), `${shield.counters} is a weapon that exists`);
  }
  assert.equal(new Set(SHIELDS.map((s) => s.counters)).size, 3, "each weapon answered once");

  // A shield is not a weapon and can never be looked up as one.
  for (const shield of SHIELDS) {
    assert.equal(weaponById(shield.id), null, `${shield.id} is not in the armoury`);
  }
});

test("a fresh game has no shields standing", () => {
  const state = createGame(PLAYERS, { testMode: true });
  assert.deepEqual(state.shields, []);
  assert.deepEqual(shieldsOf(state, 0), []);
  assert.deepEqual(shieldsOf(state, 1), []);
});

/* -------------------------------------------------------------- the visit */

test("landing on Kronos opens the shield chest, in the state", () => {
  const state = createGame(PLAYERS, { testMode: true });
  const after = goTo(state, KRONOS_INDEX);
  assert.equal(after.landing.id, "kronos");
  assert.equal(after.landing.kind, "chest");
  assert.ok(after.chest, "the chest is a fact about the game, not a browser");
  assert.equal(after.chest.kind, "kronos");
  assert.equal(after.chest.playerId, after.active);
  assert.equal(after.chest.phase, "open");
  assert.deepEqual(after.shields, [], "nothing stands until a draw");
});

test("landing on Kronos by an ordinary throw opens the same chest", () => {
  // The non-test path, with the die rigged the way the other chest tests do.
  const state = createGame(PLAYERS);
  state.pieces[0].position = KRONOS_INDEX - 1;
  const rolled = take(state, { type: "roll" }, () => (1 - 0.5) / 6).state;
  const after = take(rolled, { type: "continue" }).state;
  assert.equal(after.chest.kind, "kronos");
  assert.equal(after.chest.phase, "open");
});

test("the shield chest answers nowhere else", () => {
  refuse(createGame(PLAYERS, { testMode: true }), { type: "drawShield" }, "There is no chest to draw from.");
  const atRagnarok = goTo(createGame(PLAYERS, { testMode: true }), 4);
  assert.equal(atRagnarok.chest.kind, "ragnarok");
  refuse(atRagnarok, { type: "drawShield" }, "There is no chest to draw from.");
});

/* ------------------------------------------------------------- the drawing */

test("a drawn shield deploys at once: its owner, its weapon, two owned turns", () => {
  const state = atKronos();
  const { state: drawn, events } = take(state, { type: "drawShield", slot: 1 }, () => 0);

  const event = events.find((e) => e.type === "shieldDrawn");
  assert.ok(event, "the draw is said");
  assert.equal(SHIELD_TURNS, 2, "the duration is two owned turns");

  assert.equal(drawn.shields.length, 1, "one shield is standing");
  const [shield] = drawn.shields;
  assert.equal(shield.owner, drawn.active, "it belongs to the player who drew it");
  assert.equal(shield.id, event.shield);
  assert.equal(shield.weapon, shieldById(event.shield).counters, "it carries the weapon it counters");
  assert.equal(shield.turnsLeft, SHIELD_TURNS, "both turns are counted from the deployment");

  assert.deepEqual(drawn.pieces[0].weapons, [], "a shield is NOT a weapon and joins no inventory");
  assert.equal(drawn.visit.shieldDrawn, event.shield, "the visit is answered");
  assert.equal(drawn.chest.phase, "drawing", "the shuffle may begin");
  assert.ok(
    drawn.ledger.history.some((entry) => entry.text === `Deployed ${shieldById(event.shield).name}`),
    "the ledger says what was deployed",
  );

  // The opponent holds nothing: one seat's shield is that seat's alone.
  assert.deepEqual(shieldsOf(drawn, opponentOf(drawn, drawn.active)), []);
  assert.deepEqual(shieldsOf(drawn, drawn.active), drawn.shields);
});

test("the face turns over at its own moment, and only once", () => {
  let state = atKronos();
  state = take(state, { type: "drawShield", slot: 0 }, () => 0).state;

  refuse(state, { type: "revealShield", seat: 1 }, "It is not your turn.");
  state = take(state, { type: "revealShield" }).state;
  assert.equal(state.chest.phase, "revealed");
  assert.ok(state.chest.startedAt > 0, "the reveal has its own moment for both devices");

  refuse(state, { type: "revealShield" }, "That shield has already been turned over.");
});

test("the chest cannot be drawn from twice, and not by the other player", () => {
  const state = take(atKronos(), { type: "drawShield" }, () => 0).state;
  refuse(state, { type: "drawShield" }, "This chest has already been drawn from.");

  const fresh = atKronos();
  refuse(fresh, { type: "drawShield", seat: 1 }, "It is not your turn.");
});

test("the visit must be answered before it is left", () => {
  const state = atKronos();
  refuse(state, { type: "done" }, "Draw from the chest first.");
  refuse(state, { type: "continue" }, "Draw from the chest first.");

  const revealed = drawAt(state);
  const closed = take(revealed, { type: "done" }).state;
  assert.equal(closed.chest, null, "Done closes the chest");
  assert.equal(closed.phase, PHASE.TURN_END, "and the turn goes with it");
});

test("shields cross the wire and come back unchanged", () => {
  const drawn = drawAt(atKronos());
  const back = restoreGame(JSON.parse(JSON.stringify(serializeGame(drawn))));
  assert.deepEqual(back.shields, drawn.shields);
});

/* ---------------------------------------------- what may never be redrawn */

test("the draw skips a shield already standing, even when the rng asks for it", () => {
  const state = atKronos();
  // Seat 0 already stands behind the FIRST shield, and the rng asks for the
  // first thing going - which must not be the one they hold.
  state.shields = [{ id: "kavacha", owner: 0, weapon: "shiva", turnsLeft: 1 }];
  const { state: drawn } = take(state, { type: "drawShield" }, () => 0);

  assert.notEqual(drawn.visit.shieldDrawn, "kavacha", "a held shield is never offered");
  assert.equal(drawn.shields.length, 2, "the draw added exactly one");
  const standing = drawn.shields.find((s) => s.id === "kavacha");
  assert.equal(standing.turnsLeft, 1, "the standing shield was not refreshed by the draw");
});

test("no rng can ever redraw a held shield", () => {
  for (let i = 0; i < 256; i += 1) {
    const drawn = drawShield(() => i / 256, ["kavacha"]);
    assert.notEqual(drawn, "kavacha");
    assert.ok(drawn === null || SHIELD_IDS.includes(drawn), "or a shield that exists");
  }
});

test("drawing while all three stand is a miss, and overwrites nothing", () => {
  const state = atKronos();
  state.shields = SHIELDS.map((shield, n) => ({
    id: shield.id,
    owner: 0,
    weapon: shield.counters,
    turnsLeft: n + 1,
  }));
  const before = state.shields.map((shield) => ({ ...shield }));

  const { state: drawn } = take(state, { type: "drawShield" }, () => 0);
  assert.equal(drawn.visit.shieldDrawn, "none", "the visit is answered with a miss");
  assert.deepEqual(drawn.shields, before, "every standing shield kept its own turns");

  // A miss is still an answer: the visit can be closed.
  const revealed = take(drawn, { type: "revealShield" }).state;
  const closed = take(revealed, { type: "done" }).state;
  assert.equal(closed.chest, null);
});

test("the opponent's standing shields are none of this draw's business", () => {
  const state = atKronos();
  state.shields = [{ id: "kavacha", owner: 1, weapon: "shiva", turnsLeft: 2 }];
  const { state: drawn } = take(state, { type: "drawShield" }, () => 0);
  assert.equal(drawn.shields.length, 2, "seat 0 may still draw a shield of their own");
  assert.equal(drawn.visit.shieldDrawn, "kavacha");
});

test("a refused action cannot move the shields, and a copy cannot either", () => {
  const state = atKronos();
  const before = state.shields;
  refuse(state, { type: "drawShield", seat: 1 }, "It is not your turn.");
  assert.equal(state.shields, before, "the refused action left the state itself untouched");

  const { state: drawn } = take(state, { type: "drawShield" }, () => 0);
  assert.notEqual(drawn.shields, state.shields, "the new state holds a new list");
});

/* ------------------------------------------------------- two owned turns */

test("a shield stands for exactly two of its OWNER's turns", () => {
  let state = drawAt(atKronos());
  const owner = state.active;
  const weapon = state.shields[0].weapon;
  const id = state.shields[0].id;

  // The owner's first turn ends - the deployment turn is the first of the two.
  state = take(state, { type: "done" }).state;
  state = take(state, { type: "continue" }).state;
  assert.equal(state.shields.length, 1);
  assert.equal(state.shields[0].turnsLeft, SHIELD_TURNS - 1, "one owned turn spent");

  // The OPPONENT's turn runs, and does not count.
  state = passTurn(state);
  assert.equal(state.active, owner, "the turn is back with the owner");
  assert.equal(state.shields[0].turnsLeft, SHIELD_TURNS - 1, "the opponent's turn did not count");

  // The owner's second turn ends, and the shield goes.
  const resolved = take(goTo(state, QUIET_INDEX), { type: "continue" }).state;
  const { state: ended, events } = take(resolved, { type: "continue" });
  assert.deepEqual(ended.shields, [], "expired after the owner's second turn");
  const expired = events.find((e) => e.type === "shieldExpired");
  assert.ok(expired, "the expiry is said");
  assert.equal(expired.seat, owner, "to the shield's owner");
  assert.equal(expired.shield, id);
  assert.equal(expired.weapon, weapon);
});

/* --------------------------------------------------------------- the block */

test("a shield blocks its own weapon: the strike spends itself on it", () => {
  let state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    shields: [{ id: "nuclear-aegis", owner: 1, weapon: "nuclear", turnsLeft: 2 }],
  });
  const { state: struck, events } = take(state, { type: "fightAttack", targetId: "moon" });

  // Nothing destructive happened: no capture, no weapon spent.
  assert.equal(sheetFor(struck.ledger, "moon").owner, 1, "the colony is untouched");
  assert.deepEqual(struck.pieces[0].weapons, ["nuclear"], "the attacker keeps the weapon");

  // The shield is consumed - once, in the same action that read it.
  assert.deepEqual(struck.shields, []);

  // The fight knows what happened and is ready to be closed.
  assert.equal(struck.fight.phase, "resolving");
  assert.equal(struck.fight.result.blocked, true);
  assert.equal(struck.fight.result.shield, "nuclear-aegis");
  assert.equal(struck.fight.result.id, "moon");

  // Both screens are told, once, and the capture is NOT ALSO SAID.
  const blocked = events.find((e) => e.type === "shieldBlocked");
  assert.ok(blocked, "the block is an event of its own");
  assert.equal(blocked.weapon, "nuclear");
  assert.equal(blocked.owner, 1, "the defender is the shield's owner");
  assert.equal(blocked.id, "moon");
  assert.equal(events.some((e) => e.type === "fightResolved"), false, "no second answer");
  assert.ok(
    struck.ledger.history.some((entry) => entry.text.includes("Nuclear Aegis")),
    "the ledger says what stopped the strike",
  );

  // The blocked strike closes the fight the same way a capture does.
  const closed = take(struck, { type: "done" }).state;
  assert.equal(closed.fight, null);
  assert.equal(closed.phase, PHASE.TURN_END);
});

test("the other two weapons walk straight past the shield", () => {
  // Kavacha answers the Eye of Shiva; a nuclear strike is not its business.
  const state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    shields: [{ id: "kavacha", owner: 1, weapon: "shiva", turnsLeft: 2 }],
  });
  const { state: struck, events } = take(state, { type: "fightAttack", targetId: "moon" });

  assert.equal(sheetFor(struck.ledger, "moon").owner, 0, "the colony is captured");
  assert.deepEqual(struck.pieces[0].weapons, [], "the weapon is spent on the capture");
  assert.equal(struck.shields.length, 1, "the shield is not touched by another weapon's strike");
  assert.ok(events.some((e) => e.type === "fightResolved"), "the ordinary answer is the only one");
});

test("a shield answers only for its owner, never for the attacker", () => {
  const state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    shields: [{ id: "nuclear-aegis", owner: 0, weapon: "nuclear", turnsLeft: 2 }],
  });
  const { state: struck, events } = take(state, { type: "fightAttack", targetId: "moon" });

  assert.equal(sheetFor(struck.ledger, "moon").owner, 0, "your own shield does not stop your own strike");
  assert.equal(struck.shields.length, 1, "and it is still standing afterwards");
  assert.ok(events.some((e) => e.type === "fightResolved"));
});

test("a blocked strike does not consume the weapon, so it can be tried again", () => {
  let state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    shields: [{ id: "nuclear-aegis", owner: 1, weapon: "nuclear", turnsLeft: 2 }],
  });
  state = take(state, { type: "fightAttack", targetId: "moon" }).state;
  assert.deepEqual(state.pieces[0].weapons, ["nuclear"], "the block does not delete the weapon");

  // The fight closes, the turns pass, and the same weapon strikes again -
  // with no shield left to stop it this time.
  state = take(state, { type: "done" }).state;
  state = take(state, { type: "continue" }).state; // -> seat 1
  state = passTurn(state); // -> seat 0 again, and the shield was already spent
  const atFight = goTo(state, FIGHT_INDEX);
  const selected = take(atFight, { type: "selectWeapon", weaponId: "nuclear" }).state;
  const armed = take(selected, { type: "armWeapon" }).state;
  const { state: struck } = take(armed, { type: "fightAttack", targetId: "moon" });

  assert.equal(sheetFor(struck.ledger, "moon").owner, 0, "with no shield, the strike lands");
  assert.deepEqual(struck.shields, []);
});

test("an expired shield blocks nothing", () => {
  // One owned turn left: the next handover takes it.
  let state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    shields: [{ id: "nuclear-aegis", owner: 1, weapon: "nuclear", turnsLeft: 1 }],
  });
  // Seat 0 walks away from the Fight, which ends the visit and the turn.
  state = take(state, { type: "leaveFight" }).state;
  state = take(state, { type: "continue" }).state; // -> seat 1
  state = passTurn(state); // seat 1's turn ends: the shield expires
  assert.deepEqual(state.shields, [], "the shield did not survive its owner's turn");

  const atFight = goTo(state, FIGHT_INDEX);
  const selected = take(atFight, { type: "selectWeapon", weaponId: "nuclear" }).state;
  const armed = take(selected, { type: "armWeapon" }).state;
  const { state: struck } = take(armed, { type: "fightAttack", targetId: "moon" });
  assert.equal(sheetFor(struck.ledger, "moon").owner, 0, "the expired shield stopped nothing");
});

test("a strike is answered by exactly one shield, and only that one is spent", () => {
  const state = fightVisit({
    weapons: ["nuclear"],
    owned: ["moon"],
    shields: [
      { id: "nuclear-aegis", owner: 1, weapon: "nuclear", turnsLeft: 2 },
      { id: "kavacha", owner: 1, weapon: "shiva", turnsLeft: 2 },
    ],
  });
  const { state: struck, events } = take(state, { type: "fightAttack", targetId: "moon" });
  assert.equal(events.filter((e) => e.type === "shieldBlocked").length, 1, "one block, one spend");
  assert.deepEqual(
    struck.shields.map((s) => s.id),
    ["kavacha"],
    "the matching shield is spent; the one answering another weapon still stands",
  );
});
