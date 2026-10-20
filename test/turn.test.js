/* ==========================================================================
   WHOSE TURN

   The pill no longer counts a turn of its own. It is told which seat is active
   by the game, and the tests are about the two ways that can be wrong: naming a
   player who is not playing, and going on naming the last player after the seat
   has stopped being valid. The honesty of it - that the turn is the game's, and
   this is only where it is written down - is checked too, because a comment can
   rot and a comment that rots is worse than none.
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
  // And it stays quiet rather than inventing one when the seat is set.
  turn.set(0);
  assert.equal(turn.node.hidden, true);
  assert.equal(turn.node.textContent, "");
});

test("a seat that is not playing is not named", () => {
  const turn = pill([{ name: null }, { name: "Smith" }, { name: "" }]);
  turn.set(0);
  assert.equal(turn.node.hidden, true);
  assert.equal(turn.node.textContent, "");

  turn.set(1);
  assert.equal(turn.node.hidden, false);
  assert.equal(turn.node.dataset.name, "Smith");
  assert.equal(turn.node.dataset.turn, "1");

  turn.set(2);
  assert.equal(turn.node.hidden, true);
});

test("setting the seat names exactly that seat", () => {
  const turn = pill(roster("Sam", "Smith"));
  turn.set(0);
  assert.equal(turn.node.textContent, "Sam\u2019s turn");
  assert.equal(turn.node.dataset.turn, "0");
  assert.equal(turn.node.dataset.name, "Sam");

  turn.set(1);
  assert.equal(turn.node.textContent, "Smith\u2019s turn");
  assert.equal(turn.node.dataset.turn, "1");
});

test("three players can each be named, in any order the game hands them", () => {
  const turn = pill(roster("Sam", "Smith", "Alex"));
  const seats = [];
  for (const seat of [0, 1, 2, 0, 1, 2, 0]) {
    turn.set(seat);
    seats.push(turn.node.dataset.turn);
  }
  assert.deepEqual(seats, ["0", "1", "2", "0", "1", "2", "0"]);
});

test("one player alone keeps the turn, which is the honest answer", () => {
  const turn = pill(roster("Sam"));
  for (let i = 0; i < 5; i += 1) {
    turn.set(0);
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
