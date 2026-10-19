/* ==========================================================================
   THE PROPERTIES

   Twenty squares somebody can buy, what they cost, and what they say. The
   prices used to be derived from the board rather than written down; they now
   come from shared/economy.js, so what matters here is that each one lands on
   the square it belongs to. A price that is arithmetically right and attached
   to the wrong square would look perfect on a price list and be wrong on the
   board.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PROPERTIES,
  PROPERTIES_WITH_COPY,
  propertyFor,
  priceOf,
  isPurchasable,
} from "../shared/properties.js";
import { CELLS } from "../shared/spaces.js";
import { ART_IDS, hasPropertyArt } from "../authored/samrajya/assets/js/property-art.js";

test("there are exactly twenty purchasable properties", () => {
  const onBoard = CELLS.filter((c) => c.type === "property");
  assert.equal(onBoard.length, 20);
  assert.equal(PROPERTIES.length, 20);
  assert.deepEqual(
    PROPERTIES.map((p) => p.id).sort(),
    onBoard.map((c) => c.id).sort(),
  );
});

test("and they are in the order the board is travelled", () => {
  const indexes = PROPERTIES.map((p) => p.index);
  assert.deepEqual(indexes, [...indexes].sort((a, b) => a - b));
  // The step is Nth along the board, so this order is the whole meaning of the
  // number: Moon is the first property met, not the first one defined.
  assert.equal(PROPERTIES[0].id, "moon");
  assert.equal(PROPERTIES[0].index, 1);
});

test("every square carries the price the table gives it, by name", () => {
  // Spelled out one by one, in board order, so a price filed against the wrong
  // square cannot pass. This is the whole reason these numbers are checked:
  // nothing computes them any more, so nothing else would notice.
  const LADDER = [
    ["moon", 200],
    ["lagrange-l2", 250],
    ["asteroid-belt", 300],
    ["jupiter", 350],
    ["pluto", 400],
    ["kuiper-belt", 450],
    ["halleys-comet", 500],
    ["voyager-1", 550],
    ["proxima-centauri", 600],
    ["event-horizon", 700],
    ["earth-137", 750],
    ["orions-belt", 800],
    ["wow-signal", 850],
    ["dyson-sphere", 900],
    ["wormhole", 950],
    ["milky-way", 1000],
    ["rama", 1100],
    ["quasar", 1200],
    ["supernova", 1300],
    ["sagittarius-a-star", 1400],
  ];

  assert.deepEqual(PROPERTIES.map((p) => [p.id, p.price]), LADDER);

  for (const [id, price] of LADDER) {
    assert.equal(propertyFor(id).price, price, `${id} costs ${price}`);
  }
});

test("Sagittarius A* is the most expensive place on the board", () => {
  const dearest = PROPERTIES.reduce((a, b) => (b.price > a.price ? b : a));
  assert.equal(dearest.id, "sagittarius-a-star");
  assert.equal(dearest.price, 1400);

  // The three biggest, cheapest first.
  const top3 = PROPERTIES
    .map((p) => p.price)
    .sort((a, b) => b - a)
    .slice(0, 3);
  assert.deepEqual(top3, [1400, 1300, 1200]);
});

test("the price climbs along the board, so the cheapest place is met first", () => {
  // Not a rule about how the table is written - a property's price comes from
  // its name. It is an observation about this board, and it is the reason
  // buying power builds up gradually instead of arriving all at once.
  const prices = PROPERTIES.map((p) => p.price);
  for (let n = 1; n < prices.length; n += 1) {
    assert.ok(
      prices[n] > prices[n - 1],
      `${PROPERTIES[n].id} at ${prices[n]} is dearer than ${PROPERTIES[n - 1].id} at ${prices[n - 1]}`,
    );
  }
});

test("the two chests and the four corners are not for sale", () => {
  for (const id of [
    "start", "outer-space", "black-hole", "fight",      // the corners
    "ragnarok", "nexus", "epoch", "kronos",             // the chests
  ]) {
    assert.equal(isPurchasable(id), false, `${id} is not purchasable`);
    assert.equal(propertyFor(id), null, `${id} has no card`);
    assert.equal(priceOf(id), null, `${id} has no price`);
  }
});

test("a price is written with the rupee sign", () => {
  assert.equal(priceOf("moon"), "₹200");
  assert.equal(priceOf("quasar"), "₹1200");
});

test("an id nobody has heard of is not a property", () => {
  for (const nope of ["roman", "", null, undefined, 42]) {
    assert.equal(isPurchasable(nope), false);
    assert.equal(propertyFor(nope), null);
    assert.equal(priceOf(nope), null);
  }
});

test("every property has a description of exactly two lines", () => {
  assert.equal(PROPERTIES_WITH_COPY.length, 20);
  for (const p of PROPERTIES_WITH_COPY) {
    assert.equal(p.description.length, 2, `${p.id} has ${p.description.length} lines`);
    for (const line of p.description) {
      assert.equal(typeof line, "string");
      assert.ok(line.trim().length > 8, `${p.id}: "${line}" says something`);
      // A sanity bound, not a claim that it fits: whether a line is actually
      // clipped is measured in the browser by scripts/e2e.js, on the smallest
      // board, where it would matter.
      assert.ok(line.length <= 48, `${p.id}: "${line}" is a plausible one-line break`);
    }
  }
});

test("every property has a short advantage that does not tell anybody to buy it", () => {
  for (const p of PROPERTIES_WITH_COPY) {
    assert.ok(p.advantage.length > 20, `${p.id} says something`);
    assert.ok(p.advantage.length <= 110, `${p.id} stays short`);
    assert.equal(
      /\b(buy|purchase|you should)\b/i.test(p.advantage),
      false,
      `${p.id} does not tell the player what to do`,
    );
    assert.match(p.advantage, /[.!]$/, `${p.id} is a sentence`);
  }
});

test("no two properties are described the same way", () => {
  const descriptions = PROPERTIES_WITH_COPY.map((p) => p.description.join(" "));
  assert.equal(new Set(descriptions).size, 20);
  const advantages = PROPERTIES_WITH_COPY.map((p) => p.advantage);
  assert.equal(new Set(advantages).size, 20);
});

test("the card keeps the tile's own pill colour and label", () => {
  for (const p of PROPERTIES_WITH_COPY) {
    const cell = CELLS.find((c) => c.id === p.id);
    assert.equal(p.color, cell.color, `${p.id} keeps its set's colour`);
    assert.equal(p.set, cell.set, `${p.id} keeps its set`);
    assert.deepEqual([...p.lines], cell.lines, `${p.id} keeps its line breaks`);
    assert.equal(p.name, cell.name, `${p.id} keeps its name`);
  }
});

test("the data still names a drawing for only the ten that borrow one", () => {
  // This field is a pointer into the finished CARD artwork, so it stays null for
  // the ten the board draws for itself. It is not the board's idea of whether a
  // property has a picture - that is the test below, and it is the one that
  // matters to a player.
  const withArt = PROPERTIES.filter((p) => p.art);
  assert.equal(withArt.length, 10);
  assert.equal(PROPERTIES.length - withArt.length, 10);
  assert.ok(propertyFor("moon").art.endsWith("moon.svg"));
  for (const p of PROPERTIES) {
    assert.equal(
      p.art === null || (typeof p.art === "string" && p.art.endsWith(".svg")),
      true,
      `${p.id} has artwork or does not`,
    );
  }
});

test("every property is drawn, and none of them fell back to a letter", () => {
  const drawn = PROPERTIES.filter((p) => hasPropertyArt(p.id) || p.art);
  assert.equal(drawn.length, 20);

  // The ten the board draws for itself, by name - this is the list that was
  // previously a row of monograms.
  assert.deepEqual(ART_IDS, [
    "earth-137", "orions-belt", "wow-signal", "dyson-sphere", "wormhole",
    "milky-way", "rama", "quasar", "supernova", "sagittarius-a-star",
  ]);
});

test("the three properties nobody gave directions for still have copy", () => {
  // Quasar, Supernova and Sagittarius A* were not in the brief, so these were
  // written to the same shape as the rest rather than left blank.
  for (const id of ["quasar", "supernova", "sagittarius-a-star"]) {
    const p = propertyFor(id);
    assert.ok(p, `${id} exists`);
    assert.equal(p.description.length, 2, `${id} has two lines`);
    assert.ok(p.advantage.length > 20, `${id} has an advantage`);
  }
});