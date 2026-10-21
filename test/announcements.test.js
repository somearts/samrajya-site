/* ==========================================================================
   WHAT AN ACTION SAYS

   The announcement copy is a function of an event and the person looking at
   it. These tests are the two-phone case: one event, two viewers, the same
   figures on both and different sentences.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import { announcementFor, signed } from "../shared/announcements.js";
import { createGame } from "../shared/game.js";
import { baseRentOf, priceOf, upgradeAt } from "../shared/economy.js";

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

test("selling says SOLD and what came back", () => {
  const spec = announcementFor(
    { type: "sold", seat: 0, id: "moon", payout: 475 },
    { viewer: 0, ledger },
  );
  assert.equal(spec.label, "SOLD");
  assert.equal(spec.big, "Moon");
  assert.equal(spec.sub, "+₹475");
});

test("an upgrade names the level and the rent it now carries", () => {
  const spec = announcementFor(
    { type: "upgraded", seat: 0, id: "moon", name: "Lunar Outpost", cost: 100, rent: 80 },
    { viewer: 0, ledger },
  );
  assert.equal(spec.label, "UPGRADED");
  assert.equal(spec.big, "Lunar Outpost");
  assert.equal(spec.sub, "−₹100 · rent now ₹80");
});

test("passing says PASSED and the square it passed on", () => {
  const spec = announcementFor(
    { type: "passed", seat: 1, id: "kuiper-belt" },
    { viewer: 1, ledger },
  );
  assert.equal(spec.label, "PASSED");
  assert.equal(spec.big, "Kuiper Belt");
  assert.equal(spec.sub, "Not this time");
});

test("salary says SALARY, the amount and why", () => {
  const spec = announcementFor({ type: "salary", seat: 0, amount: 200 }, { viewer: 0, ledger });
  assert.equal(spec.label, "SALARY");
  assert.equal(spec.big, "+₹200");
  assert.equal(spec.sub, "Lap complete");
  assert.equal(spec.tone, "earn");
});

test("the payer and the holder read the same rent two ways", () => {
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

test("movement, landing, the chest and the turn banner stay quiet", () => {
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

test("the upgrade cost comes from the economy, not from the sentence", () => {
  const spec = announcementFor(
    {
      type: "upgraded",
      seat: 0,
      id: "moon",
      name: "Lunar Outpost",
      cost: upgradeAt("moon", 0).cost,
      rent: 80,
    },
    { viewer: 0, ledger },
  );
  assert.match(spec.sub, /^−₹\d/);
});
