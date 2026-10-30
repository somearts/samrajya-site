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
export const RAGNAROK = deepFreeze({"id":"ragnarok","_label":"The card used to carry a 'COMMUNITY CHEST' label where a property puts its price. It is gone: the title already says what this is, and the label was taking the width the title needed. The word is kept here only so it is not lost if the card wants to say it somewhere else.","title":"Welcome to Ragnarok","titleLines":["Welcome to","Ragnarok"],"tagline":"The armoury at the end of time.","body":"Ragnarok is where weapons are drawn. Draw once per visit and you may leave with one. Carry your weapons to Fight, where you can strike an opponent's colony. Every weapon can only reach certain colonies, and a successful strike hands that colony to you.","_titleLines":"The title is too long for one line in the card's title column at a phone's cell size, and an ellipsis reading 'WELCO...' is worse than a break. The break lives here rather than being guessed in the card, for the same reason every board name carries its own lines: the drawing and the data cannot then disagree about where something wraps.","badLuck":"Bad luck. Try next time."});

/** The shield chest's copy - the same shape, the same job, at Kronos. */
export const KRONOS_CHEST = deepFreeze({"id":"kronos","title":"Welcome to Kronos","_titleLines":"One line, unlike Ragnarok's two: the shield-circle's welcome is short enough to stand on a single line at every phone cell size, and the card keeps its own typography to say it - no smaller type, no tightened tracking, just no break where none is needed.","titleLines":["Welcome to Kronos"],"tagline":"The shield-circle at the end of time.","body":"Kronos offers a shield. Draw once per visit: it deploys the moment it is drawn, stands for two of your own turns, and is spent the instant it stops its one weapon. It answers no other - the remaining weapons pass it by.","badLuck":"Nothing left to defend with."});

/** The three weapons, in the order they are offered. */
export const WEAPONS = deepFreeze([{"id":"antimatter","name":"Antimatter Weapon","set":"s7","emblem":"rings","blurb":"Annihilates stellar and cosmic-scale colonies.","targets":["proxima-centauri","supernova","quasar","sagittarius-a-star","milky-way","wormhole"]},{"id":"nuclear","name":"Nuclear Warhead","set":"s2","emblem":"cone","blurb":"Hits solid worlds and objects within reach.","targets":["moon","asteroid-belt","jupiter","pluto","kuiper-belt","halleys-comet","voyager-1"]},{"id":"shiva","name":"Eye of Shiva","set":"s3","emblem":"eye","blurb":"Reaches what physics cannot explain.","targets":["lagrange-l2","event-horizon","earth-137","orions-belt","wow-signal","dyson-sphere"]}].map((w) => Object.freeze(w)));

export const WEAPON_IDS = Object.freeze(WEAPONS.map((w) => w.id));

/** The three shields, in the order they are offered. */
export const SHIELDS = deepFreeze([{"id":"kavacha","name":"Kavacha of Parvati","counters":"shiva","set":"s1","emblem":"eye","blurb":"A veil no gaze may pierce.","myth":"The armour Parvati wove for her son - no gaze may pierce it.","stands":"Stops the Eye of Shiva, once."},{"id":"matterforge","name":"Matterforge Shield","counters":"antimatter","set":"s5","emblem":"rings","blurb":"Matter re-woven faster than it can be undone.","myth":"Struck where matter is unmade, it re-weaves faster than it can be undone.","stands":"Stops the Antimatter Weapon, once."},{"id":"nuclear-aegis","name":"Nuclear Aegis","counters":"nuclear","set":"s6","emblem":"cone","blurb":"A hush of hardened light around what it keeps.","myth":"Star-forged in a dying sun's collapse, a hush of hardened light.","stands":"Stops the Nuclear Warhead, once."}].map((s) => Object.freeze(s)));

export const SHIELD_IDS = Object.freeze(SHIELDS.map((s) => s.id));

/** Colonies no weapon reaches. Said here, and never said out loud. */
export const IMMUNE = deepFreeze(["rama"]);

/** Outcome id for the draw that comes to nothing. */
export const BAD_LUCK = "bad-luck";

export const ODDS = deepFreeze({"antimatter":30,"nuclear":30,"shiva":30,"bad-luck":10});

const BY_ID = new Map(WEAPONS.map((w) => [w.id, w]));

const SHIELD_BY_ID = new Map(SHIELDS.map((s) => [s.id, s]));

/** A weapon by id, or null. Never a fallback and never a guess. */
export function weaponById(id) {
  return BY_ID.get(String(id ?? "").trim().toLowerCase()) || null;
}

/** What a weapon can strike, as colony ids. */
export function targetsOf(id) {
  return weaponById(id)?.targets ? [...weaponById(id).targets] : [];
}

/** A shield by id, or null. Never a fallback and never a guess. */
export function shieldById(id) {
  return SHIELD_BY_ID.get(String(id ?? "").trim().toLowerCase()) || null;
}

/** The one shield that counters a given weapon id, or null. */
export function shieldFor(weaponId) {
  const id = String(weaponId ?? "").trim().toLowerCase();
  return SHIELDS.find((s) => s.counters === id) || null;
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

/**
 * Draw from the shield chest. Returns a shield id, or null.
 *
 * UNIFORM AMONG WHAT IS LEFT. `held` is the ids the drawing player already
 * stands behind; a shield already held is never drawn again, so a shield can
 * neither be refreshed by drawing a second copy nor stacked by keeping one.
 * When nothing is left the draw is a miss - it returns null rather than
 * reaching for a shield the player holds, which is what makes the no-
 * overwrite rule impossible to sidestep from the drawing side.
 *
 * `rng` is injected and defaults to Math.random. Anything in [0, 1) works.
 */
export function drawShield(rng = Math.random, held = []) {
  const taken = new Set(held || []);
  const available = SHIELDS.filter((s) => !taken.has(s.id));
  if (!available.length) return null;

  const roll = Number(rng());
  const draw = Number.isFinite(roll) ? roll : 0;
  const point = Math.min(0.999999999, Math.max(0, draw));
  const at = Math.min(available.length - 1, Math.floor(point * available.length));
  return available[at].id;
}
