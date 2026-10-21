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
  rentShortMessage,
  syncActive,
  syncPurses,
  toast,
} from "./economy-ui.js";
import { turnPill } from "./turn.js";
import { profilePanel } from "./profile.js";
import { announcementLayer } from "./announcement.js";
import { announcementFor } from "./shared/announcements.js";
import { isPurchasable } from "./shared/properties.js";
import { ENABLE_SELL, PHASE, restoreGame } from "./shared/game.js";
import { coinColor } from "./shared/civilizations.js";
import { CELLS, CORNER_IDS, SETS } from "./shared/spaces.js";
import {
  banner,
  cardAway,
  flyCoins,
  flyRent,
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
  const label = nameLines(cell);
  label.append(
    el("span", { class: "board__pips", "aria-hidden": "true" }, [
      el("span", { class: "board__pip", "data-on": "false" }),
      el("span", { class: "board__pip", "data-on": "false" }),
      el("span", { class: "board__pip", "data-on": "false" }),
    ]),
  );

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
      label,
    ],
  );
}

/**
 * Build the board and the game on it.
 *
 * `players` is the room's roster and `game` is the server's state, already
 * restored from its wire form. `session` and `roomId` are how the board sends
 * its actions: it does not apply a rule itself, and it never rolls its own die.
 * The game is kept on the element (`frame.game`) for the same reason the coin
 * layer is: the board is built once and lives for the whole match.
 */
export function board({
  players = [],
  game: given = null,
  seat: mySeat = null,
  session = null,
  roomId = null,
} = {}) {
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

  // The big announcement lives inside the middle, in the same cell as the die
  // and the card, and above both. It is created once and reused.
  const announce = announcementLayer(centreArea);

  /* ------------------------------------------------------------- the game */

  let game = given;
  let cardMode = "read";
  let reading = false;
  let busy = false;
  /* The number of the last action this board applied. The socket repeats the
     state an action produced; the number is how a board knows that repetition
     from a genuinely new turn. */
  let lastSeq = game?.seq ?? 0;
  /* A snapshot that arrived while this board was busy animating its own action.
     It is applied the moment the animation is done, so a move by the other
     player is never dropped just because this screen was mid-flight. */
  let pendingSnapshot = null;

  frame.game = game;
  frame.ledger = game?.ledger ?? null;
  frame.turn = turn;

  /* A way to take one action from outside the board, with the die's generator
     injectable. The checks use it to play a real turn to a square they chose;
     nothing in the page calls it, and it takes the same lock a press does. The
     generator is only used by the preview's test hook; the server rolls the die
     in every real game. */
  frame.play = (action, rng) => run(action, { rng });

  /* ------------------------------------------------------------- the profile
     A chip opens one player's record in the middle. The card and the die are
     not removed - they are only hidden - so closing the profile gives back
     exactly what was underneath it, even if the turn moved on while it was
     open. The profile itself is re-read from the live game on every paint, so
     its figures are never a photograph of an older turn. */
  let profileSeat = null;

  function closeProfile() {
    if (profileSeat === null) return;
    profileSeat = null;
    delete frame.dataset.profile;
    delete frame.dataset.profileSeat;
    centreArea.querySelector(".board__profile")?.remove();
    // Anything that happened while the record was open is said now, in the
    // order it happened, rather than being swallowed by the record.
    announce.flush();
  }

  function renderProfile() {
    if (profileSeat === null) return;
    const existing = centreArea.querySelector(".board__profile");
    const top = existing?.scrollTop || 0;
    const panel = profilePanel({
      ledger: game?.ledger,
      game,
      players,
      seat: profileSeat,
      onClose: closeProfile,
    });
    if (existing) existing.replaceWith(panel);
    else centreArea.append(panel);
    panel.scrollTop = top;
    frame.dataset.profile = "true";
    frame.dataset.profileSeat = String(profileSeat);
  }

  function openProfile(seat) {
    const wanted = Number(seat);
    if (!Number.isInteger(wanted)) return;
    if (profileSeat === wanted) {
      closeProfile();
      return;
    }
    profileSeat = wanted;
    renderProfile();
  }

  frame.openProfile = openProfile;
  frame.closeProfile = closeProfile;
  frame.toggleProfile = openProfile;


  const root = () => frame.closest(".board-screen") || document;
  const holder = () => frame.querySelector(".board__card");
  const cellAt = (id) => frame.querySelector(`.board__cell[data-id="${id}"]`);
  const isDecision = () => game.phase === PHASE.DECISION;
  const isMyTurn = () => mySeat !== null && game.active === Number(mySeat);

  /** Everything on screen that the game decides, repainted from the game. */
  const paint = ({ animate = true } = {}) => {
    if (!game) return;
    syncPurses(root(), game.ledger, { animate });
    markBoard(frame, game.ledger);
    syncActive(root(), game.active);
    for (const piece of game.pieces) {
      renderWeapons(root(), piece.seat, piece.weapons);
    }
    syncCard(frame, context());
    paintPhase();
    renderProfile();
  };

  /**
   * The die, the turn line, and the tab stops, all from pointer-events and from
   * the phase. A decision has no die; neither does a read-only card, because a
   * card that can be dismissed by a tap is not a card you can throw past.
   */
  const paintPhase = () => {
    if (!game) {
      frame.dataset.phase = "";
      frame.dataset.active = "";
      frame.dataset.rollable = "false";
      frame.dataset.busy = busy ? "true" : "false";
      return;
    }
    frame.dataset.phase = game.phase;
    frame.dataset.active = game.active === null ? "" : String(game.active);
    frame.dataset.reading = reading ? "true" : "false";
    frame.dataset.cardMode = cardMode;
    frame.dataset.busy = busy ? "true" : "false";
    turn.set(game.active);
    // The die belongs to the player whose turn it is, and only on their screen.
    const rollable =
      game.phase === PHASE.AWAITING_ROLL && !reading && !busy && isMyTurn();
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
    // The card belongs to the player looking at it, not to whoever's turn it
    // happens to be. On the other player's screen it is a read-only card.
    seat: mySeat ?? game.active,
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
      // A snapshot that arrived while this board was busy is applied now, so the
      // other player's move is never dropped because this screen was animating.
      if (pendingSnapshot) {
        const snapshot = pendingSnapshot;
        pendingSnapshot = null;
        frame.applySnapshot(snapshot);
      }
    }
  }

  /** One action, its events, and the repaint after them. No settling. */
  async function step(action, { rng } = {}) {
    const before = game;
    let response;
    try {
      response = await session.action(roomId, {
        ...action,
        ...((action.type === "roll" || action.type === "drawWeapon") && rng !== undefined
          ? { rng }
          : {}),
      });
    } catch {
      toast(frame, "No connection to the server. Check your network and try again.", { tone: "refused" });
      return null;
    }

    if (!response.ok) {
      const no = {
        type: "refused",
        action: action.type,
        seat: game?.active ?? null,
        why: response.error,
      };
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
      return { events: [no] };
    }

    const state = restoreGame(response.data.state);
    // The socket may have delivered this action already. The number tells a
    // board's own reply from a repetition of one it has already applied. A debug
    // action is the exception: it changes the state without changing the number,
    // so a board that applied it once must not refuse it a second time.
    const isDebug = action.type === "debug";
    if (!isDebug && state.seq <= lastSeq) {
      return { events: [] };
    }
    if (isDebug && action.reset) lastSeq = -1;
    lastSeq = state.seq;

    game = state;
    frame.game = game;
    frame.ledger = game.ledger;
    paintPhase();
    // The card is put in step with the new state BEFORE the animation runs, so
    // a purchase stops offering itself at the instant it is accepted and the
    // build rows show what they have become while the ring is still drawing.
    // Waiting for the animation would leave a live Buy button under the finger.
    syncCard(frame, context());

    await playEvents(response.data.events);

    // The coin already walked during `moved`; syncing here is what puts the
    // weapons and the final slot on screen without moving anybody twice.
    pieces.sync(game.pieces);
    paint({ animate: true });

    // A property decision that has just been answered takes its card away. A
    // chest card closes itself, because it has a reveal to finish first.
    if (
      before?.phase === PHASE.DECISION &&
      game.phase !== PHASE.DECISION &&
      cardMode === "decision" &&
      holder()?.dataset.cardKind === "property"
    ) {
      await dismissCard();
    }

    return { state, events: response.data.events };
  }

  /**
   * Apply a snapshot the server pushed down the socket.
   *
   * This is how the other player's move reaches this screen: the events are
   * animated and the new state is painted. The number keeps a repeated
   * broadcast from being played twice, and a snapshot that arrives mid-animation
   * is queued rather than dropped.
   */
  frame.applySnapshot = (snapshot) => {
    if (!snapshot?.state) return;
    const candidate = restoreGame(snapshot.state);
    if (!candidate) return;
    const isReset = candidate.seq === 0 && lastSeq > 0;
    if (!isReset && candidate.seq <= lastSeq) return;
    if (busy) {
      pendingSnapshot = snapshot;
      return;
    }
    busy = true;
    (async () => {
      try {
        lastSeq = candidate.seq;
        game = candidate;
        frame.game = game;
        frame.ledger = game.ledger;
        paintPhase();
        await playEvents(snapshot.events || []);
        pieces.sync(game.pieces);
        paint({ animate: true });
        // A decision the other player is making is shown here as a read-only
        // card. Their own board is the one with the buttons.
        if (game.phase === PHASE.DECISION && !isMyTurn()) {
          await openDecision();
        }
      } finally {
        busy = false;
        paintPhase();
        if (pendingSnapshot) {
          const next = pendingSnapshot;
          pendingSnapshot = null;
          frame.applySnapshot(next);
        }
      }
    })();
  };

  /** The chip for a seat on this screen, or null. */
  const chip = (seat) => root().querySelector(`.who[data-seat="${Number(seat)}"]`);

  /** The colour of a seat's own coin, for the announcement's motif. */
  const seatColour = (seat) =>
    coinColor(game?.ledger?.players?.find((p) => p.seat === Number(seat))?.civ) ||
    "var(--ink)";

  /** Say what happened, worded for this viewer, or say nothing. */
  async function say(event) {
    const spec = announcementFor(event, { viewer: mySeat, ledger: game?.ledger });
    if (!spec) return;
    await announce.show({ ...spec, color: seatColour(spec.seat) });
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
          // Count the purse while the coins are travelling: the balance and
          // the money are two answers to the same question.
          paint({ animate: true });
          await Promise.all([
            say(event),
            flyCoins(frame, {
              from: chip(event.seat),
              to: cellAt(event.id),
              amount: event.price,
            }),
          ]);
          break;
        }

        case "upgraded": {
          markBoard(frame, game.ledger);
          pipPulse(cellAt(event.id));
          paint({ animate: true });
          await say(event);
          break;
        }

        case "sold": {
          markBoard(frame, game.ledger);
          paint({ animate: true });
          await Promise.all([
            say(event),
            flyCoins(frame, {
              from: cellAt(event.id),
              to: chip(event.seat),
              amount: event.payout,
            }),
          ]);
          break;
        }

        case "passed": {
          await say(event);
          break;
        }

        case "rentPaid": {
          paint({ animate: true });
          await Promise.all([say(event), flyRent(root(), frame, event)]);
          break;
        }

        case "salary": {
          paint({ animate: true });
          await Promise.all([
            say(event),
            flyCoins(frame, {
              from: cellAt("start"),
              to: chip(event.seat),
              amount: event.amount,
            }),
          ]);
          break;
        }

        case "rentShort": {
          // What the payer could actually hand over still flies; the rest is the
          // short, and the notice is the only thing that says the visit was not
          // an ordinary rent. Nothing else happens because of it.
          if (event.amount > 0) {
            paint({ animate: true });
            await Promise.all([say(event), flyRent(root(), frame, event)]);
          } else {
            await say(event);
          }
          toast(frame, rentShortMessage(event), { tone: "refused" });
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

  /** Open the card the decision belongs to. */
  async function openDecision() {
    const landing = game.landing;
    if (!landing) return;
    // The card belongs to whoever is looking at it. On the player whose turn it
    // is it is a decision with buttons; on the other screen it is a read-only
    // card, because the buttons would only be refused.
    const mine = isMyTurn();

    if (landing.kind === "chest") {
      cardMode = mine ? "decision" : "read";
      reading = false;
      paintPhase();
      if (mine) {
        await showChest(frame, {
          drawable: true,
          // The draw is an action. The card shuffles and reveals; the game
          // chooses. There is no second random generator behind the glass.
          draw: async () => {
            // The e2e may force the draw (for bad luck) by setting
            // window.__drawRng; the server honours it only in the preview.
            const rng = window.__drawRng;
            const result = await step(
              rng !== undefined ? { type: "drawWeapon", rng } : { type: "drawWeapon" },
            );
            const drawn = result?.events.find((event) => event.type === "weaponDrawn");
            return drawn?.weapon || BAD_LUCK;
          },
          collect: async () => {
            await step({ type: "collectWeapon" });
          },
          onWeapon: () => paint({ animate: false }),
        });
      } else {
        showChest(frame, { drawable: false, onClose: () => closeRead() });
      }
      cardMode = "read";
      frame.dataset.reading = "false";
      // Bad luck leaves the visit open until it is acknowledged; collecting
      // leaves it in RESOLVING. Either way the phase settles from here.
      if (mine && game.phase === PHASE.DECISION && game.landing?.kind === "chest") {
        await step({ type: "continue" });
      }
      return;
    }

    if (!landing.id || !isPurchasable(landing.id)) return;
    cardMode = mine ? "decision" : "read";
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
    if (busy) return;
    if (isDecision()) return;
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
    if (!isMyTurn()) return;
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
    if (profileSeat !== null) return;
    if (!reading) return;
    if (event.target.closest?.(".board__card")) return;
    closeRead();
  });

  frame.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (profileSeat !== null) {
      closeProfile();
      return;
    }
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
