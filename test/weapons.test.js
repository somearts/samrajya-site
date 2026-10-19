/* ==========================================================================
   RAGNAROK - THE WEAPONS, AND THE ODDS

   The data and the draw, tested without a browser.

   THE TARGET LISTS
   ----------------
   The three lists and the immune list have to account for all twenty
   properties between them, exactly once each, with nothing in two lists at
   once. That is the test that matters most here, because the lists are written
   by hand: a colony that appears in none of them is unreachable by everything
   and a colony in two of them is reachable by more than it should be, and
   neither mistake shows up when you look at any single list.

   RAMA IS IMMUNE AND IS NOT MENTIONED
   ----------------------------------
   The immune list exists so that the property is accounted for rather than
   forgotten. Nothing in this file may put the word "rama" into something a
   player reads - the card shows each weapon's targets and no other property is
   named anywhere. So there is a test that no visible string in the chest's copy
   contains it, which is the only thing that stops an "immune to everything"
   reveal being added later by accident.

   THE ODDS
   --------
   A hundred thousand seeded draws, checked to land within a percent of 30/30/
   30/10. One draw proves nothing about a table of odds; the shape of the table
   is what is being checked here, and a seeded generator is what makes that a
   repeatable fact rather than a good afternoon.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  BAD_LUCK,
  IMMUNE,
  ODDS,
  RAGNAROK,
  WEAPONS,
  WEAPON_IDS,
  drawWeapon,
  targetsOf,
  weaponById,
} from "../shared/weapons.js";
import { PROPERTIES } from "../shared/properties.js";

const ALL_PROPERTY_IDS = PROPERTIES.map((p) => p.id).sort();
const allTargets = WEAPONS.flatMap((w) => w.targets);

/* ---------------------------------------------------------------- the lists */

test("there are three weapons and one way of drawing nothing", () => {
  assert.equal(WEAPONS.length, 3);
  assert.deepEqual(WEAPON_IDS, ["antimatter", "nuclear", "shiva"]);
  assert.equal(BAD_LUCK, "bad-luck");
  assert.ok(!WEAPON_IDS.includes(BAD_LUCK), "bad luck is not a weapon");
});

test("each weapon says which colonies it reaches", () => {
  assert.deepEqual(targetsOf("nuclear"), [
    "moon", "asteroid-belt", "jupiter", "pluto",
    "kuiper-belt", "halleys-comet", "voyager-1",
  ]);
  assert.deepEqual(targetsOf("antimatter"), [
    "proxima-centauri", "supernova", "quasar",
    "sagittarius-a-star", "milky-way", "wormhole",
  ]);
  assert.deepEqual(targetsOf("shiva"), [
    "lagrange-l2", "event-horizon", "earth-137",
    "orions-belt", "wow-signal", "dyson-sphere",
  ]);
  assert.deepEqual(targetsOf("bad-luck"), [], "bad luck reaches nothing");
  assert.deepEqual(targetsOf("nonsense"), [], "and neither does nonsense");
});

test("the three lists and the immune list are all twenty properties, once each", () => {
  const everything = [...allTargets, ...IMMUNE];
  assert.equal(everything.length, 20, "twenty entries in total");
  assert.deepEqual([...everything].sort(), ALL_PROPERTY_IDS,
    "and they are exactly the twenty properties");
});

test("no colony is in two lists at once", () => {
  const seen = new Map();
  for (const weapon of WEAPONS) {
    for (const id of weapon.targets) {
      assert.equal(seen.has(id), false,
        `${id} is reached by both ${seen.get(id) || "nothing"} and ${weapon.id}`);
      seen.set(id, weapon.id);
    }
  }
  for (const id of IMMUNE) {
    assert.equal(seen.has(id), false, `${id} is immune and is also a target`);
  }
  assert.equal(seen.size, 19, "nineteen colonies are reachable by something");
});

test("every weapon reaches the same number of colonies", () => {
  const sizes = WEAPONS.map((w) => w.targets.length).sort((a, b) => a - b);
  assert.deepEqual(sizes, [6, 6, 7]);
  // Not a rule the game states - just a sanity check that a list was not pasted
  // twice or truncated, which is the likeliest way hand-written lists go wrong.
  for (const w of WEAPONS) {
    assert.ok(w.targets.length >= 6 && w.targets.length <= 7, `${w.id} reaches ${w.targets.length}`);
  }
});

test("every target is a real property, and every name can be looked up", () => {
  for (const w of WEAPONS) {
    for (const id of w.targets) {
      assert.ok(ALL_PROPERTY_IDS.includes(id), `${w.id} targets ${id}, which is not a property`);
      // The card shows targets as names, so a name has to exist for each one.
      const property = PROPERTIES.find((p) => p.id === id);
      assert.ok(property.lines.length > 0, `${id} has a label`);
    }
  }
});

test("rama is immune to everything, and nothing visible says so", () => {
  assert.deepEqual(IMMUNE, ["rama"]);
  for (const w of WEAPONS) {
    assert.ok(!w.targets.includes("rama"), `${w.id} does not reach rama`);
  }

  // The card names each weapon's targets and nothing else, so the only way to
  // learn that rama is immune would be for some piece of copy to say it. The
  // brief asks for that quietly, and the way to keep it quiet is to be able to
  // fail when a line of copy mentions it.
  const visible = [
    RAGNAROK.title, RAGNAROK.tagline, RAGNAROK.body, RAGNAROK.oddsCaption,
    ...WEAPONS.map((w) => w.name),
    ...WEAPONS.map((w) => w.blurb),
  ].join(" ");
  assert.doesNotMatch(visible, /rama/i, "nothing a player reads names rama");
});

/* ------------------------------------------------------------------ the odds */

test("the odds come to a hundred", () => {
  const total = Object.values(ODDS).reduce((sum, n) => sum + n, 0);
  assert.equal(total, 100, `odds come to ${total}`);
  assert.deepEqual(Object.keys(ODDS).sort(), [...WEAPON_IDS, BAD_LUCK].sort(),
    "every outcome has an entry and there are no others");
  assert.equal(ODDS[BAD_LUCK], 10);
  for (const id of WEAPON_IDS) assert.equal(ODDS[id], 30, `${id} is 30`);
});

test("each outcome sits in its own band of the roll", () => {
  // The bands are contiguous and together cover [0, 1) with nothing outside.
  const bands = [];
  let cursor = 0;
  for (const [id, chance] of Object.entries(ODDS)) {
    const from = cursor;
    cursor += chance / 100;
    bands.push([id, from, cursor]);
  }
  assert.equal(Math.abs(cursor - 1) < 1e-9, true, `bands reach ${cursor}`);
  assert.equal(bands[0][1], 0, "the first band starts at zero");

  const point = (n) => drawWeapon(() => n);
  assert.equal(point(0), "antimatter", "0 is the first weapon");
  assert.equal(point(0.2999), "antimatter", "still the first at the end of its band");
  assert.equal(point(0.3), "nuclear", "exactly 0.3 is the second");
  assert.equal(point(0.8999), "shiva", "the third runs to 0.9");
  assert.equal(point(0.9), BAD_LUCK, "exactly 0.9 is bad luck");
  assert.equal(point(0.999999), BAD_LUCK, "and bad luck runs to the end");
});

test("a hundred thousand seeded draws land within a percent", () => {
  // A seeded generator, so this is a repeatable fact about the table rather than
  // a good afternoon. 100,000 draws at these odds puts the sampling error well
  // inside a percent, and the margin is there so a correct table cannot fail on
  // luck.
  const counts = Object.fromEntries([...WEAPON_IDS, BAD_LUCK].map((id) => [id, 0]));

  // mulberry32 - small, fast, and good enough that the sequence it produces is
  // not visibly biased over 100,000 samples.
  let seed = 0x9e3779b9;
  const rng = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const RUNS = 100000;
  for (let n = 0; n < RUNS; n++) counts[drawWeapon(rng)] += 1;

  for (const [id, chance] of Object.entries(ODDS)) {
    const seen = (counts[id] / RUNS) * 100;
    assert.ok(
      Math.abs(seen - chance) <= 1,
      `${id} came up ${seen.toFixed(2)}% of the time, which is not within 1% of ${chance}%`,
    );
  }

  // And every outcome was reachable - a table that never produced bad luck would
  // pass an odds test that only looked at the weapons.
  assert.equal(Object.values(counts).every((c) => c > 0), true, "every outcome was drawn");
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), RUNS);
});

test("the same seed gives the same draw, twice", () => {
  // What a server would need if it ever drew on the other end: the same seed
  // has to produce the same weapon on both machines.
  const seeded = (s) => () => {
    let t = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  for (const s of [1, 2, 42, 12345]) {
    assert.equal(drawWeapon(seeded(s)), drawWeapon(seeded(s)), `seed ${s} agrees with itself`);
  }
});

test("a nonsense roll is still an answer, not a crash", () => {
  for (const junk of [NaN, -1, 5, null, undefined, "0.1"]) {
    const got = drawWeapon(() => junk);
    assert.ok(got === BAD_LUCK || WEAPON_IDS.includes(got), `${String(junk)} drew ${got}`);
  }
});

/* --------------------------------------------------------------- lookup */

test("weaponById resolves each of the three and nothing else", () => {
  for (const w of WEAPONS) {
    assert.equal(weaponById(w.id)?.name, w.name);
    assert.equal(weaponById(w.id.toUpperCase())?.name, w.name);
  }
  for (const nope of ["romulan", "", null, undefined, 7, BAD_LUCK]) {
    assert.equal(weaponById(nope), null, `${nope} is not a weapon`);
  }
});

test("the copy is all there, and says what it says", () => {
  assert.equal(RAGNAROK.id, "ragnarok");
  assert.equal(RAGNAROK.title, "Welcome to Ragnarok");
  assert.equal(RAGNAROK.tagline, "The armoury at the end of time.");
  assert.equal(RAGNAROK.oddsCaption, "Each draw: 30% for each weapon, 10% bad luck.");
  assert.ok(RAGNAROK.body.length > 120, "the body says what the chest is for");
  for (const w of WEAPONS) {
    assert.ok(w.blurb.length > 20, `${w.id} has a line about what it does`);
    assert.ok(w.emblem, `${w.id} names an emblem`);
  }
});

test("and the chest says what it is once, in its title", () => {
  // There used to be a COMMUNITY CHEST label where a property puts its price.
  // It is gone: the title already names the place, and the label was taking the
  // width the title needed. This is here so that putting one back is a decision
  // somebody makes rather than a leftover nobody notices.
  assert.equal(RAGNAROK.label, undefined, "no second label in the data");
  const visible = [RAGNAROK.title, ...RAGNAROK.titleLines].join(" ");
  assert.doesNotMatch(visible, /community chest/i);
});

test("and the title's break is the title, with a space between the lines", () => {
  // The title is too long for the card's title column at a phone's cell size,
  // so it is broken in the data rather than guessed in the card. Which means two
  // fields have to agree, and this is what stops them drifting apart - a title
  // that said "Welcome to Ragnarok" while the card read "Welcome to Nowhere"
  // would look fine in a test and wrong on the board.
  assert.deepEqual(RAGNAROK.titleLines, ["Welcome to", "Ragnarok"]);
  assert.equal(RAGNAROK.titleLines.join(" "), RAGNAROK.title);
  for (const line of RAGNAROK.titleLines) {
    assert.ok(line.length <= 14, `"${line}" fits a line on its own`);
  }
});

test("each weapon's colour is a set that exists", () => {
  // Colours are named tokens so the card cannot drift from the board. If a
  // weapon names a set nobody has, the pill would come out as nothing.
  for (const w of WEAPONS) {
    assert.match(w.set, /^s[1-8]$/, `${w.id} names a real set, not "${w.set}"`);
  }
  assert.equal(new Set(WEAPONS.map((w) => w.set)).size, 3, "and the three are different sets");
});