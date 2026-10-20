/* ==========================================================================
   SAMRAJYA - THE BOARD

   Twenty-eight cells in a six-by-ten grid, one die, two coins, and the turn
   that moves them.

   THE GEOMETRY IS THE REQUIREMENT, so it is declared once, as a grid, and every
   cell is placed into it by the coordinates the data gives it:

        cols   1  2  3  4  5  6
   row  1    .  .  .  .  .  .
        2    .  .  .  .  .  .
        ...
        10    .  .  .  .  .  .

   Every track is the same length, `--cell`, so all twenty-eight cells are the
   same square by construction - corners included. There is no code that could
   make two of them differ, and nothing to keep in step.

   THE TURN IS NOT KEPT HERE
   -------------------------
   `shared/game.js` owns it. This file calls `applyAction`, plays the events it
   returns, and draws the phase it lands in. It never decides whose turn it is,
   never advances a seat, and never checks a rule a second time: when the card
   says "one build per visit", that sentence came from the same function the
   server will call in Phase 2.

   The one place the board writes a turn fact is `paintPhase`, and it writes it
   DOWN - the die's visibility, the turn line, the chip's ring - from the state
   it was handed. Nothing here sets the active player except by asking the game
   to continue a finished turn.

   WHAT A TAP MEANS
   ----------------
   When the game is waiting for a throw, a tap on a square opens a read-only
   card. It cannot change the turn, and the die steps aside while it is up so
   the same tap cannot throw. When the game is waiting for a decision, the only
   live things are the card's own buttons: a tap on another square is ignored,
   because leaving without answering is not something a visit allows.
   ========================================================================== */

import { el } from "./dom.js";
import { cornerMark } from "./corner-art.js";
import { dice, throwTo } from "./dice.js";
// The layer draws the coins; the rules they obey - including the name a seat
// goes by - are in coins.js, which imports nothing and is tested on its own.
import { coins } from "./coin-layer.js";
import { seatId } from "./coins.js";
import { renderWeapons, showChest } from "./chest-card.js";
import { RAGNAROK, BAD_LUCK } from "./shared/weapons.js";
import { hideCard, showCard, syncCard } from "./property-card.js";
import {
  markBoard,
  rentMessage,
  syncActive,
  syncPurses,
  toast,
} from "./economy-ui.js";
import { turnPill } from "./turn.js";
import { isPurchasable } from "./shared/properties.js";
import {
  ENABLE_SELL,
  PHASE,
  applyAction,
  createGame,
} from "./shared/game.js";
import { rupees } from "./shared/economy.js";
import { CELLS, CORNER_IDS, SETS } from "./shared/spaces.js";
import {
  banner,
  cardAway,
  flyRent,
  lift,
  passedLabel,
  pipPulse,
  ringDraw,
  shake,
} from "./board-fx.js";

/**
 * The four corners, and the mark each one carries.
 *
 * The keys are the cell ids from the data, and each one is now the same word as
 * the corner it names. The marks are the project's own - `corner-art.js` draws
 * all four as one-stroke instruments in a single weight, and they are not being
 * redrawn for a new size, only laid out again at it.
 */
const CORNER_MARKS = Object.freeze({
  start: "start",
  "outer-space": "space",
  "black-hole": "hole",
  fight: "fight",
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

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
 * only its name, because a chest belongs to no set and a pill in no set's
 * colour would be saying something false about it.
 */
function plainCell(cell) {
  const isChest = cell.type === "chest";

  // One style object, built once. A cell's position is not optional, so it is
  // assembled alongside everything else the cell needs and handed over once.
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
    // Ragnarok is a button because it opens a card. The other three chests and
    // the four corners still do nothing, and still are not buttons.
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
 * Build the board and the game on it.
 *
 * `players` is the room's roster. `game` is optional and is how a game survives
 * leaving the board and coming back; without one a fresh game is made. The
 * game is kept on the element (`frame.game`) for the same reason the coin layer
 * is: the board is built once and lives for the whole match.
 */
export function board({ players = [], game: given = null, seat: mySeat = null } = {}) {
  const frame = el("div", {
    class: "board",
    role: "group",
    "aria-label": "The board of Samrajya",
  });

  // Columns 2 to 5, rows 2 to 9 - the four by eight that is not part of the
  // ring. It covers the gaps inside its own span on purpose, so the grid's
  // lines stop where the ring stops.
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
  // stylesheet is what puts it in the upper middle, or across the whole middle
  // when the game has stopped for a decision.
  const card = el("div", { class: "board__card", hidden: true });
  frame.append(card);

  // The die. It arrives unthrown and is thrown by pressing it, never on its
  // own - a die that rolls by itself is a decoration, and the number on it has
  // to mean something a player asked for.
  const die = centreArea.querySelector(".board__dice");

  // The turn line, under the die. It names the seat the game says is active;
  // the stylesheet takes it away in every phase where a throw cannot happen.
  const turn = turnPill(players);
  centreArea.append(turn.node);

  /* ------------------------------------------------------------- the game */

  let game = given || createGame(players);
  let cardMode = "read";
  let reading = false;
  let busy = false;

  frame.game = game;
  frame.ledger = game.ledger;
  frame.turn = turn;

  /* A way to take one action from outside the board, with the die's generator
     injectable. The checks use it to play a real turn to a square they chose;
     nothing in the page calls it, and it takes the same lock a press does. */
  frame.play = (action, rng) => run(action, { rng });

  const root = () => frame.closest(".board-screen") || document;
  const holder = () => frame.querySelector(".board__card");
  const idOnCard = () => holder()?.dataset.property || "";
  const cellAt = (id) => frame.querySelector(`.board__cell[data-id="${id}"]`);
  const isDecision = () => game.phase === PHASE.DECISION;

  /** Everything on screen that the game decides, repainted from the game. */
  const paint = ({ animate = true } = {}) => {
    syncPurses(root(), game.ledger, { animate });
    markBoard(frame, game.ledger);
    syncActive(root(), game.active);
    for (const piece of game.pieces) {
      renderWeapons(root(), piece.seat, piece.weapons);
    }
    syncCard(frame, context());
    paintPhase();
  };

  /**
   * The die, the turn line, and the tab stops, all from pointer-events and from
   * the phase. A decision has no die; neither does a read-only card, because a
   * card that can be dismissed by a tap is not a card you can throw past.
   */
  const paintPhase = () => {
    frame.dataset.phase = game.phase;
    frame.dataset.active = game.active === null ? "" : String(game.active);
    frame.dataset.reading = reading ? "true" : "false";
    frame.dataset.cardMode = cardMode;
    turn.set(game.active);
    const rollable = game.phase === PHASE.AWAITING_ROLL && !reading && !busy;
    die?.setAttribute("tabindex", rollable ? "0" : "-1");
    die?.setAttribute("aria-hidden", String(!rollable));
    frame.dataset.rollable = rollable ? "true" : "false";
  };

  /* --------------------------------------------------------------- the ctx */

  /**
   * What the card is allowed to ask for.
   *
   * The card itself calls `applyAction` indirectly through these; it never owns
   * a rule. The seat and the mode are read at the moment of the click rather
   * than captured when the card was drawn, so a card that outlives its turn
   * cannot act as the player who opened it.
   */
  const context = () => ({
    ledger: game.ledger,
    game,
    seat: game.active,
    mode: cardMode,
    sellEnabled: ENABLE_SELL,
    onBuy: () => run({ type: "buy" }),
    onPass: () => run({ type: "pass" }),
    onUpgrade: () => run({ type: "upgrade" }),
    onContinue: () => run({ type: "continue" }),
    onSell: (id) => run({ type: "sell", id }),
    onClose: () => closeRead(),
  });

  /* ----------------------------------------------------------- one action */

  /**
   * Do one action, play what it caused, and let the turn settle.
   *
   * `step` is the action itself. `run` is a person's action: it takes the input
   * lock and then asks the game to settle wherever the action left it. The
   * split matters for the events inside a chest, which are actions too but must
   * not each take and release the lock.
   */
  async function run(action, { rng } = {}) {
    if (busy) return null;
    busy = true;
    paintPhase();
    try {
      if (action.type === "roll") {
        if (reading) closeRead();
        pieces.clearHighlight();
      }
      const result = await step(action, { rng });
      // A refused action changed nothing, so there is nothing to settle. Settling
      // anyway would re-open the decision card and wipe the shake that is the
      // refusal's whole visible answer.
      const refusedHere = result?.events?.some(
        (event) => event.type === "refused" && event.action === action.type,
      );
      if (!refusedHere) await settle();
      return result;
    } finally {
      busy = false;
      paintPhase();
    }
  }

  /** One action, its events, and the repaint after them. No settling. */
  async function step(action, { rng } = {}) {
    const before = game;
    let result;
    try {
      result = applyAction(game, action, rng);
    } catch (error) {
      toast(frame, error?.message || "The game could not do that.", { tone: "refused" });
      return null;
    }

    const no = result.events.find((event) => event.type === "refused");
    if (no && no.action === action.type) {
      toast(frame, no.why, { tone: "refused" });
      const target =
        action.type === "buy"
          ? holder()?.querySelector(".property-card__buy")
          : action.type === "upgrade"
            ? holder()?.querySelector(".build__button:not([disabled])")
            : action.type === "sell"
              ? holder()?.querySelector(".property-card__sell")
              : die;
      shake(target);
      return result;
    }
    // A rent that could not be paid is a fact inside a successful throw, not a
    // refused throw. The visit still happens, and the card still opens.
    if (no) toast(frame, no.why, { tone: "refused" });

    game = result.state;
    frame.game = game;
    frame.ledger = game.ledger;
    paintPhase();
    // The card is put in step with the new state BEFORE the animation runs, so
    // a purchase stops offering itself at the instant it is accepted and the
    // build rows show what they have become while the ring is still drawing.
    // Waiting for the animation would leave a live Buy button under the finger.
    syncCard(frame, context());

    await playEvents(result.events);

    // The coin already walked during `moved`; syncing here is what puts the
    // weapons and the final slot on screen without moving anybody twice.
    pieces.sync(game.pieces);
    paint({ animate: true });

    // A property decision that has just been answered takes its card away. A
    // chest card closes itself, because it has a reveal to finish first.
    if (
      before.phase === PHASE.DECISION &&
      game.phase !== PHASE.DECISION &&
      cardMode === "decision" &&
      holder()?.dataset.cardKind === "property"
    ) {
      await dismissCard();
    }

    return result;
  }

  /** Play the events in the order they happened. */
  async function playEvents(events) {
    for (const event of events) {
      switch (event.type) {
        case "moved": {
          // The state has already left AWAITING_ROLL, so the die would be
          // hidden by then. `data-throwing` keeps it up for exactly the length
          // of its own throw, then the phase takes it away.
          frame.dataset.throwing = "true";
          await Promise.all([
            pieces.walk(event.path, event.seat),
            die ? throwTo(die, event.face) : Promise.resolve(),
          ]);
          delete frame.dataset.throwing;
          break;
        }

        case "landed": {
          const cell = cellAt(event.id);
          if (cell) {
            cell.classList.add("is-just-landed");
            setTimeout(() => cell.classList.remove("is-just-landed"), 420);
          }
          break;
        }

        case "bought": {
          // The ring is drawn before the purse is repainted, so the square
          // changes hands on screen at the same moment the money leaves.
          markBoard(frame, game.ledger);
          ringDraw(cellAt(event.id));
          // Count the purse while the price is lifting, not half a second
          // later: a "-₹400" floating over a balance that still says the old
          // figure is two answers to the same question.
          paint({ animate: true });
          lift(root(), frame, event.seat, `-${rupees(event.price)}`, { tone: "spend" });
          toast(frame, `Bought ${event.name}`, { tone: "good" });
          await wait(560);
          break;
        }

        case "upgraded": {
          markBoard(frame, game.ledger);
          pipPulse(cellAt(event.id));
          paint({ animate: true });
          lift(root(), frame, event.seat, `-${rupees(event.cost)}`, { tone: "spend" });
          toast(frame, `${event.name} built`, { tone: "good" });
          await wait(420);
          break;
        }

        case "sold": {
          markBoard(frame, game.ledger);
          paint({ animate: true });
          lift(root(), frame, event.seat, `+${rupees(event.payout)}`, { tone: "earn" });
          toast(frame, `Sold for ${rupees(event.payout)}`, { tone: "good" });
          await wait(320);
          break;
        }

        case "passed": {
          await passedLabel(root(), frame, event.seat);
          break;
        }

        case "rentPaid": {
          await flyRent(root(), frame, event);
          paint({ animate: true });
          toast(frame, rentMessage(game.ledger, event), { tone: "rent" });
          await wait(260);
          break;
        }

        case "weaponDrawn":
        case "weaponCollected":
          // The chest card reveals and flies the weapon itself; the chip is
          // repainted from the game's pieces at the end of the step.
          break;

        case "turnChanged": {
          // The ring and the TURN tag move with the banner, not after it. The
          // banner is naming the player whose chip is already emphasised; a
          // banner over a chip that still says the old player is a lie for as
          // long as it is on screen.
          paint({ animate: true });
          const mine = mySeat !== null && event.to === Number(mySeat);
          await banner(frame, mine ? "Your turn" : `${event.name}\u2019s turn`, { mine });
          break;
        }

        default:
          break;
      }
    }
  }

  /* -------------------------------------------------------------- settling */

  /**
   * Walk the phases to wherever the turn is waiting.
   *
   * MOVING and RESOLVING are animation moments, and `continue` is the client
   * saying "that has finished". TURN_END is the one action that changes the
   * active seat; after it the next turn is ready for its throw. DECISION stops
   * the walk and opens the card.
   */
  async function settle() {
    for (let guard = 0; guard < 10; guard += 1) {
      if (game.phase === PHASE.DECISION) {
        await openDecision();
        // A property decision waits for its player. A chest resolves inside
        // `openDecision` (draw, collect, bad luck), so the walk carries on.
        if (game.phase === PHASE.DECISION) return;
        continue;
      }
      if (game.phase === PHASE.MOVING) {
        await step({ type: "continue" });
        continue;
      }
      if (game.phase === PHASE.RESOLVING) {
        await wait(260);
        await step({ type: "continue" });
        continue;
      }
      if (game.phase === PHASE.TURN_END) {
        await wait(220);
        await step({ type: "continue" });
        continue;
      }
      return;
    }
  }

  /** Open the card the decision belongs to, and wait for the player. */
  async function openDecision() {
    const landing = game.landing;
    if (!landing) return;

    if (landing.kind === "chest") {
      cardMode = "decision";
      reading = false;
      paintPhase();
      await showChest(frame, {
        drawable: true,
        // The draw is an action. The card shuffles and reveals; the game
        // chooses. There is no second random generator behind the glass.
        draw: async () => {
          const result = await step({ type: "drawWeapon" });
          const drawn = result?.events.find((event) => event.type === "weaponDrawn");
          return drawn?.weapon || BAD_LUCK;
        },
        collect: async () => {
          await step({ type: "collectWeapon" });
        },
        onWeapon: () => paint({ animate: false }),
      });
      cardMode = "read";
      frame.dataset.reading = "false";
      // Bad luck leaves the visit open until it is acknowledged; collecting
      // leaves it in RESOLVING. Either way the phase settles from here.
      if (game.phase === PHASE.DECISION && game.landing?.kind === "chest") {
        await step({ type: "continue" });
      }
      return;
    }

    if (!landing.id || !isPurchasable(landing.id)) return;
    cardMode = "decision";
    reading = false;
    paintPhase();
    await showCard(frame, landing.id, context());
  }

  /** Slide the decision card away and take it out of the holder. */
  async function dismissCard() {
    await cardAway(holder());
    hideCard(frame);
    cardMode = "read";
    frame.dataset.cardMode = "read";
  }

  /* ------------------------------------------------------------------ cards */

  function openRead(id) {
    if (game.phase !== PHASE.AWAITING_ROLL) return;
    reading = true;
    cardMode = "read";
    paintPhase();

    if (id === RAGNAROK.id) {
      showChest(frame, { drawable: false, onClose: () => closeRead() });
      return;
    }
    if (!isPurchasable(id)) {
      closeRead();
      return;
    }
    showCard(frame, id, context());
  }

  function closeRead() {
    reading = false;
    cardMode = "read";
    hideCard(frame);
    paintPhase();
  }

  /* -------------------------------------------------------------- the die */

  const rollIt = () => {
    if (busy || reading) return;
    if (game.phase !== PHASE.AWAITING_ROLL) return;
    run({ type: "roll" });
  };

  if (die) {
    die.addEventListener("click", rollIt);
    die.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      rollIt();
    });
  }

  /* ---------------------------------------------------------- the squares */

  for (const cell of cells) {
    if (!cell.matches?.("button[data-id]")) continue;
    cell.addEventListener("click", () => {
      if (busy || isDecision()) return;
      if (game.phase !== PHASE.AWAITING_ROLL) return;
      openRead(cell.dataset.id);
    });
  }

  // A tap outside the card closes a read-only one. A tap on a cell both closes
  // and opens, because the cell's own click runs after this; a decision card
  // has no outside to close it, and ignores this entirely.
  frame.addEventListener("pointerdown", (event) => {
    if (!reading) return;
    if (event.target.closest?.(".board__card")) return;
    closeRead();
  });

  frame.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!reading) return;
    closeRead();
  });

  /* ---------------------------------------------------------- the coins */

  const pieces = coins(frame, { players, pieces: game.pieces });
  frame.coins = pieces;

  /* ------------------------------------------------------------ first paint */

  paint({ animate: false });
  if (game.phase === PHASE.DECISION) openDecision();

  return frame;
}

/* --------------------------------------------------------------- handles */

/** The die on this board, or null. A handle for whoever throws it next. */
export function theDice(root) {
  return (root || document).querySelector(".board__dice");
}

/**
 * The coins on this board, or null.
 *
 * The same kind of handle as `theDice` above, and for the same reason: a check
 * reaches the layer the same way the old die did.
 */
export function theCoins(root) {
  return (root || document).querySelector(".board")?.coins ?? null;
}

/** Whether a cell is one of the four corners. */
export function isCornerCell(cell) {
  return CORNER_IDS.includes(cell.id);
}

/**
 * Which player's coin a seat names.
 *
 * The room deliberately does not send the client each player's `id` - that is
 * the identity token - so the roster arriving here carries `name`, `civ`,
 * `joined` and `role` and nothing else. The seat is the only name a coin can
 * have, and it is the same seat the turn line counts on.
 */
export function playerIdAtSeat(pill, players = []) {
  const seat = Number(pill?.node?.dataset?.turn);
  if (!Number.isInteger(seat)) return null;
  const named = (players || []).filter((p) => p && p.name);
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
