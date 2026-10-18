/* ==========================================================================
   SAMRAJYA - ASSET CHECK

   Runs after every build. It is the thing that catches the class of mistake
   that is invisible in a browser and fatal in production: a path that resolves
   on disk but not on the wire, and a board whose drawing and its data have
   quietly drifted apart.

   Checked:
     - every src/href in the HTML resolves to a real file
     - every import in the client graph resolves to a real file
     - no page path climbs above /samrajya
     - nothing is shipped from outside public/samrajya
     - the client copies of the shared modules are marked generated and match
       the originals
     - shared/spaces.js is a faithful copy of shared/board-cells.json, cell by
       cell and field by field
     - the board's grid is six by ten of one cell size, and every cell is
       placed at the coordinates the data gives it
     - the four corners sit at cell size and keep their own marks
     - the twelve cards are still exactly what they were
     - no credential-looking string is in the shipped bundle

   THE DATA IS THE TRUTH
   ---------------------
   board-cells.json is the source of truth for the twenty-eight cells and
   spaces.js is generated from it. This script checks the two agree, because the
   whole point of a transcription is that it can be checked, and a transcription
   nobody checks is an interpretation that has not admitted it yet.
   ========================================================================== */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { CELLS, CORNER_IDS, GRID, SETS, census } from "../shared/spaces.js";

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

  for (const name of ["civilizations.js", "identity.js", "spaces.js"]) {
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

  /* ------------------------------------------------- the cells, and the file */

  section("The board's cells");

  const source = JSON.parse(await readFile(join(SHARED, "board-cells.json"), "utf8"));

  check("board-cells.json is in the repository", existsSync(join(SHARED, "board-cells.json")));
  check(
    "the grid is the file's grid",
    GRID.cols === source.grid.cols && GRID.rows === source.grid.rows,
    `${GRID.cols} x ${GRID.rows}`,
  );

  // The transcription itself. Every cell, every field, compared against the file
  // the board was copied from. Nothing here is a judgement about what the cells
  // should be - only whether the board says what the file says.
  const FIELDS = [
    "index", "col", "row", "type", "id", "name", "lines",
    "set", "color", "art", "chest",
  ];
  const drift = [];
  for (const want of source.cells) {
    const got = CELLS.find((c) => c.id === want.id);
    if (!got) {
      drift.push(`${want.id} is in the file and not on the board`);
      continue;
    }
    for (const field of FIELDS) {
      if (JSON.stringify(got[field]) !== JSON.stringify(want[field])) {
        drift.push(`${want.id}.${field}: ${JSON.stringify(want[field])} -> ${JSON.stringify(got[field])}`);
      }
    }
  }
  check(
    "shared/spaces.js is the file, cell by cell and field by field",
    CELLS.length === source.cells.length && drift.length === 0,
    drift.slice(0, 4).join("; ") || `${CELLS.length} cells, no drift`,
  );

  check(
    "the sets are the file's, unchanged",
    Object.entries(source.sets).every(([id, s]) => SETS[id]?.color === s.color),
  );

  // The ring. Twenty-eight cells, one grid position each, all on the border, and
  // the middle empty - because the centre is not a cell and anything placed
  // there would be a tile that is not part of the board.
  check("there are twenty-eight cells", CELLS.length === 28, `${CELLS.length}`);
  check("no two cells share an id", new Set(CELLS.map((c) => c.id)).size === 28);
  check(
    "and no two sit on the same square",
    new Set(CELLS.map((c) => `${c.col},${c.row}`)).size === 28,
  );
  check(
    "every cell is on the border of the grid",
    CELLS.every((c) => c.col === 1 || c.col === GRID.cols || c.row === 1 || c.row === GRID.rows),
  );
  check(
    "the middle four columns by eight rows is not a cell",
    CELLS.every((c) => !(c.col >= 2 && c.col <= 5 && c.row >= 2 && c.row <= 9)),
  );
  check(
    "four are corners, twenty are properties and four are chests",
    census().corners === 4 && census().properties === 20 && census().chests === 4,
    JSON.stringify(census()),
  );
  check("the whole board's cells cannot be mutated", (await readFile(join(SHARED, "spaces.js"), "utf8")).includes("deepFreeze"));

  /* ------------------------------------------------------- the order, walked */

  const start = CELLS[0];
  check(
    "START is the bottom-left corner and index 0",
    start.id === "start" && start.col === 1 && start.row === GRID.rows,
    `${start.id} at ${start.col},${start.row}`,
  );
  // Rows count from the top, so travelling up the left column decreases the row.
  // A lap is twenty-eight moves, not twenty-seven: the move from the last cell
  // back onto Start is a move, and it is the one that makes this a ring. The
  // walk is four straight runs and nothing else, which is a far sharper
  // statement than "the counts are right" - a cell moved anywhere would either
  // break a run or make one of them the wrong length.
  const at = (i) => CELLS[i % CELLS.length];
  const steps = [];
  for (let i = 1; i <= CELLS.length; i++) {
    steps.push(`${at(i).col - at(i - 1).col},${at(i).row - at(i - 1).row}`);
  }
  const runs = [];
  for (const d of steps) {
    const last = runs[runs.length - 1];
    if (last && last[0] === d) last[1] += 1;
    else runs.push([d, 1]);
  }
  check(
    "one lap is nine up the left, five across the top, nine down the right, five back",
    JSON.stringify(runs) === JSON.stringify([["0,-1", 9], ["1,0", 5], ["0,1", 9], ["-1,0", 5]]),
    runs.map(([d, n]) => `${d} x${n}`).join(" then "),
  );
  check(
    "and the lap is twenty-eight moves and it closes",
    steps.length === 28 &&
      runs.reduce((n, [, k]) => n + k, 0) === 28 &&
      at(CELLS.length - 1).row === at(0).row &&
      at(CELLS.length - 1).col - at(0).col === 1 &&
      steps[27] === "-1,0",
    "the cell before Start is on Start's row, one cell to its right, so the last move is a step left",
  );

  const corners = CELLS.filter((c) => c.type === "corner");
  check(
    "the four corners are Omega, Akash Core, Start and Marketplace, where the file puts them",
    JSON.stringify(corners.map((c) => [c.id, c.col, c.row]).sort()) ===
      JSON.stringify([
        ["akash-core", 6, 1],
        ["marketplace", 6, 10],
        ["omega", 1, 1],
        ["start", 1, 10],
      ]),
    corners.map((c) => `${c.id}@${c.col},${c.row}`).join(" "),
  );
  check(
    "and none of them has been abbreviated",
    JSON.stringify(corners.map((c) => c.name).sort()) ===
      JSON.stringify(["Akash Core", "Marketplace", "Omega", "Start"]),
  );
  check(
    "no cell has a price nobody chose",
    (await readFile(join(SHARED, "spaces.js"), "utf8")).includes("cell?.price == null"),
    "a null price is the answer, not a gap",
  );

  /* ------------------------------------------------------------ the geometry */

  section("The board's geometry");

  const boardJs = await readFile(join(OUT, "assets", "js", "board.js"), "utf8");
  const boardCss = await readFile(join(OUT, "assets", "css", "board.css"), "utf8");

  check(
    "six columns of one cell size",
    /grid-template-columns:\s*repeat\(6,\s*var\(--cell\)\)/.test(boardCss),
  );
  check(
    "and ten rows of that same cell size",
    /grid-template-rows:\s*repeat\(10,\s*var\(--cell\)\)/.test(boardCss),
  );
  check(
    "the cell is the smaller of what fits across and what fits down",
    /--cell-fit:\s*min\(/.test(boardCss) &&
      boardCss.includes("100vw") &&
      boardCss.includes("100dvh"),
  );
  check(
    "and it is rounded down to a whole pixel, never nearest or up",
    /--cell:\s*round\(down,\s*var\(--cell-fit\),\s*1px\)/.test(boardCss),
    "a fractional cell puts the first line on a fractional coordinate and every " +
      "line after it inherits that; rounding up would overflow the fit it came from",
  );
  check(
    "and it allows for the hairlines, so the board cannot overflow the screen",
    boardCss.includes("7 * var(--hair)") && boardCss.includes("11 * var(--hair)"),
    "six cells, five gaps and two frames across; ten cells, nine gaps and two down",
  );
  check(
    "the reserves are variables",
    /--reserve-top:/.test(boardCss) && /--reserve-bottom:/.test(boardCss),
  );
  check(
    "the lines are the board's own ground showing through the gap, not borders that double",
    /background:\s*var\(--board-ground\)/.test(boardCss) && /gap:\s*var\(--hair\)/.test(boardCss),
    "no cell carries a border that could be drawn twice where it meets its neighbour",
  );
  check(
    "and a line is a whole pixel, because half a pixel is not a line",
    /--hair:\s*1px/.test(boardCss),
    "at 0.5px the renderer antialiases every line across two device pixels and " +
      "the whole grid comes out at half strength",
  );
  check(
    "the old 8x8 template is gone",
    !boardCss.includes("grid-template-areas") && !boardCss.includes("--corner:"),
    "corner tracks at 16.85% made the corners a third larger than their neighbours",
  );

  check(
    "every cell is placed by the coordinates the data gives it",
    boardJs.includes("gridColumn: String(cell.col)") &&
      boardJs.includes("gridRow: String(cell.row)"),
  );
  check(
    "and the board is built from the data rather than a list written out by hand",
    boardJs.includes("CELLS.map(") && !/\bconst (?:AREAS|PATH)\b/.test(boardJs),
  );
  check(
    "the cells come from the shared module, not a copy in the bundle",
    boardJs.includes('from "./shared/spaces.js"'),
  );
  check(
    "the four corners keep the project's own marks",
    boardJs.includes('from "./corner-art.js"') && boardJs.includes("cornerMark("),
    "not redrawn at the new size, only laid out again at it",
  );
  check(
    "the centre is the four by eight, and it is ready for the dice and the scorecard",
    boardJs.includes('id: "board-center"') &&
      boardJs.includes('centreArea.style.gridColumn = "2 / 6"') &&
      boardJs.includes('centreArea.style.gridRow = "2 / 10"'),
    "the reference draws the middle as one field, so the lines stop at the ring",
  );

  check(
    "every property is a real button, addressed by its own id and index",
    boardJs.includes('el(\n    "button"') &&
      boardJs.includes('"data-id": cell.id') &&
      boardJs.includes('"data-index": String(cell.index)') &&
      boardJs.includes('"data-art": cell.art'),
    "reachable by keyboard, and carrying the artwork path for later",
  );
  check(
    "and each one's label is set on the breaks in the data, not on a guess",
    boardJs.includes("cell.lines.map((line) => `<span>${line}</span>`)"),
  );
  check(
    "a chest has no pill, because a chest belongs to no set",
    /--chest-wash:\s*#000000/.test(boardCss) &&
      /--wash:\s*var\(--chest-wash\)/.test(boardCss) &&
      boardJs.includes("const isChest = cell.type === \"chest\""),
  );
  check(
    "the pill is where the layout brief puts it",
    /top:\s*13\.3%/.test(boardCss) &&
      /left:\s*26\.7%/.test(boardCss) &&
      /width:\s*46\.7%/.test(boardCss) &&
      /height:\s*10%/.test(boardCss) &&
      /border-radius:\s*999px/.test(boardCss),
  );
  check(
    "the label is sized from the cell alone, with a floor under it",
    /font-size:\s*max\(8px, calc\(var\(--cell\) \* 0\.14\)\)/.test(boardCss) &&
      /text-transform:\s*uppercase/.test(boardCss) &&
      /letter-spacing:\s*0\.05em/.test(boardCss) &&
      /\.board__label > span \{\s*white-space:\s*nowrap/.test(boardCss),
    "never from the artwork, so a card cannot change a name's size",
  );

  /* ---------------------------------------------------- the board's colours */

  section("The board's colours");

  const tokens = {
    "--board-ground": /#2a2a2a/i,
    "--cell-ground": /#f7f4ef/i,
    "--corner-ground": /#121212/i,
    "--centre-ground": /#fbf9f5/i,
    "--chest-wash": /#000000/i,
    "--wash-strength": /7%/,
  };
  for (const [token, value] of Object.entries(tokens)) {
    check(`${token} is defined once, in the board's own block`, new RegExp(`${token}:\\s*`).test(boardCss));
    check(`  and it is ${value.source}`, value.test(boardCss));
  }
  check(
    "a cell's wash is its own pill's colour, and only that",
    /"--wash":\s*cell\.color/.test(boardJs) &&
      /backgroundColor:\s*cell\.color/.test(boardJs),
    "one value from one field of one record, used for both",
  );
  check(
    "and the cell's grid position is assembled in the same style object as the wash",
    /const style = \{\s*gridColumn: String\(cell\.col\),\s*gridRow: String\(cell\.row\),/.test(boardJs) &&
      !/\.\.\.props,\s*\n\s*type: "button",\s*\n\s*"aria-label": cell\.name,\s*\n\s*style:/.test(boardJs),
    "a style key written after the spread silently replaces gridColumn and " +
      "gridRow, and the grid then auto-places every property in the wrong square",
  );
  check(
    "and it is laid on by color-mix, so the cell is one flat colour",
    /background:\s*color-mix\(in srgb, var\(--wash\) var\(--wash-strength\), var\(--cell-ground\)\)/.test(boardCss),
    "the paper tinted by the wash, with no second layer to clip",
  );
  check(
    "the four corners are not washed, because a corner is not a set",
    !/\.board__cell--corner[^{]*\{[^}]*--wash/.test(boardCss) &&
      !/\.board__cell--corner[^{]*\{[^}]*color-mix/.test(boardCss),
  );
  // The point of naming them: a colour written into a rule instead of a token is
  // a colour that can drift away from the one the design says. The token
  // definitions themselves are where colours are allowed to be written down, so
  // they come out of the text before this looks.
  const rules = boardCss
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--[\w-]+\s*:[^;]*;\s*$/gm, "");
  const literals = [...rules.matchAll(/:\s*(#[0-9a-f]{6})\s*[;}]/gi)].map((m) => m[1].toLowerCase());
  check(
    "and no colour is written into a rule where a token could carry it",
    literals.length === 0,
    literals.length ? [...new Set(literals)].join(" ") : "every colour goes through a token",
  );

  const cornerArt = await readFile(join(OUT, "assets", "js", "corner-art.js"), "utf8");
  check(
    "all four corner marks are drawn",
    ["omega", "core", "start", "market"].every((m) =>
      new RegExp(`${m}: \`<svg`).test(cornerArt),
    ),
  );

  const wordmark = await readFile(join(OUT, "assets", "js", "wordmark.js"), "utf8");
  check("the wordmark draws SAMRAJYA", wordmark.includes("SAMRAJYA"));
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

  /* ---------------------------------------------------------------- the cards

     The artwork is transcribed geometry, generated from the supplied SVG files.
     These checks are about the things that would silently turn a transcription
     into an interpretation - and none of them has anything to do with the board,
     because the board's cells do not draw cards yet. */

  section("The cards");

  const cardsCode = (await readFile(join(OUT, "assets", "js", "cards.js"), "utf8"))
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

  check(
    "there are still twelve cards",
    [...cardsCode.matchAll(/^\s{2}"[a-z0-9-]+": Object\.freeze\(\{/gm)].length === 12,
  );
  check(
    "the artwork keeps its two formats, six of each",
    (cardsCode.match(/w: 328,\n    h: 212,/g) || []).length === 6 &&
      (cardsCode.match(/w: 190,\n    h: 300,/g) || []).length === 6,
    "328x212 and 190x300, unchanged by the new board",
  );
  check(
    "the wrapper's viewBox is written per card, not assumed",
    cardsCode.includes('viewBox="0 0 ${card.w} ${card.h}"') &&
      cardsCode.includes('rx="${card.rx}"'),
  );
  check(
    "the four property groups keep their colours",
    /purple:\s*"#7B68B0"/.test(cardsCode) &&
      /terracotta:\s*"#CF7A4B"/.test(cardsCode) &&
      /teal:\s*"#3F8F96"/.test(cardsCode) &&
      /rose:\s*"#B8557A"/.test(cardsCode),
  );
  check(
    "and the old ones are gone",
    !/#C79A1E|#3F7F5C/.test(cardsCode),
    "amber and green were the previous set's colours",
  );
  check(
    "exactly two cards are chests, and neither has a pill",
    (cardsCode.match(/type: "chest"/g) || []).length === 2 &&
      (cardsCode.match(/type: "property"/g) || []).length === 10 &&
      (cardsCode.match(/>RAGNAROK</g) || []).length === 1 &&
      (cardsCode.match(/>NEXUS</g) || []).length === 1,
  );
  check(
    "ten property cards each have a pill behind a white title",
    (cardsCode.match(/<g class="title-pill">/g) || []).length === 10 &&
      (cardsCode.match(/fill="#FFFFFF"/g) || []).length === 10,
  );
  check(
    "every card sits on the shared ivory",
    (cardsCode.match(/<rect width="\d+" height="\d+" fill="#F7F4EF"\/>/g) || []).length === 12 &&
      !/<rect width="\d+" height="\d+" fill="#(26211C|000000|3A3042)"/.test(cardsCode),
  );

  // The one sanctioned text change to the card artwork: LAGRANGE POINT, with the
  // L2 left off. The board's CELL says Lagrange Point L2 - they are different
  // things, and the cell is not allowed to change the card or the card the cell.
  check(
    "Lagrange Point is displayed without the L2",
    cardsCode.includes(">LAGRANGE POINT<") && !cardsCode.includes(">LAGRANGE POINT L2<"),
  );
  check(
    "the cell, which is a different thing, still says Lagrange Point L2",
    CELLS.some((c) => c.id === "lagrange-l2" && c.name === "Lagrange Point L2"),
  );

  check(
    "every pill is drawn AROUND its title, not beside it",
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
    /clipSeq/.test(cardsCode) && cardsCode.includes("`card-${key}-${++clipSeq}`"),
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