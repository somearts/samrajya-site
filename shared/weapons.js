/* GENERATED FILE - DO NOT EDIT.

   Written by scripts/build.js from shared/weapons.json.
   Edit the JSON and rebuild; this copy is overwritten every time.
*/

function deepFreeze(o) {
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) deepFreeze(o[k]);
    Object.freeze(o);
  }
  return o;
}

/** The chest this describes, and all of its copy. */
export const RAGNAROK = deepFreeze({"id":"ragnarok","label":"Community Chest","title":"Welcome to Ragnarok","tagline":"The armoury at the end of time.","body":"Ragnarok is where weapons are drawn. Draw once per visit and you may leave with one. Carry your weapons to Fight, where you can strike an opponent's colony. Every weapon can only reach certain colonies, and a successful strike hands that colony to you.","oddsCaption":"Each draw: 30% for each weapon, 10% bad luck."});

/** The three weapons, in the order they are offered. */
export const WEAPONS = deepFreeze([{"id":"antimatter","name":"Antimatter Weapon","set":"s7","emblem":"rings","blurb":"Annihilates stellar and cosmic-scale colonies.","targets":["proxima-centauri","supernova","quasar","sagittarius-a-star","milky-way","wormhole"]},{"id":"nuclear","name":"Nuclear Warhead","set":"s2","emblem":"cone","blurb":"Hits solid worlds and objects within reach.","targets":["moon","asteroid-belt","jupiter","pluto","kuiper-belt","halleys-comet","voyager-1"]},{"id":"shiva","name":"Eye of Shiva","set":"s3","emblem":"eye","blurb":"Reaches what physics cannot explain.","targets":["lagrange-l2","event-horizon","earth-137","orions-belt","wow-signal","dyson-sphere"]}].map((w) => Object.freeze(w)));

export const WEAPON_IDS = Object.freeze(WEAPONS.map((w) => w.id));

/** Colonies no weapon reaches. Said here, and never said out loud. */
export const IMMUNE = deepFreeze(["rama"]);

/** Outcome id for the draw that comes to nothing. */
export const BAD_LUCK = "bad-luck";

export const ODDS = deepFreeze({"antimatter":30,"nuclear":30,"shiva":30,"bad-luck":10});

const BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));

/** A weapon by id, or null. Never a fallback and never a guess. */
export function weaponById(id) {
  return BY_ID.get(String(id ?? "").trim().toLowerCase()) || null;
}

/** What a weapon can strike, as colony ids. */
export function targetsOf(id) {
  return weaponById(id)?.targets ? [...weaponById(id).targets] : [];
}

/**
 * Draw once. Returns a weapon id, or BAD_LUCK.
 *
 * One uniform draw against the odds table, walked in the table's own order. It
 * is a single function so that it can be tested with a seeded generator, and so
 * that moving it to the server later is moving one function rather than
 * reimplementing the odds somewhere else.
 *
 * `rng` is injected and defaults to Math.random. Anything in [0, 1) works.
 */
export function drawWeapon(rng = Math.random) {
  const roll = Number(rng());
  const draw = Number.isFinite(roll) ? roll : 0;
  const point = Math.min(0.999999999, Math.max(0, draw));

  let cursor = 0;
  for (const [id, chance] of Object.entries(ODDS)) {
    cursor += Number(chance) / 100;
    if (point < cursor) return id;
  }
  return BAD_LUCK;
}
