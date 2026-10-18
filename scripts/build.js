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
async function publishShared() {
  const wanted = new Set(["civilizations.js", "identity.js", "spaces.js", "properties.js"]);
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
