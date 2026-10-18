/* ==========================================================================
   WHOSE TURN

   A local counter, and the tests are mostly about the two ways it can be wrong:
   advancing when the die has not landed yet, and naming a player who is not
   playing. The honesty of it - that it is local, and says so - is checked too,
   because a comment can rot and a comment that rots is worse than none.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import { turnPill, turnLabel } from "../authored/samrajya/assets/js/turn.js";
import { DICE_FACES } from "../authored/samrajya/assets/js/dice.js";

/** The smallest thing `el` will hand back that the pill can live on. */
function fakeEl(tag, props = {}, children = []) {
  return {
    tagName: tag.toUpperCase(),
    props,
    children,
    dataset: {},
    _text: "",
    get textContent() {
      return this._text;
    },
    set textContent(value) {
      this._text = value;
    },
    get hidden() {
      return Boolean(this.props.hidden);
    },
    set hidden(value) {
      this.props.hidden = value;
    },
  };
}

// turn.js takes its element factory as an argument - the same seam the die's
// roll has for its clock - so the rule can be tested without a document.
const roster = (...names) =>
  names.map((name, i) => ({ name, civ: `civ-${i}`, seat: i, joined: true }));

const pill = (...args) => turnPill(...args, fakeEl);

test("the label is a possessive, with a real apostrophe", () => {
  assert.equal(turnLabel("Sam"), "Sam\u2019s turn");
  // A straight quote would read as a typo on a board that is otherwise typographic.
  assert.equal(turnLabel("Sam").includes("'"), false);
});

test("a name ending in s still takes a plain apostrophe", () => {
  assert.equal(turnLabel("James"), "James\u2019s turn");
});

test("with nobody playing, there is no turn to name", () => {
  const turn = pill([]);
  assert.equal(turn.node.hidden, true);
  assert.equal(turn.node.textContent, "");
  // And it stays quiet rather than inventing one when something moves.
  turn.next();
  assert.equal(turn.node.hidden, true);
  assert.equal(turn.node.textContent, "");
});

test("a player who has not chosen a name is not playing", () => {
  const turn = pill([{ name: null }, { name: "Smith" }, { name: "" }]);
  assert.equal(turn.node.hidden, false);
  assert.equal(turn.node.dataset.name, "Smith");
});

test("the first player in the roster has the first turn", () => {
  const turn = pill(roster("Sam", "Smith"));
  assert.equal(turn.node.textContent, "Sam\u2019s turn");
  assert.equal(turn.node.dataset.turn, "0");
  assert.equal(turn.node.dataset.name, "Sam");
});

test("every throw hands it to the next player, and it wraps", () => {
  const turn = pill(roster("Sam", "Smith"));
  const shown = () => turn.node.textContent;

  // Written as a table rather than as a run of calls, because counting "and
  // then two more" by eye is how this went wrong the first time.
  const expected = [
    "Sam\u2019s turn",   // before anything is thrown
    "Smith\u2019s turn", // one throw
    "Sam\u2019s turn",   // two
    "Smith\u2019s turn", // three
    "Sam\u2019s turn",   // four - back to the start, and round again
  ];
  for (const want of expected) {
    assert.equal(shown(), want);
    turn.next();
  }
});

test("three players take three turns each, in order", () => {
  const turn = pill(roster("Sam", "Smith", "Alex"));
  const seats = [turn.node.dataset.turn];
  for (let i = 0; i < 6; i += 1) {
    turn.next();
    seats.push(turn.node.dataset.turn);
  }
  assert.deepEqual(seats, ["0", "1", "2", "0", "1", "2", "0"]);
});

test("one player alone keeps the turn, which is the honest answer", () => {
  const turn = pill(roster("Sam"));
  for (let i = 0; i < 5; i += 1) {
    turn.next();
    assert.equal(turn.node.textContent, "Sam\u2019s turn");
  }
});

test("it is announced when it changes, and is not a control", () => {
  const turn = pill(roster("Sam", "Smith"));
  assert.equal(turn.node.props["aria-live"], "polite");
  // The stylesheet makes it inert; this is only confirming it is not a button.
  assert.notEqual(turn.node.tagName, "BUTTON");
});

test("no roster at all is still a board", () => {
  // board() is called with no arguments by anything that has not got players.
  const turn = pill(undefined);
  assert.equal(turn.node.hidden, true);
});

test("the six faces are still the six faces - the turn did not touch them", () => {
  assert.deepEqual(DICE_FACES, [1, 2, 3, 4, 5, 6]);
});
