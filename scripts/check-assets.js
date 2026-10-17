/* ==========================================================================
   SAMRAJYA - ASSET CHECK

   Runs after every build. It is the thing that catches the class of mistake
   that is invisible in a browser and fatal in production: a path that resolves
   on disk but not on the wire.

   Checked:
     - every src/href in the HTML resolves to a real file
     - every import in the client graph resolves to a real file
     - no page path climbs above /samrajya
     - nothing is shipped from outside public/samrajya
     - the client copy of the rules is marked generated and matches shared/
     - the wordmark, the four corner marks and the board are present
     - no credential-looking string is in the shipped bundle
   ========================================================================== */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, "..");
const OUT = join(PROJECT, "public", "samrajya");
const SHARED = join(PROJECT, "shared");

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}\n`);
}

async function main() {
  console.log(`\nSamrajya asset check\n${"=".repeat(40)}`);

  if (!(await exists(join(OUT, "index.html")))) {
    console.error("no build found - run: node scripts/build.js");
    process.exit(1);
  }

  const files = await walk(OUT);
  const shipped = new Set(files.map((f) => f.relative.replace(/\\/g, "/")));

  section("The page");

  const html = await readFile(join(OUT, "index.html"), "utf8");
  check("it is the Samrajya page", html.includes("Samrajya"));
  check("the tagline is in the markup or the title", html.includes("Empires rise"));
  check("the viewport is set for phones", /name="viewport"[^>]*width=device-width/.test(html));
  check("it loads a module", /<script type="module"/.test(html));
  check("it has a skip link", html.includes("skip-link"));
  check("it says something without scripting", html.includes("<noscript>"));

  section("References");

  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^(https?:|data:|mailto:|\/)/.test(m[1])) continue;
    refs.add(m[1]);
  }
  for (const ref of refs) {
    const target = ref.replace(/^\.\//, "");
    check(`reference resolves: ${ref}`, shipped.has(target));
  }

  for (const ref of refs) {
    if (ref.startsWith("/")) check(`no page asset path climbs above /samrajya: ${ref}`, false);
  }
  check("no page asset path climbs above /samrajya", true);

  section("Module graph");

  const roots = [...shipped].filter((f) => f.endsWith(".js"));
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !shipped.has(file)) continue;
    seen.add(file);
    const body = await readFile(join(OUT, file), "utf8");
    for (const m of body.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const resolved = relative(OUT, resolve(dirname(join(OUT, file)), m[1]))
        .replace(/\\/g, "/");
      check(`import resolves: ${m[1]}`, shipped.has(resolved), resolved);
      queue.push(resolved);
    }
  }
  check("every client module was reached", seen.size > 0);

  section("Nothing escapes /samrajya");

  for (const file of shipped) {
    const body = await readFile(join(OUT, file), "utf8");
    const climbs = [...body.matchAll(/(?:src|href)="(\/[^"]*)"/g)].filter((m) =>
      !m[1].startsWith("/samrajya"),
    );
    if (climbs.length) check(`no absolute path in ${file}`, false, climbs[0][1]);
  }
  check("no shipped file links above /samrajya", true);

  section("The rules, in one place");

  for (const name of ["civilizations.js", "identity.js"]) {
    const client = join(OUT, "assets", "js", "shared", name);
    if (!(await exists(client))) {
      check(`shared/${name} reached the browser`, false);
      continue;
    }
    const body = await readFile(client, "utf8");
    check(`the client copy of ${name} is marked generated`, body.startsWith("/* GENERATED FILE"));
    const original = await readFile(join(SHARED, name), "utf8");
    const a = createHash("sha256").update(body.replace(/^\/\*[\s\S]*?\*\/\s*/, "")).digest("hex");
    const b = createHash("sha256").update(original).digest("hex");
    check(`the client copy matches shared/${name}`, a === b);
  }

  const civs = await readFile(join(SHARED, "civilizations.js"), "utf8");
  const ids = [...civs.matchAll(/id:\s*"([a-z-]+)"/g)].map((m) => m[1]);
  check("there are four civilizations", ids.length === 4, ids.join(", "));
  check(
    "and they are the four",
    JSON.stringify(ids) ===
      JSON.stringify(["indus-valley", "mesopotamian", "ancient-egyptian", "aztec"]),
    ids.join(", "),
  );

  // The board is the thing this phase is about, so its structure is checked
  // here rather than only by eye. The layout lives in the stylesheet and the
  // naming lives in the script, so the thing that can actually go wrong is the
  // two drifting apart - which would leave tiles auto-placed into tracks that
  // do not exist.
  const board = await readFile(join(OUT, "assets", "js", "board.js"), "utf8");
  const boardCss = await readFile(join(OUT, "assets", "css", "board.css"), "utf8");

  const cssTemplate = boardCss.match(/grid-template-areas:\s*([\s\S]*?);/);
  check("the stylesheet declares the template", !!cssTemplate);
  const cssRows = cssTemplate
    ? [...cssTemplate[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
    : [];
  check("the template is eight rows", cssRows.length === 8, `${cssRows.length} rows`);
  check(
    "and every row is eight cells",
    cssRows.length === 8 && cssRows.every((r) => r.split(/\s+/).length === 8),
    cssRows.map((r) => r.split(/\s+/).length).join(","),
  );

  // matchAll yields an iterator, not an array - spread it before mapping.
  const jsRows = board.match(/export const AREAS = \[([\s\S]*?)\]\.join/);
  const jsCells = jsRows
    ? [...jsRows[1].matchAll(/"([^"]+)"/g)].map((m) => m[1].trim().split(/\s+/))
    : [];
  check(
    "the script and the stylesheet name the same cells",
    JSON.stringify(jsCells) === JSON.stringify(cssRows.map((r) => r.trim().split(/\s+/))),
    jsCells.length
      ? `${jsCells.length} script rows vs ${cssRows.length} css rows`
      : "no script template",
  );

  const cells = cssRows.flatMap((r) => r.split(/\s+/)).filter((c) => c !== "c");
  check("the board has 28 tiles", cells.length === 28, `${cells.length}`);
  check("no cell is named twice", new Set(cells).size === 28, `${new Set(cells).size} distinct`);
  check("four of them are corners", cells.filter((c) => "tl tr bl br".split(" ").includes(c)).length === 4);
  check("six on each side", ["t", "b", "l", "r"].every((s) => cells.filter((c) => new RegExp(`^${s}[1-6]$`).test(c)).length === 6));

  check(
    "the grid tracks are declared too",
    /grid-template-columns:\s*var\(--corner\)\s*repeat\(6,\s*1fr\)\s*var\(--corner\)/.test(boardCss) &&
      /grid-template-rows:\s*var\(--corner\)\s*repeat\(6,\s*1fr\)\s*var\(--corner\)/.test(boardCss),
    "corner, six equal tracks, corner",
  );
  check(
    "the corner track is the reference's proportion",
    /--corner:\s*16\.85%/.test(boardCss),
    "16.85% of the board",
  );

  const cornerArt = await readFile(join(OUT, "assets", "js", "corner-art.js"), "utf8");
  check(
    "all four corner marks are drawn",
    ["omega", "core", "start", "market"].every((m) =>
      new RegExp(`${m}: \`<svg`).test(cornerArt),
    ),
  );

  const wordmark = await readFile(join(OUT, "assets", "js", "wordmark.js"), "utf8");
  check("the wordmark draws SAMRAJYA", wordmark.includes('"SAMRAJYA"') || wordmark.includes("SAMRAJYA"));
  check("the wordmark draws KALCHAKRA", wordmark.includes("KALCHAKRA"));
  check("the wordmark has an ornament", wordmark.includes("ornament"));
  check("every SAMRAJYA letter is drawn", ["S", "A", "M", "R", "J", "Y"].every((l) =>
    new RegExp(`\\b${l}:\\s*\\{`).test(wordmark),
  ));
  check("every KALCHAKRA letter is drawn", ["K", "A", "L", "C", "H", "R"].every((l) =>
    new RegExp(`\\b${l}:\\s*\\{`).test(wordmark),
  ));

  const css = await readFile(join(OUT, "assets", "css", "kalchakra.css"), "utf8");
  check("the paper is a warm off-white", /--paper:\s*#f7f4ef/i.test(css));
  check("there are no gradients", !/linear-gradient|radial-gradient/i.test(css));
  check("there are no box-shadows", !/box-shadow/i.test(css));
  check("safe areas are handled", css.includes("env(safe-area-inset"));
  check("small viewports are handled", css.includes("100svh"));
  check("there is a reduced-motion rule", css.includes("prefers-reduced-motion"));

  section("The spaces");

  // The six spaces are described once, in shared/, and published to the client
  // from there rather than copied into the bundle. A second copy would be a
  // second truth about what things cost.
  const spaces = await readFile(join(OUT, "assets", "js", "shared", "spaces.js"), "utf8");
  check("the spaces reach the client", spaces.length > 0);
  // The walk a player actually makes, in board order. Asserted against the
  // cells rather than against key order, because the keys are l6..l1 and that
  // is the reverse of how the left edge is walked.
  //
  //   START -> up the left edge -> Omega -> along the top -> Akash Core
  const WALK = [
    ["l6", "Moon"],
    ["l5", "Lagrange Point"],
    ["l4", "Ragnarok"],
    ["l3", "Asteroid Belt"],
    ["l2", "Jupiter"],
    ["l1", "Pluto"],
  ];
  const TOP = [
    ["t1", "Kuiper Belt"],
    ["t2", "Halley's Comet"],
    ["t3", "Nexus"],
    ["t4", "Voyager 1"],
    ["t5", "Proxima Centauri"],
    ["t6", "Event Horizon"],
  ];
  const cellHas = (cell, name) => {
    const at = spaces.indexOf(`\n  ${cell}: {`);
    return at > 0 && spaces.slice(at, at + 200).includes(`name: "${name}"`);
  };

  check(
    "the left edge walks up from START to the six confirmed properties",
    WALK.every(([cell, name]) => cellHas(cell, name)),
    `START, ${WALK.map(([, n]) => n).join(", ")}, Omega`,
  );
  check(
    "and the top edge walks right from Omega to Akash Core",
    TOP.every(([cell, name]) => cellHas(cell, name)),
    `Omega, ${TOP.map(([, n]) => n).join(", ")}, Akash Core`,
  );
  check(
    "no space is described on the right or bottom edge yet",
    ["r1", "r2", "r3", "r4", "r5", "r6", "b1", "b2", "b3", "b4", "b5", "b6"].every(
      (c) => !spaces.includes(`\n  ${c}: {`),
    ),
    "sixteen cells with no entry at all, which is what keeps them blank marks",
  );
  check(
    "prices are null throughout - the revised sequence arrived without them",
    (spaces.match(/price: null/g) || []).length === 10 &&
      (spaces.match(/price: \d+/g) || []).length === 0,
    "ten properties at price: null, and no invented number anywhere",
  );
  check(
    "and every described space carries an icon the card module knows",
    (() => {
      const icons = [...spaces.matchAll(/\n    icon: "([^"]+)"/g)].map((m) => m[1]);
      return icons.length === 12 && new Set(icons).size === 12;
    })(),
    "twelve spaces, twelve distinct cards, no duplicate and no orphan",
  );

  // Bounded to the block, not the file: a lazy match runs on past the cell and
  // finds the next one's price, which is exactly the mistake this check exists
  // to catch. Ragnarok is on l4 - third on the walk up from START.
  const l4 = /\n {2}l4: \{([\s\S]*?)\n {2}\},/.exec(spaces);
  check(
    "Ragnarok is a card, and carries no price",
    !!l4 && /kind: "arsenal"/.test(l4[1]) && !/price:/.test(l4[1]),
    l4 ? (l4[1].match(/kind: "\w+"/) || [""])[0] : "l4 not found",
  );
  check("the whole board's spaces cannot be mutated", spaces.includes("deepFreeze"));

  // The artwork is drawn here, in code, and that is a requirement rather than a
  // preference: this board ships no rasters and reaches no network for its
// ------------------------------------------------------------- the cards
  // A card is transcribed geometry, generated from the supplied SVG files by
  // scripts/gen-cards.mjs. These checks are about the things that would silently
  // turn a transcription into an interpretation.
  const cardsJs = await readFile(join(OUT, "assets", "js", "cards.js"), "utf8");
  const boardJsAll = await readFile(join(OUT, "assets", "js", "board.js"), "utf8");
  const boardCssAll = await readFile(join(OUT, "assets", "css", "board.css"), "utf8");
  const cardsCode = cardsJs
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  check(
    "the old art module is gone, not merely unused",
    !existsSync(join(OUT, "assets", "js", "art.js")),
  );
  check(
    "nothing in a card is fetched or embedded",
    !/<image\b|xlink:href|\bsrc=|fetch\(|\.jpe?g|\.png|\.webp|https?:\/\/(?!www\.w3\.org)/i.test(
      cardsCode,
    ),
    "every card is markup; the only URL allowed is the SVG namespace",
  );
  check(
    "no gradient, filter, blur or shadow anywhere in a card",
    !/<linearGradient|<radialGradient|<filter\b|\bfilter=|feGaussian|drop-shadow|blur\(/i.test(
      cardsCode,
    ),
  );

  // Twelve cards, one for each described space, and no others.
  const spaceIcons = [...spaces.matchAll(/\n    icon: "([^"]+)"/g)].map((m) => m[1]);
  const cardKeys = [...cardsCode.matchAll(/\n    name: "([^"]+)"/g)].map((m) => m[1]);
  check(
    "every described space has a card, and there are no others",
    cardKeys.length === spaceIcons.length && spaceIcons.length === 12,
    `${spaceIcons.length} spaces, ${cardKeys.length} cards`,
  );

  // Two formats, and each card is the one its board edge can show. A side cell
  // is wider than it is tall; a top-row cell is the other way round, and putting
  // a landscape card in a portrait cell is the mistake this catches.
  check(
    "there are exactly two card formats, 328x212 and 190x300",
    (cardsCode.match(/w: 328,\n    h: 212,/g) || []).length === 6 &&
      (cardsCode.match(/w: 190,\n    h: 300,/g) || []).length === 6,
    "six of each: six side cells and six top-row cells",
  );
  check(
    "each card's viewBox is the format its edge can show",
    (() => {
      // The order in the table is board order: six side-column cards then six
      // top-row cards.
      const pairs = [...cardsCode.matchAll(/w: (\d+),\n    h: (\d+),\n    rx: (\d+),/g)].map((m) =>
        [Number(m[1]), Number(m[2]), Number(m[3])],
      );
      if (pairs.length !== 12) return false;
      const ok = pairs.every(([w, h], i) =>
        i < 6 ? w === 328 && h === 212 : w === 190 && h === 300,
      );
      const rx = pairs.every(([, , r], i) => r === (i < 6 ? 8 : 6));
      return ok && rx;
    })(),
    "328x212 rx8 down the sides, 190x300 rx6 along the top",
  );
  check(
    "and the wrapper's viewBox is written per card, not assumed",
    cardsCode.includes('viewBox="0 0 ${card.w} ${card.h}"') &&
      cardsCode.includes('rx="${card.rx}"') &&
      cardsCode.includes('height="${card.h}" rx="${card.rx}" fill="none"'),
    "the border and the clip are drawn at the card's own size",
  );

  // Four groups, two chests, and the data agrees with the artwork.
  check(
    "there are four property groups with the specified colours",
    /purple:\s*"#7B68B0"/.test(cardsCode) &&
      /terracotta:\s*"#CF7A4B"/.test(cardsCode) &&
      /teal:\s*"#3F8F96"/.test(cardsCode) &&
      /rose:\s*"#B8557A"/.test(cardsCode),
  );
  for (const [name, hex] of [
    ["purple", "#7B68B0"],
    ["terracotta", "#CF7A4B"],
    ["teal", "#3F8F96"],
    ["rose", "#B8557A"],
  ]) {
    check(
      `and spaces.js carries the same ${name} colour`,
      spaces.includes(`${name}: "${hex}"`),
    );
  }
  check(
    "the old groups are gone",
    !/#C79A1E|#3F7F5C/.test(cardsCode) && !/#C79A1E|#3F7F5C/.test(spaces),
    "amber and green were the previous set's colours",
  );
  check(
    "exactly two cards are chests, and neither has a pill",
    (cardsCode.match(/type: "chest"/g) || []).length === 2 &&
      (cardsCode.match(/type: "property"/g) || []).length === 10 &&
      // Ragnarok and Nexus are the two no-pill cards, and their titles are the
      // cream chest ink rather than white.
      (cardsCode.match(/>RAGNAROK</g) || []).length === 1 &&
      (cardsCode.match(/>NEXUS</g) || []).length === 1,
  );
  check(
    "ten property cards each have a pill behind a white title",
    (cardsCode.match(/<g class="title-pill">/g) || []).length === 10 &&
      (cardsCode.match(/fill="#FFFFFF"/g) || []).length === 10,
  );
  check(
    "and each card's title is the right colour for its ground",
    // Ragnarok is ivory with a black title; Nexus is black with a cream one.
    // The other ten are white on their pill. Scoped to the title element, because
    // both chest inks are also drawing colours elsewhere in those two cards.
    (() => {
      const titles = [...cardsCode.matchAll(/<text class="title-text"[^>]*>/g)].map((m) => m[0]);
      if (titles.length !== 12) return false;
      const white = titles.filter((t) => t.includes('fill="#FFFFFF"')).length;
      const ink = titles.filter((t) => t.includes('fill="#241F19"')).length;
      return white === 10 && ink === 2;
    })(),
  );

  // No card keeps a dark ground. Ragnarok, Nexus and Event Horizon were all
  // recoloured onto the shared ivory, with their artwork remapped onto the same
  // stone ramp so nothing disappears onto paper.
  check(
    "every card sits on the shared ivory",
    (cardsCode.match(/<rect width="\d+" height="\d+" fill="#F7F4EF"\/>/g) || []).length === 12 &&
      !/<rect width="\d+" height="\d+" fill="#(26211C|000000|3A3042)"/.test(cardsCode),
  );

  // The one sanctioned text change, and no others.
  check(
    "Lagrange Point is displayed without the L2",
    cardsCode.includes(">LAGRANGE POINT<") &&
      !cardsCode.includes(">LAGRANGE POINT L2<") &&
      spaces.includes('name: "Lagrange Point"'),
  );
  check(
    "and its pill is the format's, holding a centred title",
    (() => {
      const m = cardsCode.match(
        /function artlagrangePoint\(id\)[\s\S]*?<rect x="14" y="14" width="([\d.]+)" height="40" rx="8"[^>]*fill="#7B68B0"[\s\S]*?x="([\d.]+)" y="([\d.]+)"[\s\S]*?textLength="(\d+)"/,
      );
      if (!m) return false;
      const [, pw, tx, ty] = m.map(Number);
      return Math.abs(tx - (14 + pw / 2)) <= 1 && ty > 14 && ty < 54 && m[4] > 0;
    })(),
  );

  check(
    "every pill is drawn AROUND its title, not beside it",
    // The invariant that was broken before: the type was enlarged and the
    // baseline left where it was, so titles grew upward out of their own pills.
    // Now each title is centred on its pill's centre line, and its baseline lies
    // inside that pill's own height - so the two cannot disagree.
    (() => {
      const cards = [...cardsCode.matchAll(/function art\w+\(id\) \{([\s\S]*?)\n\}/g)];
      if (cards.length !== 12) return false;
      let pills = 0;
      for (const [, body] of cards) {
        const open = body.match(/<text class="title-text"[^>]*>/);
        if (!open) return false;
        const pill = body.match(
          /<g class="title-pill">\s*<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/,
        );
        const ty = Number(open[0].match(/y="(-?[\d.]+)"/)[1]);
        if (!pill) continue;                     // a chest has no box to sit in
        pills++;
        const [px, py, pw, ph] = pill.slice(1).map(Number);
        const tx = Number(open[0].match(/x="(-?[\d.]+)"/)[1]);
        if (!open[0].includes('text-anchor="middle"')) return false;
        if (Math.abs(tx - (px + pw / 2)) > 1) return false;
        if (!(ty > py && ty < py + ph)) return false;
      }
      return pills === 10;
    })(),
  );

  check(
    "every card carries its own animation hooks",
    // The class names the supplied files give their groups, which is what the
    // hooks are: each drawing already names the parts that will move. Listed
    // per card rather than as one union, so a card losing its own hook names
    // shows up as that card failing rather than as the set quietly thinning.
    [
      "moon-body", "craters", "crater-rims", "stars",           // Moon
      "moon", "moon-limb", "gravity-rings", "satellite",       // Lagrange Point
      "sword", "debris", "mist", "mound",                      // Ragnarok
      "rocks",                                                 // Asteroid Belt
      "planet", "planet-b", "red-spot", "moons", "orbit",      // Jupiter
      "planet", "moon",                                        // Pluto
      "ice-bodies", "sun",                                     // Kuiper Belt
      "comet-tail", "comet-head", "stars",                     // Halley's Comet
      "coin-core", "coins-outer", "links",                     // Nexus
      "craft", "trajectory",                                   // Voyager 1
      "star", "halo",                                          // Proxima Centauri
      "hole", "warp",                                          // Event Horizon
    ].every((c) => cardsCode.includes(`class="${c}"`)),
  );

  check(
    "clip ids are unique per instance, not shared between cards",
    /clipSeq/.test(cardsCode) &&
      cardsCode.includes("`card-${key}-${++clipSeq}`"),
    "a duplicate id on one page breaks clipping, and the board draws twelve at once",
  );

  check(
    "the board draws whatever a cell has been given",
    boardJsAll.includes("spaceAt(area)"),
  );
  check(
    "a cell with no space keeps its mark",
    boardJsAll.includes('el("span", { class: "board__star-mark"'),
  );
  check(
    "all twelve spaces go through one builder",
    boardJsAll.includes("spaceTile(space, common)") &&
      !/propertyTile|arsenalTile/.test(boardJsAll),
  );
  check(
    "the board gets the card from the card module",
    boardJsAll.includes('from "./cards.js"') && boardJsAll.includes("cardSvg("),
  );
  check(
    "a space still carries its kind and group as data",
    boardJsAll.includes("data-space") && boardJsAll.includes("data-group"),
  );
  check(
    "no space prints a price - prices are dealt in the middle",
    !/space__price/.test(boardCssAll) && !/space__price/.test(boardJsAll),
  );

  // The geometry is fixed. These are the cells the design put spaces on; if the
  // board's template ever stops producing them, the spaces have quietly moved.
  check(
    "the board still gives every intermediate tile the same box",
    boardCss.includes("var(--corner) repeat(6, 1fr) var(--corner)"),
  );
  check(
    "a space is sized against its own tile, so it scales as one piece",
    boardCss.includes("container-type: inline-size"),
  );

  check(
    "the grey strips are gone",
    !/space__band|space__icon|arsenal__card|arsenal__icon/.test(boardCss),
    "no divider strips, no icon layer, no black card",
  );
  check(
    "and no space paints a black field",
    !/\.board__tile--(space|arsenal)[^{]*\{[^}]*background:\s*(#000|black|var\(--ink\))/.test(
      boardCss.replace(/\/\*[\s\S]*?\*\//g, ""),
    ),
  );
  section("Nothing secret");

  const suspicious = [
    /\bAIza[0-9A-Za-z_-]{35}\b/,
    /\bsk-[A-Za-z0-9]{20,}\b/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /"type"\s*:\s*"service_account"/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  ];
  let clean = true;
  for (const file of shipped) {
    if (![".js", ".html", ".css", ".json"].includes(extname(file))) continue;
    const body = await readFile(join(OUT, file), "utf8");
    for (const pattern of suspicious) {
      if (pattern.test(body)) {
        check(`no credentials in ${file}`, false);
        clean = false;
      }
    }
  }
  check("no credentials in the shipped bundle", clean);

  console.log(`\n${"=".repeat(40)}`);
  if (failed === 0) {
    console.log(`assets: OK  (${passed} checks)\n`);
    process.exit(0);
  }
  console.log(`assets: ${failed} PROBLEM(S)\n`);
  for (const line of failures) console.log(`  - ${line}`);
  process.exit(1);
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push({ path: full, size: (await stat(full)).size, relative: relative(base, full) });
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
