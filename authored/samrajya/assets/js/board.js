/* ==========================================================================
   SAMRAJYA - THE BOARD

   Twenty-eight cells in a six-by-ten grid, and nothing else.

   THE GEOMETRY IS THE REQUIREMENT, so it is declared once, as a grid, and every
   cell is placed into it by the coordinates the data gives it:

        cols   1  2  3  4  5  6
   row  1    .  .  .  .  .  .
        2    .  .  .  .  .  .
        ...
       10    .  .  .  .  .  .

   Every track is the same length, `--cell`, so all twenty-eight cells are the
   same square by construction - corners included. There is no code that could
   make two of them differ, and nothing to keep in step. The earlier board was
   8x8 with corner tracks at 16.85% and six 1fr tracks beside them, which made
   the corners a third larger than the cells next to them and gave the top row
   a different orientation from the sides; a square board cannot do that without
   one of the two orientations being wrong, and it was.

   Cells are numbered in the order a game travels them, starting at START in the
   bottom-left and going clockwise - up the left column, across the top, down
   the right, back along the bottom. That index and the cell's coordinates are
   the same fact, and both come from the same record in shared/spaces.js, so
   they cannot drift apart.

   WHAT IS IN A CELL NOW
   --------------------
   The four corners carry their mark, their name and the rule beneath it. A
   property carries a pill in its set's colour and its name. A chest carries
   its name in cream on the dark ground and no pill. The card artwork that
   belongs behind the pill is the next piece of work and is not drawn here; the
   cells have their ids, indices and art paths on them from the start, so
   putting artwork in is adding a child rather than rebuilding the board.
   ========================================================================== */

import { el } from "./dom.js";
import { cornerMark } from "./corner-art.js";
import { dice, makeThrowable } from "./dice.js";
// The layer draws the coins; the rules they obey - including the name a seat
// goes by - are in coins.js, which imports nothing and is tested on its own.
import { coins } from "./coin-layer.js";
import { seatId } from "./coins.js";
import { chestPending, renderWeapons, showChest } from "./chest-card.js";
import { RAGNAROK } from "./shared/weapons.js";
import { showCard, syncCard } from "./property-card.js";
import { markBoard, rentMessage, syncPurses, toast } from "./economy-ui.js";
import { turnPill } from "./turn.js";
import { isPurchasable } from "./shared/properties.js";
import {
  buy as buySquare,
  createLedger,
  nameOfSeat,
  payRent,
  upgrade as upgradeSquare,
} from "./shared/ledger.js";
import { CELLS, CORNER_IDS, SETS } from "./shared/spaces.js";

/**
 * The four corners, and the mark each one carries.
 *
 * The keys are the cell ids from the data, and each one is now the same word as
 * the corner it names. The marks are the project's own - `corner-art.js` draws
 * all four as one-stroke instruments in a single weight, and they are not being
 * redrawn for a new size, only laid out again at it.
 *
 * The three that were renamed used to carry ids from a board that no longer
 * exists - `omega`, `akash-core`, `marketplace` - and were kept that way on the
 * argument that ids are wiring, not display. They are wiring, and they have been
 * rewritten everywhere they are used, so the argument held for a change nobody
 * asked for rather than for one worth making.
 */
const CORNER_MARKS = Object.freeze({
  start: "start",
  "outer-space": "space",
  "black-hole": "hole",
  fight: "fight",
});


/**
 * The middle: a die, in the board's own colours.
 *
 * One set colour per face, taken from the pills themselves rather than written
 * out here, so a set whose colour is changed on the board changes the die with
 * it. The die takes them as an argument so that it has no import of its own
 * into the shared modules - those only exist in the built tree, and a die that
 * reached for one could not be tested.
 */
function centre() {
  return dice(Object.values(SETS).map((set) => set.color));
}

/** One corner: its mark, its name, and a rule beneath. */
function cornerCell(cell) {
  return el(
    "div",
    {
      class: "board__cell board__cell--corner",
      style: { gridColumn: String(cell.col), gridRow: String(cell.row) },
      "data-id": cell.id,
      "data-index": String(cell.index),
      "data-cell": cell.type,
      "data-corner": cell.id,
    },
    [
      el("span", {
        class: "board__mark board__mark--corner",
        html: cornerMark(CORNER_MARKS[cell.id]),
      }),
      el("span", {
        class: "board__corner-name",
        // The name is set on the lines the data gives, which is how "Outer Space"
        // becomes OUTER / SPACE and "Black Hole" becomes BLACK / HOLE - the
        // same break the reference layout draws, and the only reason a corner
        // name is ever more than one line.
        html: cell.lines.map((line) => `<span>${line}</span>`).join(""),
      }),
      el("span", { class: "board__corner-rule" }),
    ],
  );
}

/**
 * The name, set on the lines the data gives.
 *
 * "Proxima Centauri" becomes PROXIMA / CENTAURI and "Lagrange Point L2" becomes
 * LAGRANGE / POINT L2 - the breaks are in the data, not guessed here, so the
 * drawing and board-cells.json cannot disagree about where a name wraps.
 */
function nameLines(cell) {
  return el("span", {
    class: "board__label",
    html: cell.lines.map((line) => `<span>${line}</span>`).join(""),
  });
}

/**
 * Any cell that is not a corner.
 *
 * A property carries a pill in its set's colour above its name. A chest carries
 * only its name, in cream on the dark ground, because a chest belongs to no set
 * and a pill in no set's colour would be saying something false about it.
 *
 * Properties are real buttons, so a property is reachable by keyboard and
 * announces itself as one; the cells have no handler yet and that is deliberate -
 * a button that does nothing is still a button the reader can find, and it is
 * the same element that will take the tap when there is one. Chests are
 * ordinary cells for now and become buttons the same way when they do.
 */
function plainCell(cell) {
  const isChest = cell.type === "chest";

  // One style object, built once. It was two, and the second replaced the first:
  // a `style` key written after the spread overwrites the gridColumn and
  // gridRow that came with it, every property button lost its coordinates and
  // the grid auto-placed them - which still puts 28 squares on 28 board
  // positions, and still passes a count, and still leaves every pixel inside a
  // cell. The cells were simply in the wrong places. A cell's position is not
  // optional, so it is assembled alongside everything else the cell needs and
  // handed over once.
  const style = {
    gridColumn: String(cell.col),
    gridRow: String(cell.row),
    // The wash is the same colour as the pill, from the same field in the same
    // record, so the tint on the ground and the pill above it cannot disagree.
    // A chest has no colour of its own to wash with and is left to the
    // stylesheet, which gives it black.
    ...(isChest ? {} : { "--wash": cell.color }),
  };

  const props = {
    class: `board__cell board__cell--${cell.type}`,
    style,
    "data-id": cell.id,
    "data-index": String(cell.index),
    "data-cell": cell.type,
    ...(cell.set ? { "data-set": cell.set } : {}),
    ...(cell.chest ? { "data-chest": cell.chest } : {}),
    ...(cell.art ? { "data-art": cell.art } : {}),
  };

  if (isChest) {
    // A chest's wash is black, set by the stylesheet, because a chest belongs
    // to no set and has no colour of its own to tint with.
    //
    // Ragnarok is the exception, and it is now a button. The rule the other
    // seven follow is that a square you cannot act on should not be a button,
    // because a button that does nothing is still one a reader can find and
    // press. Ragnarok has stopped being that: it opens a card, and a player can
    // look at what the armoury is. The other three chests and the four corners
    // still do nothing, and still are not buttons.
    if (cell.id !== RAGNAROK.id) {
      return el("div", props, [nameLines(cell)]);
    }

    return el(
      "button",
      {
        ...props,
        type: "button",
        "aria-label": `${cell.name}, community chest`,
      },
      [nameLines(cell)],
    );
  }

  // A property is a button because it is a place a player can buy, and the card
  // that says so comes up when it is pressed. The handler lives on the board
  // rather than on the cell so that the cell carries no behaviour of its own.
  return el(
    "button",
    {
      ...props,
      type: "button",
      "aria-label": `${cell.name}, ${isPurchasable(cell.id) ? "show details" : "not for sale"}`,
    },
    [
      el("span", {
        class: "board__pill",
        style: { backgroundColor: cell.color },
        "aria-hidden": "true",
      }),
      nameLines(cell),
    ],
  );
}

/**
 * Build the board.
 *
 * Returns the element. It is built in one go rather than patched, because the
 * board does not change while it is on screen and there is nothing to
 * reconcile.
 *
 * `players` is the roster, and is only read for the turn pill: a board built
 * without one still renders, and the pill simply stays hidden rather than
 * naming a turn nobody has.
 */
export function board({ players = [], ledger: given = null } = {}) {
  const frame = el("div", {
    class: "board",
    role: "group",
    "aria-label": "The board of Samrajya",
  });

  // Columns 2 to 5, rows 2 to 9 - the four by eight that is not part of the
  // ring. Placed on lines rather than on a named area, because the grid's cells
  // are placed individually now and there is no template for a name to sit in.
  //
  // It covers the gaps inside its own span on purpose. In the reference the
  // middle is one unbroken field with a line of text on it, so the grid's lines
  // do not cross it - they stop where the ring stops. Lines 2 to 4 across and
  // lines 2 to 8 down are drawn only in the two side columns and the two end
  // rows, which is what the reference draws.
  //
  // No longer aria-hidden: it used to hold only decoration, but it now holds the
  // die, and a die that says which number it came up is the one thing in here
  // worth reading out.
  const centreArea = el("div", {
    id: "board-center",
    class: "board__centre",
    html: centre(),
  });
  centreArea.style.gridColumn = "2 / 6";
  centreArea.style.gridRow = "2 / 10";

  const cells = CELLS.map((cell) =>
    isCornerCell(cell) ? cornerCell(cell) : plainCell(cell),
  );

  frame.append(centreArea, ...cells);

  // The card's box. It is empty and hidden until a property is pressed; the
  // stylesheet is what puts it in the upper middle, inside the rectangle the
  // six tiles named in property-card.js bound off.
  const card = el("div", { class: "board__card", hidden: true });
  frame.append(card);

  // The die. It arrives unthrown and is thrown by pressing it, never on its
  // own - a die that rolls by itself is a decoration, and the number on it has
  // to mean something a player asked for.
  const die = centreArea.querySelector(".board__dice");

  // The turn pill, under the die. It is put in the middle rather than over the
  // board so that it lands in the same two rows the die is in and can be
  // positioned from the die's own edge. It advances when the die has LANDED,
  // not when it is touched, so the pill never names a player who is still
  // mid-throw.
  const turn = turnPill(players);
  centreArea.append(turn.node);

  /* THE LEDGER
     ---------
     Who holds what and who has how much. Built here from the roster, or handed
     in from outside so a game survives leaving the board and coming back to it.

     It lives on the board element for the same reason the coin layer does: the
     board is built once when the screen opens and is not rebuilt while it is
     open, so this is a place that survives a whole game. Everything that reads
     it - the card, the purses, the marks on the squares - is given the same
     object rather than a copy of it.

     WHOSE CARD IS IT?
     The card answers to whoever's turn it is, read from the pill rather than
     captured once, because a card left open across a throw has to belong to
     the player who is about to act on it. */
  const ledger = given || createLedger(players);
  frame.ledger = ledger;

  const seatNow = () => {
    const seat = Number(turn.node?.dataset?.turn);
    if (!Number.isInteger(seat)) return null;
    // Looked up by seat rather than by index: they are the same thing here, and
    // a lookup that says so is a lookup that survives the two ever differing.
    return ledger.players.some((p) => p.seat === seat) ? seat : null;
  };

  /** Everything on screen that the ledger decides, repainted from the ledger. */
  const refresh = () => {
    const root = frame.closest(".board-screen") || document;
    syncPurses(root, ledger);
    markBoard(frame, ledger);
    syncCard(frame, ctx);
  };

  const ctx = {
    ledger,
    get seat() {
      return seatNow();
    },

    /* Buying and building.
     *
     * Both are one line: ask the ledger, and if it said yes, repaint. The
     * ledger is what refuses, so this file never has to - and a refusal that
     * came from somewhere else than the button being grey would be a rule the
     * card and the ledger disagreed about.
     *
     * The card is NOT redrawn. `syncCard` rewrites the figures on the card
     * already on screen, so a player can buy and then keep buying without the
     * card turning away and back each time. */
    onBuy: () => {
      const id = frame.querySelector(".board__card")?.dataset.property;
      const seat = seatNow();
      if (!id || seat === null) return;
      const verdict = buySquare(ledger, id, seat);
      refresh();
      if (!verdict.ok) toast(frame, verdict.why, { tone: "refused" });
    },

    onUpgrade: (n) => {
      const id = frame.querySelector(".board__card")?.dataset.property;
      const seat = seatNow();
      if (!id || seat === null) return;
      const verdict = upgradeSquare(ledger, id, seat);
      refresh();
      if (!verdict.ok) toast(frame, verdict.why, { tone: "refused" });
      else toast(frame, `${nameOfSeat(ledger, seat)} built ${verdict.upgrade.name}.`, { tone: "good" });
    },
  };

  // The coins. Every player has one, and they all start on Start, and the layer
  // takes no taps so the squares underneath stay pressable.
  const pieces = coins(frame, {
    players,

    /* WHAT A LANDING MEANS.

       The coin layer knows where a coin stopped and knows nothing else. What
       that square does about it is this file's business, because it is the only
       place that knows what each square is for.

       Ragnarok runs a draw. A property shows its card. Anything else - a
       corner, or one of the three chests with nothing decided for them yet -
       closes whatever was open and says nothing, which is the honest answer for
       a square that has not been given a purpose. */
    onLand: async ({ cell, player }) => {
      const landingSeat = pieces.state.players.indexOf(player);

      if (cell?.dataset.id === RAGNAROK.id) {
        await showChest(frame, {
          drawable: true,
          onWeapon: (weaponId) => {
            player.weapons.push(weaponId);
            renderWeapons(document, landingSeat, player.weapons);
          },
        });
        return;
      }

      /* RENT.

         Paid on landing and not asked for: a square somebody holds charges
         whoever steps on it, and making a player press a button to be charged
         would be a rule the board did not say out loud.

         Landing on your own square charges you nothing and a square nobody holds
         charges you nothing - both are the same answer here, because in each
         case there is nobody to pay. Only a refusal is worth saying out loud,
         and the one refusal there is happens when the purse is short of the
         rent, which is worth a player being told rather than discovering. */
      if (landingSeat >= 0 && isPurchasable(cell?.dataset.id)) {
        const id = cell.dataset.id;
        const verdict = payRent(ledger, id, landingSeat);
        if (verdict.paid) {
          refresh();
          toast(frame, rentMessage(ledger, verdict), { tone: "rent" });
        } else if (!verdict.ok) {
          refresh();
          toast(frame, verdict.why, { tone: "refused" });
        }
      }

      /* A CHEST WAITING ON A DRAW OUTRANKS A LANDING.

         The tap handler and the throw handler both refuse to replace a chest
         that has not been answered. This one did not, and it could: a throw
         begun while a chest was open still moves a coin, and the square it lands
         on would then close the chest mid-shuffle and take the draw with it.

         The money above has already moved and that is correct - the landing
         happened, and a rent is owed whether or not a card is on screen. What is
         refused is only the card. */
      if (chestPending(frame)) return;

      await showCard(frame, cell && isPurchasable(cell.dataset.id) ? cell.dataset.id : "", ctx);
    },
  });
  // The handle `theCoins()` reads, so `movePlayer` can be driven from outside
  // this module. It is a reference to the same object the board is using - not a
  // copy, and not a second set of coins.
  frame.coins = pieces;

  // And the turn, for the same reason. Handing the turn over is `next()`, and
  // the only other way to do it is to throw the die - which also moves a coin,
  // which is a great deal more than "hand the turn over" means. A check that
  // wants to look at a square from the other player's side should not have to
  // roll for it.
  frame.turn = turn;

  /* THE ONE PLACE A ROLL BECOMES A MOVE
     ----------------------------------
     The die and the turn pill already work and are not rebuilt here. What this
     adds is the one fact neither of them keeps: WHO threw.

     That has to be read at the moment of the roll, before `turn.next()` runs,
     because advancing the turn is what changes the answer. Read afterwards the
     pill is already naming the next player and the wrong coin moves - a bug that
     would only show with two players on a board, and would look like the coins
     were moving on their own.

     So the seat is captured on the way in and carried until the die lands. The
     listeners are registered BEFORE makeThrowable's, so the capture happens
     first on every tap. */
  let rolling = null;

  const capture = () => {
    rolling = playerIdAtSeat(turn, players);
    // A card left open from the last turn is closed as this one starts. Tapping
    // a square by hand still opens one, which is the existing behaviour and is
    // untouched - this only clears what the last roll left behind.
    //
    // Except a chest waiting on a draw. Clearing that would let a throw abandon
    // a visit before it was answered, which is the one thing Ragnarok promises
    // it will not do.
    if (chestPending(frame)) return;
    showCard(frame, "", ctx);
    pieces.clearHighlight();
  };

  if (die) {
    die.addEventListener("click", capture);
    die.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      capture();
    });

    makeThrowable(die, (face) => {
      const who = rolling;
      rolling = null;
      turn.next();
      if (who) pieces.movePlayer(who, face);
    });

    /* THE DIE IS OFF WHILE A COIN IS IN THE AIR
       ----------------------------------------
       A second throw landing on top of a move in progress would move two coins
       from one roll. The die is an SVG with a role, not a real button, so
       `disabled` does nothing to it - what actually stops a throw is stopping
       the event on its way in.

       That is done on `centreArea` in the capture phase rather than on the die.
       Listeners on the element itself fire in registration order whatever their
       phase, so one added to the die would run first only by accident of being
       added first; on an ancestor, the capture phase is guaranteed to run before
       the die's own listeners, which is the property being relied on here. */
    /* AND THE DIE IS OFF WHILE A CHEST IS WAITING ON A DRAW.

       The same guard, for a second reason. `capture` above refuses to close a
       pending chest, but that only stops the card being cleared - the throw
       itself still ran, because the throw is `makeThrowable`'s business and its
       callback does not know about chests. A throw begun over an unanswered
       chest therefore advanced the turn and moved a coin, and a coin that landed
       back on Ragnarok restarted the draw: the phase went from "drawing" to
       "idle" and the answer a player had been waiting for was simply gone.

       So the die does not throw at all while a chest is open. That is what the
       card already claims when it says it cannot be dismissed before the draw is
       answered, and this is the half of that claim the tap and key handlers could
       not make on their own. */
    const shut = () => pieces.isMoving() || chestPending(frame);

    centreArea.addEventListener(
      "click",
      (event) => {
        if (!shut()) return;
        event.stopImmediatePropagation();
        event.preventDefault();
      },
      true,
    );
    centreArea.addEventListener(
      "keydown",
      (event) => {
        if (!shut()) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.stopImmediatePropagation();
        event.preventDefault();
      },
      true,
    );
  }

  // One handler for every property, on the board rather than twenty times on
  // the cells. The cells that are not purchasable are not buttons at all, so
  // pressing a corner or a chest cannot reach this.
  for (const cell of cells) {
    if (!cell.matches?.("button[data-id]")) continue;
    cell.addEventListener("click", () => {
      // A chest card that is waiting on a draw cannot be replaced. It is the one
      // card on the board that has not finished saying what it has to say, and
      // replacing it would let a visitor leave Ragnarok without drawing.
      if (chestPending(frame)) return;

      if (cell.dataset.id === RAGNAROK.id) {
        // Opened by hand rather than by landing: read-only. The card says what
        // the chest is and what a draw would give, with the button there and
        // disabled, because a visit that did not happen is not a draw.
        showChest(frame, { drawable: false });
        return;
      }

      showCard(frame, cell.dataset.id, ctx);
    });
  }

  // The marks, the purses and the card are all derived from the ledger, so they
  // are painted once here rather than waiting for the first purchase to paint
  // them. Every square starts unowned and every purse at two thousand, and the
  // board should say so before anything has happened to it.
  markBoard(frame, ledger);

  return frame;
}

/** The die on this board, or null. A handle for whoever throws it next. */
export function theDice(root) {
  return (root || document).querySelector(".board__dice");
}

/**
 * The coins on this board, or null.
 *
 * The same kind of handle as `theDice` above, and for the same reason: `movePlayer`
 * is the one function a server will call when there is a server that knows who
 * rolled what, and something has to be able to reach it from outside the module
 * that built the board. A check reaches it the same way.
 */
export function theCoins(root) {
  return (root || document).querySelector(".board")?.coins ?? null;
}

/** Whether a cell is one of the four corners. */
export function isCornerCell(cell) {
  return CORNER_IDS.includes(cell.id);
}

/**
 * Which player's coin the turn pill is currently naming.
 *
 * The pill carries the seat it is on as `data-turn`, and this turns that seat
 * into the name that seat's coin knows - `seat-N`. It is a lookup and not a
 * second turn counter on purpose: there is exactly one thing on this board that
 * knows whose turn it is, and it is the pill.
 *
 * It cannot ask the roster for an id, and this is the whole reason the coins
 * are named after seats. The room deliberately does not send the client each
 * player's `id` - that is the identity token, and the design of it is that the
 * far end of the socket is not handed it back - so the roster arriving here
 * carries `name`, `civ`, `joined` and `role` and nothing else to identify
 * anybody by. Reading `player.id` and finding nothing would have made every
 * roll move no coin at all, which is exactly what happened the first time.
 */
export function playerIdAtSeat(pill, players = []) {
  const seat = Number(pill?.node?.dataset?.turn);
  if (!Number.isInteger(seat)) return null;
  const named = (players || []).filter((p) => p && p.name);
  // The same roster the pill counts on, so the seat means the same player in
  // both places. A seat with no name is a seat nobody is sitting in.
  if (!named[seat]) return null;
  return seatId(seat);
}

/** How many of each kind of cell a board has. Used by the geometry check. */
export function tileCensus() {
  return {
    total: CELLS.length,
    corners: CELLS.filter(isCornerCell).length,
    edges: CELLS.filter((c) => !isCornerCell(c)).length,
    // one per grid position, so no two cells can be sitting on the same square
    positions: new Set(CELLS.map((c) => `${c.col},${c.row}`)).size,
  };
}