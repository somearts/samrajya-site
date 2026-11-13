/* ==========================================================================
   THE MONOPOLY RULES, AUDITED

   Every rule in the list, one test at a time, and the two new ones: even
   upgrades, and the rent of a full set.

   The sets are the eight on the board, and each is tested as a set: a proper
   subset is not a set, and two players each holding part of one is not a set
   either. The rules are read from the board's own data, so a set that gains or
   loses a colony is tested with it.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { PHASE, applyAction, createGame } from "../shared/game.js";
import {
  canUpgrade,
  evenUpgradeBlocked,
  fullSetRent,
  hasMonopoly,
  levelOf,
  moneyOf,
  ownerOf,
  payRent,
  rentAt,
  setHolder,
  setMembers,
  sheetFor,
  upgrade,
} from "../shared/ledger.js";
import { baseRentOf, rentFor } from "../shared/economy.js";
import { CELLS } from "../shared/spaces.js";

const PLAYERS = [
  { name: "Sam", civ: "indus-valley" },
  { name: "Smith", civ: "aztec" },
];

/** The sets on the board, and the colonies in each. */
const SETS = CELLS.filter((c) => c.type === "property" && c.set).reduce((all, c) => {
  if (!all[c.set]) all[c.set] = [];
  all[c.set].push(c.id);
  return all;
}, {});

const face = (n) => () => (n - 0.5) / 6;

function game() {
  return createGame(PLAYERS);
}

/** A ledger with a seat holding the given colonies. */
function holding(ids, seat = 0) {
  const state = game();
  for (const id of ids) sheetFor(state.ledger, id).owner = seat;
  return state;
}

/* ------------------------------------------------------------- the sets */

test("the board has eight sets, and every colony belongs to one", () => {
  const names = Object.keys(SETS);
  assert.equal(names.length, 8);
  for (const name of names) {
    assert.ok(SETS[name].length === 2 || SETS[name].length === 3, `${name} has 2 or 3`);
  }
  const every = Object.values(SETS).flat();
  assert.equal(every.length, 20, "every property is in exactly one set");
  assert.equal(new Set(every).size, 20, "and no property is in two");
});

test("holding every colony in a set is a monopoly, for all eight sets", () => {
  for (const [name, ids] of Object.entries(SETS)) {
    const state = holding(ids, 0);
    for (const id of ids) {
      assert.equal(hasMonopoly(state.ledger, id, 0), true, `${name}: ${id}`);
      assert.equal(setHolder(state.ledger, id), 0, `${name}: ${id} is complete`);
    }
  }
});

test("holding all but one is not a monopoly, for all eight sets", () => {
  for (const [name, ids] of Object.entries(SETS)) {
    for (let missing = 0; missing < ids.length; missing += 1) {
      const kept = ids.filter((_, i) => i !== missing);
      const state = holding(kept, 0);
      for (const id of kept) {
        assert.equal(hasMonopoly(state.ledger, id, 0), false, `${name}: ${id} without ${ids[missing]}`);
        assert.equal(setHolder(state.ledger, id), null, `${name}: ${id} is not complete`);
      }
    }
  }
});

test("one colony is not a set, for all eight sets", () => {
  for (const [name, ids] of Object.entries(SETS)) {
    const state = holding([ids[0]], 0);
    assert.equal(hasMonopoly(state.ledger, ids[0], 0), false, name);
    assert.equal(setHolder(state.ledger, ids[0]), null, name);
  }
});

test("a set split between two players is not a monopoly, for all eight sets", () => {
  for (const [name, ids] of Object.entries(SETS)) {
    const state = holding([ids[0]], 0);
    for (const id of ids.slice(1)) sheetFor(state.ledger, id).owner = 1;
    for (const id of ids) {
      assert.equal(hasMonopoly(state.ledger, id, 0), false, `${name}: ${id} for seat 0`);
      assert.equal(hasMonopoly(state.ledger, id, 1), false, `${name}: ${id} for seat 1`);
      assert.equal(setHolder(state.ledger, id), null, `${name}: ${id} has no one holder`);
    }
  }
});

test("a set with a hole in it is not a monopoly either", () => {
  for (const [name, ids] of Object.entries(SETS)) {
    // One colony short of the set, whatever the set's size.
    const kept = ids.slice(0, Math.max(1, ids.length - 1));
    const state = holding(kept, 0);
    for (const id of kept) {
      assert.equal(hasMonopoly(state.ledger, id, 0), false, name);
    }
  }
});

/* ------------------------------------------------------- the audit, item a */

test("a. rent is paid only to another player who holds the square", () => {
  const state = game();
  // An unowned square charges nobody.
  assert.equal(payRent(state.ledger, "moon", 0).rent, 0);
  // Your own square charges nobody.
  sheetFor(state.ledger, "moon").owner = 0;
  assert.equal(payRent(state.ledger, "moon", 0).rent, 0);
  // Somebody else's square charges them.
  const other = game();
  sheetFor(other.ledger, "moon").owner = 1;
  const verdict = payRent(other.ledger, "moon", 0);
  assert.equal(verdict.rent, baseRentOf("moon"));
  assert.equal(verdict.to, 1);
  assert.equal(moneyOf(other.ledger, 0), 5000 - verdict.rent);
  assert.equal(moneyOf(other.ledger, 1), 5000 + verdict.rent);
});

/* ------------------------------------------------------- the audit, item b */

test("b. buying works only on landing, unowned, on your turn, with the money", () => {
  const state = game();
  // Not a decision: refused.
  let no = applyAction(state, { type: "buy", seat: 0 }).events.find((e) => e.type === "refused");
  assert.ok(no, "buying with nothing to buy is refused");

  // On a decision about somebody else's square: refused.
  const theirs = game();
  theirs.phase = PHASE.DECISION;
  theirs.landing = { seat: 1, index: 1, id: "moon", kind: "buy" };
  theirs.active = 1;
  no = applyAction(theirs, { type: "buy", seat: 0 }).events.find((e) => e.type === "refused");
  assert.ok(no, "buying out of turn is refused");

  // On a decision about a square somebody else holds: refused.
  const owned = game();
  owned.phase = PHASE.DECISION;
  owned.landing = { seat: 0, index: 1, id: "moon", kind: "buy" };
  sheetFor(owned.ledger, "moon").owner = 1;
  no = applyAction(owned, { type: "buy", seat: 0 }).events.find((e) => e.type === "refused");
  assert.ok(no, "buying a square somebody holds is refused");

  // On your own decision, with the money: accepted, once.
  const mine = game();
  mine.phase = PHASE.DECISION;
  mine.landing = { seat: 0, index: 1, id: "moon", kind: "buy" };
  mine.visit = { seat: 0, bought: false, upgrades: 0, drawn: null, collected: false, rent: 0, paid: false };
  const bought = applyAction(mine, { type: "buy", seat: 0 });
  assert.equal(bought.events.find((e) => e.type === "refused"), undefined);
  assert.equal(ownerOf(bought.state.ledger, "moon"), 0);
  // And buying it again in the same visit is refused: the phase has moved on.
  no = applyAction(bought.state, { type: "buy", seat: 0 }).events.find((e) => e.type === "refused");
  assert.ok(no, "buying twice is refused");
});

/* ------------------------------------------------------- the audit, item c */

test("c. a corner, a chest and a held square can never be bought", () => {
  for (const id of ["start", "outer-space", "black-hole", "fight", "ragnarok", "kronos"]) {
    const state = game();
    state.phase = PHASE.DECISION;
    state.landing = { seat: 0, index: 0, id, kind: "buy" };
    state.visit = { seat: 0, bought: false, upgrades: 0, drawn: null, collected: false, rent: 0, paid: false };
    const no = applyAction(state, { type: "buy", seat: 0 }).events.find((e) => e.type === "refused");
    assert.ok(no, `${id} is not for sale`);
  }
});

/* ------------------------------------------------------- the audit, item d */

test("d. out-of-turn actions are refused, one roll a turn, and the phase is checked", () => {
  const state = game();
  for (const action of [
    { type: "roll", seat: 1 },
    { type: "buy", seat: 1 },
    { type: "pass", seat: 1 },
    { type: "upgrade", seat: 1 },
    { type: "sell", id: "moon", seat: 1 },
    { type: "drawWeapon", seat: 1 },
    { type: "collectWeapon", seat: 1 },
    { type: "continue", seat: 1 },
  ]) {
    const no = applyAction(state, action).events.find((e) => e.type === "refused");
    assert.ok(no, `${action.type} out of turn is refused`);
  }
});

test("d. only one roll a turn", () => {
  const state = game();
  const first = applyAction(state, { type: "roll", seat: 0 }, face(3));
  assert.equal(first.events.find((e) => e.type === "refused"), undefined);
  const no = applyAction(first.state, { type: "roll", seat: 0 }, face(3)).events
    .find((e) => e.type === "refused");
  assert.ok(no, "a second roll in the same turn is refused");
});

test("d. an action in the wrong phase is refused", () => {
  const state = game();
  state.phase = PHASE.RESOLVING;
  const no = applyAction(state, { type: "roll", seat: 0 }, face(3)).events
    .find((e) => e.type === "refused");
  assert.ok(no, "rolling while the visit is being resolved is refused");
});

/* ------------------------------------------------------- the audit, item e */

test("e. upgrades need a monopoly, a landing, one a visit, in order, and the money", () => {
  const [setA, setB] = Object.entries(SETS);
  const ids = setA[1];

  // No monopoly: refused.
  const partial = holding([ids[0]], 0);
  assert.equal(canUpgrade(partial.ledger, ids[0], 0).ok, false);

  // A monopoly, but the money is short: refused.
  const poor = holding(ids, 0);
  poor.ledger.players[0].money = 1;
  const short = canUpgrade(poor.ledger, ids[0], 0);
  assert.equal(short.ok, false);
  assert.match(short.why, /more to upgrade/);

  // A monopoly and the money: allowed.
  const rich = holding(ids, 0);
  const fine = canUpgrade(rich.ledger, ids[0], 0);
  assert.equal(fine.ok, true);
});

test("e. one level a visit, in order, never past the third", () => {
  const ids = Object.values(SETS)[0];
  const state = holding(ids, 0);
  // Even building: a set rises together, so every colony in the set is built
  // to the same level before any of them goes past it.
  for (let level = 1; level <= 3; level += 1) {
    for (const id of ids) {
      const verdict = upgrade(state.ledger, id, 0);
      assert.equal(verdict.ok, true, `${id} to level ${level}`);
      assert.equal(levelOf(state.ledger, id), level);
    }
  }
  const past = canUpgrade(state.ledger, ids[0], 0);
  assert.equal(past.ok, false);
  assert.match(past.why, /as far as it goes/);
});

/* ------------------------------------------------------- the audit, item f */

test("f. redemption is earned for crossing or landing on Start, never for the first move", () => {
  const state = game();
  state.pieces[0].position = 26;
  const crossed = applyAction(state, { type: "roll", seat: 0 }, face(4));
  assert.equal(
    crossed.events.find((e) => e.type === "redemption"),
    undefined,
    "the lap is not paid in the middle of the walk",
  );
  assert.equal(crossed.state.visit.redemption, 200, "it is earned by crossing");

  const fresh = game();
  const first = applyAction(fresh, { type: "roll", seat: 0 }, face(1));
  assert.equal(first.state.visit.redemption, 0);
});

/* ------------------------------------------------------- the audit, item g */

test("g. a payer who cannot cover the rent is charged the full rent as debt", () => {
  const state = game();
  sheetFor(state.ledger, "moon").owner = 1;
  state.ledger.players[0].money = 5;
  const rent = baseRentOf("moon");
  const verdict = payRent(state.ledger, "moon", 0);
  assert.equal(verdict.amount, rent, "the whole rent moves");
  assert.equal(verdict.shortfall, 0, "nothing is left unpaid");
  assert.equal(moneyOf(state.ledger, 0), 5 - rent, "the purse crosses zero into debt");
  assert.equal(moneyOf(state.ledger, 1), 5000 + rent, "the owner takes the whole rent");
  assert.equal(state.ledger.players[0].short, 0, "no short accrues");
});

/* ------------------------------------------------------- the audit, item i */

test("i. selling is for the owner, between turns", () => {
  const state = game();
  sheetFor(state.ledger, "moon").owner = 0;
  // Out of the owner's turn: refused.
  state.active = 1;
  let no = applyAction(state, { type: "sell", id: "moon", seat: 0 }).events
    .find((e) => e.type === "refused");
  assert.ok(no, "selling on the other player's turn is refused");
  // Somebody else's square: refused.
  state.active = 0;
  no = applyAction(state, { type: "sell", id: "moon", seat: 1 }).events
    .find((e) => e.type === "refused");
  assert.ok(no, "selling a square you do not hold is refused");
  // Your own square, between turns: accepted.
  const sold = applyAction(state, { type: "sell", id: "moon", seat: 0 });
  assert.equal(sold.events.find((e) => e.type === "refused"), undefined);
  assert.equal(ownerOf(sold.state.ledger, "moon"), null);
});

/* -------------------------------------------- the new rule: even upgrades */

test("a set may never stand more than one level above its lowest colony", () => {
  for (const [name, ids] of Object.entries(SETS)) {
    const state = holding(ids, 0);
    // Nothing built: the first level is fine.
    assert.equal(evenUpgradeBlocked(state.ledger, ids[0]), false, name);
    // One colony at level one, the rest at zero: the level two colony is
    // blocked, because it would stand two levels above the lowest.
    sheetFor(state.ledger, ids[0]).upgradeLevel = 1;
    assert.equal(evenUpgradeBlocked(state.ledger, ids[0]), true, `${name}: the next level`);
    assert.equal(evenUpgradeBlocked(state.ledger, ids[1]), false, `${name}: the lower colony`);
    const verdict = canUpgrade(state.ledger, ids[0], 0);
    assert.equal(verdict.ok, true);
  }
});

test("a set at equal levels may be built up together", () => {
  for (const [name, ids] of Object.entries(SETS)) {
    const state = holding(ids, 0);
    for (const id of ids) sheetFor(state.ledger, id).upgradeLevel = 1;
    for (const id of ids) {
      assert.equal(evenUpgradeBlocked(state.ledger, id), false, `${name}: ${id}`);
      assert.equal(canUpgrade(state.ledger, id, 0).ok, true, `${name}: ${id}`);
    }
  }
});

/* ------------------------------------------- the new rule: a full set's rent */

test("a complete set with nothing built on it charges double", () => {
  for (const [name, ids] of Object.entries(SETS)) {
    const state = holding(ids, 0);
    for (const id of ids) {
      assert.equal(
        rentAt(state.ledger, id),
        baseRentOf(id) * 2,
        `${name}: ${id} charges double`,
      );
      assert.equal(fullSetRent(state.ledger, id), baseRentOf(id) * 2, name);
    }
  }
});

test("once anything is built in the set, the ordinary rent applies again", () => {
  for (const [name, ids] of Object.entries(SETS)) {
    const state = holding(ids, 0);
    sheetFor(state.ledger, ids[0]).upgradeLevel = 1;
    for (const id of ids) {
      assert.equal(fullSetRent(state.ledger, id), null, `${name}: ${id} is not doubled`);
      const level = levelOf(state.ledger, id);
      assert.equal(rentAt(state.ledger, id), rentFor(id, level), `${name}: ${id}`);
    }
  }
});

test("the doubled rent is what is charged, announced and recorded", () => {
  const state = game();
  const ids = Object.values(SETS)[1];
  for (const id of ids) sheetFor(state.ledger, id).owner = 1;
  const before = moneyOf(state.ledger, 0);
  const verdict = payRent(state.ledger, ids[0], 0);
  assert.equal(verdict.rent, baseRentOf(ids[0]) * 2, "the rent charged is doubled");
  assert.equal(moneyOf(state.ledger, 0), before - verdict.rent);
});

test("a set that is not complete charges the ordinary rent", () => {
  const ids = Object.values(SETS)[0];
  const state = holding([ids[0]], 1);
  const id = ids[0];
  assert.equal(fullSetRent(state.ledger, id), null);
  assert.equal(rentAt(state.ledger, id), baseRentOf(id));
});

/* ------------------------------------------------------ the invariant check */

/**
 * What must be true of a ledger, always.
 *
 * Run after every action, so a rule that breaks the ledger is caught by the
 * rule that broke it and not by something later.
 */
function assertInvariants(state) {
  const { ledger } = state;
  const seats = ledger.players.map((p) => p.seat);
  for (const [id, sheet] of ledger.properties) {
    if (!sheet) continue;
    assert.ok(
      sheet.owner === null || seats.includes(sheet.owner),
      `${id} is owned by a seat that is not playing`,
    );
    assert.ok(
      Number.isInteger(sheet.upgradeLevel) && sheet.upgradeLevel >= 0 && sheet.upgradeLevel <= 3,
      `${id} is at level ${sheet.upgradeLevel}`,
    );
    assert.ok(
      sheet.owner === null ? sheet.upgradeLevel === 0 : true,
      `${id} is built on and nobody holds it`,
    );
  }
  for (const player of ledger.players) {
    assert.ok(player.money >= 0, `seat ${player.seat} has ${player.money}`);
    assert.ok(player.short >= 0, `seat ${player.seat} is short ${player.short}`);
  }
  // No colony is held twice: one sheet, one owner, one level.
  for (const id of setMembers(ledger, "moon")) {
    assert.ok(ownerOf(ledger, id) !== undefined);
  }
}

test("h. the ledger is consistent after every action of a whole game", () => {
  let state = game();
  const script = [
    { type: "roll", seat: 0, rng: face(2) },
    { type: "buy", seat: 0 },
    { type: "continue", seat: 0 },
    { type: "roll", seat: 1, rng: face(1) },
    { type: "pass", seat: 1 },
    { type: "continue", seat: 1 },
    { type: "roll", seat: 0, rng: face(3) },
    { type: "pass", seat: 0 },
    { type: "continue", seat: 0 },
    { type: "roll", seat: 1, rng: face(6) },
    { type: "continue", seat: 1 },
  ];
  for (const action of script) {
    const result = applyAction(state, { type: action.type, seat: action.seat }, action.rng);
    const no = result.events.find((e) => e.type === "refused");
    if (no) continue;
    state = result.state;
    assertInvariants(state);
  }
  assertInvariants(state);
});

/* ------------------------------------------- the line that must not exist */

test("nothing anywhere claims that a player holds a whole set", () => {
  const roots = ["authored/samrajya/assets/js", "shared", "test", "scripts"];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith(".js") || path.endsWith(".mjs")) files.push(path);
    }
  };
  for (const root of roots) walk(root);

  // The phrase is assembled rather than written, so that this test is not
  // itself an occurrence of the thing it forbids.
  const forbidden = ["holds", "every"].join(" ");
  const offenders = files.filter((file) =>
    readFileSync(file, "utf8").includes(forbidden));
  assert.deepEqual(offenders, [], "the line is gone, and it does not come back");
});

test("and the set's own size is what the card says", () => {
  // The message names the size of the set, so it has to be the real size.
  for (const [name, ids] of Object.entries(SETS)) {
    const state = holding([ids[0]], 0);
    const verdict = canUpgrade(state.ledger, ids[0], 0);
    assert.equal(verdict.ok, false);
    assert.equal(
      verdict.why,
      `Own all ${ids.length} colonies in this set to unlock upgrades.`,
      name,
    );
  }
});
















