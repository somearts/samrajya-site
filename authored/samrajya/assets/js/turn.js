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
 * The turn pill, and a way to put it on a seat.
 *
 * It draws nothing and decides nothing. `set(seat)` is called with the game's
 * own active seat and writes the name it belongs to; `hide()` is for the two
 * phases where a throw cannot happen and the line would be a lie. The game is
 * the only thing that moves the turn, and this is only where that fact is
 * written down on screen.
 */
export function turnPill(players = [], make = el) {
  const roster = players || [];

  const node = make("p", {
    class: "board__turn",
    // Announced when it changes, so a screen reader is told the turn passed
    // rather than having to go looking for it.
    "aria-live": "polite",
  });

  const set = (seat) => {
    const player = roster[Number(seat)];
    if (!player || !player.name) {
      node.hidden = true;
      return null;
    }
    node.textContent = turnLabel(player.name);
    // Which seat is playing, read by the checks rather than by eye.
    node.dataset.turn = String(seat);
    node.dataset.name = player.name;
    node.hidden = false;
    return player.name;
  };

  const hide = () => {
    node.hidden = true;
  };

  set(0);

  return { node, set, hide };
}