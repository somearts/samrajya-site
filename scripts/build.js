/* ==========================================================================
   SAMRAJYA - BUILD

   Copies the authored site into public/samrajya/, and publishes the shared
   rules the browser needs to draw the same token picker the server validates
   against.

   authored/samrajya/  ->  public/samrajya/
   shared/             ->  public/samrajya/assets/js/shared/

   The site is authored with relative asset paths, exactly as Strand is, so it
   resolves correctly under the /samrajya/ prefix and stays portable.

   Usage:  node scripts/build.js
   ========================================================================== */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, "..");
const AUTHORED = join(PROJECT, "authored", "samrajya");
const OUT = join(PROJECT, "public", "samrajya");
const SHARED = join(PROJECT, "shared");
const SHARED_OUT = join(OUT, "assets", "js", "shared");

async function main() {
  if (!(await exists(AUTHORED))) fail(`no authored site at ${AUTHORED}`);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(AUTHORED, OUT, { recursive: true });
  await generateWeapons();
  await publishShared();

  const files = await walk(OUT);
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  console.log(
    `built  ${files.length} files  ${(bytes / 1024).toFixed(0)} kB  ->  public/samrajya`,
  );
}

/**
 * Publish the rules modules.
 *
 * Only the pure ones: the token list and the name/code rules. Anything that
 * decides a game stays on the server - but at this stage there is no game to
 * decide, and the picker and the validator have to agree exactly, or a player
 * would be offered a token the server then refuses.
 */
/**
 * Turn shared/weapons.json into shared/weapons.js.
 *
 * The card's copy is a data file because it is meant to be edited by somebody
 * who does not read JavaScript. The browser cannot import JSON - it would have to
 * be fetched, and this project fetches nothing - so the JSON is the source and
 * this is the module built from it.
 *
 * Written fresh on every build, so the two cannot drift. Editing the JSON and
 * rebuilding is the whole workflow; there is no second file to remember, and no
 * way for the shipped copy to be quietly out of date.
 *
 * The result is deliberately boring: data in, one pure function out. `drawWeapon`
 * takes its randomness as an argument so it can be tested with a seeded
 * generator and later called on the server without changing.
 */
async function generateWeapons() {
  const raw = await readFile(join(SHARED, "weapons.json"), "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return fail(`shared/weapons.json is not valid JSON: ${error.message}`);
  }

  // The odds are written once and walked once, so a change to the numbers cannot
  // produce an order the table does not agree with.
  const odds = Object.entries(data.odds || {});
  const total = odds.reduce((sum, [, n]) => sum + Number(n), 0);
  if (total !== 100) fail(`shared/weapons.json odds come to ${total}, not 100`);

  const module = `/* GENERATED FILE - DO NOT EDIT.

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
export const RAGNAROK = deepFreeze(${JSON.stringify(data.chest)});

/** The three weapons, in the order they are offered. */
export const WEAPONS = deepFreeze(${JSON.stringify(data.weapons)}.map((w) => Object.freeze(w)));

export const WEAPON_IDS = Object.freeze(WEAPONS.map((w) => w.id));

/** Colonies no weapon reaches. Said here, and never said out loud. */
export const IMMUNE = deepFreeze(${JSON.stringify(data.immune)});

/** Outcome id for the draw that comes to nothing. */
export const BAD_LUCK = "bad-luck";

export const ODDS = deepFreeze(${JSON.stringify(data.odds)});

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
 * \`rng\` is injected and defaults to Math.random. Anything in [0, 1) works.
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
`;

  await writeFile(join(SHARED, "weapons.js"), module, "utf8");
}

async function publishShared() {
  const wanted = new Set([
    "civilizations.js", "identity.js", "spaces.js", "properties.js", "weapons.js", "economy.js", "ledger.js", "game.js", "announcements.js",
  ]);
  const entries = await readdir(SHARED);
  const files = entries.filter((name) => wanted.has(name));
  const missing = [...wanted].filter((name) => !files.includes(name));
  if (missing.length) fail(`missing shared modules: ${missing.join(", ")}`);

  await mkdir(SHARED_OUT, { recursive: true });
  for (const name of files) {
    await cp(join(SHARED, name), join(SHARED_OUT, name));
  }

  const note = [
    "/* GENERATED FILE - DO NOT EDIT.",
    "",
    "   Copied by scripts/build.js from shared/ at the repository root.",
    "   Edit the original and rebuild; this copy is overwritten every time.",
    "",
    "   It exists so the browser and the server describe the same tokens and",
    "   the same name rules. Neither reads it for anything else.",
    "*/",
    "",
  ].join("\n");

  for (const name of files) {
    const file = join(SHARED_OUT, name);
    const body = await readFile(file, "utf8");
    if (!body.startsWith("/* GENERATED FILE")) await writeFile(file, note + body, "utf8");
  }
  console.log(`shared  ${files.length} canonical modules published to the client`);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push({ path: full, size: (await stat(full)).size });
  }
  return out;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(`build failed: ${message}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
