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
  upgrade as ledgerUpgrade,
} from "./ledger.js";
import { NEXUS, NEXUS_PRAY_COST, drawNexusCard } from "./nexus-cards.js";
import { CELLS } from "./spaces.js";
import { BAD_LUCK, RAGNAROK, drawWeapon, weaponById } from "./weapons.js";

export { MAX_UPGRADE, STARTING_MONEY };

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
export function createGame(players = [], { opening = STARTING_MONEY } = {}) {
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

       kind      "ragnarok" or "nexus"
       playerId  the seat that is at the chest
       phase     where the chest is in its own little story
       startedAt when it began, so both devices can start their animation at
                 the same moment
       choice    what the player chose ("pray" | "draw")
       result    what the chest produced */
    chest: null,
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

/**
 * What this visit has done, and what it still may do.
 *
 * The card asks this rather than remembering a flag of its own: one visit is
 * one object, and it is cleared at TURN_END like everything else about a turn.
 */
export function visitOf(game) {
  return game?.visit ? { ...game.visit } : null;
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
      const face = 1 + Math.min(5, Math.floor((Number.isFinite(drawn) ? drawn : 0) * 6));
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
      next.lastRoll = { seat: active, face, from, to, id: cell?.id || "" };

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
      } else if (cell?.id === RAGNAROK.id || cell?.id === NEXUS.id) {
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
          kind: cell.id === RAGNAROK.id ? "ragnarok" : "nexus",
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

    /* ------------------------------------------------------------ the chest is
       DONE. The acting player has finished with it - the weapon is collected,
       the card is turned over - and the visit is over. This is the only thing
       that closes a shared chest, and it is pressed by the acting player.

       Both devices close together: the chest goes to null in the state, and
       every client draws the middle from the state, so there is nothing left
       to show. */
    case "done": {
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (!state.chest) return refused(state, action, "There is nothing to finish.");

      if (state.chest.kind === "ragnarok") {
        if (state.visit?.drawn === null) {
          return refused(state, action, "Draw from the chest first.");
        }
        if (state.visit?.drawn !== BAD_LUCK && !state.visit?.collected) {
          return refused(state, action, "Collect the weapon first.");
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
          } else if (state.landing?.id === NEXUS.id) {
            /* THE NEXUS VISIT CAN ALWAYS BE LEFT.

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

      next.active = to;
      next.phase = PHASE.AWAITING_ROLL;
      next.turn = (state.turn || 0) + 1;
      next.landing = null;
      next.visit = null;
      next.lastRoll = null;
      /* The chest is gone with the turn. Both devices read this and both close
         the middle at the same moment. */
      next.chest = null;
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
