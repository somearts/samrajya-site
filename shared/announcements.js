/* ==========================================================================
   SAMRAJYA - WHAT AN ACTION SAYS

   The words of the big announcement, and nothing else.

   One event reaches two phones, and the two people did not do the same thing:
   a rent is paid on one and received on the other. So the copy is a function
   of the event *and the viewer*, and both devices read the same event while
   printing their own sentence. Nothing here draws, and nothing decides whether
   an event happened - it is a pure table of words over shared/economy.js, so a
   plain node test can read it.

   A null answer means "no announcement": the movement, the landing highlight,
   the chest reveal and the turn banner all have their own voice and do not
   need a second one on top of them.
   ========================================================================== */

import { rupees } from "./economy.js";
import { nameOfSeat } from "./ledger.js";
import { propertyFor } from "./properties.js";

const MINUS = "\u2212";
const PLUS = "+";

/** The name a square goes by, or its id if it somehow has none. */
function squareName(id) {
  return propertyFor(id)?.name || String(id || "");
}

/** A sum with its sign in front: +₹120, −₹200. */
export function signed(amount) {
  const value = Math.trunc(Number(amount) || 0);
  return `${value < 0 ? MINUS : PLUS}${rupees(Math.abs(value))}`;
}

/**
 * The announcement an event deserves, worded for one viewer.
 *
 * `viewer` is a seat, or null when nobody in particular is looking. `ledger`
 * supplies the names the sentences use; without it the sentences still read,
 * with "Someone" in the places a name would go.
 */
export function announcementFor(event, { viewer = null, ledger = null } = {}) {
  if (!event || typeof event.type !== "string") return null;
  const mine = viewer === null || viewer === undefined ? null : Number(viewer);
  const nameOf = (seat) => nameOfSeat(ledger, seat) || "Someone";

  switch (event.type) {
    case "bought":
      return {
        label: "ACQUIRED",
        big: event.name || squareName(event.id),
        sub: signed(-(event.price || 0)),
        seat: event.seat,
        tone: "spend",
      };

    case "sold":
      return {
        label: "SOLD",
        big: squareName(event.id),
        sub: signed(event.payout || 0),
        seat: event.seat,
        tone: "earn",
      };

    case "upgraded":
      return {
        label: "UPGRADED",
        big: event.name || "Upgraded",
        sub: `${signed(-(event.cost || 0))} · rent now ${rupees(event.rent || 0)}`,
        seat: event.seat,
        tone: "spend",
      };

    case "passed":
      return {
        label: "PASSED",
        big: squareName(event.id),
        sub: "Not this time",
        seat: event.seat,
        tone: "plain",
      };

    case "salary":
      return {
        label: "SALARY",
        big: signed(event.amount || 200),
        sub: "Lap complete",
        seat: event.seat,
        tone: "earn",
      };

    case "rentPaid":
    case "rentShort": {
      const received = mine !== null && Number(event.to) === mine;
      const amount = event.type === "rentPaid" ? event.amount || 0 : event.amount || 0;
      const square = squareName(event.id);
      if (received) {
        return {
          label: "RENT RECEIVED",
          big: signed(amount),
          sub: `from ${nameOf(event.from)} · ${square}`,
          seat: event.to,
          tone: "earn",
        };
      }
      return {
        label: "RENT PAID",
        big: signed(-amount),
        sub: `to ${nameOf(event.to)} · ${square}`,
        seat: event.from,
        tone: "spend",
      };
    }

    default:
      return null;
  }
}
