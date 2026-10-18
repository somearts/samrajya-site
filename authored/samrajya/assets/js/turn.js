/* ==========================================================================
   SAMRAJYA - WHOSE TURN

   A pill under the die, naming whoever is playing.

   WHAT THIS IS NOT
   ----------------
   It is a LOCAL turn. The turn lives in this browser's memory and nowhere else,
   because the game has no turn yet: the server's room view returns `board: null`
   with the note that the board state "is not written yet", and the socket
   carries nothing but players joining. So there is no shared truth to read, and
   inventing one here would have meant writing a game.

   The consequence is stated plainly because it is not a small one: when Sam
   throws, the pill on Sam's screen moves to Smith. The pill on Smith's screen
   does not, because Smith has not thrown. Two players in one room will see two
   different pills, and that is the honest behaviour of a local counter and not a
   bug to be papered over with a socket that carries the wrong thing.

   THE RULE
   --------
   The first player in the roster has the first turn - which is the seat that
   created the game - and every throw after that hands it on, wrapping at the
   end of the roster. When the roster has one named player, or none, the pill
   stays hidden rather than naming a turn nobody is taking.
   ========================================================================== */

import { el } from "./dom.js";

/** "Sam's turn", with a real apostrophe rather than a straight quote. */
export function turnLabel(name) {
  return `${name}\u2019s turn`;
}

/**
 * The turn pill, and a way to move it on.
 *
 * Returns the element to place on the board plus `next()`, which is what the die
 * calls once it has landed. `players` is the roster as the board already has it,
 * and only the ones with a name count.
 *
 * `make` builds the element and defaults to the project's own; it is the same
 * seam the die's roll has for its clock, and it is here so that the rule above -
 * who plays, in what order, wrapping where - can be tested without a document
 * standing in for one. The rule is the part worth checking.
 */
export function turnPill(players = [], make = el) {
  const named = (players || []).filter((p) => p && p.name);

  const node = make("p", {
    class: "board__turn",
    // Announced when it changes, so a screen reader is told the turn passed
    // rather than having to go looking for it.
    "aria-live": "polite",
  });

  if (named.length === 0) {
    node.hidden = true;
    return { node, next() {} };
  }

  let seat = 0;
  const show = () => {
    const whose = named[seat % named.length];
    node.textContent = turnLabel(whose.name);
    // Which seat is playing, read by the checks rather than by eye.
    node.dataset.turn = String(seat % named.length);
    node.dataset.name = whose.name;
    node.hidden = false;
  };
  show();

  return {
    node,
    /** The throw has landed: the turn goes to the next player. */
    next() {
      seat += 1;
      show();
    },
  };
}