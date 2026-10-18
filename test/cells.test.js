/* ==========================================================================
   SAMRAJYA - THE BOARD'S CELLS, TESTED

   The twenty-eight cells are a transcription of shared/board-cells.json, and
   the only thing worth testing about a transcription is that it is faithful.
   These tests compare the data the board draws against the file it was copied
   from, cell by cell and field by field, and then assert the handful of facts
   that the layout depends on being true of the file in the first place.

   Nothing here decides what the board should look like. If board-cells.json
   changes, these tests change with it - which is the point: the file is the
   source of truth and the board is a copy of it.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CELLS,
  CORNER_IDS,
  GRID,
  SETS,
  cellAt,
  cellById,
  cellByIndex,
  census,
  isCorner,
  price,
} from "../shared/spaces.js";

const SOURCE = new URL("../shared/board-cells.json", import.meta.url);
const FIELDS = [
  "index", "col", "row", "type", "id", "name", "lines",
  "set", "color", "art", "chest",
];

test("the cells are the file, cell by cell and field by field", async () => {
  const source = JSON.parse(await readFile(SOURCE, "utf8"));
  assert.equal(CELLS.length, source.cells.length, "a cell has gone missing or been added");
  for (const want of source.cells) {
    const got = cellById(want.id);
    assert.ok(got, `${want.id} is in the file and not on the board`);
    for (const field of FIELDS) {
      assert.deepEqual(got[field], want[field], `${want.id}: ${field} was changed on the way in`);
    }
  }
});

test("the grid is six by ten", async () => {
  const source = JSON.parse(await readFile(SOURCE, "utf8"));
  assert.deepEqual({ ...GRID }, source.grid);
  assert.equal(GRID.cols, 6);
  assert.equal(GRID.rows, 10);
});

test("the sets are the file's, unchanged", async () => {
  const source = JSON.parse(await readFile(SOURCE, "utf8"));
  for (const [id, set] of Object.entries(source.sets)) {
    assert.equal(SETS[id]?.color, set.color, `set ${id} has been recoloured`);
  }
  assert.equal(Object.keys(SETS).length, Object.keys(source.sets).length);
});

/* --------------------------------------------------------------- the ring */

test("there are twenty-eight cells and one grid position each", () => {
  assert.equal(CELLS.length, 28);
  assert.equal(new Set(CELLS.map((c) => c.id)).size, 28, "two cells share an id");
  assert.equal(
    new Set(CELLS.map((c) => `${c.col},${c.row}`)).size,
    28,
    "two cells are sitting on the same square",
  );
});

test("every cell is on the border of the grid, and the middle is not a cell", () => {
  for (const c of CELLS) {
    const onEdge = c.col === 1 || c.col === GRID.cols || c.row === 1 || c.row === GRID.rows;
    assert.ok(onEdge, `${c.id} is at ${c.col},${c.row}, which is not on the ring`);
  }
  // columns 2 to 5 and rows 2 to 9 is the centre: 4 x 8, and nothing in it
  for (let col = 2; col <= 5; col++) {
    for (let row = 2; row <= 9; row++) {
      assert.equal(cellAt(col, row), null, `${col},${row} is the centre and must be empty`);
    }
  }
});

test("the census counts what the file describes", () => {
  assert.deepEqual(census(), {
    total: 28,
    corners: 4,
    properties: 20,
    chests: 4,
    grouped: 20,
    sets: 8,
  });
});

/* -------------------------------------------------------------- the walk */

test("START is the bottom-left corner and index 0", () => {
  const start = cellByIndex(0);
  assert.equal(start.id, "start");
  assert.equal(start.type, "corner");
  assert.equal(start.col, 1);
  assert.equal(start.row, 10);
});

test("one lap is twenty-eight moves, and it closes", () => {
  // A lap is twenty-eight moves, not twenty-seven. The move from the last cell
  // back onto Start is a move like any other, and it is the one that makes this
  // a ring rather than a path - so the walk has to include it. Rows count from
  // the top, so travelling up the left column decreases the row.
  const at = (i) => CELLS[i % CELLS.length];

  const steps = [];
  for (let i = 1; i <= CELLS.length; i++) {
    steps.push(`${at(i).col - at(i - 1).col},${at(i).row - at(i - 1).row}`);
  }

  // Nine up the left column, five across the top, nine down the right column,
  // and five back along the bottom - the fifth of those five is the move that
  // closes the ring, landing on Start from the cell beside it.
  const runs = [];
  for (const d of steps) {
    const last = runs[runs.length - 1];
    if (last && last[0] === d) last[1] += 1;
    else runs.push([d, 1]);
  }
  assert.deepEqual(
    runs,
    [
      ["0,-1", 9],
      ["1,0", 5],
      ["0,1", 9],
      ["-1,0", 5],
    ],
    "four straight runs, nine, five, nine, five, in that order",
  );

  assert.equal(steps.length, 28, "a lap of twenty-eight cells is twenty-eight moves");
  assert.equal(runs.reduce((n, [, k]) => n + k, 0), 28, "and every move belongs to a run");

  // The closure, stated on its own so the ring cannot be broken quietly: the
  // cell before Start is the one to Start's right, on the same row, and the
  // last move of the lap is a step left.
  const beforeStart = at(CELLS.length - 1);
  assert.equal(beforeStart.row, at(0).row, "the cell before Start is on Start's row");
  assert.equal(
    beforeStart.col - at(0).col,
    1,
    "and it is exactly one cell to Start's right",
  );
  assert.equal(steps[27], "-1,0", "so the lap's last move is a step left, into Start");
  assert.ok(
    steps.every((d) => d === "0,-1" || d === "1,0" || d === "0,1" || d === "-1,0"),
    "every move is one cell in a single direction",
  );
});

test("the four corners are where the file says, and are the four named ones", () => {
  const corners = CELLS.filter(isCorner);
  assert.deepEqual(
    corners.map((c) => [c.id, c.col, c.row]).sort(),
    [
      ["akash-core", 6, 1],
      ["marketplace", 6, 10],
      ["omega", 1, 1],
      ["start", 1, 10],
    ],
  );
  assert.deepEqual([...CORNER_IDS].sort(), ["akash-core", "marketplace", "omega", "start"]);
  // and the names are not abbreviated anywhere
  assert.deepEqual(
    corners.map((c) => c.name).sort(),
    ["Black Hole", "Fight", "Outer Space", "Start"],
  );
});

/* ------------------------------------------------------------- the cells */

test("the four chests are chests, and none of them is in a set", () => {
  const chests = CELLS.filter((c) => c.type === "chest");
  assert.deepEqual(chests.map((c) => c.id).sort(), ["epoch", "kronos", "nexus", "ragnarok"]);
  for (const c of chests) {
    assert.equal(c.set, null, `${c.id} is a chest and belongs to no set`);
    assert.equal(c.color, null, `${c.id} is a chest and has no set colour`);
  }
});

test("every property is in a set, and the colour is the set's colour", () => {
  for (const c of CELLS.filter((x) => x.type === "property")) {
    assert.ok(c.set, `${c.id} is a property and belongs to no set`);
    assert.equal(c.color, SETS[c.set].color, `${c.id} is not in its set's colour`);
  }
});

test("every set is still one group, and the layout is written down here", () => {
  for (const id of Object.keys(SETS)) {
    const members = CELLS.filter((c) => c.set === id);
    assert.ok(members.length >= 2, `set ${id} has ${members.length} members`);
    // Still a set: every member carries the set's id and the set's colour, which
    // is what the test above already asserts. What is NOT asserted here is that
    // a set's members are adjacent on the ring.
    //
    // They used to be, and that was the rule until 18 October 2026, when three
    // squares were deliberately swapped - Ragnarok with Asteroid Belt, Nexus
    // with Voyager 1, Kronos with Quasar. Each swap put a chest between two
    // properties of one set, so s2, s4 and s8 are now split and the other five
    // are not. The swap was asked for and the board is drawn from the data, so
    // the data is the record of the layout and this test reports it rather than
    // forbidding it.
    //
    // What is still checked is that a split is SPLIT and not scattered: a set's
    // members all carry its colour and none of them has been renamed or dropped.
    const indexes = members.map((c) => c.index).sort((a, b) => a - b);
    const gaps = indexes.filter((v, i) => i > 0 && v - indexes[i - 1] > 1);
    const squares = members
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((c) => `${c.id}@${c.col},${c.row}`);
    process.stderr.write(
      `    set ${id}: ${indexes.length} members at ${indexes.join(",")}` +
        `${gaps.length ? ` (split, ${gaps.length} gap) - ${squares.join(" ")}` : " (one run)"}\n`,
    );
  }
});

test("labels are one or two short lines, and they are the name in capitals", () => {
  for (const c of CELLS) {
    assert.ok(c.lines.length >= 1 && c.lines.length <= 2, `${c.id} has ${c.lines.length} label lines`);
    for (const line of c.lines) {
      assert.equal(line, line.toUpperCase(), `${c.id}: "${line}" is not in capitals`);
      assert.ok(line.length <= 9, `${c.id}: "${line}" is too long to fit a square cell`);
    }
  }
});

/* ---------------------------------------------------------------- prices */

test("no price has been decided, and that is the answer, not a gap", () => {
  // A null here renders as no price. A made-up number would put a figure on the
  // board that nobody chose, which is worse than an honest blank.
  for (const c of CELLS) {
    assert.equal(price(c), null, `${c.id} has a price nobody set`);
  }
});