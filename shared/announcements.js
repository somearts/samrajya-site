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
   the chest reveal and the persistent turn status all have their own voice and
   do not need a second one on top of them.
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

    case "redemption":
      return {
        label: "REDEMPTION",
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
      /* One sentence for both phones, naming both players. The label and the
         signed figure already say who is looking at it; the line beneath says
         the fact they share, so a rent is never a silent subtraction. */
      const sentence = `${nameOf(event.from)} paid rent to ${nameOf(event.to)}`;
      const short =
        event.type === "rentShort" && event.shortfall > 0
          ? ` \u00b7 short ${rupees(event.shortfall)}`
          : "";
      if (received) {
        return {
          label: "RENT RECEIVED",
          big: signed(amount),
          sub: `${sentence} \u00b7 ${square}${short}`,
          seat: event.to,
          tone: "earn",
        };
      }
      return {
        label: event.type === "rentShort" ? "RENT SHORT" : "RENT PAID",
        big: signed(-amount),
        sub: `${sentence} \u00b7 ${square}${short}`,
        seat: event.from,
        tone: "spend",
      };
    }

    default:
      return null;
  }
}

/**
 * The persistent line in the middle: whose turn it is, and what they are doing.
 *
 * This is a state, not an announcement. It sits there until the state changes,
 * and the announcement layer takes the middle away from it whenever a fact has
 * to be said. The two use the same surface and the same typography, so the
 * board never grows a second little bar saying the same thing in a different
 * voice.
 *
 * The phase names are the strings shared/game.js writes. They are spelled here
 * rather than imported because this module is a word table and importing the
 * rules into it would make a cycle out of a vocabulary.
 */
export function statusFor(game, { viewer = null } = {}) {
  if (!game || game.active === null || game.active === undefined) return null;
  const mine = viewer !== null && viewer !== undefined && Number(game.active) === Number(viewer);
  const name = nameOfSeat(game.ledger, game.active) || "Your opponent";

  if (mine) {
    if (game.phase !== "AWAITING_ROLL") return null;
    return {
      label: "YOUR MOVE",
      big: "Your Turn",
      sub: "Tap the die to roll",
      seat: game.active,
      tone: "turn",
    };
  }

  /* A read-only decision card owns the middle on the watching screen, so the
     status has nothing to add while it is up. */
  if (game.phase === "DECISION") return null;

  return {
    label: "IN PLAY",
    big: "Opponent\u2019s Turn",
    sub: `${name} is playing`,
    seat: game.active,
    tone: "wait",
  };
}
