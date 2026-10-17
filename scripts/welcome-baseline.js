/* ==========================================================================
   Assert the welcome screen has not changed.

   Why this file exists: the welcome screen was approved, signed off, and is
   meant to survive every later phase untouched. That was being asserted in the
   README with a SHA-256 and checked by hand - a hash written in prose is a
   memory, not a guarantee, and this phase changed the client that draws the
   board on the same page. So it is a check now.

   Three things have to agree, and all three are compared:

     the authored source   authored/samrajya/index.html
     the stored baseline   welcome-baseline.json
     the live page         https://golake.app/samrajya/

   The authored source is included so the check also works offline, and so a
   change to the file cannot pass by being written into the baseline at the same
   time - `check` never writes.

   Hashing the raw body does not work here: Cloudflare appends a challenge
   script with a fresh token to every response, so two fetches of an unchanged
   page differ on exactly that line and nowhere else. Everything is stripped
   through authorContent() first, which is the same stripping golake-baseline.js
   uses for the same reason.

   Usage:
     node scripts/welcome-baseline.js save     write the current state out
     node scripts/welcome-baseline.js check    compare, exit 1 on drift
   ========================================================================== */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { authorContent } from "./author-content.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, "..");
const SOURCE = join(PROJECT, "authored", "samrajya", "index.html");
const FILE = join(PROJECT, "welcome-baseline.json");
const LIVE = "https://golake.app/samrajya/";

const mode = process.argv[2] || "check";
const sha = (s) => createHash("sha256").update(s).digest("hex").toUpperCase();

const source = authorContent(await readFile(SOURCE, "utf8"));

let live;
try {
  const res = await fetch(LIVE);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  live = authorContent(await res.text());
} catch (err) {
  // A network failure is not evidence that the screen changed. Say so plainly
  // and exit non-zero without pretending to have compared anything.
  console.error(`could not read ${LIVE}: ${err.message}`);
  console.error("this is not a pass and not a failure - the check did not run");
  process.exitCode = 2;
}

/*
 * Nothing below calls process.exit(). Node exits when the event loop drains,
 * and the HTTP client still holds a socket open: forcing an exit from here
 * tears that down mid-close and libuv asserts. Setting exitCode says the same
 * thing without killing a socket the runtime still owns.
 */
if (process.exitCode) {
  // The fetch failed; there is nothing to compare and nothing to write.
} else if (mode === "save") {
  await writeFile(
    FILE,
    JSON.stringify(
      {
        what: "The approved welcome screen, as the author's own markup.",
        method: "SHA-256 of index.html after authorContent(), which strips what Cloudflare injects per request.",
        approved: sha(source),
        deployed: sha(live),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  console.log(`saved   source ${sha(source).slice(0, 24)}`);
  console.log(`        live   ${sha(live).slice(0, 24)}`);
  if (source !== live) {
    console.error("\nthe deployed page does not match the source right now - not saving that");
    process.exitCode = 1;
  } else {
    console.log("        the two agree");
  }
} else if (mode !== "check") {
  console.error(`unknown mode "${mode}" - use save or check`);
  process.exitCode = 2;
} else {
  let baseline;
  try {
    baseline = JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    console.error(`no baseline at ${FILE} - run: node scripts/welcome-baseline.js save`);
    process.exitCode = 1;
    baseline = null;
  }

  if (baseline) {
    const results = [
      ["the approved welcome screen", baseline.approved === sha(source), `source  ${sha(source).slice(0, 24)}`],
      ["  against the approved capture", baseline.approved === baseline.deployed, `capture ${baseline.approved.slice(0, 24)}`],
      ["  as deployed", baseline.deployed === sha(live), `live     ${sha(live).slice(0, 24)}`],
    ];

    console.log("The welcome screen");
    for (const [name, ok, detail] of results) {
      console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(34)} ${detail}`);
    }

    if (results.some(([, ok]) => !ok)) {
      console.error("\nthe welcome screen has drifted. It was approved as it was;");
      console.error("if the change is wanted, say so, then re-run save deliberately.");
      process.exitCode = 1;
    } else {
      console.log("\n  unchanged");
    }
  }
}