/* ==========================================================================
   SAMRAJYA - THE GAME

   One turn, one state, one pure function. This file is the whole of the rules:
   whose turn it is, what phase that turn is in, what an action may do, and what
   changed when it did.

   WHY THIS IS NOT IN THE BROWSER
   ------------------------------
   `applyAction(state, action, rng)` returns `{ state, events }` and touches no
   DOM, no clock and no global random generator. The browser calls it to play a
   turn; the server will call the SAME function in Phase 2, validate the sender's
   seat, roll the die itself and broadcast the events. There is no second copy of
   the rules to disagree with this one.

   THE PHASES
   ----------
   A turn walks one route and only one route:

       AWAITING_ROLL -> MOVING -> DECISION -> RESOLVING -> TURN_END
                                 -> (next player's AWAITING_ROLL)

   MOVING and RESOLVING are the two halves of "an animation is playing". The UI
   reads the events and animates; the state says what the turn is waiting for.
   DECISION is only entered when the square actually needs an answer: an unowned
   square, your own square, somebody else's square, or Ragnarok. A corner or one
   of the three silent chests highlights and goes straight on.

   NOTHING FLIPS THE ACTIVE PLAYER EXCEPT TURN_END
   -----------------------------------------------
   Every action below leaves `active` exactly where it was. The only branch that
   changes it is `continue` arriving while the phase is TURN_END, which is the
   moment the previous turn has finished animating. That is what stops the die
   area naming the next player while the last player is still deciding.

   EVENTS, NOT DIFFERENCES
   -----------------------
   The UI never compares two states to work out what happened. It is handed the
   events in the order they happened and animates them: `moved` walks a coin,
   `bought` draws a ring, `rentPaid` flies tokens, `turnChanged` sweeps a banner.
   An event carries the numbers the animation needs - who, how much, which square
   - so the UI does not go looking for them in a state that has already moved on.

   A PLAYER IS A SEAT
   ------------------
   The ledger already says this and it stays true here. `active` is a seat, the
   landing is a seat, and every event names a seat. The room's roster is keyed by
   seat, the coins are keyed by seat, and a turn is a seat's turn.

   MONEY AND OWNERSHIP ARE THE LEDGER'S
   ------------------------------------
   This file does not know what a square costs or what rent it carries. It asks
   shared/ledger.js, which asks shared/economy.js. What lives here is flow: whose
   turn, which phase, which action is legal now, and what the visit has already
   spent. One economy, one ledger, one turn.
   ========================================================================== */

import { MAX_UPGRADE, REDEMPTION, STARTING_MONEY, isPriced, priceOf } from "./economy.js";
import {
  adjustMoney,
  buy as ledgerBuy,
  canBuy,
  canUpgrade,
  createLedger,
  levelOf,
  nameOfSeat,
  ownerOf,
  payRent,
  recordEntry,
  redemption as ledgerRedemption,
  rentAt,
  saleValue,
  sell as ledgerSell,
  sheetFor,
  upgrade as ledgerUpgrade,
} from "./ledger.js";
import { FIGHT, isTargetProtected, validTargets } from "./fight.js";
import { NEXUS, NEXUS_PRAY_COST, drawNexusCard } from "./nexus-cards.js";
import { NO_EFFECT, NO_TARGET, drawTimeCard, timeCardById } from "./epoch-cards.js";
import { CELLS } from "./spaces.js";
import {
  BAD_LUCK,
  IMMUNE as IMMUNE_LIST,
  RAGNAROK,
  drawShield,
  drawWeapon,
  shieldById,
  weaponById,
} from "./weapons.js";

export { MAX_UPGRADE, STARTING_MONEY };

/** The Epoch tile, matched from the board's own data rather than retyped. */
const EPOCH = CELLS.find((cell) => cell.id === "epoch") || null;

/** The Kronos tile, matched the same way. */
const KRONOS = CELLS.find((cell) => cell.id === "kronos") || null;

/** How many of the owner's turns a shield stands for, once drawn. */
export const SHIELD_TURNS = 2;

/** The four phases a turn can be in, plus the two animation phases. */
export const PHASE = Object.freeze({
  AWAITING_ROLL: "AWAITING_ROLL",
  MOVING: "MOVING",
  DECISION: "DECISION",
  RESOLVING: "RESOLVING",
  TURN_END: "TURN_END",
});

/** Whether selling is offered at all. One switch, so it can be turned off. */
export const ENABLE_SELL = true;

/** How much of what was paid comes back when a square is sold. */
export const SALE_RATE = 0.5;

/** The board's size, and the wrap a move uses. Mirrors coins.js. */
export const BOARD_SIZE = 28;

/** Where a move of `steps` from `from` ends. The same rule as coins.js. */
export function advance(from, steps, total = BOARD_SIZE) {
  if (!(total > 0)) return 0;
  const start = Number(from) || 0;
  const move = Math.trunc(Number(steps) || 0);
  return (((start + move) % total) + total) % total;
}

/** Every square a move touches, starting where the piece stands. */
export function pathFrom(from, steps, total = BOARD_SIZE) {
  const start = advance(from, 0, total);
  const move = Math.trunc(Number(steps) || 0);
  const path = [start];
  for (let n = 1; n <= Math.abs(move); n += 1) {
    path.push(advance(start + Math.sign(move) * n, 0, total));
  }
  return path;
}

/* ------------------------------------------------------------------ creation */

/**
 * A fresh game, from the room's roster.
 *
 * `players` is what the room already holds - names and civilizations, and a
 * seat each. Money and ownership are built by the ledger; position and weapons
 * belong to the game, because they are facts about a turn rather than about an
 * economy.
 */
export function createGame(players = [], { opening = STARTING_MONEY, testMode = false } = {}) {
  const ledger = createLedger(players, { opening });
  return {
    ledger,
    /* The pieces. One per seat, and the only place a position is kept. */
    pieces: ledger.players.map((player) => ({
      seat: player.seat,
      position: 0,
      weapons: [],
    })),
    phase: PHASE.AWAITING_ROLL,
    active: ledger.players[0]?.seat ?? null,
    testMode,
    /* What the active player landed on, and what this visit has already done.
       Both are cleared when the turn ends. */
    landing: null,
    visit: null,
    lastRoll: null,
    turn: 0,
    /* The chest that is open, or null.

       Ragnarok and Nexus are SHARED screens: they are a fact about the game,
       not a thing one player's browser invented. So the chest lives in the
       state, and every client draws the middle from it. A client that missed a
       message, or that joined late, or that reconnected, reads the same chest
       out of the same state and shows the same screen.

       kind      "ragnarok", "kronos" or "nexus"
       playerId  the seat that is at the chest
       phase     where the chest is in its own little story
       startedAt when it began, so both devices can start their animation at
                 the same moment
       choice    what the player chose ("pray" | "draw")
       result    what the chest produced */
    chest: null,
    /* The fight that is at the bottom-right corner, or null.

       Like the chest, it is a SHARED screen: a fact about the game, living in
       the state, so both devices draw the same Fight from the same fact and
       neither of them needed to be told anything. The player who landed acts;
       the other watches the same screen read-only.

       playerId  the seat that landed
       phase     open -> selected -> armed -> resolving -> result -> done
       selectedWeaponId  the weapon the landing player has chosen
       armed     whether the strike is armed and the tiles are blinking
       targetId  the colony the armed strike is aimed at (set at the strike)
       result    what the strike produced, once there has been one */
    fight: null,
    /* The Epoch visit, or null. Like the chest and the fight it is a SHARED
       screen: a fact about the game, so both devices draw the same middle from
       it and neither needed to be told anything. The player who landed acts.

       playerId  the seat that landed
       phase     open -> revealed (-> choosing, for Alternate Timeline)
       startedAt when it began, so both devices start any animation together
       cardId    the Time Card that was drawn, once it has been
       result    the resolution outcome, once the effect has been applied
       rewindSteps / fracturePos  the genuine stored facts the two movement
                 cards read, captured from the roll that landed here */
    epoch: null,
    /* Pending extra rolls, per seat. Temporal Loop grants one; Time Theft may
       transfer one. Consumed by the next `roll` the seat takes. */
    bonusRolls: { 0: 0, 1: 0 },
    /* The KRONOS SHIELDS standing in this game, as a list of:

         { id, owner, weapon, turnsLeft }

       `weapon` is the ONE weapon the shield answers; `turnsLeft` counts the
       OWNER's turns only, and is spent on a successful block. A shield is
       added when it is drawn at Kronos, ticked at TURN_END, and removed when
       it blocks or expires.

       ONE PER WEAPON, PER PLAYER, AT MOST THREE - the whole of the anti-stacking
       rule, and it is held by the draw itself rather than by a check here: a
       draw never offers a shield the player already stands behind, so a second
       copy cannot be drawn, a shield cannot be refreshed by redrawing it, and
       the list can never hold two entries that answer the same weapon. */
    shields: [],
    /* A Frozen Moment laid on a seat, per seat. One-shot: it cancels a pending
       bonus roll, or nullifies the opponent's next bonus grant within their
       following turn, and is always cleared by the end of that turn. */
    frozen: { 0: false, 1: false },
    /* A Future Sight reservation, per seat: the exact face the next roll must
       produce. Consumed by that roll. */
    futureSight: { 0: null, 1: null },
    /* Accepted actions, in order. Phase 2 numbers actions with this so a
       duplicate arriving over a socket can be ignored rather than replayed. */
    seq: 0,
  };
}

/* --------------------------------------------------------------- wire form */

/**
 * A state that can cross a wire.
 *
 * The ledger's `properties` is a `Map`, which JSON turns into an empty object, so
 * it is written as its entries. `restoreGame` puts it back. Nothing else in a
 * state needs translating: pieces, landing, visit and lastRoll are plain.
 */
export function serializeGame(state) {
  if (!state) return null;
  return {
    ...state,
    ledger: {
      ...state.ledger,
      properties: [...(state.ledger?.properties?.entries?.() || [])],
    },
  };
}

/** The live state, rebuilt from `serializeGame`. */
export function restoreGame(data) {
  if (!data) return null;
  return {
    ...data,
    ledger: {
      ...data.ledger,
      properties: new Map(data.ledger?.properties || []),
    },
  };
}

/* -------------------------------------------------------------------- copies */

/**
 * A state that can be changed without touching the one handed in.
 *
 * Every rule below works on a copy. That is what makes `applyAction` safe to
 * call with the live state and to throw away when it refuses: a refused action
 * returns the original state and nothing has moved.
 */
function cloneGame(state) {
  return {
    ...state,
    ledger: {
      ...state.ledger,
      players: state.ledger.players.map((player) => ({ ...player })),
      properties: new Map(
        [...state.ledger.properties].map(([id, sheet]) => [id, { ...sheet }]),
      ),
      history: [...(state.ledger.history || [])],
    },
    pieces: state.pieces.map((piece) => ({
      ...piece,
      weapons: [...(piece.weapons || [])],
    })),
    landing: state.landing ? { ...state.landing } : null,
    visit: state.visit ? { ...state.visit } : null,
    lastRoll: state.lastRoll ? { ...state.lastRoll } : null,
    chest: state.chest ? { ...state.chest } : null,
    fight: state.fight ? { ...state.fight } : null,
    epoch: state.epoch ? { ...state.epoch } : null,
    shields: (state.shields || []).map((shield) => ({ ...shield })),
    bonusRolls: { ...(state.bonusRolls || { 0: 0, 1: 0 }) },
    frozen: { ...(state.frozen || { 0: false, 1: false }) },
    futureSight: { ...(state.futureSight || { 0: null, 1: null }) },
    testMode: state.testMode,
  };
}

/* ------------------------------------------------------------------- queries */

/** The piece belonging to a seat, or null. */
export function pieceAt(game, seat) {
  return game?.pieces?.find((piece) => piece.seat === seat) || null;
}

/** The seat whose turn it is. */
export function activeSeat(game) {
  return game?.active ?? null;
}

/** The name the active seat goes by. */
export function activeName(game) {
  return nameOfSeat(game?.ledger, game?.active);
}

/** Is the game waiting for an answer about a square? */
export function wantsDecision(game) {
  return game?.phase === PHASE.DECISION;
}

/** The cell the active player is standing on, or null. */
export function landingCell(game) {
  const index = game?.landing?.index;
  if (!Number.isInteger(index)) return null;
  return CELLS.find((cell) => cell.index === index) || null;
}

/** The next seat after this one, wrapping at the end of the roster. */
export function seatAfter(game, seat) {
  const order = game?.ledger?.players?.map((player) => player.seat) || [];
  if (!order.length) return null;
  const at = order.indexOf(seat);
  return order[(at + 1) % order.length];
}

/** The seat this seat is playing against, in the roster order. */
export function opponentOf(game, seat) {
  const order = game?.ledger?.players?.map((player) => player.seat) || [];
  const at = order.indexOf(seat);
  if (at === -1) return null;
  return order[(at + 1) % order.length] ?? null;
}

/**
 * What this visit has done, and what it still may do.
 *
 * The card asks this rather than remembering a flag of its own: one visit is
 * one object, and it is cleared at TURN_END like everything else about a turn.
 */
export function visitOf(game) {
  return game?.visit ? { ...game.visit } : null;
}

/** The Kronos shields standing for a seat, as plain copies. */
export function shieldsOf(game, seat) {
  return (game?.shields || [])
    .filter((shield) => shield.owner === seat)
    .map((shield) => ({ ...shield }));
}

/**
 * May the active player build on this square right now?
 *
 * Three independent reasons can say no, and each says which: the ledger's own
 * rule (not yours, finished, cannot afford), the visit's rule (you bought it
 * this visit), and the one-upgrade-per-landing rule.
 */
export function upgradeOffer(game, id) {
  if (!game) return { ok: false, why: "There is no game." };
  if (game.phase !== PHASE.DECISION || game.landing?.kind !== "own") {
    return { ok: false, why: "Land on this square to upgrade." };
  }
  if (game.landing.id !== id) return { ok: false, why: "You are not on this square." };
  if (game.visit?.bought) return { ok: false, why: "You bought this square this visit." };
  if ((game.visit?.upgrades || 0) >= 1) {
    return { ok: false, why: "One upgrade per visit. Land here again to upgrade." };
  }
  return canUpgrade(game.ledger, id, game.active);
}

/** May this seat sell this square back to the bank now? */
export function sellOffer(game, id, seat = game?.active) {
  if (!ENABLE_SELL) return { ok: false, why: "Selling is closed." };
  if (!game || game.phase !== PHASE.AWAITING_ROLL) {
    return { ok: false, why: "Sell between turns, before you throw." };
  }
  if (seat !== game.active) return { ok: false, why: "It is not your turn." };
  if (ownerOf(game.ledger, id) !== seat) return { ok: false, why: "You do not hold this square." };
  return { ok: true, why: "", payout: saleValue(game.ledger, id) };
}

/* ------------------------------------------------------------------ refusals */

const refused = (state, action, why) => ({
  state,
  events: [
    {
      type: "refused",
      action: action?.type || "",
      seat: state?.active ?? null,
      why,
    },
  ],
});

const event = (seq, type, data = {}) => ({ type, seq, ...data });

/**
 * The clock the shared screens agree on.
 *
 * A chest is opened at a moment, and both devices have to start their
 * animation at the same moment - so the moment is a fact in the state, not
 * something each browser decides for itself. The server is the clock.
 */
const now = () => Date.now();

/* ----------------------------------------------------------------- the rules */

/**
 * Do one thing, and say what happened.
 *
 * The state handed in is never changed. A refusal returns it untouched with a
 * single `refused` event carrying a sentence for the player; an acceptance
 * returns a new state and the events the screen should animate.
 */
export function applyAction(state, action, rng = Math.random) {
  if (!state || !action || typeof action.type !== "string") {
    return refused(state, action, "That is not something the game can do.");
  }

  const next = cloneGame(state);
  const events = [];
  const active = state.active;
  const piece = pieceAt(next, active);
  const actor = action.seat ?? active;

  /* Every accepted action takes the next number, even one that emits no event -
     a `continue` that only changes the phase is still a move the server must be
     able to recognise by its number, so it cannot share a number with the action
     that opened the phase. A refused action returns the original state and the
     number goes with it. */
  next.seq = (state.seq || 0) + 1;

  /* Every accepted action takes the next number, and EVERY event from that
     action carries the same one. One action is one number, however many things
     it caused - that is what lets Phase 2 recognise a duplicate roll without
     mistaking its three events for three actions. */
  let actionSeq = null;
  const ok = (type, data = {}) => {
    if (actionSeq === null) {
      actionSeq = (state.seq || 0) + 1;
      next.seq = actionSeq;
    }
    events.push(event(actionSeq, type, data));
  };

  if (active === null) return refused(state, action, "Nobody is playing.");

  switch (action.type) {
    /* ------------------------------------------------------------- the roll */
    case "roll": {
      if (state.phase !== PHASE.AWAITING_ROLL) {
        return refused(state, action, "The die waits until the visit is over.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (!piece) return refused(state, action, "That seat has no piece.");

      const drawn = Number(rng());
      const rolledFace = 1 + Math.min(5, Math.floor((Number.isFinite(drawn) ? drawn : 0) * 6));
      /* A FUTURE SIGHT reservation is the die now: the number was fixed when
         the card was drawn and it is consumed exactly here, so the visual die,
         the recorded roll and the movement can never disagree. Nothing else
         may change it, and a reload keeps it because it lives in the state. */
      const reserved = state.futureSight?.[active];
      const face = Number.isInteger(reserved) ? reserved : rolledFace;
      const from = piece.position;
      const to = advance(from, face);
      const cell = CELLS.find((entry) => entry.index === to) || CELLS[to];

      /* A roll taken with a bonus (Temporal Loop, or a roll Time Theft moved
         here) is marked so the ledger and the history can tell it apart from
         the ordinary turn roll. It is one ordinary roll; it cannot grant
         another bonus through the same card, because the card is not re-drawn. */
      const bonus = (state.bonusRolls?.[active] || 0) > 0;
      if (Number.isInteger(reserved)) {
        next.futureSight = { ...(state.futureSight || { 0: null, 1: null }), [active]: null };
      }
      if (bonus) {
        next.bonusRolls = { ...(state.bonusRolls || { 0: 0, 1: 0 }), [active]: state.bonusRolls[active] - 1 };
      }

      /* Crossing Start EARNS the Redemption, but does not pay it yet. The
         payment belongs to the end of the turn: a player who crosses Start and
         then lands on a square still has a visit to finish, and a purse that
         rose during the walk would be paying them in the middle of their own
         move. The flag rides on the visit and `continue` pays it at TURN_END. */
      const crossedStart = from > 0 && from + face >= BOARD_SIZE;

      piece.position = to;
      next.lastRoll = {
        seat: active, face, from, to, id: cell?.id || "",
        ...(bonus ? { bonus: true } : {}),
        ...(Number.isInteger(reserved) ? { reserved: "future-sight" } : {}),
      };

      next.landing = {
        seat: active,
        index: to,
        id: cell?.id || "",
        kind: "none",
      };
      next.chest = null;
      next.visit = {
        seat: active,
        bought: false,
        upgrades: 0,
        drawn: null,
        collected: false,
        /* KRONOS ONLY. What the shield draw found: the shield id, the
           sentinel "none" for a draw that found nothing left to offer, or
           null while the chest has not been drawn from - the same three
           states `drawn` holds at Ragnarok. */
        shieldDrawn: null,
        rent: 0,
        paid: false,
        short: 0,
        /* What completing a lap is owed, paid when the turn is resolved. */
        redemption: crossedStart ? REDEMPTION : 0,
        /* Nexus only. */
        prayed: false,
        nexusDrawn: false,
        nexusCard: null,
        /* The player left the Nexus without praying or drawing. */
        declined: false,
      };
      next.phase = PHASE.MOVING;

      ok("moved", {
        seat: active,
        from,
        to,
        steps: face,
        path: pathFrom(from, face),
        face,
      });
      ok("landed", {
        seat: active,
        index: to,
        id: cell?.id || "",
        name: cell?.name || "",
      });

      /* What the square wants. A property is the only kind that can hold a
         decision except Ragnarok; a corner or a silent chest goes straight on
         to RESOLVING and the UI sweeps it away. */
      if (cell?.type === "property" && isPriced(cell.id)) {
        const owner = ownerOf(next.ledger, cell.id);

        if (owner === null) {
          next.landing.kind = "buy";
        } else if (owner === active) {
          next.landing.kind = "own";
        } else {
          next.landing.kind = "rent";
          const verdict = payRent(next.ledger, cell.id, active);
          next.visit.rent = verdict.rent || 0;
          next.visit.paid = Boolean(verdict.paid);
          next.visit.short = verdict.shortfall || 0;

          /* The two sides of one payment, written for the two people who will
             read them. Both devices read the same ledger, so the payer's history
             says what they paid and the holder's says what they received. */
          recordEntry(next.ledger, {
            turn: state.turn,
            seat: active,
            kind: "rent",
            text: `Rent paid to ${nameOfSeat(next.ledger, owner)} · ${cell.name}`,
            amount: -(verdict.amount || 0),
          });
          if ((verdict.amount || 0) > 0) {
            recordEntry(next.ledger, {
              turn: state.turn,
              seat: owner,
              kind: "rent",
              text: `Rent received from ${nameOfSeat(next.ledger, active)} · ${cell.name}`,
              amount: verdict.amount || 0,
            });
          }

          if (verdict.shortfall > 0) {
            /* The payer could not meet the whole rent. They have paid everything
               they hold and the ledger has recorded the rest as a short. This is
               not a refusal and not a penalty: the visit continues exactly as a
               paid rent would, and the notice is the only thing that says the two
               were different. */
            ok("rentShort", {
              id: cell.id,
              from: active,
              to: owner,
              rent: verdict.rent || 0,
              amount: verdict.amount || 0,
              short: verdict.short || 0,
              shortfall: verdict.shortfall || 0,
              payer: verdict.payer,
              holder: verdict.holder,
            });
          } else {
            ok("rentPaid", {
              id: cell.id,
              from: active,
              to: owner,
              amount: verdict.rent || 0,
              payer: verdict.payer,
              holder: verdict.holder,
              rent: rentAt(next.ledger, cell.id),
            });
          }
        }
      } else if (
        cell?.id === RAGNAROK.id ||
        cell?.id === NEXUS.id ||
        (KRONOS && cell?.id === KRONOS.id)
      ) {
        next.landing.kind = "chest";
        /* THE CHEST IS OPENED HERE, IN THE STATE.

           The chest is a shared screen, so it is a fact about the game and not
           a thing one browser invented. It is opened when the coin stops on
           the square, and every client draws the middle from it - so a client
           that missed a message, or that joined late, or that reconnected,
           reads the same chest out of the same state and shows the same
           screen. Nothing about it has to be announced to be seen.

           The phase starts at "open": the chest is there, the acting player
           may press, and the other player is watching. */
        next.chest = {
          kind: cell.id === RAGNAROK.id
            ? "ragnarok"
            : cell.id === NEXUS.id
              ? "nexus"
              : "kronos",
          playerId: active,
          phase: "open",
          startedAt: now(),
          choice: null,
          result: null,
        };
        ok("chestOpened", {
          kind: next.chest.kind,
          seat: active,
          startedAt: next.chest.startedAt,
        });
      } else if (cell?.id === FIGHT.id) {
        /* THE FIGHT IS OPENED HERE, IN THE STATE.

           The corner is a shared screen the same way the two chests are: the
           fact lives in the state, and every client draws the middle from it.
           The player who landed acts; the other player watches the same
           screen read-only. Nothing about it has to be announced to be seen. */
        next.landing.kind = "fight";
        next.fight = {
          playerId: active,
          phase: "open",
          selectedWeaponId: null,
          armed: false,
          targetId: null,
          result: null,
          startedAt: now(),
        };
        ok("fightOpened", { seat: active, startedAt: next.fight.startedAt });
      } else if (EPOCH && cell?.id === EPOCH.id) {
        /* EPOCH OPENS HERE, IN THE STATE. The same shared screen as the two
           chests and the fight: the fact lives in the state and every client
           draws the middle from it. The player who landed acts; the other
           watches read-only. The two facts the movement cards need - how far
           the last throw went, and where the coin stood before it - are read
           from the genuine `lastRoll`, never guessed. */
        next.landing.kind = "epoch";
        next.epoch = {
          playerId: active,
          phase: "open",
          startedAt: now(),
          cardId: null,
          result: null,
          /* The two facts the movement cards read: how far this throw went,
             and where the coin stood before it. Both are the throw that just
             landed here - the genuine values, never a guess. */
          rewindSteps: face,
          fracturePos: from,
        };
        ok("epochOpened", { seat: active, startedAt: next.epoch.startedAt });
      } else {
        next.landing.kind = "none";
      }

      /* MOVING is the phase the coin is walking in. What the square wants is
         already known (`landing.kind`), but the card is not up yet: `continue`
         is what the client sends when the coin has stopped, and that is the
         step that opens the decision. A square that wants nothing goes to
         RESOLVING instead, so the highlight has its own moment. */
      next.phase = PHASE.MOVING;
      return { state: next, events };
    }

    /* ------------------------------------------------------------- testRoll */
    case "testRoll": {
      if (!state.testMode) {
        return refused(state, action, "Test mode is not enabled for this game.");
      }
      if (state.phase !== PHASE.AWAITING_ROLL) {
        return refused(state, action, "The die waits until the visit is over.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (!piece) return refused(state, action, "That seat has no piece.");

      const steps = Number(action.steps);
      if (!Number.isInteger(steps) || steps < 1 || steps > 28) {
        return refused(state, action, "Test roll must be an integer from 1 to 28.");
      }

      const face = steps;
      const from = piece.position;
      const to = advance(from, face);
      const cell = CELLS.find((entry) => entry.index === to) || CELLS[to];

      /* Crossing Start EARNS the Redemption, but does not pay it yet. The
         payment belongs to the end of the turn: a player who crosses Start and
         then lands on a square still has a visit to finish, and a purse that
         rose during the walk would be paying them in the middle of their own
         move. The flag rides on the visit and `continue` pays it at TURN_END. */
      const crossedStart = from > 0 && from + face >= BOARD_SIZE;

      piece.position = to;
      next.lastRoll = { seat: active, face, from, to, id: cell?.id || "", test: true };

      next.landing = {
        seat: active,
        index: to,
        id: cell?.id || "",
        kind: "none",
      };
      next.chest = null;
      next.visit = {
        seat: active,
        bought: false,
        upgrades: 0,
        drawn: null,
        collected: false,
        /* KRONOS ONLY. What the shield draw found: the shield id, the
           sentinel "none" for a draw that found nothing left to offer, or
           null while the chest has not been drawn from - the same three
           states `drawn` holds at Ragnarok. */
        shieldDrawn: null,
        rent: 0,
        paid: false,
        short: 0,
        /* What completing a lap is owed, paid when the turn is resolved. */
        redemption: crossedStart ? REDEMPTION : 0,
        /* Nexus only. */
        prayed: false,
        nexusDrawn: false,
        nexusCard: null,
        /* The player left the Nexus without praying or drawing. */
        declined: false,
      };
      next.phase = PHASE.MOVING;

      ok("moved", {
        seat: active,
        from,
        to,
        steps: face,
        path: pathFrom(from, face),
        face,
        test: true,
      });
      ok("landed", {
        seat: active,
        index: to,
        id: cell?.id || "",
        name: cell?.name || "",
        test: true,
      });

      /* What the square wants. A property is the only kind that can hold a
         decision except Ragnarok; a corner or a silent chest goes straight on
         to RESOLVING and the UI sweeps it away. */
      if (cell?.type === "property" && isPriced(cell.id)) {
        const owner = ownerOf(next.ledger, cell.id);

        if (owner === null) {
          next.landing.kind = "buy";
        } else if (owner === active) {
          next.landing.kind = "own";
        } else {
          next.landing.kind = "rent";
          const verdict = payRent(next.ledger, cell.id, active);
          next.visit.rent = verdict.rent || 0;
          next.visit.paid = Boolean(verdict.paid);
          next.visit.short = verdict.shortfall || 0;

          recordEntry(next.ledger, {
            turn: state.turn,
            seat: active,
            kind: "rent",
            text: `Rent paid to ${nameOfSeat(next.ledger, owner)} · ${cell.name}`,
            amount: -(verdict.amount || 0),
          });
          if ((verdict.amount || 0) > 0) {
            recordEntry(next.ledger, {
              turn: state.turn,
              seat: owner,
              kind: "rent",
              text: `Rent received from ${nameOfSeat(next.ledger, active)} · ${cell.name}`,
              amount: verdict.amount || 0,
            });
          }

          if (verdict.shortfall > 0) {
            ok("rentShort", {
              id: cell.id,
              from: active,
              to: owner,
              rent: verdict.rent || 0,
              amount: verdict.amount || 0,
              short: verdict.short || 0,
              shortfall: verdict.shortfall || 0,
              payer: verdict.payer,
              holder: verdict.holder,
              test: true,
            });
          } else {
            ok("rentPaid", {
              id: cell.id,
              from: active,
              to: owner,
              amount: verdict.rent || 0,
              payer: verdict.payer,
              holder: verdict.holder,
              rent: rentAt(next.ledger, cell.id),
              test: true,
            });
          }
        }
      } else if (
        cell?.id === RAGNAROK.id ||
        cell?.id === NEXUS.id ||
        (KRONOS && cell?.id === KRONOS.id)
      ) {
        next.landing.kind = "chest";
        next.chest = {
          kind: cell.id === RAGNAROK.id
            ? "ragnarok"
            : cell.id === NEXUS.id
              ? "nexus"
              : "kronos",
          playerId: active,
          phase: "open",
          startedAt: now(),
          choice: null,
          result: null,
        };
        ok("chestOpened", {
          kind: next.chest.kind,
          seat: active,
          startedAt: next.chest.startedAt,
          test: true,
        });
      } else if (cell?.id === FIGHT.id) {
        next.landing.kind = "fight";
        next.fight = {
          playerId: active,
          phase: "open",
          selectedWeaponId: null,
          armed: false,
          targetId: null,
          result: null,
          startedAt: now(),
        };
        ok("fightOpened", { seat: active, startedAt: next.fight.startedAt, test: true });
      } else if (EPOCH && cell?.id === EPOCH.id) {
        next.landing.kind = "epoch";
        next.epoch = {
          playerId: active,
          phase: "open",
          startedAt: now(),
          cardId: null,
          result: null,
          rewindSteps: face,
          fracturePos: from,
        };
        ok("epochOpened", { seat: active, startedAt: next.epoch.startedAt, test: true });
      } else {
        next.landing.kind = "none";
      }

      next.phase = PHASE.MOVING;
      return { state: next, events };
    }

    /* --------------------------------------------------------------- buying */
    case "buy": {
      if (state.phase !== PHASE.DECISION || state.landing?.kind !== "buy") {
        return refused(state, action, "There is nothing to buy here.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      const id = state.landing.id;
      const verdict = ledgerBuy(next.ledger, id, active);
      if (!verdict.ok) return refused(state, action, verdict.why);

      next.visit.bought = true;
      next.phase = PHASE.RESOLVING;
      recordEntry(next.ledger, {
        turn: state.turn,
        seat: active,
        kind: "buy",
        text: `Bought ${landingCell(next)?.name || id}`,
        amount: -verdict.spent,
      });
      ok("bought", {
        seat: active,
        id,
        name: landingCell(next)?.name || id,
        price: verdict.spent,
        money: verdict.money,
      });
      return { state: next, events };
    }

    /* -------------------------------------------------------------- passing */
    case "pass": {
      if (state.phase !== PHASE.DECISION) {
        return refused(state, action, "There is nothing to pass.");
      }
      if (!["buy", "own"].includes(state.landing?.kind)) {
        return refused(state, action, "Press Continue to leave this square.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      next.phase = PHASE.RESOLVING;
      ok("passed", {
        seat: active,
        id: state.landing.id,
        kind: state.landing.kind,
      });
      return { state: next, events };
    }

    /* ------------------------------------------------------------ upgrading */
    case "upgrade": {
      if (state.phase !== PHASE.DECISION || state.landing?.kind !== "own") {
        return refused(state, action, "Land on your own square to upgrade.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      const id = state.landing.id;
      const offer = upgradeOffer(state, id);
      if (!offer.ok) return refused(state, action, offer.why);

      const verdict = ledgerUpgrade(next.ledger, id, active);
      if (!verdict.ok) return refused(state, action, verdict.why);

      next.visit.upgrades = (next.visit.upgrades || 0) + 1;
      recordEntry(next.ledger, {
        turn: state.turn,
        seat: active,
        kind: "upgrade",
        text: `Upgraded ${landingCell(next)?.name || id} to ${verdict.upgrade.name}`,
        amount: -verdict.spent,
      });
      /* The visit stays open: a player may build once and then press Done, and
         the card has to stay on screen to show what happened. */
      ok("upgraded", {
        seat: active,
        id,
        level: verdict.level,
        cost: verdict.spent,
        money: verdict.money,
        name: verdict.upgrade.name,
        rent: verdict.rent,
      });
      return { state: next, events };
    }

    /* ---------------------------------------------------------------- selling */
    case "sell": {
      const id = action.id || state.landing?.id || "";
      const offer = sellOffer(state, id, actor);
      if (!offer.ok) return refused(state, action, offer.why);
      const verdict = ledgerSell(next.ledger, id, actor);
      if (!verdict.ok) return refused(state, action, verdict.why);

      recordEntry(next.ledger, {
        turn: state.turn,
        seat: actor,
        kind: "sell",
        text: `Sold ${CELLS.find((c) => c.id === id)?.name || id}`,
        amount: verdict.payout,
      });
      ok("sold", {
        seat: actor,
        id,
        payout: verdict.payout,
        money: verdict.money,
      });
      return { state: next, events };
    }

    /* ------------------------------------------------------------- Ragnarok */
    case "drawWeapon": {
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "chest" ||
        state.landing?.id !== RAGNAROK.id
      ) {
        return refused(state, action, "There is no chest to draw from.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (next.visit.drawn !== null) {
        return refused(state, action, "This chest has already been drawn from.");
      }
      if (!state.chest) return refused(state, action, "There is no chest to draw from.");
      if (state.chest.phase !== "open") {
        return refused(state, action, "The draw is already under way.");
      }

      /* THE DRAW IS DECIDED HERE AND STORED.

         The weapon is chosen by the server the moment the button is pressed,
         and it is written into the chest straight away. The clients do not
         draw: they show what the state says, once the animation has run.
         So a client that arrives late sees the same weapon, and a client
         that never saw the press still sees the answer. */
      const outcome = drawWeapon(rng);
      next.visit.drawn = outcome;
      next.phase = PHASE.DECISION;
      next.chest.phase = "drawing";
      next.chest.startedAt = now();
      next.chest.choice = "draw";
      next.chest.result = {
        badLuck: outcome === BAD_LUCK,
        weapon: outcome === BAD_LUCK ? null : outcome,
        /* The face the player touched. Both devices turn over the same one. */
        slot: Number.isInteger(action.slot) ? Math.max(0, Math.min(2, action.slot)) : 1,
      };
      ok("weaponDrawn", {
        seat: active,
        weapon: outcome === BAD_LUCK ? null : outcome,
        badLuck: outcome === BAD_LUCK,
        slot: next.chest.result.slot,
        startedAt: next.chest.startedAt,
      });
      return { state: next, events };
    }

    /* THE WEAPON IS TURNED OVER.

       The draw is answered the moment the button is pressed, and the weapon
       is in the chest from then. This is the moment the face turns over, and
       it is a separate action so that both devices turn it over at the same
       moment and the weapon is collectable only once it has been seen. */
    case "revealWeapon": {
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "chest" ||
        state.landing?.id !== RAGNAROK.id
      ) {
        return refused(state, action, "There is no chest to draw from.");
      }
      if (!state.chest || state.chest.choice !== "draw") {
        return refused(state, action, "There is nothing to turn over.");
      }
      if (state.chest.phase === "revealed") {
        return refused(state, action, "That weapon has already been turned over.");
      }
      if (!state.visit?.drawn) {
        return refused(state, action, "Draw from the chest first.");
      }

      next.chest.phase = "revealed";
      next.chest.startedAt = now();
      ok("weaponRevealed", {
        seat: active,
        weapon: state.visit.drawn === BAD_LUCK ? null : state.visit.drawn,
        badLuck: state.visit.drawn === BAD_LUCK,
        startedAt: next.chest.startedAt,
      });
      return { state: next, events };
    }

    case "collectWeapon": {
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "chest" ||
        state.landing?.id !== RAGNAROK.id
      ) {
        return refused(state, action, "There is no chest to collect from.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      const weapon = state.visit?.drawn;
      if (!weapon || weapon === BAD_LUCK) {
        return refused(state, action, "There is no weapon to collect.");
      }
      if (state.visit?.collected) {
        return refused(state, action, "That weapon has already been collected.");
      }
      if (!piece) return refused(state, action, "That seat has no piece.");

      piece.weapons.push(weapon);
      next.visit.collected = true;
      next.phase = PHASE.RESOLVING;
      /* The chest is answered: the weapon is the player's. The face turned over
         a moment ago - that was `revealWeapon` - and this is the press that
         takes it. */
      if (next.chest) next.chest.phase = "done";
      recordEntry(next.ledger, {
        turn: state.turn,
        seat: active,
        kind: "weapon",
        text: `Drew ${weaponById(weapon)?.name || weapon}`,
        amount: 0,
      });
      ok("weaponCollected", {
        seat: active,
        weapon,
        weapons: [...piece.weapons],
      });
      return { state: next, events };
    }

    /* -------------------------------------------------------------- Kronos

       The shield chest. The same little story as Ragnarok - a draw the server
       decides, a shuffle the clients play, a face turned over at its own
       moment - with one press fewer, because a shield DEPLOYS the moment it is
       drawn. There is nothing to collect: the shield is already standing, and
       Collect would be a press that changes nothing. */

    case "drawShield": {
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "chest" ||
        !(KRONOS && state.landing?.id === KRONOS.id)
      ) {
        return refused(state, action, "There is no chest to draw from.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if ((state.visit?.shieldDrawn ?? null) !== null) {
        return refused(state, action, "This chest has already been drawn from.");
      }
      if (!state.chest || state.chest.kind !== "kronos") {
        return refused(state, action, "There is no chest to draw from.");
      }
      if (state.chest.phase !== "open") {
        return refused(state, action, "The draw is already under way.");
      }
      if (!state.visit) return refused(state, action, "There is no chest to draw from.");

      /* WHAT MAY BE OFFERED, AND WHAT MAY NOT.

         A player stands behind AT MOST ONE SHIELD PER WEAPON, and the draw is
         where that rule is held: it never offers a shield the player already
         stands behind. So a shield cannot be refreshed by drawing a second
         copy, cannot be stacked, and cannot be silently overwritten - the only
         thing a draw can do is add a shield that is not yet held. With all
         three already held the draw is a miss, recorded as "none", and the
         visit is answered either way. */
      const standing = (state.shields || [])
        .filter((entry) => entry.owner === active)
        .map((entry) => entry.id);
      const outcome = drawShield(rng, standing);
      const shield = outcome ? shieldById(outcome) : null;
      const none = !shield;

      /* DEPLOYED AT THE DRAW, IN THE SAME ACTION.

         The shield enters the shared state here, with its full two turns: the
         turn it is drawn in IS the owner's first of the two, and TURN_END below
         takes one off. From this moment both screens hold the same fact, a
         strike is answered from that fact, and there is no separate activation
         - nothing to press, nothing to forget, nothing one device knows that
         the other does not. */
      if (shield) {
        next.shields = [
          ...(state.shields || []),
          { id: shield.id, owner: active, weapon: shield.counters, turnsLeft: SHIELD_TURNS },
        ];
      }

      next.visit.shieldDrawn = none ? "none" : outcome;
      next.phase = PHASE.DECISION;
      next.chest.phase = "drawing";
      next.chest.startedAt = now();
      next.chest.choice = "draw";
      next.chest.result = {
        shield: none ? null : outcome,
        none,
        /* The face the player touched. Both devices turn over the same one. */
        slot: Number.isInteger(action.slot) ? Math.max(0, Math.min(2, action.slot)) : 1,
      };
      if (shield) {
        recordEntry(next.ledger, {
          turn: state.turn,
          seat: active,
          kind: "shield",
          text: `Deployed ${shield.name}`,
          amount: 0,
        });
      }
      ok("shieldDrawn", {
        seat: active,
        shield: none ? null : outcome,
        none,
        weapon: shield?.counters || null,
        turnsLeft: SHIELD_TURNS,
        slot: next.chest.result.slot,
        startedAt: next.chest.startedAt,
      });
      return { state: next, events };
    }

    /* THE SHIELD'S FACE IS TURNED OVER.

       The draw was answered the moment the button was pressed and the shield
       was standing from then. This is the moment both devices turn the face
       over together - the same separate action Ragnarok's reveal is, for the
       same reason: two screens, one moment. */
    case "revealShield": {
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "chest" ||
        !(KRONOS && state.landing?.id === KRONOS.id)
      ) {
        return refused(state, action, "There is no chest to draw from.");
      }
      if (!state.chest || state.chest.kind !== "kronos" || state.chest.choice !== "draw") {
        return refused(state, action, "There is nothing to turn over.");
      }
      if (state.chest.phase === "revealed") {
        return refused(state, action, "That shield has already been turned over.");
      }
      if ((state.visit?.shieldDrawn ?? null) === null) {
        return refused(state, action, "Draw from the chest first.");
      }

      next.chest.phase = "revealed";
      next.chest.startedAt = now();
      ok("shieldRevealed", {
        seat: active,
        shield: state.chest.result?.shield || null,
        none: Boolean(state.chest.result?.none),
        startedAt: next.chest.startedAt,
      });
      return { state: next, events };
    }

    /* --------------------------------------------------------------- Nexus */
    case "pray": {
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.landing?.id !== NEXUS.id || state.landing?.kind !== "chest") {
        return refused(state, action, "There is nothing to pray for here.");
      }
      if (state.visit?.prayed || state.visit?.nexusDrawn) {
        return refused(state, action, "You have already made your offering.");
      }
      if (state.phase !== PHASE.DECISION) {
        return refused(state, action, "There is nothing to pray for here.");
      }
      if (!state.chest) return refused(state, action, "There is nothing to pray for here.");
      if (state.chest.phase !== "open") {
        return refused(state, action, "The Nexus has already been answered.");
      }

      /* THE OFFERING IS TAKEN HERE, AND THE CHEST SAYS SO.

         The ledger entry is the one the profile shows, and the chest's own
         result is the same fact written for the middle of the board. Both
         devices read the same chest. */
      const verdict = adjustMoney(next.ledger, active, -NEXUS_PRAY_COST, {
        turn: state.turn,
        seat: active,
        kind: "nexus",
        text: "Temple offering",
      });
      if (!verdict.ok) return refused(state, action, verdict.why);

      next.visit.prayed = true;
      next.phase = PHASE.DECISION;
      next.chest.phase = "praying";
      next.chest.choice = "pray";
      next.chest.startedAt = now();
      next.chest.result = { amount: -NEXUS_PRAY_COST, money: verdict.money };
      ok("prayed", {
        seat: active,
        amount: NEXUS_PRAY_COST,
        money: verdict.money,
        startedAt: next.chest.startedAt,
      });
      return { state: next, events };
    }

    case "drawNexus": {
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.landing?.id !== NEXUS.id || state.landing?.kind !== "chest") {
        return refused(state, action, "There is no card to draw here.");
      }
      if (state.visit?.prayed || state.visit?.nexusDrawn) {
        return refused(state, action, "You have already drawn from the Nexus.");
      }
      if (state.phase !== PHASE.DECISION) {
        return refused(state, action, "There is no card to draw here.");
      }
      if (!state.chest) return refused(state, action, "There is no card to draw here.");
      if (state.chest.phase !== "open") {
        return refused(state, action, "The Nexus has already been answered.");
      }

      /* THE CARD IS CHOSEN HERE AND STORED AT ONCE.

         The server picks the card the moment the button is pressed and writes
         it into the chest. The clients do not draw: they show what the state
         says, once the shuffle has run. So the money can be applied at the
         moment the card is REVEALED - which is a later action - and both
         balances still move once. */
      const card = drawNexusCard(rng);
      next.visit.nexusDrawn = true;
      next.visit.nexusCard = card;
      next.phase = PHASE.DECISION;
      next.chest.phase = "shuffling";
      next.chest.choice = "draw";
      next.chest.startedAt = now();
      next.chest.result = { card, amount: card.amount, revealed: false };
      ok("nexusDrawn", {
        seat: active,
        card,
        startedAt: next.chest.startedAt,
      });
      return { state: next, events };
    }

    /* THE NEXUS CARD IS TURNED OVER, AND THE MONEY MOVES.

       This is the moment the card is revealed: the server takes the amount
       out of (or into) the purse, writes the ledger entry, and the chest
       records that it has been revealed. Both devices then show the card and
       the new balance. */
    case "revealNexus": {
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.landing?.id !== NEXUS.id || state.landing?.kind !== "chest") {
        return refused(state, action, "There is no card to turn over here.");
      }
      if (!state.chest || state.chest.choice !== "draw" || !state.chest.result?.card) {
        return refused(state, action, "There is no card to turn over.");
      }
      if (state.chest.result.revealed) {
        return refused(state, action, "That card has already been turned over.");
      }

      const card = state.chest.result.card;
      const verdict = adjustMoney(next.ledger, active, card.amount, {
        turn: state.turn,
        seat: active,
        kind: "nexus",
        text: card.name,
      });
      if (!verdict.ok) return refused(state, action, verdict.why);

      next.chest.phase = "revealed";
      next.chest.result = {
        ...state.chest.result,
        revealed: true,
        money: verdict.money,
      };
      next.phase = PHASE.DECISION;
      ok("nexusRevealed", {
        seat: active,
        card,
        amount: card.amount,
        money: verdict.money,
      });
      return { state: next, events };
    }

    /* --------------------------------------------------------------- the fight

       The corner is a SHARED screen, and every part of it is answered by an
       action the server validates, the same way the chest is. The player who
       landed chooses a weapon (`selectWeapon`), arms it (`armWeapon`), may
       step back (`cancelArm`), strikes (`fightAttack`), and may always leave
       (`leaveFight`). Nobody but the landing player's actions is accepted
       here, and the turn is ended by the same two exits the chest uses:
       `leaveFight` and `done`. */
    case "selectWeapon": {
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "fight" ||
        !state.fight
      ) {
        return refused(state, action, "There is no fight here.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      /* A weapon can be changed while it is only CHOSEN - a player who
         touched the wrong face is not trapped by it. It cannot be changed
         once the strike is armed or under way: Cancel is the way back, and
         nothing else is. */
      if (state.fight.phase === "armed" || state.fight.phase === "resolving") {
        return refused(state, action, "The strike is already armed.");
      }
      const weapon = weaponById(action.weaponId);
      if (!weapon) return refused(state, action, "That is not a weapon.");
      if (!piece?.weapons?.includes(weapon.id)) {
        return refused(state, action, "You do not carry that weapon.");
      }

      next.fight.selectedWeaponId = weapon.id;
      next.fight.phase = "selected";
      ok("fightSelected", { seat: active, weapon: weapon.id });
      return { state: next, events };
    }

    /* THE STRIKE IS ARMED, AND THE TILES BLINK.

       A weapon that cannot reach any colony cannot be armed: the client
       disables its Attack pill, and the server refuses the arming as well,
       because a pill is a request and not a rule. */
    case "armWeapon": {
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "fight" ||
        !state.fight
      ) {
        return refused(state, action, "There is no fight here.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.fight.phase !== "selected") {
        return refused(state, action, "Choose a weapon first.");
      }
      const weapon = weaponById(state.fight.selectedWeaponId);
      if (!weapon || !piece?.weapons?.includes(weapon.id)) {
        return refused(state, action, "You do not carry that weapon.");
      }
      const opponent = opponentOf(state, active);
      const targets = validTargets(next.ledger, weapon.id, active, { opponentSeat: opponent });
      if (!targets.length) {
        return refused(state, action, "No colony in range.");
      }

      next.fight.phase = "armed";
      next.fight.armed = true;
      ok("fightArmed", { seat: active, weapon: weapon.id, targets });
      return { state: next, events };
    }

    /* Back from armed to a chosen weapon. The glow comes back; the blink
       goes. Nothing else changes. */
    case "cancelArm": {
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "fight" ||
        !state.fight
      ) {
        return refused(state, action, "There is no fight here.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.fight.phase !== "armed") {
        return refused(state, action, "There is nothing to step back from.");
      }

      next.fight.phase = "selected";
      next.fight.armed = false;
      ok("fightCancelled", { seat: active });
      return { state: next, events };
    }

    /* THE STRIKE.

       One press on a blinking tile, and there is no second question: the
       strike is the press. The server answers for everything - the weapon
       belongs to the striker, the colony is within reach, the visit has
       struck once - and then the colony changes hands with everything built
       on it, the weapon is spent, and both ledgers write what happened with
       no money moving at all. */
    case "fightAttack": {
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "fight" ||
        !state.fight
      ) {
        return refused(state, action, "There is no fight here.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.fight.phase !== "armed") {
        return refused(state, action, "Arm a weapon before you strike.");
      }
      if (state.fight.result) {
        return refused(state, action, "The fight has already been fought.");
      }
      const weapon = weaponById(state.fight.selectedWeaponId);
      if (!weapon || !piece?.weapons?.includes(weapon.id)) {
        return refused(state, action, "You do not carry that weapon.");
      }
      const targetId = String(action.targetId ?? "");
      const cell = CELLS.find((entry) => entry.id === targetId);
      if (!cell) return refused(state, action, "There is no such colony.");
      if (IMMUNE_LIST.includes(targetId)) {
        return refused(state, action, "That colony is beyond any weapon.");
      }
      if (isTargetProtected(cell)) {
        return refused(state, action, "That colony is protected.");
      }
      const opponent = opponentOf(state, active);
      const targets = validTargets(next.ledger, weapon.id, active, { opponentSeat: opponent });
      if (!targets.includes(targetId)) {
        return refused(state, action, "That colony is not within reach.");
      }

      /* KRONOS ANSWERS HERE, BEFORE ANYTHING MOVES.

         The defender is whoever holds the colony under the strike. If one of
         their shields names this weapon, the strike is spent against it:

         - the shield is removed in the SAME action that read it, so it can be
           consumed only once - there is no second read and no second press;
         - this returns BEFORE the colony changes hands and BEFORE the weapon
           is spent, which is what stops the destructive effect from reaching
           the target through any other path: no capture, no rent shift, no
           weapon lost by the attacker;
         - only the shield's OWN weapon is answered. The other two pass by,
           because the match is on the exact weapon id.

         The weapon stays with its owner. A block denies the strike; it does
         not delete the weapon, so a shield buys its owner a turn rather than
         handing them the attacker's arsenal. */
      const defender = ownerOf(next.ledger, targetId);
      const shield = defender === null || defender === active
        ? null
        : (state.shields || []).find(
            (entry) => entry.owner === defender && entry.weapon === weapon.id,
          );
      if (shield) {
        next.shields = (state.shields || []).filter((entry) => entry !== shield);
        const shieldName = shieldById(shield.id)?.name || shield.id;

        next.fight.phase = "resolving";
        next.fight.armed = false;
        next.fight.targetId = targetId;
        next.fight.result = {
          id: targetId,
          weapon: weapon.id,
          name: cell.name,
          from: defender,
          to: active,
          blocked: true,
          shield: shield.id,
        };

        recordEntry(next.ledger, {
          turn: state.turn,
          seat: active,
          kind: "fight",
          text: `${weapon.name} stopped by ${shieldName} at ${cell.name}`,
          amount: 0,
        });
        recordEntry(next.ledger, {
          turn: state.turn,
          seat: defender,
          kind: "fight",
          text: `${shieldName} spent at ${cell.name}`,
          amount: 0,
        });

        ok("shieldBlocked", {
          seat: active,
          owner: defender,
          shield: shield.id,
          weapon: weapon.id,
          id: targetId,
          name: cell.name,
        });
        return { state: next, events };
      }

      /* THE COLONY CHANGES HANDS, WITH EVERYTHING ON IT.

          The sheet's owner is the only thing written: the upgrade level the
          colony already carries is the colony's own fact and it travels with
          it, and the rent that follows is worked out from the ownership by
          the ledger's own rules - including the monopoly it now belongs to.
          Nothing here recomputes rent, because nothing here has to. */
      const sheet = sheetFor(next.ledger, targetId);
      sheet.owner = active;
      piece.weapons = piece.weapons.filter((id) => id !== weapon.id);

      /* One sentence for each side, and no money moves. */
      recordEntry(next.ledger, {
        turn: state.turn,
        seat: active,
        kind: "fight",
        text: `Captured ${cell.name} with ${weapon.name}`,
        amount: 0,
      });
      recordEntry(next.ledger, {
        turn: state.turn,
        seat: opponent,
        kind: "fight",
        text: `Lost ${cell.name} to ${nameOfSeat(next.ledger, active)}`,
        amount: 0,
      });

      next.fight.phase = "resolving";
      next.fight.armed = false;
      next.fight.targetId = targetId;
      next.fight.result = {
        id: targetId,
        weapon: weapon.id,
        name: cell.name,
        from: opponent,
        to: active,
      };
      ok("fightResolved", {
        seat: active,
        id: targetId,
        weapon: weapon.id,
        name: cell.name,
        from: opponent,
        to: active,
      });
      return { state: next, events };
    }

    /* LEAVING.

       The red pill at the foot of the Fight, always there, with or without
       weapons. Leaving ends the Fight AND the turn: a visit to the corner is
       over when the player walks away from it. */
    case "leaveFight": {
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (!state.fight) return refused(state, action, "There is no fight to leave.");

      next.fight = null;
      next.phase = PHASE.TURN_END;
      ok("fightLeft", { seat: active });
      return { state: next, events };
    }

    /* ---------------------------------------------------------------- Epoch

       Epoch is a shared screen, like the two chests and the fight. The player
       who landed draws exactly one Time Card; the server picks it, applies its
       effect to the real state, records it in the ledger, and both devices read
       the outcome from `game.epoch`. Nothing here is decided by a browser.

       EPOCH MOVEMENT IS POSITIONAL. A card that moves the coin changes only
       the coin's square. It does not open a purchase, charge rent, upgrade, or
       chain into another special tile - so a card can never strand a turn, buy
       something by accident, or recurse. This is the explicit landing rule for
       every Epoch movement card, and it is documented rather than silent. */
    case "drawTimeCard": {
      if (state.phase !== PHASE.DECISION || state.landing?.kind !== "epoch" || !state.epoch) {
        return refused(state, action, "There is no Epoch here.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.epoch.phase !== "open") {
        return refused(state, action, "A Time Card has already been drawn.");
      }
      if (!piece) return refused(state, action, "That seat has no piece.");

      const card = drawTimeCard(rng);
      const opponent = opponentOf(state, active);
      const result = { card: card.id, name: card.name, text: card.text, outcome: "", outcomeKind: "" };

      /* Resolve the effect against the real state. Every branch writes the same
         `result`, so the client always has one outcome to show, and every state
         change is made here and nowhere else. */
      switch (card.effect) {
        case "rewind": {
          const steps = Number(state.epoch.rewindSteps);
          if (!Number.isInteger(steps) || steps < 1) {
            result.outcomeKind = NO_EFFECT;
            result.outcome = "No completed throw to rewind by.";
            break;
          }
          const from = piece.position;
          const to = advance(from, -steps);
          const path = pathFrom(from, -steps);
          piece.position = to;
          result.outcomeKind = "moved";
          result.outcome = `Rewound ${steps} ${steps === 1 ? "space" : "spaces"}.`;
          recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: `Time Rewind · back ${steps} to ${CELLS.find((c) => c.index === to)?.name || to}`, amount: 0 });
          ok("epochMoved", { seat: active, from, to, path, steps: -steps, backward: true });
          break;
        }
        case "leap": {
          const from = piece.position;
          const to = advance(from, 3);
          const path = pathFrom(from, 3);
          piece.position = to;
          result.outcomeKind = "moved";
          result.outcome = `Leapt 3 spaces to ${CELLS.find((c) => c.index === to)?.name || to}.`;
          recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: `Time Leap · forward 3 to ${CELLS.find((c) => c.index === to)?.name || to}`, amount: 0 });
          ok("epochMoved", { seat: active, from, to, path, steps: 3, backward: false });
          break;
        }
        case "fracture": {
          const target = Number(state.epoch.fracturePos);
          if (!Number.isInteger(target)) {
            result.outcomeKind = NO_EFFECT;
            result.outcome = "No earlier moment to fracture back to.";
            break;
          }
          const from = piece.position;
          const to = advance(target, 0);
          const path = pathFrom(from, to - from);
          piece.position = to;
          result.outcomeKind = "moved";
          result.outcome = `Fractured back to ${CELLS.find((c) => c.index === to)?.name || to}.`;
          recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: `Time Fracture · back to ${CELLS.find((c) => c.index === to)?.name || to}`, amount: 0 });
          ok("epochMoved", { seat: active, from, to, path, steps: to - from, backward: to < from });
          break;
        }
        case "sight": {
          const drawnSight = Number(rng());
          const sightFace = 1 + Math.min(5, Math.floor((Number.isFinite(drawnSight) ? drawnSight : 0) * 6));
          next.futureSight = { ...(state.futureSight || { 0: null, 1: null }), [active]: sightFace };
          result.sight = sightFace;
          result.outcomeKind = "sight";
          result.outcome = `Your next throw is already decided: ${sightFace}.`;
          recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: `Future Sight · next throw is ${sightFace}`, amount: 0 });
          break;
        }
        case "loop": {
          /* A Frozen Moment on this seat eats the moment before it can grant:
             the loop is drawn, and it does not repeat. The freeze is spent. */
          if (state.frozen?.[active]) {
            next.frozen = { ...(state.frozen || { 0: false, 1: false }), [active]: false };
            result.outcomeKind = NO_EFFECT;
            result.outcome = "Your moment is frozen; no bonus roll is granted.";
            recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: "Temporal Loop · frozen, no bonus roll", amount: 0 });
            break;
          }
          next.bonusRolls = { ...(state.bonusRolls || { 0: 0, 1: 0 }), [active]: (state.bonusRolls?.[active] || 0) + 1 };
          result.outcomeKind = "loop";
          result.outcome = "Time repeats. Roll once more.";
          recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: "Temporal Loop · one bonus roll", amount: 0 });
          break;
        }
        case "freeze": {
          if (!opponent) {
            result.outcomeKind = NO_TARGET;
            result.outcome = "No opponent to freeze.";
            break;
          }
          /* One-time protection: the opponent's next earned advantage is held.
             It is stored authoritatively and always cleared by the end of their
             next turn, so it can never sit pending for ever. */
          next.frozen = { ...(state.frozen || { 0: false, 1: false }), [opponent]: true };
          if ((next.bonusRolls?.[opponent] || 0) > 0) {
            next.bonusRolls = { ...next.bonusRolls, [opponent]: 0 };
            result.outcomeKind = "freeze";
            result.outcome = `${nameOfSeat(next.ledger, opponent)}'s held advantage is spent and lost.`;
          } else {
            result.outcomeKind = "freeze";
            result.outcome = `${nameOfSeat(next.ledger, opponent)}'s next advantage is frozen.`;
          }
          recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: `Frozen Moment · ${nameOfSeat(next.ledger, opponent)} frozen`, amount: 0 });
          break;
        }
        case "theft": {
          if (!opponent || (state.bonusRolls?.[opponent] || 0) < 1) {
            result.outcomeKind = NO_TARGET;
            result.outcome = "No unspent advantage to steal.";
            recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: "Time Theft · no advantage to steal", amount: 0 });
            break;
          }
          next.bonusRolls = {
            ...(state.bonusRolls || { 0: 0, 1: 0 }),
            [opponent]: state.bonusRolls[opponent] - 1,
            [active]: (state.bonusRolls?.[active] || 0) + 1,
          };
          result.outcomeKind = "theft";
          result.outcome = `Stole an advantage from ${nameOfSeat(next.ledger, opponent)}. Roll once more.`;
          recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: `Time Theft · stole a roll from ${nameOfSeat(next.ledger, opponent)}`, amount: 0 });
          break;
        }
        case "timeline":
        default: {
          /* Alternate Timeline: the moment opens into two futures and waits for
             a choice. Nothing moves yet; the coin stays where it is until the
             player picks a direction. */
          result.outcomeKind = "choose";
          result.outcome = "Two futures open. Choose one.";
          recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: "Alternate Timeline · awaiting a choice", amount: 0 });
          break;
        }
      }

      next.epoch.cardId = card.id;
      next.epoch.result = result;
      next.epoch.phase = result.outcomeKind === "choose" ? "choosing" : "revealed";
      next.phase = PHASE.DECISION;

      recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: `Drew ${card.name}`, amount: 0 });
      ok("timeCardDrawn", {
        seat: active,
        card: card.id,
        name: card.name,
        text: card.text,
        result,
        startedAt: state.epoch.startedAt,
      });
      return { state: next, events };
    }

    /* The chosen future of an Alternate Timeline. One press, validated, and the
       unselected option has no effect at all. */
    case "epochChoice": {
      if (state.phase !== PHASE.DECISION || !state.epoch) {
        return refused(state, action, "There is no Epoch here.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.epoch.phase !== "choosing") {
        return refused(state, action, "There is no future to choose.");
      }
      const option = action.option === "backward" ? "backward" : "forward";
      const steps = option === "forward" ? 2 : -2;
      const from = piece.position;
      const to = advance(from, steps);
      const path = pathFrom(from, steps);
      piece.position = to;

      const result = { ...state.epoch.result, outcomeKind: "moved", option, outcome: `${option === "forward" ? "Advanced" : "Fell back"} 2 to ${CELLS.find((c) => c.index === to)?.name || to}.` };
      next.epoch.result = result;
      next.epoch.phase = "revealed";

      recordEntry(next.ledger, { turn: state.turn, seat: active, kind: "epoch", text: `Alternate Timeline · ${option} 2 to ${CELLS.find((c) => c.index === to)?.name || to}`, amount: 0 });
      ok("epochMoved", { seat: active, from, to, path, steps, backward: steps < 0 });
      ok("timeCardDrawn", {
        seat: active,
        card: state.epoch.cardId,
        name: timeCardById(state.epoch.cardId)?.name || "",
        text: timeCardById(state.epoch.cardId)?.text || "",
        result,
        startedAt: state.epoch.startedAt,
      });
      return { state: next, events };
    }

    /* ------------------------------------------------------------ the chest is
       DONE. The acting player has finished with it - the weapon is collected,
       the card is turned over - and the visit is over. This is the only thing
       that closes a shared chest, and it is pressed by the acting player.

       Both devices close together: the chest goes to null in the state, and
       every client draws the middle from the state, so there is nothing left
       to show. */
    case "done": {
      if (actor !== active) return refused(state, action, "It is not your turn.");

      /* THE FIGHT'S CLOSING. The strike has been seen - the war has played
         on both screens - and the acting player's board asks for the visit
         to be over. The fight goes with it, and the turn ends. */
      if (state.fight) {
        if (state.fight.phase !== "resolving") {
          return refused(state, action, "The fight is still being fought.");
        }
        next.fight = null;
        next.phase = PHASE.TURN_END;
        ok("fightClosed", { seat: active });
        return { state: next, events };
      }

      if (!state.chest) return refused(state, action, "There is nothing to finish.");

      if (state.chest.kind === "ragnarok") {
        if (state.visit?.drawn === null) {
          return refused(state, action, "Draw from the chest first.");
        }
        if (state.visit?.drawn !== BAD_LUCK && !state.visit?.collected) {
          return refused(state, action, "Collect the weapon first.");
        }
      } else if (state.chest.kind === "kronos") {
         /* The shield deploys at the draw, so there is no Collect step - but
            the draw must have happened, or the visit would close having
            offered nothing. A miss ("none", all three already held) counts as
            answered: it is a result, and the player is let go. */
         if ((state.visit?.shieldDrawn ?? null) === null) {
           return refused(state, action, "Draw from the chest first.");
         }
      } else if (state.chest.kind === "nexus") {
        /* A Nexus card that has been chosen but not turned over is turned over
           first, so the money moves exactly once and at the moment the card
           is seen. */
        if (state.chest.choice === "draw" && !state.chest.result?.revealed) {
          return refused(state, action, "Turn the card over first.");
        }
      }

      next.chest = null;
      next.phase = PHASE.TURN_END;
      ok("chestClosed", { kind: state.chest.kind, seat: active });
      return { state: next, events };
    }

    /* -------------------------------------------------------------- continue */
    case "continue": {
      if (actor !== active) return refused(state, action, "It is not your turn.");

      if (state.phase === PHASE.DECISION) {
        const kind = state.landing?.kind;
        if (kind === "buy" || kind === "own") {
          return refused(state, action, "Choose, then the turn can end.");
        }
        if (kind === "chest") {
          if (state.landing?.id === RAGNAROK.id) {
            if (state.visit?.drawn === null) {
              return refused(state, action, "Draw from the chest first.");
            }
            if (state.visit?.drawn !== BAD_LUCK && !state.visit?.collected) {
              return refused(state, action, "Collect the weapon first.");
            }
          } else if (KRONOS && state.landing?.id === KRONOS.id) {
            /* A shield is drawn before the visit may be left - the same rule
               Ragnarok's draw answers to, and the reason a player cannot walk
               away from the shield chest having been offered nothing. */
            if ((state.visit?.shieldDrawn ?? null) === null) {
              return refused(state, action, "Draw from the chest first.");
            }
          } else if (state.landing?.id === NEXUS.id) {            /* THE NEXUS VISIT CAN ALWAYS BE LEFT.

               A refusal here used to be the end of the road, and it stranded the
               game: the client closed the card, asked to continue, was told to
               choose, and had nothing left to choose with. The phase stayed
               DECISION, the card was gone, the die would not come back, and the
               only way out was to reload the page.

               So the visit is never refused. If neither offering nor a draw has
               been made, the player is leaving the Nexus without approaching
               it: no money moves, and the turn carries on. If the client still
               has the card up, it is told the visit is over and takes it down. */
            if (!state.visit?.prayed && !state.visit?.nexusDrawn) {
              next.visit.declined = true;
              ok("nexusDeclined", { seat: active });
            }
          }
          /* A chest that has been answered is closed by the acting player
             pressing Done. `continue` is still accepted - it is what the
             client sends when the chest has nothing left to answer - and it
             closes the chest on its way out. */
          if (state.chest) {
            next.chest = null;
            ok("chestClosed", { kind: state.chest.kind, seat: active });
          }
        }
        if (kind === "fight") {
          /* A fight is ended by the red pill (leaveFight), or by the closing
             press that follows the strike (done). A stray `continue` does
             not walk out of a visit the player is still standing in: the
             turn ends through one of the two exits, or not at all. */
          return refused(state, action, "The fight is still open.");
        }
        if (kind === "epoch") {
          /* Epoch is closed by the acting player once the card has resolved.
             A stray `continue` cannot walk out before the draw, and cannot
             walk out while an Alternate Timeline is still waiting on a
             choice - the effect must be settled before the turn carries on. */
          if (!state.epoch || state.epoch.phase === "open") {
            return refused(state, action, "Draw a Time Card first.");
          }
          if (state.epoch.phase === "choosing") {
            return refused(state, action, "Choose a future first.");
          }
          next.epoch = null;
        }
        next.phase = PHASE.TURN_END;
        return { state: next, events };
      }

      if (state.phase === PHASE.MOVING) {
        /* The coin has stopped. A square with something to decide opens its
           card; a square with nothing to decide - and a rent, which is paid
           and announced during the walk - goes straight on to resolve. */
        const kind = state.landing?.kind;
        next.phase =
          kind === "rent"
            ? PHASE.RESOLVING
            : state.landing && kind !== "none"
              ? PHASE.DECISION
              : PHASE.RESOLVING;
        return { state: next, events };
      }

      if (state.phase === PHASE.RESOLVING) {
        next.phase = PHASE.TURN_END;
        return { state: next, events };
      }

      if (state.phase !== PHASE.TURN_END) {
        return refused(state, action, "There is no turn to end.");
      }

      /* A TEMPORAL LOOP OR A STOLEN MOMENT IS STILL WAITING. The turn does not
         move on while the player holds an unspent bonus roll: the moment
         repeats, and they throw again. The bonus is spent by the throw itself
         (in `roll`), so this can only ever grant the rolls that are actually
         owed - never an endless loop. A Frozen Moment on this seat has already
         eaten the bonus at the moment it was drawn, so nothing is pending here
         for a frozen player. */
      if ((state.bonusRolls?.[state.active] || 0) > 0) {
        next.phase = PHASE.AWAITING_ROLL;
        next.landing = null;
        next.visit = null;
        next.chest = null;
        next.fight = null;
        next.epoch = null;
        ok("bonusRollDue", { seat: state.active, remaining: state.bonusRolls[state.active] });
        return { state: next, events };
      }

      /* THE ONLY PLACE THE ACTIVE PLAYER MOVES. */
      const from = state.active;
      const to = seatAfter(state, from);

      /* The lap is settled here, after every part of the visit has resolved.
         The event is emitted before `turnChanged` so both screens say what the
         finishing player earned, and only then hand the turn on. */
      const due = Number(state.visit?.redemption) || 0;
      if (due > 0) {
        ledgerRedemption(next.ledger, from, state.turn);
        ok("redemption", { seat: from, amount: due });
      }

      /* KRONOS SHIELDS AGE WITH THE TURNS OF THEIR OWNER.

         This is the owner's turn ending, so only the shields whose owner is
         `from` tick; the opponent's are left exactly as they are, which is
         what makes the duration TWO OWNED turns rather than two whole turns.
         A shield that reaches zero is gone from the same list in the same
         action that said so, so it can neither block nor be seen again after
         its moment. The bonus-roll branch above does not reach here: no turn
         changed, so nothing ages. */
      const aged = [];
      for (const shield of next.shields || []) {
        if (shield.owner !== from) {
          aged.push(shield);
          continue;
        }
        const left = (shield.turnsLeft || 0) - 1;
        if (left > 0) {
          aged.push({ ...shield, turnsLeft: left });
          continue;
        }
        ok("shieldExpired", {
          seat: shield.owner,
          shield: shield.id,
          weapon: shield.weapon,
        });
      }
      next.shields = aged;

      next.active = to;
      next.phase = PHASE.AWAITING_ROLL;
      next.turn = (state.turn || 0) + 1;
      next.landing = null;
      next.visit = null;
      next.lastRoll = null;
      /* The chest is gone with the turn. Both devices read this and both close
         the middle at the same moment. */
      next.chest = null;
      next.fight = null;
      next.epoch = null;
      /* A Frozen Moment is one-shot and never pending for more than a single
         turn: whatever it had not already consumed is released here, so a
         frozen seat cannot be suppressed for ever. */
      next.frozen = { ...(state.frozen || { 0: false, 1: false }), [from]: false };
      ok("turnChanged", {
        from,
        to,
        seat: to,
        name: nameOfSeat(next.ledger, to),
        turn: next.turn,
      });
      return { state: next, events };
    }

    default:
      return refused(state, action, "That is not something the game can do.");
  }
}

/* ----------------------------------------------------------------- the card */

/**
 * What the card should say about the current decision.
 *
 * Kept here rather than in the card so the same answer is used by the tests and
 * by Phase 2's server: the UI renders this, it does not decide it.
 */
export function decisionFor(game, id) {
  const landing = game?.landing;
  if (!landing || game.phase !== PHASE.DECISION || landing.id !== id) return null;

  const owner = ownerOf(game.ledger, id);
  return {
    kind: landing.kind,
    seat: game.active,
    owner,
    level: levelOf(game.ledger, id),
    rent: rentAt(game.ledger, id),
    price: priceOf(id),
    bought: Boolean(game.visit?.bought),
    upgrades: game.visit?.upgrades || 0,
    drawn: game.visit?.drawn ?? null,
    collected: Boolean(game.visit?.collected),
    paid: Boolean(game.visit?.paid),
    // The rent that actually moved, and the part of it that did not. A full
    // payment has `short` zero; a shortfall has `rentPaid + short === rent`.
    rentPaid: (game.visit?.rent || 0) - (game.visit?.short || 0),
    short: game.visit?.short || 0,
    canBuy: canBuy(game.ledger, id, game.active),
    canUpgrade: upgradeOffer(game, id),
    canSell: sellOffer(game, id, game.active),
  };
}
