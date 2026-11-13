/* ==========================================================================
   THE ECONOMY

   Twenty prices, twenty base rents and sixty upgrades, all of them written down
   rather than computed. Written numbers are only trustworthy if something
   checks them, so this file is mostly checks:

     that the table is exactly the twenty properties and nothing else,
     that every number in it is a round number a player could read at a glance,
     that rent only ever goes up as you build,
     and that the twenty prices are twenty different prices.

   The last two matter more than they look. A duplicated price or a rent that
   falls when the place gets better would both survive every visual review and
   both would be wrong.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PRICING,
  PRICED_IDS,
  STARTING_MONEY,
  MAX_UPGRADE,
  priceOf,
  baseRentOf,
  rentFor,
  upgradeAt,
  upgradesOf,
  isPriced,
} from "../shared/economy.js";
import { CELLS } from "../shared/spaces.js";
import { PROPERTIES, propertyFor } from "../shared/properties.js";

test("everyone starts with two thousand", () => {
  assert.equal(STARTING_MONEY, 5000);
});

test("the table prices exactly the twenty properties, and no others", () => {
  const onBoard = CELLS.filter((c) => c.type === "property").map((c) => c.id).sort();
  assert.deepEqual([...PRICED_IDS].sort(), onBoard);
  assert.equal(PRICED_IDS.length, 20);
});

test("every price is a round fifty and every cost a round ten", () => {
  // Nobody is going to read 947 and think the game is well made.
  //
  // Prices are multiples of 50 and upgrade costs multiples of 10. The costs are
  // not all multiples of 50 - Relay Station is 120 and Stabiliser Gate is 480 -
  // because the design asked for clean numbers and then wrote those. The written
  // numbers won: they are the ones on the card, and a price nobody can sum in
  // their head is worth more than a price that is tidy by the wrong ten.
  for (const id of PRICED_IDS) {
    const p = PRICING[id];
    assert.equal(p.price % 50, 0, `${id} price ${p.price}`);
    for (const up of p.upgrades) {
      assert.equal(up.cost % 10, 0, `${id} ${up.name} costs ${up.cost}`);
    }
  }
});

test("rent is a tenth of the price, on every one of the twenty", () => {
  // Not a rule the game depends on - a regularity that came out of the design
  // and is worth keeping, because it means a player who has priced one square
  // has priced all of them.
  for (const id of PRICED_IDS) {
    const p = PRICING[id];
    assert.equal(p.baseRent, p.price / 10, `${id}: ${p.baseRent} on ${p.price}`);
    assert.equal(baseRentOf(id), p.price / 10);
  }
});

test("the twenty prices are twenty different prices, cheapest to dearest", () => {
  const prices = PRICED_IDS.map((id) => PRICING[id].price);
  assert.equal(new Set(prices).size, 20, "two squares cost the same");

  const sorted = [...prices].sort((a, b) => a - b);
  assert.deepEqual(sorted, [200, 250, 300, 350, 400, 450, 500, 550, 600, 700,
    750, 800, 850, 900, 950, 1000, 1100, 1200, 1300, 1400]);
});

test("Sagittarius A* is the dearest and Quasar the third dearest", () => {
  const byPrice = [...PRICED_IDS].sort((a, b) => PRICING[b].price - PRICING[a].price);
  assert.deepEqual(byPrice.slice(0, 3), ["sagittarius-a-star", "supernova", "quasar"]);
});

test("every property has three upgrades, and each is a level above the last", () => {
  for (const id of PRICED_IDS) {
    assert.equal(PRICING[id].upgrades.length, MAX_UPGRADE, `${id} upgrade count`);
    for (const up of PRICING[id].upgrades) {
      assert.ok(up.name.length > 2, `${id} has an unnamed upgrade`);
      assert.ok(up.description.length > 10, `${id} ${up.name} has no description`);
      assert.ok(up.rentAfter > 0, `${id} ${up.name} rents nothing`);
    }
  }
});

test("rent only ever goes up as a place is built up", () => {
  for (const id of PRICED_IDS) {
    const rents = [0, 1, 2, 3].map((level) => rentFor(id, level));
    for (let n = 1; n < rents.length; n += 1) {
      assert.ok(
        rents[n] > rents[n - 1],
        `${id}: rent falls to ${rents[n]} at level ${n}`,
      );
    }
  }
});

test("upgrades cost more each time, because each one is a bigger thing", () => {
  for (const id of PRICED_IDS) {
    const costs = PRICING[id].upgrades.map((u) => u.cost);
    for (let n = 1; n < costs.length; n += 1) {
      assert.ok(costs[n] > costs[n - 1], `${id}: upgrade ${n + 1} is cheaper than upgrade ${n}`);
    }
  }
});

test("a fully built place is worth many times what it cost to take", () => {
  // The reason to keep building. If this stops being true the economy is a trap.
  for (const id of PRICED_IDS) {
    const p = PRICING[id];
    const spent = p.price + p.upgrades.reduce((sum, u) => sum + u.cost, 0);
    assert.ok(
      p.upgrades[2].rentAfter > spent / 8,
      `${id}: ${p.upgrades[2].rentAfter} on ${spent} spent`,
    );
  }
});

test("rent at each level is the bare rent, then the upgrade that brought it", () => {
  assert.equal(rentFor("moon", 0), 20);
  assert.equal(rentFor("moon", 1), 80);
  assert.equal(rentFor("moon", 2), 240);
  assert.equal(rentFor("moon", 3), 500);

  const halley = PRICING["halleys-comet"];
  assert.equal(rentFor("halleys-comet", 0), halley.baseRent);
  assert.equal(rentFor("halleys-comet", 1), halley.upgrades[0].rentAfter);
  assert.equal(rentFor("halleys-comet", 2), halley.upgrades[1].rentAfter);
  assert.equal(rentFor("halleys-comet", 3), halley.upgrades[2].rentAfter);
});

test("a build level outside the three is clamped, not answered wrongly", () => {
  // A caller being wrong should not put a false rent on a card.
  assert.equal(rentFor("moon", 4), 500);
  assert.equal(rentFor("moon", 99), 500);
  assert.equal(rentFor("moon", -1), 20);
  assert.equal(rentFor("moon", "nonsense"), 20);
  assert.equal(rentFor("moon"), 20, "no level means no building");
});

test("an id nobody has heard of has nothing to sell", () => {
  for (const nope of ["roman", "", null, undefined, 42, "ragnarok", "start"]) {
    assert.equal(priceOf(nope), null, `${nope} has no price`);
    assert.equal(baseRentOf(nope), null);
    assert.equal(rentFor(nope, 2), null);
    assert.equal(upgradeAt(nope, 0), null);
    assert.deepEqual(upgradesOf(nope), []);
    assert.equal(isPriced(nope), false);
  }
  assert.equal(isPriced("moon"), true);
});

test("the table cannot be rewritten from outside", () => {
  const first = upgradesOf("moon");
  // The array is a fresh one, so adding to it changes nothing.
  first.push({ name: "Invented", description: "", cost: 0, rentAfter: 0 });
  assert.equal(PRICING.moon.upgrades.length, 3);
  assert.equal(upgradesOf("moon").length, 3);

  // And each upgrade is frozen, so rewriting one is refused rather than obeyed.
  assert.throws(() => {
    "use strict";
    first[0].name = "Vandalised";
  });
  assert.equal(upgradeAt("moon", 0).name, "Lunar Outpost");
});

test("upgradeAt is null past the third, which is the fourth's whole purpose", () => {
  assert.ok(upgradeAt("moon", 2));
  assert.equal(upgradeAt("moon", 3), null);
});

test("the same price reaches the card that the board is drawn from", () => {
  // The economy and the board are two modules. This is the seam between them.
  for (const property of PROPERTIES) {
    assert.equal(property.price, priceOf(property.id), property.id);
    assert.equal(propertyFor(property.id).price, PRICING[property.id].price, property.id);
  }
});

