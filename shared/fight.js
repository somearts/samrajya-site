/* ==========================================================================
   SAMRAJYA - THE FIGHT

   The rules of the bottom-right corner, and nothing else.

   Fight is where weapons are used. A player who lands there may strike one of
   the other player's colonies with a weapon they carry, and the colony - with
   everything built on it - changes hands. Nothing in here draws, nothing in
   here keeps a clock, and nothing in here decides anything that
   shared/game.js has not already decided: this file answers one question,
   "what is within reach of this weapon?", and it answers it for both the
   server (which validates the strike) and the client (which glows and blinks
   the tiles). One table of facts, two readers, no chance of the two
   disagreeing.
   ========================================================================== */

import { CELLS } from "./spaces.js";
import { IMMUNE, weaponById } from "./weapons.js";
import { ownerOf } from "./ledger.js";

/* --------------------------------------------------------------- the corner */

/** The corner itself, taken from the board's own data and not retyped. */
export const FIGHT = CELLS.find((cell) => cell.id === "fight") || null;

/* --------------------------------------------------------------- the shield */

/**
 * Is this target protected?
 *
 * THE HOOK, AND NOT THE SHIELD ITSELF.

   The game has no shields. It may one day grow a way for a colony to refuse a
   strike - a ward bought at the Nexus, a holy ground, whatever the corner turns
   into - and a way to refuse has to be ONE question with ONE answer, asked by
   the rule that builds the target list and by nothing else. Today the answer
   is always no: nothing is protected, and the hook says so plainly rather than
   letting every caller guess.
 * @param {object|null} _target - the cell the strike has asked about.
 * @returns {boolean} always false - nothing is protected.
 */
export function isTargetProtected(_target) {
  return false;
}

/* ------------------------------------------------------------ valid targets */

/**
 * The colonies this weapon can reach, owned by this seat's opponent.
 *
 * The rule says three things at once, and they are all intersections:
 *
 *   - the weapon only reaches the colonies written in its own target list;
 *   - a strike can only take a colony the OTHER player holds;
 *   - a colony immune to all weapons is never valid, whatever the list says.
 *
 * AND NOTHING HERE IS PROTECTED: `isTargetProtected` is asked of every
 * candidate, so the day a colony can be warded, the ward arrives in one place.
 *
 * @param {object} ledger      - the game's ledger (who holds what).
 * @param {string} weaponId    - the weapon being asked about.
 * @param {number|null} seat   - the seat asking, whose opponent is looked at.
 * @param {object} [options]
 * @param {number|null} [options.opponentSeat] - the seat being struck, when the
 *   caller knows it. Left out, the opponent is every seat that is not `seat`.
 * @returns {string[]} the colony ids within reach.
 */
export function validTargets(ledger, weaponId, seat, { opponentSeat = null } = {}) {
  const weapon = weaponById(weaponId);
  if (!weapon) return [];

  return weapon.targets.filter((id) => {
    const cell = CELLS.find((entry) => entry.id === id);
    if (!cell) return false;
    if (IMMUNE.includes(id)) return false;
    const holder = ownerOf(ledger, id);
    if (holder === null || holder === undefined) return false;
    if (holder === seat) return false;
    if (
      opponentSeat !== null &&
      opponentSeat !== undefined &&
      holder !== opponentSeat
    ) {
      return false;
    }
    if (isTargetProtected(cell)) return false;
    return true;
  });
}
