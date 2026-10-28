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

import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
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
  await stampVersion();
  await hashAssets();

  const files = await walk(OUT);
  const bytes = files.reduce((sum, f) => sum + f.size, 0);
  console.log(
    `built  ${files.length} files  ${(bytes / 1024).toFixed(0)} kB  ->  public/samrajya`,
  );
}

/**
 * Write the build's own number into the page.
 *
 * The page reads it and compares it with the number it was served with. When
 * they differ, the browser is holding a version of the game that is not the
 * one on the server, and the client reloads itself - on the landing page or in
 * the lobby, and never in the middle of a game, because a game in progress is
 * the one thing a reload would spoil.
 */
async function stampVersion() {
  const version = process.env.SAMRAJYA_VERSION || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const file = join(OUT, "version.json");
  await writeFile(file, JSON.stringify({ version }), "utf8");

  /* The page is told the same number, so it can compare without a request. */
  const html = join(OUT, "index.html");
  const source = await readFile(html, "utf8");
  const stamped = source.replace(
    /(<\/head>)/i,
    `  <meta name="samrajya-version" content="${version}">\n$1`,
  );
  await writeFile(html, stamped, "utf8");
  console.log(`version  ${version}`);
}

/**
 * Hash the asset names, so a new build is a new URL.
 *
 * A browser that has cached `/assets/js/app.js` would keep serving the old
 * file after a deploy, and the page would be half old and half new - which is
 * how a shared screen that works on one phone and not on another happens.
 * With the hash in the name, a new build is a new file, and the old one is
 * simply not asked for again.
 *
 * The names are rewritten in the HTML and in every module that imports
 * another module, so the whole graph moves together.
 */
async function hashAssets() {
  let files = await walk(OUT);

  /* The shared rules modules are NOT hashed.

     They are copied from `shared/` and the check compares the copy with the
     original, byte for byte. A hash in the name would not break that - but
     rewriting the imports inside them would, and the imports inside them are
     the very thing the hash is for.

     So the shared modules keep their names, and the page that loads them is
     served with no-cache: a new build is a new page, and the page asks for
     the modules by the names they have always had. */
  const isShared = (path) => /(^|\/)assets\/js\/shared\//.test(path.replace(/\\/g, "/"));

  /* THE HASH MUST BE THE NAME OF WHAT THE FILE IS AFTER THE REWRITE.

     Hashing a module and THEN rewriting the imports inside it names a file
     by content it no longer has. A browser that cached the old name for ever
     - which is the point of the hash - would go on importing a dependency
     by a name that no longer exists, and the module graph would 404 in the
     middle.

     So the settling goes pass by pass. A pass first renames a file whose
     content its name no longer describes, then rewrote every reference to
     the names retired in THAT pass. When a rewrite changes a module's
     imports, its own hash goes stale, and the next pass renames it - and
     retires the name the previous pass wrote, which the pass after that
     rewrites in its importers. In a graph with no cycles every reference
     reaches its last name after as many passes as the graph is deep, and
     the build ends on the first pass that retires nothing.

     A reference is replaced WHOLE. The bare name of a file is not enough:
     `cards.js` is a substring of `nexus-cards.js`, so the reference is
     matched with the characters that end a name, and nothing else. */

  /* Where every file came from, by its current path. The manifest speaks of
     the names the site was authored with, so a file that moves several
     times while the graph settles still answers for itself. */
  const origin = new Map();

  for (let pass = 0; ; pass++) {
    if (pass > 40) {
      fail(`the hashed names never settled (${pass} passes) - the import graph has a cycle the build cannot name`);
    }

    /* The names retired and minted in THIS pass, and nothing older. */
    const moves = new Map();
    for (const file of files) {
      if (!/\.(js|css|svg|png|jpg|jpeg|webp|woff2?)$/i.test(file.path)) continue;
      if (isShared(file.path.slice(OUT.length + 1))) continue;
      const body = await readFile(file.path);
      const hash = createHash("sha256").update(body).digest("hex").slice(0, 10);
      const ext = extname(file.path);
      /* A file that has been named already carries its old hash segment;
         it comes off, so this pass names the file for its content now. */
      const base = basename(file.path, ext).replace(/\.[0-9a-f]{10}$/, "");
      const dir = dirname(file.path);
      const next = join(dir, `${base}.${hash}${ext}`);
      if (next === file.path) continue; /* already named for this content */
      await rename(file.path, next);
      const from = file.path.slice(OUT.length + 1).split(/[\\/]/).join("/");
      const to = next.slice(OUT.length + 1).split(/[\\/]/).join("/");
      moves.set(basename(from), basename(to));
      origin.set(next, origin.get(file.path) ?? from);
      origin.delete(file.path);
    }

    /* Nothing retires: the graph is settled, and every file's name is the
       name of its content. */
    if (moves.size === 0) break;

    /* Rewrite every reference to the names retired this pass. Only real
       references are rewritten: a module specifier after `from` or in
       `import()`, a stylesheet's `url()`, and an HTML `src` or `href`. A
       bare file name in prose is the name of a thing the prose is about,
       not a reference, and rewriting it would change a module's content
       forever, since the prose retells the graph.

       The shared modules are rewritten too - they import the authored ones
       - and their own names are left alone. */
    const text = await walk(OUT);
    for (const file of text) {
      if (!/\.(js|html|css)$/i.test(file.path)) continue;
      let body = await readFile(file.path, "utf8");
      let changed = false;

      /* The retired name is the last segment of any specifier that holds
         it, so the directories inside the specifier come along untouched. */
      const swapover = (spec) => {
        const cut = spec.lastIndexOf("/");
        const to = moves.get(spec.slice(cut + 1));
        return to === undefined ? null : spec.slice(0, cut + 1) + to;
      };

      if (!/\.css$/i.test(file.path)) {
        /* A module specifier: `from "./x.js"` or `import("./x.js")`. */
        const written = body.replace(
          /(\bfrom\s*|\bimport\s*\(\s*)(["'])([^"'\n]+)\2/g,
          (whole, pre, quote, spec) => {
            const next = swapover(spec);
            return next === null ? whole : pre + quote + next + quote;
          },
        );
        if (written !== body) {
          body = written;
          changed = true;
        }
      }

      if (/\.css$/i.test(file.path) || /\.html$/i.test(file.path)) {
        /* A stylesheet reference, and its quoted or bare `url()`. */
        const written = body.replace(
          /(\burl\(\s*)(["']?)([^"')]+?)\2(\s*\))/g,
          (whole, pre, quote, spec, post) => {
            const next = swapover(spec);
            return next === null ? whole : pre + quote + next + quote + post;
          },
        );
        if (written !== body) {
          body = written;
          changed = true;
        }
      }

      if (/\.html$/i.test(file.path)) {
        /* A page reference: `src="assets/js/app.js"`, `href="assets/css/board.css"`. */
        const written = body.replace(
          /(\b(?:src|href)\s*=\s*)(["'])([^"'\n]+)\2/g,
          (whole, pre, quote, spec) => {
            const next = swapover(spec);
            return next === null ? whole : pre + quote + next + quote;
          },
        );
        if (written !== body) {
          body = written;
          changed = true;
        }
      }

      if (changed) await writeFile(file.path, body, "utf8");
    }

    files = await walk(OUT);
  }

  /* The manifest, so the server and the client agree on what exists. */
  const hashes = new Map();
  for (const [current, start] of origin) {
    hashes.set(start, current.slice(OUT.length + 1).split(/[\\/]/).join("/"));
  }

  await writeFile(
    join(OUT, "manifest.json"),
    JSON.stringify({ files: Object.fromEntries(hashes) }, null, 2),
    "utf8",
  );
  console.log(`hashed  ${hashes.size} assets`);
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
    "civilizations.js", "identity.js", "spaces.js", "properties.js", "weapons.js", "economy.js", "ledger.js", "game.js", "announcements.js", "nexus-cards.js",
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
