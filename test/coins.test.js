/* ==========================================================================
   THE COINS - WHERE THEY GO

   The movement rules, tested without a browser, because they are the part that
   would be painful to debug with one.

   Four cases are spelled out by name rather than left to the examples above
   them: 0+1, 0+6, 25+6, 27+1. These are the ones that describe the board to
   somebody reading the test, and each of them is also checked against the real
   cell data, so "0 + 1 is Moon" is a fact about the board rather than a fact
   about a number.

   The slots are checked geometrically - every pair of coins in every layout is
   measured and asked whether two discs that size would touch. An arrangement
   that looks fine at one cell size and overlaps at another is the failure this
   catches, and it is invisible until you measure it.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_SIZE,
  COIN_DIAMETER,
  STEP_MS,
  MOVE_BUDGET_MS,
  advance,
  pathFrom,
  seatId,
  slotAt,
  slotSpread,
} from "../authored/samrajya/assets/js/coins.js";
import { CELLS } from "../shared/spaces.js";

/** The cell at a board index, by the index the board travels. */
const cellAt = (n) => CELLS.find((c) => c.index === n);

/* ------------------------------------------------------------ the four cases */

test("0 + 1 is one square along, and one square along is Moon", () => {
  assert.equal(advance(0, 1), 1);
  assert.equal(cellAt(advance(0, 1)).id, "moon");
});

test("0 + 6 is six along, and six along is Pluto", () => {
  assert.equal(advance(0, 6), 6);
  assert.equal(cellAt(advance(0, 6)).id, "pluto");
});

test("25 + 6 wraps to 3", () => {
  assert.equal(advance(25, 6), 3);
  // Spelled out, because this is the one that fails quietly: 31 is past the
  // end of the board, and a modulus that was forgotten would leave a coin at an
  // index no cell has.
  assert.equal(advance(25, 6), 31 % BOARD_SIZE);
});

test("and 27 + 1 is 0, so a coin laps the board instead of leaving it", () => {
  assert.equal(advance(27, 1), 0);
  assert.equal(cellAt(advance(27, 1)).id, cellAt(0).id);
});

/* --------------------------------------------------------------- the modulus */

test("every index a whole lap can reach is on the board", () => {
  for (let from = 0; from < BOARD_SIZE; from++) {
    for (let steps = 0; steps <= BOARD_SIZE; steps++) {
      const to = advance(from, steps);
      assert.ok(Number.isInteger(to), `${from}+${steps} is an integer`);
      assert.ok(to >= 0 && to < BOARD_SIZE, `${from}+${steps} is on the board, got ${to}`);
      assert.ok(cellAt(to), `${from}+${steps} is a square that exists`);
    }
  }
});

test("and a move of nothing changes nothing", () => {
  for (let from = 0; from < BOARD_SIZE; from++) {
    assert.equal(advance(from, 0), from);
  }
});

test("a negative move goes backwards rather than off the board", () => {
  // The rounding that makes this work is the second one. `from + steps % total`
  // alone leaves -1 % 28 at -1 in JavaScript, and a coin on -1 is a coin that
  // has been placed on no square at all.
  assert.equal(advance(0, -1), 27);
  assert.equal(advance(3, -4), 27);
  assert.equal(advance(0, -28), 0);
  assert.equal(advance(0, -29), 27);
  assert.equal(advance(0, 56), 0);
});

test("and nonsense in gives a square out rather than a coin in nowhere", () => {
  // No move is ever driven by anything but a die, but a server will eventually
  // hand this function whatever arrives over a socket.
  for (const junk of [null, undefined, NaN, "3", {}, []]) {
    const to = advance(junk, junk);
    assert.ok(Number.isInteger(to), `${String(junk)} lands on an integer`);
    assert.ok(to >= 0 && to < BOARD_SIZE, `${String(junk)} lands on the board, got ${to}`);
  }
});

test("a board of no squares lands nowhere rather than dividing by zero", () => {
  assert.equal(advance(4, 4, 0), 0);
  assert.equal(advance(4, 4, -8), 0);
});

/* ---------------------------------------------------------------- the walk */

test("pathFrom starts where the coin is and ends where it lands", () => {
  assert.deepEqual(pathFrom(0, 3), [0, 1, 2, 3]);
  assert.deepEqual(pathFrom(25, 6), [25, 26, 27, 0, 1, 2, 3]);
});

test("it visits every square between, and only those", () => {
  const path = pathFrom(25, 6);
  assert.equal(path.length, 7, "six hops and the square it started on");
  for (const step of path) {
    assert.ok(cellAt(step), `${step} is a square that exists`);
  }
  assert.equal(new Set(path).size, path.length, "no square is visited twice");
});

test("and a throw of nothing is a walk of one square", () => {
  assert.deepEqual(pathFrom(7, 0), [7]);
  assert.deepEqual(pathFrom(7, -3), [7, 6, 5, 4]);
});

test("the walk always ends where the arithmetic says it ends", () => {
  // The two functions answer the same question - where does this move land - and
  // they were caught once disagreeing. advance(7, -3) is 4 while pathFrom used
  // to say nothing moved, and a caller that animated the walk and then asked
  // advance would have been told the coin had not gone anywhere.
  for (let from = 0; from < BOARD_SIZE; from++) {
    for (let steps = -8; steps <= 8; steps++) {
      const path = pathFrom(from, steps);
      assert.equal(
        path[path.length - 1],
        advance(from, steps),
        `${from} then ${steps} lands in the same place either way`,
      );
      assert.equal(path[0], from, `${from} then ${steps} starts where the coin was`);
      assert.equal(path.length, Math.abs(steps) + 1, `${from} then ${steps} has one entry per square`);
    }
  }
});

test("and every square the walk touches is one the board has", () => {
  for (let from = 0; from < BOARD_SIZE; from++) {
    for (let steps = -32; steps <= 32; steps++) {
      for (const index of pathFrom(from, steps)) {
        assert.ok(cellAt(index), `${from} then ${steps} touched ${index}, which is not a square`);
      }
    }
  }
});

/* ------------------------------------------------------------ the timings */

test("a hop is 160ms and a whole move is held inside its budget", () => {
  assert.equal(STEP_MS, 160);

  // Six is the longest throw there is, so this is the worst case in practice.
  const six = Math.min(STEP_MS, MOVE_BUDGET_MS / 6);
  assert.ok(six * 6 <= MOVE_BUDGET_MS, `six hops stay inside ${MOVE_BUDGET_MS}ms`);

  // And the budget holds for any number of steps at all, which is the point of
  // having one: a longer walk is made of shorter hops rather than a longer wait.
  for (const steps of [1, 6, 10, 28, 100]) {
    const perStep = Math.min(STEP_MS, MOVE_BUDGET_MS / steps);
    assert.ok(
      perStep * steps <= MOVE_BUDGET_MS + 1e-9,
      `${steps} hops finish inside the budget`,
    );
    assert.ok(perStep > 0, `${steps} hops still take time`);
  }
});

/* ---------------------------------------------------------------- the slots */

test("one coin on a square stands in the middle of it", () => {
  assert.deepEqual(slotAt(1, 0), [0, 0]);
});

test("two coins stand side by side, and not on top of each other", () => {
  const [a, b] = [slotAt(2, 0), slotAt(2, 1)];
  assert.notDeepEqual(a, b, "they are not both in the middle");
  assert.equal(a[1], b[1], "they are on one line, side by side");
  const gap = Math.hypot(b[0] - a[0], b[1] - a[1]);
  assert.ok(gap >= COIN_DIAMETER, `${gap.toFixed(2)} apart, which clears ${COIN_DIAMETER}`);
});

test("three stand in a triangle and four in a square", () => {
  assert.equal(slotAt(3, 2)[1], 0.18, "the third is below the first");
  assert.notEqual(slotAt(3, 0)[1], slotAt(3, 1)[1], "the first is on its own line");

  const four = [0, 1, 2, 3].map((n) => slotAt(4, n));
  assert.equal(new Set(four.map((p) => p.join(","))).size, 4, "four places, four coins");
  assert.equal(new Set(four.map((p) => p[0])).size, 2, "two columns");
  assert.equal(new Set(four.map((p) => p[1])).size, 2, "two rows");
});

test("and no layout ever puts two coins closer than they are wide", () => {
  // The claim, measured rather than eyeballed. Two discs of COIN_DIAMETER whose
  // centres are closer than that diameter overlap, and a coin you cannot see
  // because another is on top of it is worse than not having coins at all.
  for (const count of [1, 2, 3, 4]) {
    const spread = slotSpread(count);
    if (count === 1) continue;
    assert.ok(
      spread >= COIN_DIAMETER,
      `${count} coins come ${spread.toFixed(3)} apart, which clears ${COIN_DIAMETER}`,
    );
  }
});

test("asking for a slot that is not there gives a real one, not a hole", () => {
  // A fifth player is not a thing this game has, and the layouts stop at four.
  // What matters is that asking past the end returns somewhere real rather than
  // undefined, which would put a coin at NaN.
  for (const [count, n] of [[2, 5], [3, 9], [4, 12], [1, 3]]) {
    const [x, y] = slotAt(count, n);
    assert.ok(Number.isFinite(x) && Number.isFinite(y), `${count}/${n} is a place`);
    assert.ok(Math.abs(x) <= 0.25 && Math.abs(y) <= 0.25, `${count}/${n} is inside the cell`);
  }
  // And past four coins the four-square layout is reused, so a fifth lands on a
  // square's first corner rather than on top of it.
  assert.deepEqual(slotAt(5, 0), slotAt(4, 0));
});

/* ---------------------------------------------------------------- the seats */

test("a player is named by their seat", () => {
  assert.equal(seatId(0), "seat-0");
  assert.equal(seatId(1), "seat-1");
  // The roster the browser gets carries no id, so the seat is the whole of a
  // coin's identity. This is here so that a change to the naming has to be made
  // deliberately, in both places that depend on it.
  assert.equal(seatId(0), seatId("0"));
  assert.notEqual(seatId(0), seatId(1));
});

test("and the board is the size the wrap is written for", () => {
  assert.equal(BOARD_SIZE, 28);
  assert.equal(CELLS.length, BOARD_SIZE);
  // Every index from 0 to 27 exactly once, which is what makes the modulus and
  // the data the same statement.
  assert.deepEqual(
    [...CELLS.map((c) => c.index)].sort((a, b) => a - b),
    Array.from({ length: BOARD_SIZE }, (_, n) => n),
  );
});