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

import { MAX_UPGRADE, PRICED_IDS, REDEMPTION, STARTING_MONEY, isPriced, priceOf } from "./economy.js";
import { suitById } from "./suits.js";
import {
  adjustMoney,
  buy as ledgerBuy,
  canBuy,
  canUpgrade,
  createLedger,
  levelOf,
  moneyOf,
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
  WEAPONS,
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

/** The Black Hole corner, matched the same way. */
const HOLE_CELL = CELLS.find((cell) => cell.id === "black-hole") || null;

/** The Outer Space corner: where the interstellar suits are offered. */
const SPACE_CELL = CELLS.find((cell) => cell.id === "outer-space") || null;

/** The Wormhole square: where the escape vessel sets its passenger down. */
const WORMHOLE_CELL = CELLS.find((cell) => cell.id === "wormhole") || null;

/** The property whose hold shortens a confinement: Event Horizon. */
export const EVENT_HORIZON = "event-horizon";

/** Jupiter: the square Ancient Greek takes without tribute. */
const JUPITER = CELLS.find((cell) => cell.id === "jupiter") || null;

/* ------------------------------------------------- the civilizations' powers

   EACH CIVILIZATION BRINGS ONE POWER, and every one of them belongs to a
   player's FIRST throw of the die - never to a later one, and never twice.

   The whole rule lives in two fields of the state the server owns:

     firstRoll  which seats have already thrown their first die. Written by
                the throw itself, so a refresh, a reconnect, a second turn or
                a retried press can never make it happen again.
     civGift    the promise that first throw made, if the landing kept it: a
                blessing owed to the first purchase, two weapons owed at
                Ragnarok, Jupiter without tribute. It is spent by the visit
                that earned it and cleared when the turn resolves, so a
                promise can never travel into a later turn.

   Ancient Roman's power is the throw itself, so it carries no promise: the
   six is applied where the face is decided, and nothing is owed afterwards.

   A power is therefore never a thing a browser can ask for - it is written
   by the one action that earns it, in the same state every device reads. */

/** What each civilization's first throw promises, given the landing it made. */
const FIRST_THROW_GIFT = Object.freeze({
  /* The first territory claimed is blessed with ₹50. */
  "indus-valley": (landing) => (landing?.kind === "buy" ? "first-acquisition" : null),
  /* Ragnarok answers with two weapons instead of one. */
  mesopotamian: (landing) => (landing?.id === RAGNAROK.id ? "two-weapons" : null),
  /* Jupiter is taken without tribute - and only while it is there to take. */
  "ancient-greek": (landing) =>
    landing?.kind === "buy" && landing?.id === JUPITER?.id ? "free-jupiter" : null,
  /* The six is the gift; nothing is carried. */
  "ancient-roman": () => null,
});

/** What this civilization's first throw promises, or null. */
function giftOf(civ, landing) {
  const decide = FIRST_THROW_GIFT[civ];
  return decide ? decide(landing) : null;
}

/** The civilization a seat plays, or null. */
function civOf(state, seat) {
  return state.ledger?.players?.find((p) => p.seat === Number(seat))?.civ || null;
}

/** What Indus Valley's first acquisition returns to the treasury. */
const FIRST_ACQUISITION_BLESSING = 50;

/* ------------------------------------------------------------ Nexus loans

   A seat may borrow from the Nexus at any time, against the purchase value
   of the properties it owns. Three fixed amounts: ₹500, ₹1,000, ₹2,000, and
   the total repayment is one and a half times the amount. The security is
   the mortgaged properties: they stay owned, keep working under the ordinary
   rules, and come free when the loan is repaid within five full circuits of
   the board from the square it was taken on. Miss the deadline and Nexus
   takes them - back to the bank, unbuilt, and the loan closes as defaulted.

   THE SECURITY IS CHOSEN AUTOMATICALLY.

   The smallest combination of owned properties whose combined purchase value
   meets or exceeds the amount is mortgaged. A single property worth at least
   the amount can secure it alone; a combination whose sum is smaller than the
   amount can never secure it, so such an offer is refused outright. */

export const LOAN_AMOUNTS = Object.freeze([500, 1000, 2000]);

/** What must be repaid for a loan of this amount, interest included. */
export function loanRepaymentOf(amount) {
  return Math.round((Number(amount) || 0) * 1.5);
}

/** The smallest set of owned properties whose combined purchase value meets
   or exceeds the amount, or null when no combination can. Ties go to the
   smaller set; an exact amount always wins. */
/** The smallest set of owned properties whose combined purchase value meets
   or exceeds the amount, or null when no combination can. Ties go to the
   smaller set; an exact amount always wins. */
export function mortgageSelection(ownedIds, amount) {
  const items = ownedIds
    .map((id) => ({ id, price: priceOf(id) || 0 }))
    .sort((a, b) => a.price - b.price || (a.id < b.id ? -1 : 1));
  const n = items.length;
  let best = null;
  for (let mask = 1; mask < 1 << n; mask += 1) {
    let sum = 0;
    const ids = [];
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) {
        sum += items[i].price;
        ids.push(items[i].id);
      }
    }
    if (sum >= amount && (best === null || sum < best.sum || (sum === best.sum && ids.length < best.ids.length))) {
      best = { ids, sum };
      if (sum === amount) return best.ids;
    }
  }
  return best ? best.ids : null;
}

/** Count the circuits a move completes against an active loan, and tick them.

   One circuit is the coin passing the square the loan was taken on. The count
   lives on the loan itself, so both devices agree and a refresh cannot rewind
   it. */
function tickLoanCircuits(next, state, active, from, face) {
  const loan = state.loans?.[active] || null;
  if (!loan || loan.status !== "active") return;
  let circuits = loan.circuits || 0;
  for (let n = 1; n <= face; n += 1) {
    if (advance(from, n) === loan.position) circuits += 1;
  }
  if (circuits !== (loan.circuits || 0)) {
    next.loans = { ...next.loans, [active]: { ...loan, circuits } };
  }
}

/** How many turns of the deadline remain for an active loan, never below
   zero. Zero means the deadline has passed and the loan awaits default. */
function turnsRemainingOf(loan) {
  return Math.max(0, 5 - (loan.circuits || 0));
}

/* ------------------------------------------------------- Black Hole rules */

/** The entropy a confined player normally needs before they may escape. */
export const HOLE_THRESHOLD = 10;

/** The entropy needed while the confined player holds Event Horizon. */
export const HOLE_THRESHOLD_HELD = 5;

/** What the Relativistic Escape Vessel costs: the whole of the price. */
export const VESSEL_PRICE = 500;

/**
 * THE ONE ENDING. A purse that reaches this figure - inclusive, so exactly
 * -500 counts - sends its seat to OBLIVION and gives the game to the other
 * seat. Zero is not special: a seat at ₹0 plays on, and debt between zero
 * and this figure is part of the game. `applyAction` re-checks the threshold
 * after every accepted action, so the end is always the server's own verdict
 * on a real transaction, written once into `state.over`.
 */
export const OBLIVION_AT = -500;

/**
 * The escape threshold for a confinement, read fresh every time.
 *
 * It is a pure read of the ledger rather than a number stored at capture:
 * holding Event Horizon halves the threshold, a transfer during the
 * confinement takes the half away (or grants it) at once, and the bonus can
 * never be applied twice because it is never applied at all - it is asked
 * for.
 */
export function holeThreshold(ledger, seat) {
  return ownerOf(ledger, EVENT_HORIZON) === seat ? HOLE_THRESHOLD_HELD : HOLE_THRESHOLD;
}

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
    /* THE GAME'S END, or null - and OBLIVION is the only end there is: the
       first seat whose purse reaches OBLIVION_AT (-500, inclusive) loses,
       the other seat wins. Written once, by applyAction, in the same action
       that carried the transaction; persisted with the state, so a refresh
       repaints the ending instead of restarting the match. */
    over: null,
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
    /* The Outer Space screen, or null - a SHARED screen like the chest, so
       every device draws the same counter from the same fact.

       phase     "selecting" (the suits are offered) | "acquired" (the
                 purchase is made and the popup speaks)
       expired   the suit id that was retired by this arrival, or null
       expiredNotice  true when that retirement must be announced (the
                 discount was never spent) */
    space: null,
    /* The suits the two seats carry, keyed by seat: `{ id, discount, price,
       used, since }` or null. One suit per seat; `used` is flipped by the
       first eligible purchase and the suit is retired on the seat's return
       to Outer Space. */
    suits: null,
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

         { id, owner, weapon, colony }

       `weapon` is the ONE weapon the shield answers, and `colony` is the
       exact ground it stands on. PERMANENT: a shield has no clock and no
       turn count. It is added when it is deployed at Kronos, is never
       ticked at TURN_END, and leaves this list only when its colony is
       captured by force or it blocks the strike it answers.

       ONE PER WEAPON, PER PLAYER, AT MOST THREE - the whole of the anti-stacking
       rule, and it is held by the draw itself rather than by a check here: a
       draw never offers a shield the player already stands behind, so a second
       copy cannot be drawn, a shield cannot be refreshed by redrawing it, and
       the list can never hold two entries that answer the same weapon. */
    shields: [],
    /* The BLACK HOLE CONFINEMENT, or null.

       Like the chest, the fight and Epoch it is a SHARED screen and a fact
       in the state - but where they last one visit, a confinement outlives
       visits: it holds a seat across turns until that seat buys, builds or
       earns its way out.

         playerId    the seat the singularity holds
         phase       "confined" | "released" (released is the vessel's beat)
         startedAt   the moment of capture - when the cinematic is played
         entropy     the escape energy gathered so far
         entropyRoll the seat pressed BUILD ENTROPY: their NEXT roll is
                     entropy, not movement
         escape      the seat pressed ESCAPE NEXT TURN: their NEXT roll moves
                     them and frees them, and nothing else may */
    hole: null,
    /* A Frozen Moment laid on a seat, per seat. One-shot: it cancels a pending
       bonus roll, or nullifies the opponent's next bonus grant within their
       following turn, and is always cleared by the end of that turn. */
    frozen: { 0: false, 1: false },
    /* THE FIRST THROW OF EACH SEAT, and what it promised.

       `firstRoll[seat]` is true once that seat has thrown their first die -
       written by the throw itself, in this state, so it survives a refresh,
       a reconnect and every later turn: a civilization's power can only ever
       fire once.

       `civGift[seat]` is the promise that throw made when the landing kept
       it - a blessing for the first purchase, two weapons at Ragnarok,
       Jupiter without tribute. It is spent by the visit that earned it and
       cleared when the turn resolves, so a promise can never reach a later
       turn, and a duplicate press finds nothing left to spend. */
    firstRoll: { 0: false, 1: false },
    civGift: { 0: null, 1: null },
    /* THE NEXUS LOANS, per seat. A seat may borrow against the purchase value
       of the properties it owns, repay within five full circuits of the
       board, or forfeit the security. `null` when nothing is owed;
       otherwise the loan the seat is carrying. */
    loans: { 0: null, 1: null },
    /* THE INTRODUCTION, once for the whole game.

       Both players are shown it when the game begins; only `intro.seat` -
       the player who takes the first throw - has the button that dismisses
       it and lets the game start. `intro.done` is that press, written into
       this state, so a refresh or a reconnect reads the same answer rather
       than showing the introduction again, and the opponent - who never had
       the button - never sees it once it is done. */
    intro: { seat: ledger.players[0]?.seat ?? null, done: false },
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
    loans: { ...(state.loans || { 0: null, 1: null }) },
    hole: state.hole ? { ...state.hole } : null,
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

/* ---------------------------------------------------------------- the square */

/**
 * WHAT THE SQUARE WANTS, DECIDED ONCE.
 *
 * One piece of code answers a landing, for the throw that starts a turn and
 * for the movement an Epoch Time Card makes later in the same turn. It opens
 * the square's own decision in the state - the purchase, the rent, the chest,
 * the fight, Epoch, the singularity, the suits - and leaves the phase at
 * MOVING so the coin's walk finishes before anything is asked of the player.
 * It never ends a turn: what happens after the square has been answered is
 * the turn's own walk (`continue`), exactly as for a throw.
 *
 * It reads only what it is handed - the state it copies the visit's carried
 * facts from, the copy it writes into, and the facts of the move - so a card
 * movement and a throw land on the same rules by construction, not by
 * agreement.
 */
function openLanding(next, ok, { state, seat, from, to, face, redemption = 0 }) {
  const cell = CELLS.find((entry) => entry.index === to) || CELLS[to];

  next.landing = {
    seat,
    index: to,
    id: cell?.id || "",
    kind: "none",
  };
  next.chest = null;
  next.space = null;
  next.visit = {
    seat,
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
    /* What completing a lap is owed, paid when the turn is resolved. A
       landing in the middle of a turn - an Epoch card's move - carries
       forward what the throw that opened the turn had already earned, so
       the two crossings are paid together and neither is lost. */
    redemption: Number(redemption) || 0,
    /* Nexus only. */
    prayed: false,
    nexusDrawn: false,
    nexusCard: null,
    /* The player left the Nexus without praying or drawing. */
    declined: false,
  };
  next.phase = PHASE.MOVING;

  ok("landed", {
    seat,
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
    } else if (owner === seat) {
      next.landing.kind = "own";
    } else {
      next.landing.kind = "rent";
      const verdict = payRent(next.ledger, cell.id, seat);
      next.visit.rent = verdict.rent || 0;
      next.visit.paid = Boolean(verdict.paid);
      next.visit.short = verdict.shortfall || 0;

      /* The two sides of one payment, written for the two people who will
         read them. Both devices read the same ledger, so the payer's history
         says what they paid and the holder's says what they received. */
      recordEntry(next.ledger, {
        turn: state.turn,
        seat,
        kind: "rent",
        text: `Rent paid to ${nameOfSeat(next.ledger, owner)} · ${cell.name}`,
        amount: -(verdict.amount || 0),
      });
      if ((verdict.amount || 0) > 0) {
        recordEntry(next.ledger, {
          turn: state.turn,
          seat: owner,
          kind: "rent",
          text: `Rent received from ${nameOfSeat(next.ledger, seat)} · ${cell.name}`,
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
          from: seat,
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
          from: seat,
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
      playerId: seat,
      phase: "open",
      startedAt: now(),
      choice: null,
      result: null,
    };
    ok("chestOpened", {
      kind: next.chest.kind,
      seat,
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
      playerId: seat,
      phase: "open",
      selectedWeaponId: null,
      armed: false,
      targetId: null,
      result: null,
      startedAt: now(),
    };
    ok("fightOpened", { seat, startedAt: next.fight.startedAt });
  } else if (EPOCH && cell?.id === EPOCH.id) {
    /* EPOCH OPENS HERE, IN THE STATE. The same shared screen as the two
       chests and the fight: the fact lives in the state and every client
       draws the middle from it. The player who landed acts; the other
       watches read-only. The two facts the movement cards need - how far
       the last throw went, and where the coin stood before it - are read
       from the move that landed here, never guessed. */
    next.landing.kind = "epoch";
    next.epoch = {
      playerId: seat,
      phase: "open",
      startedAt: now(),
      cardId: null,
      result: null,
      /* The two facts the movement cards read: how far this move went,
         and where the coin stood before it. Both are the move that just
         landed here - the genuine values, never a guess. */
      rewindSteps: face,
      fracturePos: from,
    };
    ok("epochOpened", { seat, startedAt: next.epoch.startedAt });
  } else if (HOLE_CELL && cell?.id === HOLE_CELL.id) {
    /* THE SINGULARITY TAKES HOLD HERE, IN THE STATE.

       The same shared screen as the chests, the fight and Epoch - the
       fact lives in the state and every client draws the middle from
       it. What is its own is that it outlives the visit: `hole` holds
       the seat across turns, and every later rule of the confinement
       reads it.

       ONE CONFINEMENT AT A TIME. The corner takes whoever lands on it
       while nobody is held; a landing while the other seat is already
       held is an ordinary silent corner - the simplest rule that can
       never strand two seats in one hole or free the first by force. */
    if (next.hole) {
      next.landing.kind = "none";
    } else {
      next.landing.kind = "hole";
      next.hole = {
        playerId: seat,
        phase: "confined",
        startedAt: now(),
        entropy: 0,
        entropyRoll: false,
        escape: false,
      };
      ok("holeOpened", {
        seat,
        startedAt: next.hole.startedAt,
        threshold: holeThreshold(next.ledger, seat),
      });
    }
  } else if (SPACE_CELL && cell?.id === SPACE_CELL.id) {
    /* OUTER SPACE OFFERS THE SUITS, AND RETIRES THE OLD ONE.

       The screen is a shared fact like every chest and panel; arriving
       here is also the far side of the circuit a suit was bought on, so
       any suit this seat still carries is retired on this landing -
       announced when its discount was never spent, silently when it
       was. The turn itself is untouched: the screen decides what comes
       next, and `continue` leaves it the way every visit is left. */
    next.landing.kind = "space";
    next.space = {
      playerId: seat,
      phase: "selecting",
      startedAt: now(),
      expired: null,
      expiredNotice: false,
    };
    const carried = (state.suits || {})[seat] || null;
    if (carried) {
      next.suits = { ...(state.suits || {}), [seat]: null };
      if (!carried.used) {
        next.space.expired = carried.id;
        next.space.expiredNotice = true;
      }
      ok("suitExpired", {
        seat,
        suit: carried.id,
        used: Boolean(carried.used),
      });
    }
    ok("spaceOpened", { seat, startedAt: next.space.startedAt });
  } else {
    next.landing.kind = "none";
  }

  /* MOVING is the phase the coin is walking in. What the square wants is
     already known (`landing.kind`), but the card is not up yet: `continue`
     is what the client sends when the coin has stopped, and that is the
     step that opens the decision. A square that wants nothing goes to
     RESOLVING instead, so the highlight has its own moment. */
  next.phase = PHASE.MOVING;
  return next;
}

/* ----------------------------------------------------------------- the rules */

/**
 * Do one thing, and say what happened.
 *
 * The state handed in is never changed. A refusal returns it untouched with a
 * single `refused` event carrying a sentence for the player; an acceptance
 * returns a new state and the events the screen should animate.
 */
/**
 * One move, decided by the server - the exported entry point everything
 * (worker, tests) plays through.
 *
 * THE OBLIVION GATE lives here, around the rules themselves: once the game
 * has an `over`, every action is refused without touching the state, and
 * after each accepted action the purses are re-read - the first seat at or
 * below OBLIVION_AT ends the game in the same action that pushed it there.
 * `over` is written exactly once and an `oblivion` event carries it to both
 * screens; a refused press returns the original state object and is never
 * re-checked, so an end can neither be duplicated nor faked.
 */
export function applyAction(state, action, rng = Math.random) {
  if (state?.over) return refused(state, action, "This game has ended.");

  const result = applyActionInner(state, action, rng);
  const next = result.state;
  if (!next || next.over) return result;
  // A refusal hands back the untouched state - nothing moved, nothing to check.
  if (result.events.some((e) => e.type === "refused")) return result;

  for (const p of next.ledger.players) {
    if ((p.money ?? 0) <= OBLIVION_AT) {
      const loser = p.seat;
      const winner = next.ledger.players.find((q) => q.seat !== loser)?.seat;
      if (winner === undefined || winner === null) break;
      next.over = { winner, loser, kind: "oblivion", at: next.turn };
      result.events.push({ type: "oblivion", seq: next.seq, winner, loser, at: next.turn });
      break;
    }
  }
  return result;
}

function applyActionInner(state, action, rng = Math.random) {
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
    /* --------------------------------------------------- the introduction */
    case "introSeen": {
      /* ONE PRESS, BY THE PLAYER WHO TAKES THE FIRST THROW.

         Both players are shown the introduction; only `intro.seat` is given
         the button, so the opponent can read it and nothing more. The press
         is written into this state, which is what makes it one press for the
         whole game: a refresh or a reconnect reads it, the opponent's screen
         goes down with it, and it can never come back. A second press, or
         one from a seat that was never holding the button, changes nothing. */
      if (!state.intro || state.intro.done) return { state: next, events };
      const seat = Number(actor);
      if (!Number.isInteger(seat) || seat !== Number(state.intro.seat)) {
        return refused(state, action, "Only the player who takes the first throw can begin.");
      }
      next.intro = { ...state.intro, done: true };
      ok("introSeen", { seat });
      return { state: next, events };
    }

    /* ------------------------------------------------------------- the roll */
    case "roll": {
      if (state.phase !== PHASE.AWAITING_ROLL) {
        return refused(state, action, "The die waits until the visit is over.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (!piece) return refused(state, action, "That seat has no piece.");

      /* A CONFINED PLAYER ROLLS ONLY WHAT THEIR CONFINEMENT ALLOWS.

         The singularity holds the die: a confined seat whose next roll has
         not been decided by the panel may not throw at all. The two decided
         rolls - entropy, and the committed escape - are the only rolls the
         hole lets through, and each is answered inside this action. */
      const confined = state.hole?.playerId === active && state.hole?.phase !== "released"
        ? state.hole
        : null;
      if (confined && !confined.escape && !confined.entropyRoll) {
        return refused(state, action, "The singularity holds you. The panel decides your roll.");
      }

      const drawn = Number(rng());
      const rolledFace = 1 + Math.min(5, Math.floor((Number.isFinite(drawn) ? drawn : 0) * 6));
      /* A FUTURE SIGHT reservation is the die now: the number was fixed when
         the card was drawn and it is consumed exactly here, so the visual die,
         the recorded roll and the movement can never disagree. Nothing else
         may change it, and a reload keeps it because it lives in the state. */
      const reserved = state.futureSight?.[active];
      let face = Number.isInteger(reserved) ? reserved : rolledFace;

      /* ANCIENT ROMAN'S POWER IS THE THROW ITSELF.

         Their first die is a six - the real one, decided here where every
         other face is decided, so the recorded roll, the walk and the die on
         the screen are all the same six. It is applied to the FIRST throw
         only (`firstRoll` is written by this same action, below), and every
         throw after it takes whatever the rng says, exactly as before. */
      const firstThrow = !state.firstRoll?.[active];
      if (firstThrow && civOf(state, active) === "ancient-roman") face = 6;

      /* ENTROPY, NOT MOVEMENT - AND THE PANEL, NOT THE WALK.

         The roll is the die the player was always going to throw - same rng,
         same faces, same tumble on both screens - and its face becomes
         escape energy instead of steps. Nothing moves, no square is landed
         on, and `lastRoll` is untouched (it records a MOVEMENT and this is
         not one).

         The phase goes straight to the panel's DECISION: the confinement
         popup reopens over the new figure the moment the throw is read and
         WAITS for the player's choice - build again, escape, or buy the
         vessel. Under RESOLVING the walk auto-continued, the popup appeared
         only to vanish, and the turn ended with no say (the reported bug).
         At DECISION the walk stops, `continue` is refused by the hole's own
         guard, and the panel is the only door out. */
      if (confined?.entropyRoll) {
        if (Number.isInteger(reserved)) {
          next.futureSight = { ...(state.futureSight || { 0: null, 1: null }), [active]: null };
        }
        if ((state.bonusRolls?.[active] || 0) > 0) {
          next.bonusRolls = { ...(state.bonusRolls || { 0: 0, 1: 0 }), [active]: state.bonusRolls[active] - 1 };
        }
        const entropy = (confined.entropy || 0) + face;
        const threshold = holeThreshold(next.ledger, active);
        next.hole = { ...confined, entropy, entropyRoll: false };
        next.phase = PHASE.DECISION;
        ok("holeEntropy", {
          seat: active,
          face,
          gained: face,
          entropy,
          threshold,
        });
        return { state: next, events };
      }

      /* THE COMMITTED ESCAPE ROLL. It is an ordinary roll in every way - the
         coin walks, the square answers - and the hole is gone before the
         walk begins, so the release cannot be lost to a later refusal and
         the landing that follows is an ordinary landing. */
      if (confined?.escape) {
        next.hole = null;
        ok("holeEscaped", { seat: active, face });
      }
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
      /* A loan's deadline is measured in full circuits of the board from the
         square it was taken on - every pass of that square counts, whoever's
         throw made it. */
      tickLoanCircuits(next, state, active, from, face);
      next.lastRoll = {
        seat: active, face, from, to, id: cell?.id || "",
        ...(bonus ? { bonus: true } : {}),
        ...(Number.isInteger(reserved) ? { reserved: "future-sight" } : {}),
      };

      ok("moved", {
        seat: active,
        from,
        to,
        steps: face,
        path: pathFrom(from, face),
        face,
      });

      /* What the square wants, decided by the one landing rule every move
         shares - the throw's own, and (since Epoch) a Time Card's. */
      openLanding(next, ok, {
        state,
        seat: active,
        from,
        to,
        face,
        redemption: crossedStart ? REDEMPTION : 0,
      });

      /* THE FIRST THROW IS SPENT HERE, AND WHAT IT PROMISED IS WRITTEN WITH
         IT.

         Both facts live in this state: `firstRoll` says the seat has thrown
         their first die, so no refresh, reconnect, later turn or retried
         press can make the power fire again; `civGift` is the promise this
         throw made now that the landing is known - a blessing for the first
         purchase, two weapons at Ragnarok, Jupiter without tribute - waiting
         for the visit that earned it.

         A throw that is NOT the first clears any promise still standing: a
         bonus roll is a new throw, and it can never inherit the first one's
         gift. Ancient Roman carries nothing here, because its gift was the
         six the die already threw. */
      if (firstThrow) {
        next.firstRoll = { ...(state.firstRoll || {}), [active]: true };
      }
      next.civGift = {
        ...(state.civGift || {}),
        [active]: firstThrow ? giftOf(civOf(state, active), next.landing) : null,
      };
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

      /* The same confinement gate as the ordinary throw: a held seat whose
         next roll is undecided may not throw; the two decided rolls are
         answered here, the same way. */
      const confined = state.hole?.playerId === active && state.hole?.phase !== "released"
        ? state.hole
        : null;
      if (confined && !confined.escape && !confined.entropyRoll) {
        return refused(state, action, "The singularity holds you. The panel decides your roll.");
      }

      const face = steps;

      /* ENTROPY, NOT MOVEMENT. The test throw's own number becomes the
         energy - the same conversion the real die makes, so the system can
         be walked through step by step. The phase goes to the panel's
         DECISION for the same reason the real throw's does: the popup
         reopens over the new figure and waits for the choice. */
      if (confined?.entropyRoll) {
        const entropy = (confined.entropy || 0) + face;
        const threshold = holeThreshold(next.ledger, active);
        next.hole = { ...confined, entropy, entropyRoll: false };
        next.phase = PHASE.DECISION;
        ok("holeEntropy", {
          seat: active,
          face,
          gained: face,
          entropy,
          threshold,
          test: true,
        });
        return { state: next, events };
      }

      /* THE COMMITTED ESCAPE ROLL: an ordinary throw, and the hole is gone
         before the walk begins. */
      if (confined?.escape) {
        next.hole = null;
        ok("holeEscaped", { seat: active, face, test: true });
      }

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
      tickLoanCircuits(next, state, active, from, face);
      next.lastRoll = { seat: active, face, from, to, id: cell?.id || "", test: true };

      next.landing = {
        seat: active,
        index: to,
        id: cell?.id || "",
        kind: "none",
      };
      next.chest = null;
      next.space = null;
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
      } else if (HOLE_CELL && cell?.id === HOLE_CELL.id) {
        /* The same confinement as the ordinary throw opens; the Test throw
           walks here so the whole system can be tried on demand. */
        if (next.hole) {
          next.landing.kind = "none";
        } else {
          next.landing.kind = "hole";
          next.hole = {
            playerId: active,
            phase: "confined",
            startedAt: now(),
            entropy: 0,
            entropyRoll: false,
            escape: false,
          };
          ok("holeOpened", {
            seat: active,
            startedAt: next.hole.startedAt,
            threshold: holeThreshold(next.ledger, active),
            test: true,
          });
        }
      } else if (SPACE_CELL && cell?.id === SPACE_CELL.id) {
        /* OUTER SPACE OFFERS THE SUITS, AND RETIRES THE OLD ONE.

           The screen is a shared fact like every chest and panel; arriving
           here is also the far side of the circuit a suit was bought on, so
           any suit this seat still carries is retired on this landing -
           announced when its discount was never spent, silently when it
           was. The turn itself is untouched: the screen decides what comes
           next, and `continue` leaves it the way every visit is left. */
        next.landing.kind = "space";
        next.space = {
          playerId: active,
          phase: "selecting",
          startedAt: now(),
          expired: null,
          expiredNotice: false,
        };
        const carried = (state.suits || {})[active] || null;
        if (carried) {
          next.suits = { ...(state.suits || {}), [active]: null };
          if (!carried.used) {
            next.space.expired = carried.id;
            next.space.expiredNotice = true;
          }
          ok("suitExpired", {
            seat: active,
            suit: carried.id,
            used: Boolean(carried.used),
          });
        }
        ok("spaceOpened", { seat: active, startedAt: next.space.startedAt });
      } else {
        next.landing.kind = "none";
      }

      /* THE TEST MOVE CARRIES THE PROMISE OF THE SQUARE IT REACHES.

         A test move is a chosen number rather than a die, so it never decides
         Ancient Roman's six - that belongs to the first real throw, and this
         leaves it exactly as it was. But the three civilizations whose gift is
         about the SQUARE the coin reaches are promised here too: the first
         time the coin reaches that square, the gift is written and the throw
         is spent with it, so the powers can be seen in a test game exactly as
         they are played - and never twice, because a granted gift is a spent
         first throw and a second move finds nothing left to grant. */
      const testGift = state.firstRoll?.[active]
        ? null
        : giftOf(civOf(state, active), next.landing);
      if (testGift) {
        next.firstRoll = { ...(state.firstRoll || {}), [active]: true };
      }
      next.civGift = { ...(state.civGift || {}), [active]: testGift };

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
      /* A SUIT'S DISCOUNT IS SPENT HERE, ON THE PRICE AND THE PRICE ALONE.

         The carried suit - if it is unspent - comes off the purchase figure
         before the funds are asked, and this very purchase is what consumes
         it: `used` flips below in the same action that moved the money, so
         one suit can never discount twice and rent, upgrades, fees and every
         other charge are untouched. */
      const suit = (state.suits || {})[active] || null;
      /* ANCIENT ROMAN'S NEIGHBOUR TAKES JUPITER WITHOUT TRIBUTE.

         The gift is the whole price off - the same `discount` the suit uses,
         so the money, the ledger and the card's figure all follow the one
         path they already follow - and unlike a suit it consumes nothing:
         the tribute was never owed, so the carried suit is left standing for
         whatever it was meant for. It is the promise the first throw made,
         and spending it here is what retires it. */
      const gift = state.civGift?.[active] || null;
      const giftedFree = gift === "free-jupiter" && id === (JUPITER?.id || "");
      const discount = giftedFree ? 100 : suit && !suit.used ? suit.discount || 0 : 0;
      const verdict = ledgerBuy(next.ledger, id, active, { discount });
      if (!verdict.ok) return refused(state, action, verdict.why);

      if (!giftedFree && discount > 0) {
        next.suits = { ...(state.suits || {}), [active]: { ...suit, used: true } };
      }
      if (gift) {
        next.civGift = { ...(state.civGift || {}), [active]: null };
      }

      next.visit.bought = true;
      next.phase = PHASE.RESOLVING;
      recordEntry(next.ledger, {
        turn: state.turn,
        seat: active,
        kind: "buy",
        text:
          `Bought ${landingCell(next)?.name || id}` +
          (giftedFree ? " · Olympus" : discount > 0 && suit ? ` · ${suit.name} −${discount}%` : ""),
        amount: -verdict.spent,
      });

      /* INDUS VALLEY'S BLESSING, IN THE SAME ACTION THAT BOUGHT THE SQUARE.

         The universe favours the first territory: ₹50 comes back the moment
         the purchase is made - once, from the one promise the first throw
         left behind, and recorded in the ledger so both screens read the
         same balance. */
      let paid = verdict.money;
      if (gift === "first-acquisition") {
        const blessed = adjustMoney(next.ledger, active, FIRST_ACQUISITION_BLESSING, {
          turn: state.turn,
          kind: "blessing",
          text: "First acquisition · the gods return ₹50",
        });
        if (blessed.ok) paid = blessed.money;
      }

      ok("bought", {
        seat: active,
        id,
        name: landingCell(next)?.name || id,
        price: verdict.spent,
        money: paid,
        ...(giftedFree ? { gift: "free-jupiter" } : {}),
        ...(gift === "first-acquisition" ? { blessing: FIRST_ACQUISITION_BLESSING } : {}),
        ...(discount > 0 && suit ? { suit: suit.id, suitDiscount: discount, listPrice: verdict.full } : {}),
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

      /* MESOPOTAMIAN'S FIRST JOURNEY WAS TO RAGNAROK: THE HEAVENS ANSWER
         WITH TWO.

         The second card is drawn by the server from the same deck, prefers
         a weapon the seat does not yet hold, and joins the arsenal in this
         same press - so one tap brings both, both devices see them arrive
         together, and the promise is retired here so a second press (a
         reconnect, a repeated tap) finds nothing left to grant. */
      const gift = state.civGift?.[active] || null;
      let second = null;
      if (gift === "two-weapons") {
        const held = new Set(piece.weapons);
        const fresh = WEAPONS.filter((w) => !held.has(w.id));
        const pool = fresh.length ? fresh : WEAPONS;
        const pick = Math.min(pool.length - 1, Math.floor((Number(rng()) || 0) * pool.length));
        second = pool[pick]?.id || null;
        if (second) piece.weapons.push(second);
        next.civGift = { ...(state.civGift || {}), [active]: null };
      }

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
        text:
          `Drew ${weaponById(weapon)?.name || weapon}` +
          (second ? ` and ${weaponById(second)?.name || second}` : ""),
        amount: 0,
      });
      ok("weaponCollected", {
        seat: active,
        weapon,
        weapons: [...piece.weapons],
        ...(second ? { second } : {}),
      });
      return { state: next, events };
    }

    /* -------------------------------------------------------------- Kronos

       The shield chest, as ONE POPUP with a deployment inside it.

       Draw (the server decides, the clients shuffle and reveal in the same
       card) -> the shield's explanation in the same popup -> COLLECT, which
       highlights the colonies the shield can actually stand on -> a tap on
       a highlighted colony deploys it there. Nothing deploys at the draw,
       nothing is stored in an inventory, and the chip says nothing about a
       card that is merely revealed: a shield exists only once it stands on
       a colony.

       COMPATIBILITY comes from the data and nothing else: a shield counters
       one weapon (its `counters`), and the colonies it can defend are
       exactly the colonies that weapon reaches, owned by the deploying
       player. The three weapons' target lists are disjoint, so two shields
       can never stand on the same colony. */

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

         One shield per weapon, per player: the draw never offers a shield
         the player already has STANDING on a colony. With all three
         standing the draw is a miss ("none"), and the visit is answered
         either way. Nothing is deployed here - the card is merely revealed;
         deployment is COLLECT, then a colony. */
      const standing = (state.shields || [])
        .filter((entry) => entry.owner === active)
        .map((entry) => entry.id);
      const outcome = drawShield(rng, standing);
      const shield = outcome ? shieldById(outcome) : null;
      const none = !shield;

      next.visit.shieldDrawn = none ? "none" : outcome;
      next.phase = PHASE.DECISION;
      /* ONE POST-DRAW PHASE, AND IT IS THE REVEAL: the face is decided the
         moment the button is pressed, so the clients play the shuffle as an
         entrance and then show the face the state is ALREADY holding - the
         same "a device that arrives late sees the whole shuffle" design the
         Nexus deck works by, with no reveal round-trip to strand. The card
         then waits, explanation and COLLECT visible, until the player acts. */
      next.chest.phase = "revealed";
      next.chest.startedAt = now();
      next.chest.choice = "draw";
      next.chest.result = {
        shield: none ? null : outcome,
        none,
        /* The face the player touched. Both devices turn over the same one. */
        slot: Number.isInteger(action.slot) ? Math.max(0, Math.min(2, action.slot)) : 1,
      };
      ok("shieldDrawn", {
        seat: active,
        shield: none ? null : outcome,
        none,
        weapon: shield?.counters || null,
        slot: next.chest.result.slot,
        startedAt: next.chest.startedAt,
      });
      return { state: next, events };
    }

    /* COLLECT - the press that BEGINS deployment.

       It does not take the shield anywhere: it computes, here on the server,
       which colonies could legally receive this shield - the countered
       weapon's own reach, intersected with what this player owns - and puts
       the board into targeting with that list. An empty list is not a
       refusal: it is the answer the card shows as the decline message, and
       the player stays inside the popup with Done still available. */
    case "collectShield": {
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "chest" ||
        !(KRONOS && state.landing?.id === KRONOS.id)
      ) {
        return refused(state, action, "There is no chest to draw from.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (!state.chest || state.chest.kind !== "kronos") {
        return refused(state, action, "There is no chest to draw from.");
      }
      if (state.chest.phase !== "revealed") {
        return refused(state, action, "The colonies are already highlighted.");
      }
      const shieldId = state.chest.result?.shield;
      if (!shieldId || state.chest.result?.none) {
        return refused(state, action, "There is no shield to deploy.");
      }
      const shield = shieldById(shieldId);
      const weapon = shield ? weaponById(shield.counters) : null;
      if (!shield || !weapon) return refused(state, action, "There is no shield to deploy.");

      const compatible = (weapon.targets || []).filter(
        (id) => ownerOf(next.ledger, id) === active,
      );
      next.chest.phase = "targeting";
      next.chest.startedAt = now();
      next.chest.result = { ...state.chest.result, compatible };
      ok("shieldTargeting", {
        seat: active,
        shield: shield.id,
        weapon: shield.counters,
        compatible: [...compatible],
      });
      return { state: next, events };
    }

    /* THE COLONY TAP: deployment, validated against a fresh computation of
       compatibility (ownership may have changed since COLLECT), happening in
       the same action that records it - so a repeated tap finds the phase
       already moved and deploys nothing twice. */
    case "deployShield": {
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "chest" ||
        !(KRONOS && state.landing?.id === KRONOS.id)
      ) {
        return refused(state, action, "There is no chest to draw from.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (!state.chest || state.chest.kind !== "kronos") {
        return refused(state, action, "There is no chest to draw from.");
      }
      if (state.chest.phase !== "targeting") {
        return refused(state, action, "There is no colony to deploy to.");
      }
      const shieldId = state.chest.result?.shield;
      const shield = shieldId ? shieldById(shieldId) : null;
      const weapon = shield ? weaponById(shield.counters) : null;
      if (!shield || !weapon) return refused(state, action, "There is no shield to deploy.");

      const colonyId = String(action.colonyId ?? "");
      const compatible = (weapon.targets || []).filter(
        (id) => ownerOf(next.ledger, id) === active,
      );
      if (!compatible.includes(colonyId)) {
        return refused(state, action, "That colony cannot receive this shield.");
      }
      const colonyName = CELLS.find((c) => c.id === colonyId)?.name || colonyId;

      next.shields = [
        ...(state.shields || []),
        {
          id: shield.id,
          owner: active,
          weapon: shield.counters,
          colony: colonyId,
        },
      ];
      next.chest.phase = "deployed";
      next.chest.startedAt = now();
      /* The colony joins the result so the card - on both screens, from the
         state alone - can say where the shield now stands. */
      next.chest.result = { ...state.chest.result, colony: colonyId };
      recordEntry(next.ledger, {
        turn: state.turn,
        seat: active,
        kind: "shield",
        text: `Deployed ${shield.name} on ${colonyName} - stops ${weapon.name}`,
        amount: 0,
      });
      ok("shieldDeployed", {
        seat: active,
        shield: shield.id,
        colony: colonyId,
        weapon: shield.counters,
      });
      return { state: next, events };
    }

    /* ---------------------------------------------------- Black Hole panel

       Three presses, and only the held seat may make them, only while the
       panel is up (its own DECISION turn), and only once each: every press
       moves the confinement on to a state the other presses refuse. */

    case "buildEntropy": {
      if (
        state.phase !== PHASE.DECISION ||
        !state.hole ||
        state.hole.playerId !== active ||
        state.hole.phase !== "confined"
      ) {
        return refused(state, action, "There is no confinement here.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.hole.entropyRoll || state.hole.escape) {
        return refused(state, action, "Your next roll is already decided.");
      }
      if ((state.hole.entropy || 0) >= holeThreshold(next.ledger, active)) {
        return refused(state, action, "You already hold the energy to escape.");
      }

      /* THE COMMITMENT IS THE PRESS. The next roll this seat throws is
         entropy - armed here, honoured in `roll` - and this turn ends at
         once so the opponent plays theirs. Nothing moves and no money
         changes hands. */
      next.hole = { ...state.hole, entropyRoll: true };
      next.phase = PHASE.TURN_END;
      ok("holeBuilt", {
        seat: active,
        entropy: state.hole.entropy || 0,
        threshold: holeThreshold(next.ledger, active),
      });
      return { state: next, events };
    }

    case "escapeNext": {
      if (
        state.phase !== PHASE.DECISION ||
        !state.hole ||
        state.hole.playerId !== active ||
        state.hole.phase !== "confined"
      ) {
        return refused(state, action, "There is no confinement here.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.hole.escape) {
        return refused(state, action, "You have already committed to your escape.");
      }
      if (state.hole.entropyRoll) {
        return refused(state, action, "You have already committed to building entropy.");
      }
      const threshold = holeThreshold(next.ledger, active);
      if ((state.hole.entropy || 0) < threshold) {
        return refused(state, action, "You do not hold the energy to escape yet.");
      }

      /* THE COMMITMENT HOLDS THEM UNTIL THE ROLL. Once pressed, no other
         press may replace it - no more entropy, no vessel - and the turn
         ends; the seat stays held through the opponent's turn and is
         released only by its own committed roll. */
      next.hole = { ...state.hole, escape: true };
      next.phase = PHASE.TURN_END;
      ok("holeCommitted", {
        seat: active,
        entropy: state.hole.entropy || 0,
        threshold,
      });
      return { state: next, events };
    }

    case "acquireVessel": {
      if (
        state.phase !== PHASE.DECISION ||
        !state.hole ||
        state.hole.playerId !== active ||
        state.hole.phase !== "confined"
      ) {
        return refused(state, action, "There is no confinement here.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.hole.escape) {
        return refused(state, action, "You have already committed to your escape.");
      }
      const player = state.ledger.players.find((entry) => entry.seat === active);
      if (!player) return refused(state, action, "That seat is not playing.");
      if ((player.money || 0) < VESSEL_PRICE) {
        return refused(state, action, "A Relativistic Escape Vessel costs ₹500, and you do not hold that much.");
      }

      /* ONE DEDUCTION, ONE RELEASE, ONE ACTION. The price is the whole of
         the price - no fine is added - the money moves through the ledger's
         own transaction with the entry that says what it bought, and the
         confinement is released in the same action that was paid for, so a
         repeated tap, a retry or a replayed request finds nothing left to
         buy and nothing left to charge. */
      adjustMoney(next.ledger, active, -VESSEL_PRICE, {
        turn: state.turn,
        kind: "hole",
        text: "Acquired a Relativistic Escape Vessel",
      });
      next.hole = { ...state.hole, phase: "released" };
      /* OUT THROUGH THE WORMHOLE, AND THE TURN IS OVER. The vessel does not
         merely open the corridor: it sets its passenger down at the Wormhole
         square in the same action that paid for it - one movement, no
         landing to answer (the square's own card never opens), and the walk
         carries the turn on to the opponent. */
      if (WORMHOLE_CELL && piece) piece.position = WORMHOLE_CELL.index;
      next.phase = PHASE.RESOLVING;
      ok("holeVessel", {
        seat: active,
        price: VESSEL_PRICE,
        money: (player.money || 0) - VESSEL_PRICE,
      });
      return { state: next, events };
    }

    /* ------------------------------------------------ Outer Space suits

       One press per visit: the price is taken, the suit is carried, and the
       screen moves to its popup. Every guard refuses before a coin moves, so
       a repeated tap, a second seat, or a purse that cannot cover the price
       changes nothing. */

    case "acquireSuit": {
      if (
        state.phase !== PHASE.DECISION ||
        state.landing?.kind !== "space" ||
        !state.space ||
        state.space.playerId !== active
      ) {
        return refused(state, action, "There is no suit offered here.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (state.space.phase !== "selecting") {
        return refused(state, action, "You have already chosen your suit.");
      }
      if ((state.suits || {})[active]) {
        return refused(state, action, "You are already carrying a suit.");
      }
      const suit = suitById(action.suitId);
      if (!suit) return refused(state, action, "That suit does not exist.");
      const wearer = state.ledger.players.find((entry) => entry.seat === active);
      if (!wearer) return refused(state, action, "That seat is not playing.");
      if ((wearer.money || 0) < suit.price) {
        return refused(
          state,
          action,
          `You need ${suit.price - (wearer.money || 0)} more for the ${suit.name}.`,
        );
      }

      /* ONE DEDUCTION, ONE SUIT, ONE SCREEN. The price moves through the
         ledger's own transaction; the suit is carried unspent (`used:
         false`) until its first eligible purchase consumes it; and the
         screen advances to the acquisition popup in the same action, so the
         popup can only ever be seen after a purchase that actually went
         through. */
      adjustMoney(next.ledger, active, -suit.price, {
        turn: state.turn,
        kind: "suit",
        text: `Acquired ${suit.name} · ${suit.tier}`,
      });
      next.suits = {
        ...(state.suits || {}),
        [active]: {
          id: suit.id,
          discount: suit.discount,
          price: suit.price,
          used: false,
          since: state.turn,
        },
      };
      next.space = { ...state.space, phase: "acquired", suit: suit.id };
      ok("suitAcquired", {
        seat: active,
        suit: suit.id,
        name: suit.name,
        price: suit.price,
        discount: suit.discount,
        money: (wearer.money || 0) - suit.price,
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

    /* --------------------------------------------------------------- Nexus loans

       A seat may borrow against the purchase value of the properties it owns.
       Three fixed amounts - ₹500, ₹1,000, ₹2,000 - and the total repayment is
       one and a half times the amount. The security is the mortgaged
       properties: they stay owned and keep working under the ordinary rules,
       and come free when the loan is repaid within five full circuits of the
       board from the square it was taken on. Miss the deadline and Nexus
       takes them, back to the bank and unbuilt, and the loan closes as
       defaulted - handled at the end of the turn in `continue`. */

    case "nexusLoan": {
      // The loan interface is always accessible regardless of game phase
      // Players can view and select loan amounts even at the beginning of a game
      // Only eligibility checks prevent actual loan granting
      if (actor !== active) return refused(state, action, "It is not your turn.");
      if (!piece) return refused(state, action, "That seat has no piece.");

      const amount = Number(action.amount);
      if (!LOAN_AMOUNTS.includes(amount)) {
        return refused(state, action, "That is not a sum the gods lend.");
      }
      if (state.loans?.[active] && state.loans[active].status === "active") {
        return refused(state, action, "You already owe the gods.");
      }

      const owned = PRICED_IDS.filter((id) => ownerOf(next.ledger, id) === active);
      const value = owned.reduce((sum, id) => sum + (priceOf(id) || 0), 0);
      if (value < amount) {
        return refused(state, action, "Your properties do not cover that sum.");
      }
      const mortgaged = mortgageSelection(owned, amount);
      if (!mortgaged || mortgaged.length === 0) {
        return refused(state, action, "Your properties do not cover that sum.");
      }

      const repayment = loanRepaymentOf(amount);
      adjustMoney(next.ledger, active, amount, {
        turn: state.turn,
        seat: active,
        kind: "loan",
        text: `Loan from the gods · ₹${amount}`,
      });
      for (const id of mortgaged) {
        const sheet = sheetFor(next.ledger, id);
        if (sheet) sheet.mortgaged = true;
      }
      next.loans = {
        ...(state.loans || { 0: null, 1: null }),
        [active]: {
          seat: active,
          amount,
          repayment,
          mortgaged,
          startedAt: now(),
          position: piece.position,
          circuits: 0,
          status: "active",
        },
      };
      const names = mortgaged.map((id) => CELLS.find((c) => c.id === id)?.name || id).join(", ");
      recordEntry(next.ledger, {
        turn: state.turn,
        seat: active,
        kind: "loan",
        text: `Loan from the gods · ₹${amount} · secured on ${names}`,
        amount,
      });
      ok("nexusLoan", { seat: active, amount, repayment, mortgaged, position: piece.position });
      return { state: next, events };
    }

    case "nexusRepay": {
      if (state.phase !== PHASE.AWAITING_ROLL) {
        return refused(state, action, "The Nexus answers when the turn is waiting.");
      }
      if (actor !== active) return refused(state, action, "It is not your turn.");
      const loan = state.loans?.[active] || null;
      if (!loan || loan.status !== "active") {
        return refused(state, action, "There is no loan to repay.");
      }
      if (moneyOf(next.ledger, active) < loan.repayment) {
        return refused(state, action, "Your purse cannot cover the repayment.");
      }

      adjustMoney(next.ledger, active, -loan.repayment, {
        turn: state.turn,
        seat: active,
        kind: "loan",
        text: `Repaid loan · ₹${loan.repayment}`,
      });
      for (const id of loan.mortgaged || []) {
        const sheet = sheetFor(next.ledger, id);
        if (sheet) sheet.mortgaged = null;
      }
      next.loans = { ...(state.loans || {}), [active]: { ...loan, status: "repaid" } };
      ok("nexusRepaid", { seat: active, amount: loan.repayment });
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

          A STANDS ON THE COLONY, not in a player's hand: a strike meets the
          shield when the TARGET is the colony it was deployed to and the
          weapon is the one it counters. Who owns the colony at this moment
          is beside the point - the shield protects the ground it stands on.

          - the shield is removed in the SAME action that read it, so it can
            be consumed only once - no second read, no second press;
          - this returns BEFORE the colony changes hands and BEFORE the
            weapon is spent, which is what stops the destructive effect from
            reaching the target through any other path;
          - only the shield's OWN weapon is answered; the other two pass by,
            and a strike on any other colony passes this shield entirely.

          The weapon stays with its owner: a block denies the strike, it
          does not delete the weapon. */
      const shield = (state.shields || []).find(
        (entry) => entry.colony === targetId && entry.weapon === weapon.id,
      );
      if (shield) {
        next.shields = (state.shields || []).filter((entry) => entry !== shield);
        const shieldName = shieldById(shield.id)?.name || shield.id;
        const protector = shield.owner;

        next.fight.phase = "resolving";
        next.fight.armed = false;
        next.fight.targetId = targetId;
        next.fight.result = {
          id: targetId,
          weapon: weapon.id,
          name: cell.name,
          from: protector,
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
          seat: protector,
          kind: "shield",
          text: `${shieldName} spent at ${cell.name}`,
          amount: 0,
        });

        ok("shieldBlocked", {
          seat: active,
          owner: protector,
          shield: shield.id,
          weapon: weapon.id,
          id: targetId,
          colony: targetId,
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
      sheet.upgradeLevel = 0;
      /* A colony taken by force transfers bare: the previous owner's
         upgrades do not travel with it, and the new owner buys into it as
         though it had never been built. */
      piece.weapons = piece.weapons.filter((id) => id !== weapon.id);

      /* A CAPTURED COLONY KEEPS NOTHING OF ITS OLD KEEPER'S DEFENCE.

          A shield stands ON THIS GROUND, and the ground has just changed
          hands. Whatever was deployed there by the losing player leaves
          with the capture - a captured property never keeps the previous
          owner's shield - so the colony arrives bare and the next strike
          meets an ordinary, unshielded colony. */
      next.shields = (next.shields || state.shields || []).filter(
        (entry) => entry.colony !== targetId,
      );

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
         change is made here and nowhere else.

         A MOVEMENT CARD DOES NOT MOVE YET. The draw shows the card, and the
         card is what the player reads; the wheel turns when they have finished
         reading it - on the press that closes the visit. The move is carried
         in `epoch.pending` as the signed distance it will travel, and the
         press that closes Epoch walks it and lands on the destination by the
         same rules a throw lands by. Nothing about the square it will reach
         is decided here, so a card can never buy, rent or chain in secret. */
      switch (card.effect) {
        case "rewind": {
          const steps = Number(state.epoch.rewindSteps);
          if (!Number.isInteger(steps) || steps < 1) {
            result.outcomeKind = NO_EFFECT;
            result.outcome = "No completed throw to rewind by.";
            break;
          }
          next.epoch.pending = {
            steps: -steps,
            note: `Time Rewind · back ${steps} to ${CELLS.find((c) => c.index === advance(piece.position, -steps))?.name || advance(piece.position, -steps)}`,
          };
          result.outcomeKind = "moved";
          result.outcome = steps === 1
            ? "The wheel will carry you one space back."
            : `The wheel will carry you ${steps} spaces back.`;
          break;
        }
        case "leap": {
          const to = advance(piece.position, 3);
          next.epoch.pending = {
            steps: 3,
            note: `Time Leap · forward 3 to ${CELLS.find((c) => c.index === to)?.name || to}`,
          };
          result.outcomeKind = "moved";
          result.outcome = "The wheel will carry you 3 spaces ahead.";
          break;
        }
        case "fracture": {
          const target = Number(state.epoch.fracturePos);
          if (!Number.isInteger(target)) {
            result.outcomeKind = NO_EFFECT;
            result.outcome = "No earlier moment to fracture back to.";
            break;
          }
          const to = advance(target, 0);
          next.epoch.pending = {
            steps: to - piece.position,
            note: `Time Fracture · back to ${CELLS.find((c) => c.index === to)?.name || to}`,
          };
          result.outcomeKind = "moved";
          result.outcome = "The wheel will return you to where the throw began.";
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
      const to = advance(piece.position, steps);

      /* The choice is made, and the card says what it chose - but the wheel
         still waits for the press that closes the visit, exactly as the other
         movement cards do. */
      const result = {
        ...state.epoch.result,
        outcomeKind: "moved",
        option,
        outcome: option === "forward"
          ? "The wheel will carry you 2 spaces ahead."
          : "The wheel will return you 2 spaces.",
      };
      next.epoch.result = result;
      next.epoch.pending = {
        steps,
        option,
        note: `Alternate Timeline · ${option} 2 to ${CELLS.find((c) => c.index === to)?.name || to}`,
      };
      next.epoch.phase = "revealed";

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
        /* A CONFINED TURN HAS NO OTHER WAY OUT. The panel is the whole of
           the decision - whether the turn began at the capture (its landing
           IS the hole) or at a later panel turn (no landing at all) - so a
           stray `continue` cannot end the turn early and slip the seat past
           its own confinement. */
        if (state.hole && state.hole.playerId === active && (kind === "hole" || !state.landing)) {
          return refused(state, action, "The singularity holds you. The panel decides your turn.");
        }
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
            /* THE KRONOS VISIT CAN ALWAYS BE LEFT, THE SAME WAY NEXUS'S CAN.

               Refusing the leave is what turned a client hiccup into a
               stranded game: a dropped or interrupted draw left the visit
               unanswered, every automatic `continue` was refused with "Draw
               from the chest first", and there was no press that could end
               the turn. So the leave is never refused. A player who walks
               away without drawing gets no shield; the chest closes and the
               turn carries on. */
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

          /* THE WHEEL TURNS WHEN THE CARD HAS BEEN READ.

             A movement card does not move on the draw - the draw shows the
             card, and the card is what the player reads. It moves on THIS
             press, and then it lands on the destination by the same rules a
             throw lands by: the purchase, the rent, the chest, the fight,
             Epoch, the singularity, the suits. The turn does NOT end here -
             the destination is a visit of its own, and the ordinary walk
             (MOVING, then whatever the square wants) takes it from here.

             The visit the throw began is replaced by the destination's own,
             with one thing carried across: a Redemption earned on the way to
             Epoch is still owed when the turn resolves, and a crossing the
             card itself makes earns one the same way a throw's crossing does. */
          const pending = state.epoch.pending;
          if (pending && piece && Number.isInteger(pending.steps) && pending.steps !== 0) {
            /* The visit is over the moment the wheel turns: the destination is
               a landing of its own, and a landing that reaches Epoch must find
               the threshold closed, not the card that is being left. */
            next.epoch = null;
            const from = piece.position;
            const to = advance(from, pending.steps);
            const path = pathFrom(from, pending.steps);
            piece.position = to;

            recordEntry(next.ledger, {
              turn: state.turn,
              seat: active,
              kind: "epoch",
              text: pending.note ||
                `Time moved · to ${CELLS.find((c) => c.index === to)?.name || to}`,
              amount: 0,
            });
            ok("epochMoved", {
              seat: active,
              from,
              to,
              path,
              steps: pending.steps,
              backward: pending.steps < 0,
            });

            const cardCrossed = pending.steps > 0 && from > 0 && from + pending.steps >= BOARD_SIZE;
            openLanding(next, ok, {
              state,
              seat: active,
              from,
              to,
              face: Math.abs(pending.steps),
              redemption: (Number(state.visit?.redemption) || 0) + (cardCrossed ? REDEMPTION : 0),
            });
            return { state: next, events };
          }

          next.epoch = null;
        }
        if (kind === "space") {
          /* THE SUIT SCREEN IS LEFT THE WAY EVERY VISIT IS LEFT. Both of its
             exits - CONTINUE JOURNEY after the popup, and the plain leave on
             the selection screen - are this same press: the screen goes down
             and the turn ends through the normal walk, with no separate
             closing action of its own. */
          next.space = null;
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

      /* A CONFINEMENT RELEASED THIS TURN GOES WITH THE TURN. The vessel's
         release has had its beat (RESOLVING, then this); by the time a new
         turn is begun the hole is simply gone. */
      if (next.hole?.phase === "released") next.hole = null;

      /* WHICH PHASE A SEAT'S TURN BEGINS IN.

         An ordinary seat begins with the die. A HELD seat begins with the
         PANEL - its turn IS the panel - unless its confinement has already
         decided the roll it owes: entropy to gather, or the escape it
         committed to. Those two begin with the die the ordinary way, and
         the roll they throw is answered inside `roll`. */
      const turnPhaseFor = (seat) => {
        const held = next.hole && next.hole.playerId === seat && next.hole.phase !== "released";
        if (!held) return PHASE.AWAITING_ROLL;
        return next.hole.entropyRoll || next.hole.escape
          ? PHASE.AWAITING_ROLL
          : PHASE.DECISION;
      };

      /* A TEMPORAL LOOP OR A STOLEN MOMENT IS STILL WAITING. The turn does not
         move on while the player holds an unspent bonus roll: the moment
         repeats, and they throw again. The bonus is spent by the throw itself
         (in `roll`), so this can only ever grant the rolls that are actually
         owed - never an endless loop. A Frozen Moment on this seat has already
         eaten the bonus at the moment it was drawn, so nothing is pending here
         for a frozen player. */
      if ((state.bonusRolls?.[state.active] || 0) > 0) {
        next.phase = turnPhaseFor(state.active);
        next.landing = null;
        next.visit = null;
        next.chest = null;
        next.fight = null;
        next.epoch = null;
        /* A civilization's promise belongs to the throw that made it and the
           visit that earned it. The visit is over: anything unspent is
           forfeit here, exactly as the spec has it - the power expires with
           the first roll whether or not it was used. */
        next.civGift = { 0: null, 1: null };
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

      /* KRONOS SHIELDS ARE PERMANENT.

         Once deployed a shield stands until a weapon breaks it, and nothing
         here touches it - no ticking, no expiry, no turn limit. A shield
         leaves this list only when it blocks a strike, in fightAttack. */
      next.shields = next.shields || [];

      /* A NEXUS LOAN FALLS DUE AFTER FIVE FULL CIRCUITS.

         One circuit is the coin passing the square the loan was taken on,
         counted as it walks. Five circuits is the deadline: Nexus takes the
         security, the mortgaged colonies return to the bank unbuilt, and the
         loan is closed as defaulted. A seat with no active loan is skipped,
         so an untouched seat never pays for another's debt. */
      for (const seat of Object.keys(next.loans || {})) {
        const loan = next.loans[seat] || null;
        if (!loan || loan.status !== "active") continue;
        if ((loan.circuits || 0) < 5) continue;
        const taken = [];
        for (const id of loan.mortgaged || []) {
          const sheet = sheetFor(next.ledger, id);
          if (!sheet || sheet.mortgaged !== true) continue;
          sheet.owner = null;
          sheet.upgradeLevel = 0;
          sheet.mortgaged = null;
          taken.push(id);
          recordEntry(next.ledger, {
            turn: state.turn,
            seat: Number(seat),
            kind: "loan",
            text:
              (taken.length === 1
                ? `Nexus took ${CELLS.find((c) => c.id === id)?.name || id} · loan defaulted`
                : `Nexus took ${CELLS.find((c) => c.id === id)?.name || id} · loan defaulted`),
            amount: 0,
          });
        }
        next.loans = { ...next.loans, [seat]: { ...loan, status: "defaulted" } };
        ok("loanDefaulted", {
          seat: Number(seat),
          amount: loan.repayment,
          properties: taken,
        });
      }

      next.active = to;
      next.phase = turnPhaseFor(to);
      next.turn = (state.turn || 0) + 1;
      next.landing = null;
      next.visit = null;
      next.lastRoll = null;
      /* The chest is gone with the turn. Both devices read this and both close
         the middle at the same moment. */
      next.chest = null;
      next.fight = null;
      next.epoch = null;
      /* A civilization's promise belongs to the throw that made it. Whatever
         the first roll earned and the visit did not spend is forfeit when the
         turn resolves - the power expires with that roll, as it must. */
      next.civGift = { 0: null, 1: null };
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
