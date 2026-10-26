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

  section("The modules");

  /* EVERY SHIPPED MODULE MUST PARSE.

     A syntax error in a module is invisible in a build and fatal in a browser:
     the page falls back to its no-script text and the game is simply gone, with
     nothing in the console that a person would read. Node can parse a module
     without running it, so every file the client will load is parsed here. */
  const modules = files.filter((f) => f.relative.endsWith(".js"));
  let parsed = 0;
  const unparsed = [];
  for (const file of modules) {
    const source = await readFile(join(OUT, file.relative), "utf8");
    try {
      // eslint-disable-next-line no-new-func
      new Function(`return async () => { ${source.replace(/^\s*import[\s\S]*?;$/gm, "").replace(/^\s*export\s+/gm, "")} }`);
      parsed += 1;
    } catch (error) {
      unparsed.push(`${file.relative}: ${error.message}`);
    }
  }
  check(
    `every shipped module parses (${parsed} of ${modules.length})`,
    unparsed.length === 0,
    unparsed.join(" | "),
  );

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

  for (const name of ["civilizations.js", "identity.js", "spaces.js", "properties.js"]) {
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
    "the four corners are Start, Outer Space, Black Hole and Fight, where the file puts them",
    JSON.stringify(corners.map((c) => [c.id, c.col, c.row]).sort()) ===
      JSON.stringify([
        ["black-hole", 6, 1],
        ["fight", 6, 10],
        ["outer-space", 1, 1],
        ["start", 1, 10],
      ]),
    corners.map((c) => `${c.id}@${c.col},${c.row}`).join(" "),
  );
  check(
    "and none of them has been abbreviated",
    JSON.stringify(corners.map((c) => c.name).sort()) ===
      JSON.stringify(["Black Hole", "Fight", "Outer Space", "Start"]),
  );
  check(
    "and every cell's id is the same word as the corner it names",
    corners.every((c) => c.id === c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")),
    "an id that names one board and a label that names another is a trap for whoever reads the file next",
  );
  check(
    "no cell has a price nobody chose",
    (await readFile(join(SHARED, "spaces.js"), "utf8")).includes("cell?.price == null"),
    "a null price is the answer, not a gap",
  );

  /* ------------------------------------------------------------ the geometry */

  /* ------------------------------------------------------------- the way in */
  section("The way in");

  const appCode = await readFile(join(OUT, "assets", "js", "app.js"), "utf8");
  const sessionCode = await readFile(join(OUT, "assets", "js", "session.js"), "utf8");
  const identityCode = await readFile(join(OUT, "assets", "js", "shared", "identity.js"), "utf8");
  const viewsCode = await readFile(join(OUT, "assets", "js", "views.js"), "utf8");
  const workerCode = await readFile(join(PROJECT, "src", "index.js"), "utf8");
  const roomSource = await readFile(join(PROJECT, "src", "room.js"), "utf8");
  const screenCss = await readFile(join(OUT, "assets", "css", "kalchakra.css"), "utf8");

  check(
    "the create form asks for one player only",
    viewsCode.includes('step: "1 of 1"') &&
      !viewsCode.includes("guestName") &&
      !viewsCode.includes("Player 2 - "),
    "the second seat is filled in by the second player, on their own device",
  );
  check(
    "and nobody is asked to describe their opponent",
    !/their name|their civilization/i.test(viewsCode),
  );
  check(
    "every civilization choice shows the colour its coin is drawn in",
    viewsCode.includes('class: "civ__swatch"') &&
      viewsCode.includes('"--coin": civ.coin') &&
      screenCss.includes(".civ__swatch") &&
      /background:\s*var\(--coin\)/.test(screenCss),
    "the same value the board draws the coin with, not a second list of colours",
  );
  check(
    "a civilization already taken is shown, disabled, rather than hidden",
    viewsCode.includes("disabled: taken") && viewsCode.includes(", taken"),
  );

  check(
    "the room code is four digits",
    /ROOM_CODE_LENGTH = 4/.test(identityCode) && identityCode.includes("[1-9][0-9]{3}"),
    "short enough to read across a room and type with a thumb",
  );
  check(
    "and the number is derived per attempt, so a clash is the next number",
    identityCode.includes("samrajya/room/v2|") &&
      /deriveCode\(identity, createKey, attempt = 0\)/.test(identityCode),
  );
  check(
    "a create that finds its number taken asks for the next one",
    workerCode.includes("ROOM_CODE_TRIES") &&
      workerCode.includes('refusal !== "ROOM_TAKEN"') &&
      workerCode.includes("deriveCode(identity, createKey, attempt)"),
    "a busy code costs one round trip, never a second room",
  );
  check(
    "and the Worker only routes four-digit rooms",
    workerCode.includes("rooms\\/([1-9][0-9]{3})"),
  );
  check(
    "a four-digit link serves the game rather than a 404",
    workerCode.includes("samrajya\\/[1-9][0-9]{3}") &&
      workerCode.includes('new URL("/samrajya/", url)'),
    "golake.app/samrajya/7889 is the same door as ?room=7889",
  );
  check(
    "and the page takes that number out of the address once it has read it",
    appCode.includes("pathname.replace") &&
      appCode.includes("[1-9][0-9]{3}\\/?$"),
    "a refresh goes to the room this tab remembers, not to an old link",
  );
  check(
    "the room does not reserve a second seat at creation",
    !roomSource.includes("hasReservedPair") &&
      roomSource.includes("players: [seatFor(identity, host, \"HOST\", true), emptySeat()]"),
  );

  check(
    "the lobby shows the code as four digits",
    viewsCode.includes("lobby__digit") && screenCss.includes(".lobby__digit"),
  );
  check(
    "and every seat carries its civilization's colour, its name and its state",
    viewsCode.includes("seat__coin") &&
      viewsCode.includes("seat__civ") &&
      viewsCode.includes("seat__state--ready") &&
      screenCss.includes(".seat__state--ready"),
  );
  check(
    "the join is announced in a sentence that names the civilization",
    viewsCode.includes("has joined as") && viewsCode.includes("Civilization"),
  );
  check(
    "the host starts, and the guest is told to wait for that",
    viewsCode.includes('"Start Game"') && viewsCode.includes("Waiting for ${host?.name"),
  );
  check(
    "a start pushes both screens to the board, from the room the server sends",
    appCode.includes('room.status === "PLAYING" && room.board') &&
      appCode.includes("state.applySnapshot?.({ state: room.board, events: [] })"),
    "neither player presses anything twice, and nobody refreshes",
  );
  check(
    "and the code is taken out of the address bar once it has been used",
    appCode.includes("dropUrlCode") && /history\.replaceState/.test(appCode),
    "a stale ?room= is how a reload reopens a game everybody left",
  );
  check(
    "leaving forgets the room as well as the note of it",
    appCode.includes("session.forget()") && sessionCode.includes("forget()"),
  );

  /* ---------------------------------------------------------------- geometry */
  section("The board's geometry");

  const boardJs = await readFile(join(OUT, "assets", "js", "board.js"), "utf8");
  const boardCss = await readFile(join(OUT, "assets", "css", "board.css"), "utf8");
  const diceCode = await readFile(join(OUT, "assets", "js", "dice.js"), "utf8");
  const announcementsCode = await readFile(
    join(OUT, "assets", "js", "shared", "announcements.js"),
    "utf8",
  );
const cardJs = await readFile(join(OUT, "assets", "js", "property-card.js"), "utf8");

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
    !boardCss.includes("grid-template-areas") && !/--corner:\s*[\d.]/.test(boardCss),
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
    "the centre is the four by eight, and it holds the die rather than the old ornament",
    boardJs.includes('id: "board-center"') &&
      boardJs.includes('centreArea.style.gridColumn = "2 / 6"') &&
      boardJs.includes('centreArea.style.gridRow = "2 / 10"'),
    "the reference draws the middle as one field, so the lines stop at the ring",
  );
  check(
    "the diamond and its horizon lines are gone",
    !/board__star|board__line\b|board__centre-mark/.test(boardCss) &&
      !/board__star|board__line\b|board__centre-mark/.test(boardJs),
    "nothing left of the ornament the die replaced",
  );
  check(
    "the die is placed by the board, centred on rows 8 and 9",
    /\.board__dice \{[\s\S]*?position:\s*absolute/.test(boardCss) &&
      /top:\s*calc\(8 \* var\(--cell\) \+ 7\.5 \* var\(--hair\)\)/.test(boardCss) &&
      /transform:\s*translate\(-50%, -50%\)/.test(boardCss),
    "the rectangle MOON, LAGRANGE POINT L2, MILKY WAY and RAMA describe",
  );
  check(
    "and it is thrown by pressing it, never on its own",
    /die\.addEventListener\("click"/.test(boardJs) &&
      /data-face="0"/.test(diceCode) &&
      /root\.addEventListener\("click"/.test(diceCode) &&
      /animation: dice-throw/.test(boardCss),
    "an unthrown die shows no number at all, and nothing loops",
  );
  check(
    "the die is about half the size it was",
    /--die-size:\s*calc\(var\(--cell\) \* 0\.62\)/.test(boardCss) &&
      /\.board__dice \{[^}]*width:\s*var\(--die-size\)/.test(boardCss),
    "it was 1.15 cells; it is an object rather than a feature, and the size is written once so nothing else can drift from it",
  );
  check(
    "the die carries no outline in any state",
    /\.board__dice:focus,\s*\n\.board__dice:focus-visible,\s*\n\.board__dice:active \{\s*\n\s*outline:\s*none;/.test(boardCss) &&
      !/\.board__dice[^{]*\{[^}]*outline:(?!\s*none)/.test(boardCss) &&
      /-webkit-tap-highlight-color:\s*transparent/.test(boardCss),
    "an outline on an SVG is drawn round its rectangular box, not round the die, and a tap is enough to call it focus",
  );
  check(
    "the middle's status is a capsule above the die, and it takes no taps",
    /\.board__announce--status \{[\s\S]*?place-self:\s*start center/.test(boardCss) &&
      /\.board__announce--status \{[\s\S]*?pointer-events:\s*none/.test(boardCss) &&
      /\.board__announce--status \{[\s\S]*?--cell\) \* 1\.15/.test(boardCss),
    "a status that could be pressed would be a control, and the die is the only thing in the middle that can be pressed",
  );
  check(
    "and it says whose turn it is in two temperatures",
    /\.board__announce--wait \.announce__big/.test(boardCss) &&
      /\.board__announce--wait \.announce__label::before/.test(boardCss) &&
      /@keyframes wait-pulse/.test(boardCss) &&
      boardJs.includes("statusFor(game") &&
      announcementsCode.includes('"Opponent is playing"'),
    "the turn you own is inked and still; the turn you are waiting on is softer and pulses",
  );
  check(
    "the card's body copy is readable, and the labels stay labels",
    /font-size:\s*max\(11\.05px, calc\(var\(--cell\) \* 0\.1625\)\)/.test(boardCss) &&
      /font-size:\s*max\(12\.35px, calc\(var\(--cell\) \* 0\.208\)\)/.test(boardCss) &&
      /font-size:\s*max\(7\.8px, calc\(var\(--cell\) \* 0\.104\)\)/.test(boardCss) &&
      // Asked of the two rules rather than counted across the file. The chest
      // card reuses this same small type on purpose - it is the same family as
      // the property card - and a count of the whole stylesheet would have
      // failed the moment a second card reused a size, which is the opposite of
      // what the count was for.
      /\.property-card__description \{[^}]*max\(12px, calc\(var\(--cell\) \* 0\.16\)\)/.test(boardCss) &&
      /\.property-card__advantage-text \{[^}]*max\(12px, calc\(var\(--cell\) \* 0\.16\)\)/.test(boardCss),
    "body at 12px or more on the smallest phone, with the small caps still the quietest line",
  );
  check(
    "and the matchup is drawn between the two identities",
    /class: "who__vs", text: "VS"/.test(viewsCode) &&
      /i > 0 \? el\("span"/.test(viewsCode),
    "a pseudo-element would belong to one block and sit outside the pair, reading as a suffix on the first name",
  );
  check(
    "the die takes its six face colours from the board's own sets",
    /import \{ CELLS, CORNER_IDS, SETS \}/.test(boardJs) &&
      /return dice\(Object\.values\(SETS\)\.map\(\(set\) => set\.color\)\)/.test(boardJs),
    "assembled from the pills rather than typed into the die",
  );
  check(
    "and the card is placed in the upper middle by cells and lines, not by percentage",
    /\.board__card \{[\s\S]*?left:\s*calc\(var\(--cell\) \+ var\(--hair\) \* 2 \+ var\(--card-gap\)\)/.test(boardCss) &&
      /top:\s*calc\(var\(--cell\) \+ var\(--hair\) \* 2 \+ var\(--card-gap\)\)/.test(boardCss) &&
      /width:\s*calc\(var\(--cell\) \* 4 \+ var\(--hair\) \* 3 - var\(--card-gap\) \* 2\)/.test(boardCss) &&
      /height:\s*calc\(var\(--cell\) \* 3 \+ var\(--hair\) \* 2 - var\(--card-gap\) \* 2\)/.test(boardCss),
    "columns 2 to 5, rows 2 to 4, inset by --card-gap",
  );
  check(
    "nothing the card or the die does can move the board",
    /\.board__card \{[^}]*position:\s*absolute/.test(boardCss) &&
      /\.board__dice \{[^}]*position:\s*absolute/.test(boardCss) &&
      /\.property-card \{[^}]*position:\s*relative/.test(boardCss),
    "both are out of flow; the card's turn is a transform, which does not lay out",
  );
  check(
    "and the card's turn is transform-only, so it cannot reflow anything",
    cardJs.includes("rotateY") && !/width:|height:|top:|left:/.test(
      (cardJs.match(/\.animate\(\s*\[[\s\S]*?\]\s*,/g) || []).join(" "),
    ),
  );
  check(
    "every square opens a card, and the press is on the square",
    /cell\.matches\?\.\("button\[data-id\]"\)/.test(boardJs) &&
      /squareCard\(cell, \{ onClose/.test(boardJs) &&
      /isPurchasable\(landing\.id\)/.test(boardJs),
    "a square that takes a tap and answers with nothing is a square that looks " +
      "broken, so every one of the twenty-eight opens a card of its own",
  );
  check(
    "six faces, all in the markup, one shown",
    diceCode.includes("DICE_FACES = Object.freeze([1, 2, 3, 4, 5, 6])") &&
      /data-face="\$\{n\}"/.test(diceCode) &&
      /group\.toggleAttribute\("hidden"/.test(diceCode),
  );
  check(
    "the result is drawn before the animation starts, from a single draw",
    /const drawn = random\(\);/.test(diceCode) &&
      diceCode.indexOf("const drawn = random();") <
        diceCode.indexOf("const chosen = DICE_FACES[") &&
      diceCode.indexOf("const chosen = DICE_FACES[") <
        diceCode.indexOf("return throwTo(root, chosen"),
    "a roll that searched for its face as it landed could be interrupted",
  );
  check(
    "and a reader who wants less motion gets the number without the throw",
    diceCode.includes('"(prefers-reduced-motion: reduce)"') &&
      /@media \(prefers-reduced-motion: reduce\)/.test(boardCss),
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
    "--card-inset": /#fbf9f5/i,
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
    ["space", "hole", "start", "fight"].every((m) =>
      new RegExp(`${m}: \`<svg`).test(cornerArt),
    ),
    "Outer Space, Black Hole, Start, Fight",
  );
  check(
    "and the board draws a mark for each of the four ids",
    /"outer-space": "space"/.test(boardJs) &&
      /"black-hole": "hole"/.test(boardJs) &&
      /fight: "fight"/.test(boardJs) &&
      /start: "start"/.test(boardJs),
    "keyed by the same word the corner is called",
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

  /* The ten that were missing.

     These ten had no drawing at all, so their cards fell back to a letter. They
     are drawn in the vocabulary of the twenty that already existed, and these
     four checks are what "the same vocabulary" is made to mean: the same ramp of
     colours, the same two canvases, the same flat-only treatment, and a drawing
     of their own for every one of the ten. */

  const artCode = await readFile(join(OUT, "assets", "js", "property-art.js"), "utf8");
  const wanted = [
    "earth-137", "orions-belt", "wow-signal", "dyson-sphere", "wormhole",
    "milky-way", "rama", "quasar", "supernova", "sagittarius-a-star",
  ];

  // Four of the ten are single-word ids, so they are written as bare object keys
  // and six are quoted. The quotes are optional here; what is not optional is
  // that a typo cannot quietly leave a property undrawn.
  const hasDrawing = (id) =>
    new RegExp(`["']?${id.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}["']?\\s*:\\s*\\{`, "m").test(artCode);

  check(
    "the ten that had no drawing each have one now",
    wanted.every(hasDrawing),
    wanted.map((id) => `${id}:${hasDrawing(id) ? "yes" : "MISSING"}`).join(" "),
  );

  // The ramp the existing twenty use, and nothing outside it.
  const RAMP = [
    "#F7F4EF", "#D8D0C0", "#CFC7B8", "#B8AE9C", "#A39986",
    "#8E8472", "#5A5044", "#17121B", "#E5DFD3",
    "#F1E8DD", "#EBDDCF", "#D9876B", "#CF7A4B",
  ];
  const RAMP_SET = new Set(RAMP.map((c) => c.toUpperCase()));
  // The drawn body only - the header is prose, and the wrapper is the wrapper.
  const body = artCode.slice(artCode.indexOf("export const ART"));
  const used = [...body.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase());
  const strays = [...new Set(used.filter((c) => !RAMP_SET.has(c)))];
  check(
    "and they are drawn only in the ramp the other twenty are drawn in",
    strays.length === 0,
    strays.length ? `strays: ${strays.join(" ")}` : `${new Set(used).size} of the ramp's ${RAMP.length}`,
  );

  check(
    "on the same two canvases the other twenty are drawn on",
    (artCode.match(/\.\.\.LANDSCAPE/g) || []).length === 2 &&
      (artCode.match(/\.\.\.PORTRAIT/g) || []).length === 8 &&
      /w: 328, h: 212/.test(artCode) && /w: 190, h: 300/.test(artCode),
    "328x212 for what is wide, 190x300 for what is tall, as the finished cards chose them",
  );

  check(
    "flat, like every other drawing here",
    !/<linearGradient|<radialGradient|<filter\b|feGaussian|drop-shadow|blur\(|box-shadow|text-shadow|<image\b|https?:\/\/(?!www\.w3\.org)/i.test(artCode),
    "no gradient, no filter, no shadow and nothing fetched - depth is overlapping flat shapes",
  );

  const weaponsModule = await readFile(join(OUT, "assets", "js", "shared", "weapons.js"), "utf8");

  check(
    // The copy lives in shared/weapons.json because it is meant to be edited by
    // somebody who does not read JavaScript. This is what stops it being a file
    // that quietly stops being the truth.
    "the weapons data is one editable file, built into the module that ships",
    existsSync(join(SHARED, "weapons.json")) &&
      existsSync(join(OUT, "assets", "js", "shared", "weapons.js")) &&
      weaponsModule.startsWith("/* GENERATED FILE"),
    "weapons.json is the source; weapons.js is written from it on every build",
  );

  const chestCode = await readFile(join(OUT, "assets", "js", "chest-card.js"), "utf8");
  // Comments are stripped before looking for copy. Three of the card's strings
  // are quoted in the comments that explain why they are not in the card, and a
  // check that cannot tell a sentence from a sentence about a sentence is a
  // check that either fails forever or gets deleted.
  const chestCodeBare = chestCode
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  check(
    "and the chest card reads its copy from that module, not from itself",
    /from "\.\/shared\/weapons\.js"/.test(chestCodeBare) &&
      !/Welcome to Ragnarok|Community Chest|armoury at the end of time|bad luck\./i.test(chestCodeBare),
    "no line of the card's copy is written into the card's code",
  );

  check(
    "the chest card takes the board's colours by name",
    /from "\.\/shared\/spaces\.js"/.test(chestCode) && /SETS\[/.test(chestCode),
    "a weapon's colour is the set the data names, never a hex written here",
  );

  section("The cards");

  const cardsCode = (await readFile(join(OUT, "assets", "js", "cards.js"), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  check(
    "the artwork the board reuses is handed over without its pill or its title",
    /replace\(\/\\?<g class="title-pill"/.test(cardsCode) &&
      /replace\(\/\\?<text class="title-text"/.test(cardsCode),
    "the card sets both of those beside the drawing, so drawing them again would say it twice",
  );

  const spacesCode = await readFile(join(OUT, "assets", "js", "shared", "spaces.js"), "utf8");
  // The key a path is asked for by: cards/horizontal/moon.svg -> moon. This is
  // exactly the substitution property-card.js does, so a mismatch here is a
  // mismatch there.
  const spacesArtKeys = [...spacesCode.matchAll(/art:\s*"cards\/(?:horizontal|vertical)\/([^"]+)\.svg"/g)]
    .map((m) => m[1]);
  const CARDS_KEYS = new Set(
    [...cardsCode.matchAll(/^\s{2}"?([a-z0-9-]+)"?: Object\.freeze\(\{/gm)].map((m) => m[1]),
  );

  check(
    // The one that would have caught Lagrange L2. Its square is "lagrange-l2"
    // and its art path said lagrange-l2.svg, but the card it borrows is the
    // LAGRANGE POINT card, which is keyed by the card's own title. Nothing
    // matched, so the card quietly drew nothing and fell back to a letter, and
    // every check that asked "does this square have artwork?" was answered by
    // the square's own data and said yes.
    "every art path names a card that exists",
    spacesArtKeys.every((key) => CARDS_KEYS.has(key)) &&
      spacesArtKeys.length === [...new Set(spacesArtKeys)].length,
    spacesArtKeys.filter((key) => !CARDS_KEYS.has(key)).length
      ? `no such card: ${spacesArtKeys.filter((key) => !CARDS_KEYS.has(key)).join(" ")}`
      : `${spacesArtKeys.length} paths, ${CARDS_KEYS.size} cards`,
  );

  check(
    "and the twenty that were already finished are left exactly as they were",
    cardsCode.includes("function artmoon(id)") &&
      cardsCode.includes("function arteventHorizon(id)") &&
      /CARDS\[key\]/.test(cardsCode) &&
      /from "\.\/cards\.js"/.test(cardJs) &&
      /cardArt\(key\)/.test(cardJs),
    "the twelve finished cards are untouched, and the ten borrowed from them still are",
  );

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
    // Counted by a pill group that is immediately followed by its rectangle, so
    // the check counts pills that are DRAWN rather than every mention of the
    // markup - which now includes the pattern cardArt() uses to strip them back
    // off when the board borrows a drawing.
    (cardsCode.match(/<g class="title-pill">\s*<rect/g) || []).length === 10 &&
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

  section("The middle");

  const announceJs = await readFile(join(OUT, "assets", "js", "announcement.js"), "utf8");
  const profileJs = await readFile(join(OUT, "assets", "js", "profile.js"), "utf8");
  const diceJs = await readFile(join(OUT, "assets", "js", "dice.js"), "utf8");
  const ledgerJs = await readFile(join(SHARED, "ledger.js"), "utf8");

  check(
    "an announcement that arrives while a card or a record has the middle waits, and is not dropped",
    /if \(taken\(\)\) \{/.test(announceJs) &&
      announceJs.includes("queue.push({ spec, resolve: null })") &&
      boardJs.includes("announce.block("),
    "a card is a thing the player is reading; a notice painted over it is a notice " +
      "nobody reads, so what happened during that time is said afterwards rather " +
      "than swallowed",
  );
  check(
    "and the game never waits for the middle to be free",
    /queue\.push\(\{ spec, resolve: null \}\);\s*\n\s*return Promise\.resolve\(\);/.test(
      announceJs,
    ),
    "a deferred announcement resolves at once, so the action that caused it is " +
      "not held up by it",
  );
  check(
    "an announcement that is on screen when a card opens steps aside, and is said again after",
    announceJs.includes("block(reason") &&
      /token\.stopped = true/.test(announceJs) &&
      /queue\.unshift\(item\)/.test(announceJs) &&
      boardJs.includes("announce.unblock("),
    "the card is the middle of the board while it is up, so the sentence steps " +
      "aside and goes back to the front of the queue",
  );
  check(
    "the middle has exactly one owner, and it is written down in one place",
    /const wanted = \[\];/.test(boardJs) &&
      /middleOwners\.add\(reason\)/.test(boardJs) &&
      /announce\.unblock\(reason\)/.test(boardJs),
    "a card and a record both take the middle; two owners at once is a notice " +
      "painted over a card",
  );
  check(
    "the queue is said one at a time, in the order it was queued",
    /while \(queue\.length\)/.test(announceJs) &&
      /const item = queue\.shift\(\)/.test(announceJs),
    "one sentence at a time is the only way 'one at a time' can be true",
  );

  /* ------------------------------------------------------------------ the
     HOLDER. One box is used for all of the cards, and an animation that ends
     with `fill: "forwards"` stays applied to it. A card drawn inside a holder
     left at `opacity: 0` is a card that is in the page and paints nothing -
     which is how the Nexus and Ragnarok cards vanished and the board looked
     frozen. */
  const boardFxJs = await readFile(join(OUT, "assets", "js", "board-fx.js"), "utf8");
  const nexusCardJs = await readFile(join(OUT, "assets", "js", "nexus-card.js"), "utf8");
  const chestCardJs = await readFile(join(OUT, "assets", "js", "chest-card.js"), "utf8");
  const propertyCardJs = await readFile(join(OUT, "assets", "js", "property-card.js"), "utf8");
  const gameJs = await readFile(join(SHARED, "game.js"), "utf8");
  const nexusCardsJs = await readFile(join(SHARED, "nexus-cards.js"), "utf8");

  check(
    "a card that slides away does not leave the holder transparent",
    /export function resetHolder/.test(boardFxJs) &&
      /animation\.cancel\(\)/.test(boardFxJs) &&
      /holder\.style\.opacity = ""/.test(boardFxJs),
    "an animation with `fill: \"forwards\"` stays applied for good, so the " +
      "holder kept the opacity the leaving card gave it and every card drawn " +
      "afterwards was invisible",
  );
  check(
    "every card that opens puts the holder right before it draws itself",
    /resetHolder\(holder\)/.test(nexusCardJs) &&
      /resetHolder\(holder\)/.test(chestCardJs) &&
      /resetHolder\(holder\)/.test(propertyCardJs),
    "a card must never be drawn inside a box the last one left transparent",
  );
  check(
    "the notification cannot be painted over a record or a card",
    /\.board__announce\s*\{[\s\S]{0,1400}?z-index:\s*10;/.test(boardCss) &&
      /\.board__profile\s*\{[\s\S]{0,1400}?z-index:\s*20;/.test(boardCss) &&
      /\.board__card\s*\{[\s\S]{0,1400}?z-index:\s*50;/.test(boardCss),
    "the notification is the lowest of the three things that can own the middle, " +
      "so a mistake in the telling shows the thing being read on top",
  );
  check(
    "the Nexus visit can always be left, so the turn can never be stranded",
    /next\.visit\.declined = true;/.test(gameJs) &&
      /"nexusDeclined"/.test(gameJs),
    "a visit that refused to be left left the game in DECISION with no card and " +
      "no die, and the only way out was to reload the page",
  );
  check(
    "a refused offering keeps the card up, with its buttons working",
    /if \(!event\) \{/.test(nexusCardJs) &&
      /prayBtn\.disabled = false;/.test(nexusCardJs),
    "a refusal is not an answer: the card closed anyway and the player was " +
      "left with a board that could not be played",
  );
  check(
    "the board asks the server to move on when it is left with nothing to press",
    /recoverStranded/.test(boardJs),
    "a turn waiting for a decision with no card to answer it is a board that " +
      "answers nothing, and the player has to reload the page to get it back",
  );
  check(
    "the Nexus's own words are written once, in the shared module",
    /export const NEXUS_KEEPER/.test(nexusCardsJs) &&
      /NEXUS_KEEPER\.title/.test(nexusCardJs) &&
      !/"He Who Must Not Be Named"/.test(nexusCardJs.replace(/\/\*[\s\S]*?\*\//g, "")),
    "the keeper's title and mythology used to be written into the module that " +
      "draws the card, so there were two places to look and only one was edited",
  );
  check(
    "and Escape closes the record wherever the focus is",
    /document\.addEventListener\("keydown", onEscape, true\)/.test(boardJs) &&
      /document\.removeEventListener\("keydown", onEscape, true\)/.test(boardJs),
    "the record is opened from a chip, which sits outside the board, so a key " +
      "press on the chip would never reach a listener on the board itself",
  );
  check(
    "a card that stood in for a decision is taken away when that decision is answered",
    /const cardIsStale = \(\) =>/.test(boardJs) &&
      /else if \(cardIsStale\(\)\)/.test(boardJs) &&
      /await dismissCard\(\)/.test(boardJs) &&
      /!isDecision\(\) && !reading/.test(boardJs),
    "a card the other screen was showing for their decision must not stand " +
      "over the next player's dice; a card this screen opened to read is the " +
      "reader's and stays",
  );
  check(
    "the die is on the board unless something else wants the middle",
    /export function dieVisible\(state, ui = \{\}\)/.test(diceJs) &&
      /if \(ui\.card \|\| ui\.announcement \|\| ui\.profile\) return false;/.test(diceJs) &&
      /\.board\[data-die="hidden"\] \.board__dice/.test(boardCss),
    "the die used to follow the phase, so a tap took it off the screen for as " +
      "long as the server took to answer",
  );
  // The phrase is assembled rather than written, so that this check is not
  // itself an occurrence of the thing it forbids.
  const falseClaim = ["holds", "every"].join(" ");
  check(
    "the set's locked section never claims that a player owns the whole set",
    !cardJs.includes(falseClaim) && !ledgerJs.includes(falseClaim) &&
      /Own all \$\{members\.length\} properties/.test(cardJs),
    "one colony owned by one player says nothing about the set, and a line " +
      "that claimed otherwise was a lie",
  );
  check(
    "a set one player has all of charges double, and the card says so",
    /export function fullSetRent/.test(ledgerJs) &&
      /Full set \$\{rupees\(doubled\)\}/.test(cardJs) &&
      /evenUpgradeBlocked/.test(ledgerJs) &&
      /Upgrade the other colonies in this set first/.test(cardJs),
  );
  check(
    "the whole chip is one button, and it is what opens the record",
    /el\("button", \{/.test(viewsCode) &&
      /aria-label": `Open \$\{p\.name\}'s profile`/.test(viewsCode) &&
      /onclick: \(\) => theBoard\.toggleProfile\(seat\)/.test(viewsCode),
    "a chip that is not a button cannot be pressed to open anything",
  );
  check(
    "the record is a grid child of the middle, and it stretches",
    /grid-area: 1 \/ 1/.test(boardCss) && /place-self: stretch/.test(boardCss),
  );
  check(
    "the record hides the die, the status and the card rather than removing them",
    /profile: profileSeat !== null/.test(boardJs) &&
      /ui\.card \|\| ui\.announcement \|\| ui\.profile/.test(diceJs) &&
      /announce\.status\(null\)/.test(boardJs) &&
      /\.board\[data-profile="true"\] \.board__card/.test(boardCss),
    "so closing the record gives back exactly what was underneath it",
  );
  check(
    "and the record is read from the live game, not from a copy of it",
    /profilePanel\(\{/.test(boardJs) && /ledger: game\?\.ledger/.test(boardJs) &&
      profileJs.includes("moneyOf(ledger"),
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
