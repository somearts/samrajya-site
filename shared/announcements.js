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
import { NEXUS_PRAY_COST } from "./nexus-cards.js";
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
      /* DONE ON YOUR OWN SQUARE. Nothing was offered to pass on: the player
         stood on a square that was already theirs, and PASSED would tell them
         they had declined something. The confirmation is that it is theirs. */
      if (event.kind === "own") {
        return {
          label: "ALREADY YOURS",
          big: squareName(event.id),
          sub: "It is already yours",
          seat: event.seat,
          tone: "plain",
        };
      }
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

    case "prayed":
      return {
        label: "OFFERING",
        big: signed(-(event.amount || NEXUS_PRAY_COST)),
        sub: "At the Nexus",
        seat: event.seat,
        tone: "spend",
      };

    /* The card has been CHOSEN. Nothing has moved yet: the money moves when
       the card is turned over, so the middle does not say a number twice. */
    case "nexusDrawn":
      return null;

    /* The card is turned over, and this is where the money moves. */
    case "nexusRevealed": {
      const card = event.card || {};
      const amount = Number(event.amount ?? card.amount) || 0;
      return {
        label: card.name || "Nexus",
        big: signed(amount),
        sub: "The Unnamed Keeper turns a card",
        seat: event.seat,
        tone: amount >= 0 ? "earn" : "spend",
      };
    }

    /* The player left the Nexus without praying and without drawing. Nothing
       moved, and both screens are told so - one sentence, in the middle, and
       the turn carries on. */
    case "nexusDeclined":
      return {
        label: "THE NEXUS",
        big: "Left in peace",
        sub: "The keeper was not approached",
        seat: event.seat,
        tone: "plain",
      };

    case "rentPaid":
    case "rentShort": {
      const received = mine !== null && Number(event.to) === mine;
      const amount = event.amount || 0;
      const square = squareName(event.id);
      /* One sentence for both phones, each naming the other party.

         The payer is told who was paid; the holder is told who paid. Neither
         screen is told a sentence written for the other one, and the amount is
         signed from the point of view of the person reading it. */
      const short =
        event.type === "rentShort" && event.shortfall > 0
          ? ` \u00b7 short ${rupees(event.shortfall)}`
          : "";
      if (received) {
        return {
          label: event.type === "rentShort" ? "RENT SHORT" : "RENT RECEIVED",
          big: signed(amount),
          sub: `from ${nameOf(event.from)} \u00b7 ${square}${short}`,
          seat: event.to,
          tone: "earn",
        };
      }
      return {
        label: event.type === "rentShort" ? "RENT SHORT" : "RENT PAID",
        big: signed(-amount),
        sub: `to ${nameOf(event.to)} \u00b7 ${square}${short}`,
        seat: event.from,
        tone: "spend",
      };
    }

    /* THE FIGHT IS SETTLED.

       One event, two sentences. The one who struck is told what they took;
       the one who was struck is told what they lost; each with the other's
       name, and with what the colony now is - theirs, or his and hers. */
    case "fightResolved": {
      const took = mine !== null && Number(event.to) === mine;
      const lost = mine !== null && Number(event.from) === mine;
      const other = nameOf(took ? event.from : event.to);
      if (took) {
        return {
          label: "CAPTURED",
          big: event.name || squareName(event.id),
          sub: `from ${other} \u00b7 now yours`,
          seat: event.to,
          tone: "earn",
        };
      }
      if (lost) {
        return {
          label: "LOST",
          big: event.name || squareName(event.id),
          sub: `to ${other}`,
          seat: event.from,
          tone: "spend",
        };
      }
      /* A reader who was in neither seat - a third player, or nobody. */
      return {
        label: "CAPTURED",
        big: event.name || squareName(event.id),
        sub: `by ${nameOf(event.to)}`,
        seat: event.to,
        tone: "earn",
      };
    }

    /* The corner is walked away from, or the war has finished being seen and
       the visit is over. Both are the turn's own fact, not a second battle. */
    case "fightLeft":
      return {
        label: "THE FIGHT",
        big: "Left the fight",
        sub: "No weapon spent",
        seat: event.seat,
        tone: "plain",
      };

    case "fightClosed":
      return null;

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

  /* THE STATUS IS A STATE, AND IT IS ONLY TRUE WHILE THE GAME IS WAITING.

     The game is waiting for a throw in one phase only. In every other phase
     the middle belongs to something else: the die is tumbling, a card is up,
     the visit is resolving, or the turn is changing hands. A status painted
     there is a status that is about to be contradicted - which is exactly how
     "your turn" flashed on a screen whose turn had not changed yet, and then
     said the opposite a moment later. */
  if (game.phase !== "AWAITING_ROLL") return null;

  const mine = viewer !== null && viewer !== undefined && Number(game.active) === Number(viewer);
  const name = nameOfSeat(game.ledger, game.active) || "Your opponent";

  if (mine) {
    return {
      label: "YOUR TURN",
      big: "The move is yours",
      sub: "Tap the die to roll",
      seat: game.active,
      tone: "turn",
    };
  }

  return {
    label: "THEIR TURN",
    big: "Opponent is playing",
    sub: `${name} commands the turn`,
    seat: game.active,
    tone: "wait",
  };
}
