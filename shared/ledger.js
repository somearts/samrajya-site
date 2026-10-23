/* ==========================================================================
   SAMRAJYA - THE LEDGER

   What the game knows. One object that holds who has which square and what
   each player has in hand, and the rules that move it.

   WHY IT LIVES HERE RATHER THAN IN THE BROWSER
   --------------------------------------------
   It draws nothing and touches no DOM, which is the only reason it can be
   tested at all: test/ledger.test.js walks every rule in this file in a plain
   node process, with no page and no build. That is the same reason coins.js
   imports nothing, and the same reason this module sits beside economy.js
   rather than inside the client.

   It is here, and not only there, because these are the rules that decide a
   game. When the board moves onto the server - and turn.js already says out
   loud that the turn is local-only for now - the server should be validating
   a buy against these functions and not against a second copy of them. One
   ledger, two callers, no chance of the two disagreeing about what is allowed.

   EVERY RULE ANSWERS WITH A REASON
   --------------------------------
   Nothing here returns a bare true or false. It returns `{ ok, why }`, because
   a disabled Buy button has to say why it is disabled and the card has to say
   it in words a player can read: "You need 50 more to take it" is useful, and
   a greyed-out button with no reason is not.

   A PLAYER IS A SEAT, NOT AN ID
   ----------------------------
   The room deliberately never sends a player's id back to the browser, because
   that id is the identity token and sending it would hand anyone reading the
   page the ability to act as that player. So everything here is keyed by seat,
   the same way the coins are and the same way `seatId` in coins.js names one.

   THE RULES ARE DELIBERATELY STRICT
   ---------------------------------
   A buy needs an unowned square, enough money, and a seat that is playing. An
   upgrade needs the player to hold it, to be at the level below, and to be able
   to afford it - and refusing out of order is the point: Lunar Colony cannot go
   up before Lunar Outpost has been built.

   The money is never allowed to go negative. A rent larger than the landing
   player's purse fails and nothing moves, which is a loud, visible outcome
   rather than a silent negative balance nobody notices until the end.
   ========================================================================== */

import {
  MAX_UPGRADE,
  REDEMPTION,
  STARTING_MONEY,
  isPriced,
  priceOf,
  rentFor,
  upgradeAt,
} from "./economy.js";
import { CELLS } from "./spaces.js";

export { MAX_UPGRADE, STARTING_MONEY };

/* ------------------------------------------------------------------- verdicts */

/** A refusal that says why. `extra` carries numbers a toast or a test wants. */
const no = (why, extra = {}) => ({ ok: false, why, ...extra });

/** A go-ahead. `extra` carries what changed, so a caller need not look again. */
const yes = (data = {}) => ({ ok: true, why: "", ...data });

/* ------------------------------------------------------------------ creation */

/**
 * A fresh ledger: twenty squares, all unowned and all unbuilt, and the roster
 * each holding `opening`.
 *
 * `players` is whatever the room already holds - the two names, their civs and
 * their seats. Nothing is read out of it but who is playing, because ownership
 * is this file's business and not the room's.
 */
export function createLedger(players = [], { opening = STARTING_MONEY } = {}) {
  return {
    opening,
    players: players.map((p, n) => ({
      /* THE SEAT IS THE ROSTER POSITION unless the caller says otherwise.

         The room does not send a player's `id` back to the browser, and it does
         not send a seat either - so a roster arriving here has names and civs
         and nothing else to tell one entry from another. Defaulting every entry
         to seat 0 looked harmless and was not: two players became one player and
         a phantom, the second purse read zero, and every card belonged to
         nobody. The index is the only fact the roster actually carries, and it
         is the same fact the coins and the turn pill already use. */
      seat: Number.isInteger(p?.seat) ? p.seat : n,
      name: p?.name || "",
      civ: p?.civ || "",
      money: opening,
      // A rent the payer could not fully meet. It is a fact about the purse, not a
      // penalty: nothing is taken, nothing is owed to the bank, and the game does
      // not end. It accumulates so the ledger can say what happened later.
      short: 0,
    })),
    properties: new Map(),
    // The transaction history, newest first. The server is the source of truth;
    // both devices read the same list. Each entry: { turn, seat, kind, text,
    // amount (signed), balance (after) }.
    history: [],
  };
}

/** The sheet for one square: who holds it, and how far it is built. */
export function sheetFor(ledger, id) {
  const key = String(id ?? "");
  if (!ledger?.properties.has(key)) {
    if (!isPriced(key)) return null;
    ledger.properties.set(key, { owner: null, upgradeLevel: 0 });
  }
  return ledger.properties.get(key);
}

/**
 * Move money between a player and the bank.
 *
 * Positive `amount` pays the player; negative takes from them. A record is
 * written to the ledger history when one is supplied.
 */
export function adjustMoney(ledger, seat, amount, record = null) {
  const player = ledger?.players?.find((p) => p.seat === Number(seat));
  if (!player) return { ok: false, why: "That seat is not playing." };

  player.money += Number(amount) || 0;
  if (record) {
    recordEntry(ledger, {
      ...record,
      seat: player.seat,
      amount: Number(amount) || 0,
      balance: player.money,
    });
  }
  return { ok: true, money: player.money };
}

/** The same sheet without making one. */
export function sheetIfOwned(ledger, id) {
  return ledger?.properties.get(String(id ?? "")) || null;
}

/* ------------------------------------------------------------------- queries */

/** The player at a seat, or null. */
export function playerAt(ledger, seat) {
  return ledger?.players.find((p) => p.seat === seat) || null;
}

/** The name a seat goes by, for a line of text. Falls back to a place. */
export function nameOfSeat(ledger, seat) {
  return playerAt(ledger, seat)?.name || "";
}

/** How much a seat is holding. Zero for a seat nobody is sitting in. */
export function moneyOf(ledger, seat) {
  return playerAt(ledger, seat)?.money ?? 0;
}

/**
 * How much rent this seat has fallen short of, across every visit. Zero for a
 * seat nobody is sitting in. A short is a record, not a debt to the bank: it is
 * here so the ledger can answer "what happened to this purse?" without having to
 * remember the visits.
 */
export function shortOf(ledger, seat) {
  return playerAt(ledger, seat)?.short ?? 0;
}

/**
 * The transaction history, newest first. The server is the source of truth, so
 * both devices read the same list. Each entry: { turn, seat, kind, text, amount
 * (signed), balance (after) }.
 *
 * `recordEntry` is the one place entries are added. The ledger functions below
 * do not know the turn number, so the game records them once it has applied an
 * action and knows which turn it is.
 */
export function recordEntry(ledger, { turn = null, seat, kind, text, amount }) {
  if (!ledger) return;
  ledger.history = ledger.history || [];
  const balance = moneyOf(ledger, seat);
  ledger.history.unshift({ turn, seat, kind, text, amount, balance });
}

/**
 * Pay the Redemption for coming back round to Start.
 *
 * Named for the lap rather than for a wage: the board is a circuit of space,
 * and the payment is what the circuit returns to a player who completes it.
 * The game calls this once, when the turn is fully resolved - never mid-walk.
 */
export function redemption(ledger, seat, turn = null) {
  const player = playerAt(ledger, seat);
  if (!player) return no("That seat is not playing.");
  player.money += REDEMPTION;
  recordEntry(ledger, {
    turn,
    seat,
    kind: "redemption",
    text: "Redemption · lap complete",
    amount: REDEMPTION,
  });
  return yes({ amount: REDEMPTION, money: player.money });
}

/** The seat holding a square, or null when nobody holds it. */
export function ownerOf(ledger, id) {
  const sheet = sheetIfOwned(ledger, id);
  return sheet?.owner ?? null;
}

/** The property ids that share a set with this square. */
export function setMembers(ledger, id) {
  const cell = CELLS.find((c) => c.id === id);
  if (!cell || !cell.set) return [];
  return CELLS.filter((c) => c.type === "property" && c.set === cell.set).map((c) => c.id);
}

/** Does this seat hold every square in the set this square belongs to? */
export function hasMonopoly(ledger, id, seat) {
  const members = setMembers(ledger, id);
  if (members.length === 0) return false;
  return members.every((m) => ownerOf(ledger, m) === seat);
}

/**
 * The seat with every colony in this square's set, or null.
 *
 * A set is complete when ONE player has all of it. Two players each with part
 * of it is not a set, and neither is a set with a hole in it.
 *
 * The test is `every`, not `some`: one colony owned by one player says
 * nothing about the set, and a line that claimed otherwise would be a lie.
 */
export function setHolder(ledger, id) {
  const members = setMembers(ledger, id);
  if (members.length === 0) return null;
  const first = ownerOf(ledger, members[0]);
  if (first === null) return null;
  return members.every((m) => ownerOf(ledger, m) === first) ? first : null;
}

/**
 * Would the next level on this square break the even-building rule?
 *
 * Within a set, no colony may be more than one level above the lowest colony
 * in it. A set at levels 0, 1 and 2 is not a set anybody may build in: the
 * third colony would stand two levels above the first.
 */
export function evenUpgradeBlocked(ledger, id) {
  const members = setMembers(ledger, id);
  if (members.length === 0) return false;
  const level = levelOf(ledger, id);
  const after = members.map((m) => (m === id ? level + 1 : levelOf(ledger, m)));
  return Math.max(...after) > Math.min(...after) + 1;
}

/** The set this square belongs to, or null. */
export function setOf(ledger, id) {
  return CELLS.find((c) => c.id === id)?.set || null;
}

/** How far a square is built: 0, 1, 2 or 3. */
export function levelOf(ledger, id) {
  return sheetIfOwned(ledger, id)?.upgradeLevel ?? 0;
}

/**
 * The rent a square charges when its owner holds the whole set with nothing
 * built on it: twice the base rent.
 *
 * A set that is complete and unbuilt is worth more than the sum of its parts,
 * and the extra is charged on every colony in it. Once anything is built in the
 * set, the ordinary rent for each level applies again.
 */
export function fullSetRent(ledger, id) {
  if (!isPriced(id)) return null;
  if (setHolder(ledger, id) === null) return null;
  const members = setMembers(ledger, id);
  if (members.some((m) => levelOf(ledger, m) > 0)) return null;
  return (rentFor(id, 0) || 0) * 2;
}

/** What a square charges whoever lands on it. */
export function rentAt(ledger, id) {
  if (!isPriced(id)) return null;
  const level = levelOf(ledger, id);
  if (level === 0) {
    const doubled = fullSetRent(ledger, id);
    if (doubled !== null) return doubled;
  }
  return rentFor(id, level);
}

/* -------------------------------------------------------------------- buying */

/**
 * May this seat take this square?
 *
 * `ok` is the answer; `why` is a sentence for a card or a check to use when it
 * is no.
 */
export function canBuy(ledger, id, seat) {
  if (!isPriced(id)) return no("This square is not for sale.");
  const player = playerAt(ledger, seat);
  if (!player) return no("Nobody is sitting in that seat.");
  if (ownerOf(ledger, id) !== null) return no("Somebody already holds this square.");
  const price = priceOf(id);
  if (player.money < price) return no(`You need ${price - player.money} more to take it.`);
  return yes();
}

/**
 * Take the square, and take the money with it.
 *
 * Refuses rather than throwing when `canBuy` says no, and refuses without
 * changing anything when it does.
 */
export function buy(ledger, id, seat) {
  const verdict = canBuy(ledger, id, seat);
  if (!verdict.ok) return verdict;

  const player = playerAt(ledger, seat);
  const price = priceOf(id);
  player.money -= price;
  const sheet = sheetFor(ledger, id);
  sheet.owner = seat;
  return yes({ spent: price, money: player.money, sheet });
}

/* ----------------------------------------------------------------- upgrading */

/** The next build for a square, or null when it is already finished. */
export function nextUpgrade(ledger, id) {
  const level = levelOf(ledger, id);
  return level < MAX_UPGRADE ? upgradeAt(id, level) : null;
}

/**
 * May this seat put the next build on this square?
 *
 * Three things have to be true and all three are checked: the seat holds the
 * square, the square is not already finished, and the seat can pay for it.
 */
export function canUpgrade(ledger, id, seat) {
  if (!isPriced(id)) return no("This square is not for sale.");
  const player = playerAt(ledger, seat);
  if (!player) return no("Nobody is sitting in that seat.");
  if (ownerOf(ledger, id) === null) return no("Nobody holds this square yet.");
  if (ownerOf(ledger, id) !== seat) return no(`${nameOfSeat(ledger, ownerOf(ledger, id))} holds this square.`);
  // Upgrades unlock only with a monopoly: the player must hold every square in
  // the set. A sale that breaks the set re-locks further upgrades, but levels
  // already built stay.
  if (!hasMonopoly(ledger, id, seat)) {
    const members = setMembers(ledger, id);
    return no(`Own all ${members.length} colonies in this set to unlock upgrades.`);
  }
  // Even building: no colony in a set may stand more than one level above the
  // lowest colony in it.
  if (evenUpgradeBlocked(ledger, id)) {
    return no("Upgrade the other colonies in this set first.");
  }
  const upgrade = nextUpgrade(ledger, id);
  if (!upgrade) return no("This square is upgraded as far as it goes.");
  if (player.money < upgrade.cost) {
    return no(`You need ${upgrade.cost - player.money} more to upgrade this.`);
  }
  return yes({ upgrade });
}

/** Put the next build on, and take the money for it. */
export function upgrade(ledger, id, seat) {
  const verdict = canUpgrade(ledger, id, seat);
  if (!verdict.ok) return verdict;

  const player = playerAt(ledger, seat);
  const sheet = sheetFor(ledger, id);
  const step = upgradeAt(id, sheet.upgradeLevel);
  player.money -= step.cost;
  sheet.upgradeLevel += 1;
  return yes({
    upgrade: step,
    level: sheet.upgradeLevel,
    spent: step.cost,
    money: player.money,
    rent: rentFor(id, sheet.upgradeLevel),
    sheet,
  });
}

/* -------------------------------------------------------------------- selling

   A square can go back to the bank, and it goes back for half of what was put
   into it: half the price, plus half of every upgrade that was paid for. The
   half is rounded to a multiple of five, because a purse reading ₹1,237 is a
   number nobody wants to do arithmetic with and every price on this board is a
   multiple of ten. */

/** What a seat would get for selling a square. Zero when nobody holds it. */
export function saleValue(ledger, id) {
  const sheet = sheetIfOwned(ledger, id);
  if (!sheet || sheet.owner === null) return 0;

  let spent = 0;
  for (let n = 0; n < sheet.upgradeLevel; n += 1) {
    spent += upgradeAt(id, n)?.cost ?? 0;
  }
  const half = (priceOf(id) ?? 0) / 2 + spent / 2;
  return Math.round(half / 5) * 5;
}

/** May this seat sell this square back to the bank? */
export function canSell(ledger, id, seat) {
  if (!isPriced(id)) return no("This square is not for sale.");
  const player = playerAt(ledger, seat);
  if (!player) return no("Nobody is sitting in that seat.");
  const owner = ownerOf(ledger, id);
  if (owner === null) return no("Nobody holds this square.");
  if (owner !== seat) return no(`${nameOfSeat(ledger, owner)} holds this square.`);
  return yes({ payout: saleValue(ledger, id) });
}

/**
 * Sell a square back. Its builds go with it: the bank buys the square, not the
 * buildings on it, and a square nobody holds is a square at level zero.
 */
export function sell(ledger, id, seat) {
  const verdict = canSell(ledger, id, seat);
  if (!verdict.ok) return verdict;

  const player = playerAt(ledger, seat);
  const sheet = sheetFor(ledger, id);
  const payout = saleValue(ledger, id);
  player.money += payout;
  sheet.owner = null;
  sheet.upgradeLevel = 0;
  return yes({ payout, money: player.money, sheet });
}

/* --------------------------------------------------------------------- rent */

/** Who, if anybody, a square charges when it is landed on. */
export function rentPayer(ledger, id, seat) {
  const owner = ownerOf(ledger, id);
  if (owner === null || owner === seat) return null;
  return owner;
}

/**
 * Charge whoever lands on a square.
 *
 * The owner is paid and the answer says how much moved, so a toast can be
 * written without going back to the ledger for the numbers.
 *
 * A square nobody holds charges nothing, and landing on your own charges
 * nothing. Both are the same case as far as the ledger is concerned - there is
 * no second player to pay - and both return `ok: true` with `rent: 0`, because
 * nothing went wrong.
 *
 * A payment the payer cannot fully make is not refused and is not borrowed
 * either. The payer hands over **everything they hold** and the owner takes it;
 * the part of the rent that is left over is recorded against the payer as a
 * `short`. The purse is never allowed below zero, and a short is not a penalty:
 * nothing else happens because of it, and there is no bankruptcy yet. The short
 * is the ledger's way of remembering that the rent was not met, so a later rule
 * (or a card, or a test) can ask about it.
 */
export function payRent(ledger, id, seat) {
  const owner = rentPayer(ledger, id, seat);
  const rent = rentAt(ledger, id) ?? 0;
  if (owner === null) {
    return yes({ rent: 0, from: seat, to: null, paid: false, amount: 0, short: 0, shortfall: 0 });
  }

  const payer = playerAt(ledger, seat);
  const holder = playerAt(ledger, owner);
  if (!payer || !holder) return no("That seat is not playing.");

  // What can actually move is the smaller of the rent and the purse. When the two
  // are equal this is the whole rent; when the purse is smaller it is the whole
  // purse, and the difference is the short.
  const paid = Math.max(0, Math.min(payer.money, rent));
  payer.money -= paid;
  holder.money += paid;
  const shortfall = rent - paid;
  if (shortfall > 0) payer.short += shortfall;

  return yes({
    rent,
    from: seat,
    to: owner,
    paid: rent > 0 && paid === rent,
    amount: paid,
    payer: payer.money,
    holder: holder.money,
    short: payer.short,
    shortfall,
  });
}