/* ==========================================================================
   THE PROPERTIES

   Twenty squares somebody can buy, what they cost, and what they say. The
   prices are derived from the board rather than written down, and that is the
   thing worth testing hardest: a scale that is arithmetically right and
   attached to the wrong squares would look perfect on a price list and be
   wrong on the board.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PRICE_FIRST,
  PRICE_STEP,
  PROPERTIES,
  PROPERTIES_WITH_COPY,
  propertyFor,
  priceOf,
  isPurchasable,
} from "../shared/properties.js";
import { CELLS } from "../shared/spaces.js";

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

test("Moon is 200 and each one after it is 44 more, along the board", () => {
  assert.equal(PRICE_FIRST, 200);
  assert.equal(PRICE_STEP, 44);

  assert.equal(propertyFor("moon").price, 200);

  const expected = PROPERTIES.map((_, n) => 200 + n * 44);
  assert.deepEqual(PROPERTIES.map((p) => p.price), expected);

  // Spelled out, so a change to the step or to the order cannot pass unnoticed.
  assert.equal(propertyFor("lagrange-l2").price, 244);
  assert.equal(propertyFor("asteroid-belt").price, 288);
  assert.equal(propertyFor("jupiter").price, 332);
  assert.equal(propertyFor("pluto").price, 376);
  assert.equal(propertyFor("halleys-comet").price, 464);
  assert.equal(propertyFor("wormhole").price, 816);
  assert.equal(propertyFor("sagittarius-a-star").price, 1036);
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
  assert.equal(priceOf("quasar"), "₹948");
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

test("ten properties have artwork and ten do not, and that is not a gap", () => {
  const withArt = PROPERTIES.filter((p) => p.art);
  assert.equal(withArt.length, 10);
  assert.equal(PROPERTIES.length - withArt.length, 10);
  assert.ok(propertyFor("moon").art.endsWith("moon.svg"));
  // Each is either a path to a drawing or null, and never anything in between -
  // the card falls back to a monogram, so null is a decision and not a gap.
  for (const p of PROPERTIES) {
    assert.equal(
      p.art === null || (typeof p.art === "string" && p.art.endsWith(".svg")),
      true,
      `${p.id} has artwork or does not`,
    );
  }
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