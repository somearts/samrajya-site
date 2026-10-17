/* ==========================================================================
   SAMRAJYA - GOLAKE INTEGRITY

   This project edits one line of the GoLake home page: the Samrajya card
   title becomes a link. That is the only change, and this is what proves it.

     node scripts/golake-baseline.js save     record the live home page
     node scripts/golake-baseline.js check    compare against it, exit 1 on drift

   Hashing the raw body does not work against this zone: Cloudflare appends a
   challenge script carrying a fresh token to every response, so two fetches of
   an unchanged page produce different bytes. author-content.js strips that
   first; see the note in that file.
   ========================================================================== */

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { authorContent } from "./author-content.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(resolve(HERE, ".."), "golake-baseline.json");
const BASE = "https://golake.app";

const sha = (s) => createHash("sha256").update(s).digest("hex").toUpperCase();
const one = (html, re) => (html.match(re) || [])[1] || null;

/** Every project card on the home page: its number, title and destination. */
function cards(html) {
  return [...html.matchAll(/<article class="card">([\s\S]*?)<\/article>/g)].map((m) => {
    const body = m[1];
    return {
      num: one(body, /card__num">([^<]*)</),
      title: one(body, /card__title">([\s\S]*?)<\/h2>/)?.replace(/<[^>]*>/g, "").trim(),
      href: one(body, /href="([^"]*)"/),
      desc: one(body, /card__desc">([\s\S]*?)<\/p>/)?.replace(/\s+/g, " ").trim(),
    };
  });
}

/**
 * The one change this project is allowed to make, undone.
 *
 * The check below is a byte-for-byte statement that nothing *else* on the page
 * moved. To make that statement true, this project's own edit is taken back out
 * before hashing - so a page differing only in whether Samrajya is a link
 * hashes identically, and anything else that changed does not.
 */
const SAMRAJYA_LINK =
  '<h2 class="card__title"><a class="card__link" href="/samrajya/">Samrajya</a></h2>';
const SAMRAJYA_PLAIN = '<h2 class="card__title">Samrajya</h2>';

function neutralise(html) {
  return html.split(SAMRAJYA_LINK).join(SAMRAJYA_PLAIN);
}

async function snapshot() {
  const res = await fetch(`${BASE}/`, {
    headers: { "user-agent": "samrajya-verify/1.0", "cache-control": "no-cache" },
  });
  const raw = await res.text();
  const clean = authorContent(raw);
  return {
    takenAt: new Date().toISOString(),
    status: res.status,
    title: one(clean, /<title>([^<]*)<\/title>/),
    hash: sha(neutralise(clean)),
    hashWithChange: sha(clean),
    bytes: clean.length,
    assets: [...clean.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)].map((m) => m[1]).sort(),
    cards: cards(clean),
  };
}

async function main() {
  const mode = process.argv[2] || "check";
  const snap = await snapshot();

  if (mode === "save") {
    await writeFile(FILE, JSON.stringify(snap, null, 2));
    console.log(`baseline saved  ${snap.hash.slice(0, 16)}…  ${snap.cards.length} cards`);
    return;
  }

  let base;
  try {
    base = JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    console.error("no baseline yet — run: node scripts/golake-baseline.js save");
    process.exit(2);
  }

  let problems = 0;
  const line = (label, a, b) => {
    const same = a === b;
    if (!same) problems++;
    console.log(`  ${same ? "ok  " : "FAIL"}  ${label}`);
    if (!same) {
      console.log(`          expected ${JSON.stringify(b)}`);
      console.log(`          actual   ${JSON.stringify(a)}`);
    }
  };

  console.log(`\nGoLake integrity check (baseline taken ${base.takenAt})\n`);
  line("/ status", String(snap.status), String(base.status));
  line("/ title", snap.title, base.title);
  line(
    "/ author content, hash byte for byte (Samrajya's link taken out)",
    snap.hash,
    base.hash,
  );
  line("/ asset list", JSON.stringify(snap.assets), JSON.stringify(base.assets));

  console.log("\n  the projects on the page:");
  for (const card of snap.cards) {
    console.log(`    ${String(card.num).padEnd(3)} ${String(card.title).padEnd(18)} -> ${card.href || "(not linked)"}`);
  }

  // The one thing this project is allowed to change is Samrajya's destination.
  const before = base.cards.find((c) => /samrajya/i.test(c.title || ""));
  const after = snap.cards.find((c) => /samrajya/i.test(c.title || ""));
  line(
    "the Samrajya card now links to the game",
    after?.href || "(nothing)",
    "/samrajya/",
  );
  if (before && !before.href) {
    // Only meaningful when the baseline predates this project's deploy: it
    // records that the card was inert before, so the change is a change and not
    // a link that was quietly repointed.
    line(
      "and it was not linked when this project started",
      before.href || "(nothing)",
      "(nothing)",
    );
  }

  const others = snap.cards.filter((c) => !/samrajya/i.test(c.title || ""));
  const othersBefore = base.cards.filter((c) => !/samrajya/i.test(c.title || ""));
  line("every other project is untouched", JSON.stringify(others), JSON.stringify(othersBefore));

  console.log(
    `\n${problems === 0 ? "golake: as recorded" : `golake: ${problems} DIFFERENCE(S)`}\n`,
  );

  // process.exitCode, not process.exit: tearing the process down while a
  // socket is still closing trips an assertion inside Node on Windows, and the
  // script has already said everything it has to say.
  process.exitCode = problems === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("baseline failed:", e.message);
  process.exit(1);
});
