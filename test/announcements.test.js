/* ==========================================================================
   WHAT AN ACTION SAYS

   The announcement copy is a function of an event and the person looking at
   it. These tests are the two-phone case: one event, two viewers, the same
   figures on both and different sentences.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import { announcementFor, signed, statusFor } from "../shared/announcements.js";
import { createGame } from "../shared/game.js";
import { baseRentOf, priceOf } from "../shared/economy.js";

const PLAYERS = [
  { name: "Sam", civ: "indus-valley" },
  { name: "Smith", civ: "aztec" },
];

const ledger = createGame(PLAYERS).ledger;

test("a sign is in front of the amount, not inside it", () => {
  assert.equal(signed(200), "+₹200");
  assert.equal(signed(-200), "−₹200");
  assert.equal(signed(1200), "+₹1,200", "and the amount is grouped");
  assert.equal(signed(-0), "+₹0");
});

test("buying says ACQUIRED, the square, and what left the purse", () => {
  const spec = announcementFor(
    { type: "bought", seat: 0, id: "moon", name: "Moon", price: priceOf("moon") },
    { viewer: 0, ledger },
  );
  assert.deepEqual(spec, {
    label: "ACQUIRED",
    big: "Moon",
    sub: `−₹${priceOf("moon")}`,
    seat: 0,
    tone: "spend",
  });
});

test("only two kinds of splash exist; everything else says nothing", () => {
  /* ACQUIRED and the rent pair are the whole announcement vocabulary. Every
     other event - passing, upgrading, selling, the chests, the fight, the
     lap, refusals - is shown by the interface that owns it and announces
     nothing: a splash there is a second voice saying what the player has
     already been shown. */
  for (const type of [
    "sold", "upgraded", "passed", "redemption", "prayed",
    "nexusDrawn", "nexusRevealed", "nexusDeclined",
    "weaponDrawn", "weaponCollected",
    "fightResolved", "fightLeft", "fightClosed",
    "chestOpened", "chestClosed", "refused",
    "moved", "landed", "turnChanged",
  ]) {
    assert.equal(
      announcementFor({ type, seat: 0, id: "moon", name: "Moon", amount: -50 }, { viewer: 0, ledger }),
      null,
      `${type} says nothing`,
    );
  }
  // The two that remain, named:
  assert.equal(
    announcementFor({ type: "bought", seat: 0, id: "moon", name: "Moon", price: 100 }, { viewer: 0, ledger }).label,
    "ACQUIRED",
  );
  assert.equal(
    announcementFor({ type: "rentPaid", id: "moon", from: 1, to: 0, amount: 20 }, { viewer: 0, ledger }).label,
    "RENT RECEIVED",
  );
});

test("the rent sentence is written for the phone that is reading it", () => {
  const rent = baseRentOf("moon");
  const event = { type: "rentPaid", id: "moon", from: 1, to: 0, amount: rent };

  const payer = announcementFor(event, { viewer: 1, ledger });
  assert.equal(payer.label, "RENT PAID");
  assert.equal(payer.big, `−₹${rent}`);
  assert.equal(payer.sub, "to Sam · Moon");
  assert.equal(payer.seat, 1);

  const holder = announcementFor(event, { viewer: 0, ledger });
  assert.equal(holder.label, "RENT RECEIVED");
  assert.equal(holder.big, `+₹${rent}`);
  assert.equal(holder.sub, "from Smith · Moon");
  assert.equal(holder.seat, 0);
});

test("a rent that could not be covered says how short it was", () => {
  const event = { type: "rentShort", id: "moon", from: 1, to: 0, amount: 40, shortfall: 60 };
  const spec = announcementFor(event, { viewer: 1, ledger });
  assert.equal(spec.label, "RENT SHORT");
  assert.equal(spec.sub, "to Sam · Moon · short ₹60");
});

test("movement, landing, the chest and the turn change stay quiet", () => {
  for (const type of ["moved", "landed", "weaponDrawn", "weaponCollected", "turnChanged"]) {
    assert.equal(
      announcementFor({ type, seat: 0, id: "moon" }, { viewer: 0, ledger }),
      null,
      `${type} has its own voice`,
    );
  }
});

test("a rename on the server reaches both sentences", () => {
  const renamed = createGame([
    { name: "Sakshi", civ: "indus-valley" },
    { name: "Samrat", civ: "aztec" },
  ]).ledger;
  const event = { type: "rentPaid", id: "quasar", from: 0, to: 1, amount: 120 };
  assert.equal(
    announcementFor(event, { viewer: 0, ledger: renamed }).sub,
    "to Samrat · Quasar",
  );
  assert.equal(
    announcementFor(event, { viewer: 1, ledger: renamed }).sub,
    "from Sakshi · Quasar",
  );
});

/* --------------------------------------------------------------- the status */

test("the middle says the turn to the player who owns it", () => {
  const game = createGame(PLAYERS);
  const spec = statusFor(game, { viewer: game.active });
  assert.deepEqual(spec, {
    label: "YOUR TURN",
    big: "The move is yours",
    sub: "Tap the die to roll",
    seat: game.active,
    tone: "turn",
  });
});

test("and says plainly that the other player has the turn", () => {
  const game = createGame(PLAYERS);
  const spec = statusFor(game, { viewer: (game.active + 1) % 2 });
  assert.equal(spec.label, "THEIR TURN");
  assert.equal(spec.big, "Opponent is playing");
  assert.equal(spec.sub, "Sam commands the turn");
  assert.equal(spec.tone, "wait");
});

test("the status stands down while a decision card owns the middle", () => {
  const game = createGame(PLAYERS);
  game.phase = "DECISION";
  assert.equal(statusFor(game, { viewer: (game.active + 1) % 2 }), null);
  assert.equal(statusFor(game, { viewer: game.active }), null);
});

test("and the status is only ever said while the game is waiting for a throw", () => {
  /* A status painted in any other phase is a status about to be contradicted:
     the middle says "your turn" and a moment later says "their turn", and the
     player sees a turn that did not happen. */
  for (const phase of ["MOVING", "DECISION", "RESOLVING", "TURN_END"]) {
    const game = createGame(PLAYERS);
    game.phase = phase;
    assert.equal(statusFor(game, { viewer: game.active }), null, phase);
    assert.equal(statusFor(game, { viewer: (game.active + 1) % 2 }), null, phase);
  }
});

test("a board with no turn has no status at all", () => {
  assert.equal(statusFor(null), null);
  assert.equal(statusFor({ active: null, phase: "AWAITING_ROLL", ledger: null }), null);
});
