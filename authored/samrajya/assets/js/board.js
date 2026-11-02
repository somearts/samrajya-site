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
   DOWN - the die's visibility, the middle's status, the chip's ring - from the
   state it was handed. Nothing here sets the active player except by asking the
   game to continue a finished turn.

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
import { dice, dieVisible, prefersStill, throwTo } from "./dice.js";
import { DICE_DELAY_MS, DICE_HOLD_MS, DICE_ROLL_MS, pause } from "./timing.js";
// The layer draws the coins; the rules they obey - including the name a seat
// goes by - are in coins.js, which imports nothing and is tested on its own.
import { coins } from "./coin-layer.js";
import { renderShieldTiles, renderWeapons } from "./chest-card.js";
import { cornerCard, squareCard } from "./square-card.js";
import { KRONOS_CHEST, RAGNAROK, BAD_LUCK } from "./shared/weapons.js";
import { NEXUS } from "./shared/nexus-cards.js";
import { hideCard, showCard, syncCard } from "./property-card.js";
import {
  markBoard,
  syncActive,
  syncPurses,
} from "./economy-ui.js";
import { profilePanel } from "./profile.js";
import { announcementLayer } from "./announcement.js";
import { announcementFor, statusFor } from "./shared/announcements.js";
import { isPurchasable } from "./shared/properties.js";
import { ENABLE_SELL, PHASE, restoreGame, shieldsOf } from "./shared/game.js";
import { coinColor } from "./shared/civilizations.js";
import { CELLS, CORNER_IDS, SETS } from "./shared/spaces.js";
import {
  cardAway,
  flyCoins,
  flyRent,
  fightWar,
  pipPulse,
  resetHolder,
  ringDraw,
  shake,
} from "./board-fx.js";
import {
  chestCollectButton,
  chestDoneButton,
  chestWaiting,
  drawChestPeek,
  drawChestStage,
  playKronosStage,
  playNexusStage,
  playRagnarokStage,
} from "./chest-stage.js";
import {
  clearFightMarks,
  drawFightMarks,
  drawFightStage,
} from "./fight-stage.js";
import { drawEpochStage } from "./epoch-stage.js";
import { drawHoleStage, playHoleCinematic, renderHole } from "./hole-stage.js";
import { drawSpaceStage } from "./space-stage.js";

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

/**
 * One corner: its mark, its name, and a rule beneath.
 *
 * A corner is a BUTTON, like every other square on the board. It used to be a
 * plain box, on the grounds that a square you cannot act on should not look
 * like a control. But every square on this board can now be read, and a square
 * that took a tap and answered with nothing was a square that looked broken.
 */
function cornerCell(cell) {
  return el(
    "button",
    {
      type: "button",
      class: "board__cell board__cell--corner",
      style: { gridColumn: String(cell.col), gridRow: String(cell.row) },
      "data-id": cell.id,
      "data-index": String(cell.index),
      "data-cell": cell.type,
      "data-corner": cell.id,
      "aria-label": `${cell.name}, corner`,
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
    // Every chest is a button, for the same reason every corner is: a chest
    // can be read, and a square that answers a tap with nothing is a square
    // that looks broken.
    return el(
      "button",
      {
        ...props,
        type: "button",
        "aria-label": `${cell.name}, chest`,
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


  // The big middle layer. It says whose turn it is while the board is waiting,
  // and takes the whole middle for one sentence when something has happened.
  // Both players read the same layer; the waiting player is never left with an
  // empty centre.
  //
  // The layer tells the board when the middle changes hands - a notice ends,
  // the status comes back - because the die's place in the middle depends on
  // it, and the middle changes without the board being asked.
  let repaintQueued = false;
  const announce = announcementLayer(centreArea, {
    onChange: () => {
      if (repaintQueued) return;
      repaintQueued = true;
      queueMicrotask(() => {
        repaintQueued = false;
        paintPhase();
      });
    },
  });

  /* ------------------------------------------------------------- the game */

  let game = given;
  let cardMode = "read";
  let reading = false;
  let busy = false;
  /* The last action a person asked for, and when. A double-tap is one press;
     see `run` for why the in-flight lock is not enough on a fast network. */
  let lastPress = { type: null, at: 0 };
  /* TRUE WHILE THE BLACK HOLE'S FIVE-SECOND BLACKOUT HOLDS THIS SCREEN.
     Declared with the other board-wide flags because everything that draws
     or acts reads it: no panel opens, no action leaves, the die is not
     offered - see playHoleVeilOnce, the one place it rises. */
  let cinematic = false;
  /* The number of the last action this board applied. The socket repeats the
     state an action produced; the number is how a board knows that repetition
     from a genuinely new turn. */
  let lastSeq = game?.seq ?? 0;
  /* A snapshot that arrived while this board was busy animating its own action.
     It is applied the moment the animation is done, so a move by the other
     player is never dropped just because this screen was mid-flight. */
  let pendingSnapshot = null;

  frame.game = game;
  frame.seat = mySeat;
  frame.ledger = game?.ledger ?? null;
  frame.announce = announce;

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
  /* Which card is mounted, and for which decision. The same decision can be
     offered twice - by the answer to an action, and by the copy of that action
     that comes down the socket - and a card that is built twice is a card whose
     buttons belong to a card nobody can see. */
  let cardKey = null;
  /* What has the middle of the board right now: a card, a player's record, or
     both. The announcement layer is told about it in `paintPhase`, which is
     the one place that knows. */
  const middleOwners = new Set();

  function closeProfile() {
    if (profileSeat === null) return;
    profileSeat = null;
    delete frame.dataset.profile;
    delete frame.dataset.profileSeat;
    centreArea.querySelector(".board__profile")?.remove();
    // The middle is the board's again, so the die comes back to it. The
    // announcement layer is told by `paintPhase`, which is the one place that
    // knows what has the middle.
    paintPhase();
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
    // The record is the middle of the board now, so the die gives way to it.
    // `paintPhase` is what tells the announcement layer that the middle has
    // been taken: anything being said steps aside and is said when the record
    // closes.
    paintPhase();
  }

  frame.openProfile = openProfile;
  frame.closeProfile = closeProfile;
  frame.toggleProfile = openProfile;

  /* --------------------------------------------------------- the test panel
     A compact panel that replaces the die when the Test pill is pressed. It
     lets the active player type a step count (1-28) and move the coin
     instantly. Back returns to the die. */
  let testPanelOpen = false;

  function openTestPanel() {
    if (!game?.testMode) return;
    if (game.phase !== PHASE.AWAITING_ROLL) return;
    if (!isMyTurn()) return;
    testPanelOpen = true;
    renderTestPanel();
    paintPhase();
  }

  function closeTestPanel() {
    testPanelOpen = false;
    centreArea.querySelector(".board__test-panel")?.remove();
    paintPhase();
  }

  function renderTestPanel() {
    centreArea.querySelector(".board__test-panel")?.remove();
    const panel = el("div", { class: "board__test-panel" }, [
      el("span", { class: "board__test-label", text: "TEST MOVE" }),
      el("input", {
        type: "text",
        class: "board__test-input",
        inputmode: "numeric",
        pattern: "[0-9]*",
        min: "1",
        max: "28",
        value: "1",
        "aria-label": "Steps to move (1 to 28)",
      }),
      el("button", {
        type: "button",
        class: "btn btn--quiet board__test-move",
        text: "Move",
        onclick: () => {
          const input = panel.querySelector(".board__test-input");
          const steps = parseInt(input?.value || "", 10);
          if (Number.isInteger(steps) && steps >= 1 && steps <= 28) {
            closeTestPanel();
            run({ type: "testRoll", steps });
          }
        },
      }),
      el("button", {
        type: "button",
        class: "btn btn--quiet board__test-back",
        text: "Back",
        onclick: closeTestPanel,
      }),
    ]);
    centreArea.append(panel);
  }

  frame.openTestPanel = openTestPanel;
  frame.closeTestPanel = closeTestPanel;


  const root = () => frame.closest(".board-screen") || document;
  const holder = () => frame.querySelector(".board__card");
  const cellAt = (id) => frame.querySelector(`.board__cell[data-id="${id}"]`);
  const isDecision = () => game.phase === PHASE.DECISION;
  const isMyTurn = () => mySeat !== null && game.active === Number(mySeat);

  /** Everything on screen that the game decides, repainted from the game. */
  /* ---------------------------------------------------- OBLIVION / VICTORY

     THE ONE ENDING, PAINTED FROM `game.over` - the same authoritative fact
     both devices read, so the loser's screen turns red and the winner's
     green in the same moment, and a reconnect or refresh simply paints it
     again from the persisted state. The overlay owns the viewport: fixed
     above everything (over the board, the announcements and even the
     singularity's veil), swallowing every pointer event, so nothing under
     it can be pressed - the game's own server-side refusal is the second
     net. Declared before `paint` because paint is what calls it, and its
     element is kept so a repaint updates rather than rebuilds. */
  let endingCard = null;

  function syncEnding() {
    const over = game?.over;
    if (!over) {
      if (endingCard) {
        endingCard.remove();
        endingCard = null;
      }
      return;
    }
    if (mySeat === null || mySeat === undefined) return; // painted the moment this board knows its seat
    const lost = Number(mySeat) === Number(over.loser);
    const side = lost ? "lost" : "won";
    if (endingCard && endingCard.dataset.side === side && endingCard.isConnected) return;
    endingCard?.remove();
    endingCard = el(
      "div",
      { class: `ending ending--${side}`, "role": "alertdialog", "aria-modal": "true" },
      [
        el("div", { class: "ending__inner" }, [
          el("h1", { class: "ending__title", text: lost ? "OBLIVION" : "VICTORY" }),
          el("p", {
            class: "ending__sub",
            text: lost ? "YOUR EMPIRE HAS FALLEN" : "YOU CONQUERED THE UNIVERSE",
          }),
        ]),
      ],
    );
    document.body.append(endingCard);
  }

  const paint = ({ animate = true } = {}) => {
    if (!game) return;
    syncEnding(); // the ending screen answers the state before anything else
    syncPurses(root(), game.ledger, { animate });
    markBoard(frame, game.ledger);
    syncActive(root(), game.active);
    for (const piece of game.pieces) {
      renderWeapons(root(), piece.seat, piece.weapons);
      /* And the hole: one seat can be held, and the chip is what says so
         between the held seat's turns, when the middle is the opponent's. */
      renderHole(root(), piece.seat, game.hole);
    }
    /* THE KRONOS SHIELD LIVES ON THE TILE, not in a chip: a chip dot said
       "stored", and a shield is never stored - it is standing on a colony.
       This mark is the standing. */
    renderShieldTiles(frame, game.shields || []);
    syncCard(frame, context());
    paintPhase();
    renderProfile();
  };

  /**
   * The die, the middle's status and the tab stops, all from pointer-events and
   * from the phase. A decision has no die; neither does a read-only card,
   * because a card that can be dismissed by a tap is not a card you can throw
   * past.
   *
   * Whether the die is on the board at all is one question with one answer:
   * `dieVisible`. The die used to follow the phase, and a tap changed the
   * phase - so the die left the screen for as long as the server took to
   * answer, and came back. It is on the board now for as long as nothing
   * else wants the middle.
   */
  const paintPhase = () => {
    if (!game) {
      frame.dataset.phase = "";
      frame.dataset.active = "";
      frame.dataset.rollable = "false";
      frame.dataset.busy = busy ? "true" : "false";
      frame.dataset.die = "hidden";
      return;
    }
    frame.dataset.phase = game.phase;
    frame.dataset.active = game.active === null ? "" : String(game.active);
    frame.dataset.reading = reading ? "true" : "false";
    frame.dataset.cardMode = cardMode;
    frame.dataset.busy = busy ? "true" : "false";
    // The die belongs to the board, not to one player: both phones watch the
    // same throw. Only the right to press it is the active seat's.
    const rollable =
      game.phase === PHASE.AWAITING_ROLL &&
      !reading &&
      !busy &&
      !cinematic &&
      isMyTurn() &&
      !testPanelOpen;
    die?.setAttribute("tabindex", rollable ? "0" : "-1");
    die?.setAttribute("aria-hidden", String(!rollable));
    frame.dataset.rollable = rollable ? "true" : "false";

    /* THE MIDDLE HAS ONE OWNER AT A TIME.

       A card is a thing the player is reading and a record is a thing the
       player is reading; neither can have a notification painted over it. So
       while either of them is up the announcement layer is told the middle
       has been taken: anything being said steps aside and is said when the
       card goes, never over the top of it. */
    const cardUp = Boolean(holder() && !holder().hidden);
    const wanted = [];
    if (cardUp) wanted.push("card");
    if (profileSeat !== null) wanted.push("profile");
    if (testPanelOpen) wanted.push("test");
    for (const reason of middleOwners) {
      if (!wanted.includes(reason)) {
        middleOwners.delete(reason);
        announce.unblock(reason);
      }
    }
    for (const reason of wanted) {
      if (!middleOwners.has(reason)) {
        middleOwners.add(reason);
        announce.block(reason);
      }
    }
    const owner = wanted.length > 0;

    /* What the middle says when nothing is being announced. The status is a
       state and not a fact: it says whose turn it is, and it says it only
       while the game is waiting for a throw. In every other phase the middle
       belongs to the action - the die is tumbling, a card is up, or the turn
       is changing - and a status painted there would flash a turn that has
       not happened yet.

       This runs WHILE the board is busy too, on purpose: the moment a move
       begins the old turn is no longer true, and a spec left stored from it
       is a spec the event's hand-back repaints - the stale "Your Turn" that
       flashed at the payer after rent. Clearing it here is what keeps the
       hand-back honest. */
    if (owner) {
      announce.status(null);
    } else {
      const status = statusFor(game, { viewer: mySeat });
      let statusSpec = status ? { ...status, color: seatColour(status.seat) } : null;
      if (statusSpec) {
        const isActive = statusSpec.seat === mySeat;
        statusSpec.label = isActive ? "Your Turn" : "Opponent's Turn";
        statusSpec.big = isActive ? "Your Turn" : "Opponent's Turn";
      }
      announce.status(statusSpec);
    }

    frame.dataset.die = dieVisible(game, {
      seat: mySeat,
      throwing: frame.dataset.throwing === "true",
      card: cardUp || testPanelOpen,
      announcement: announce.covering(),
      profile: profileSeat !== null,
    })
      ? "shown"
      : "hidden";
  };

  /* A BOARD WITH NOTHING TO PRESS IS A BROKEN BOARD.

     The turn has stopped for a decision, and the card that decision belongs to
     is not on the screen. There is no die either - a decision has no die - and
     so the middle is empty and the board cannot be played. The player is left
     with a board that answers nothing, and the only way out is to reload the
     page.

     That is exactly what happened when the Nexus card closed itself after a
     refused offering: the game stayed in DECISION, the card went, and the
     server refused the next step as well, so nothing ever moved again.

     So the board watches for it and puts it right: if the turn is waiting for a
     decision and there is no card to answer it with, the board asks the server
     to move the turn on. The server decides whether it may; the board only
     makes the asking.

     It is checked where the board has come to rest - after the walk, and
     after a snapshot - and never in the middle of a move, when a decision that
     has just been reached is on its way to being opened. */
  let recovering = false;
  async function recoverStranded() {
    if (recovering || busy) return;
    if (!game || game.phase !== PHASE.DECISION) return;
    if (holder() && !holder().hidden) return;
    recovering = true;
    try {
      await run({ type: "continue" });
    } catch {
      /* The server refused, which means the turn is not where this board
         thinks it is. The next snapshot puts the board right. */
    } finally {
      recovering = false;
    }
  }

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
    /* The ACTIVE seat's carried suit, if it is unspent - the fact the buy
       card reads to show the discounted price before the confirmation. The
       suit belongs to whoever is deciding, so it is read from the active
       seat and never from whoever is looking. */
    suit: game.suits?.[game.active] || null,
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
    /* NOTHING LEAVES THE BOARD WHILE THE BLACKOUT HOLDS IT. The veil
       swallows every pointer event; this is the keyboard's door, and the
       server-side rules remain the final word whatever arrives. */
    if (busy || cinematic) return null;
    /* ONE PRESS IS ONE ACTION, EVEN ON A GLASS SCREEN.

       `busy` closes the door while a request is in flight, but a local server
       answers in under the 45ms between two taps of a double-tap, so the lock
       can be down again while the button the thumb just hit is still under
       it - and the same action goes out twice. A second press of the SAME
       action within 600ms is a double-tap, not a second decision: every
       action on this board changes the screen or ends the turn, so nothing
       legitimate repeats that fast. Refusals are excluded because they change
       nothing and a player may well try again immediately. */
    const now = Date.now();
    if (action.type === lastPress.type && now - lastPress.at < 600) return null;
    lastPress = { type: action.type, at: now };
    /* The presses this board actually accepted, for the mobile harness. It is
       a passive record - nothing reads it in the app - and it exists because a
       continue that ends a turn makes the board settle itself, and that settle
       sends a continue of its own: the wire count alone cannot tell a thumb
       from the state machine. Test-mode rooms only. */
    if (game?.testMode) {
      (frame.presses ||= []).push(action.type);
      if (frame.presses.length > 50) frame.presses.shift();
    }
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
      /* A refusal is not a decision: the player may well try the same thing
         again at once, so the double-tap guard stands down for it. */
      if (refusedHere) lastPress = { type: null, at: 0 };
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
      } else {
        /* The action is over and the board is free. If it has come to rest
           waiting for a decision that has no card, the board asks the server
           to move it on rather than sitting there with nothing to press. */
        void recoverStranded();
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
        ...((action.type === "roll" ||
          action.type === "drawWeapon" ||
          action.type === "drawShield") && rng !== undefined
          ? { rng }
          : {}),
      });
    } catch {
      await announce.show({
        label: "OFFLINE",
        big: "No connection",
        sub: "Check your network and try again.",
        tone: "refused",
      });
      return null;
    }

    if (!response.ok) {
      const no = {
        type: "refused",
        action: action.type,
        seat: game?.active ?? null,
        why: response.error,
      };
      const target =
        action.type === "buy"
          ? holder()?.querySelector(".property-card__buy")
          : action.type === "upgrade"
            ? holder()?.querySelector(".build__button:not([disabled])")
            : action.type === "sell"
              ? holder()?.querySelector(".property-card__sell")
              : die;
      // The button answers the tap at once with a shake, and the middle says
      // why at the same time. Neither waits for the other, and the board does
      // not stand still for either: a refusal is a sentence, not a pause.
      //
      // A TURN WARNING IS THE EXCEPTION, AND IT IS SILENT. "It is not your
      // turn" is what the server answers to any action that arrived after the
      // turn moved - a stale tap, or the board's own follow-up (continue, the
      // fight's done) landing a beat late during ordinary play. Splashing it
      // put "That cannot happen / It is not your turn" on screens doing
      // nothing wrong. The server still refuses; only the sentence is
      // dropped, and the turn indicator already says whose turn it is.
      if (!/not your turn/i.test(no.why || "")) {
        shake(target);
        await announce.show({
          label: "NOT NOW",
          big: "That cannot happen",
          sub: no.why,
          tone: "refused",
        });
      }
      return { events: [no] };
    }

    const state = restoreGame(response.data.state);
    // The socket may have delivered this action already. The number tells a
    // board's own reply from a repetition of one it has already applied. A debug
    // action is the exception: it changes the state without changing the number,
    // so a board that applied it once must not refuse it a second time.
    const isDebug = action.type === "debug";
    const repeated = !isDebug && state.seq <= lastSeq;
    if (!repeated) {
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
    }
    /* THE SOCKET GOT THERE FIRST.

       When the snapshot that came down the socket applied this action, the
       events were played with it and the state is already the board's. The
       answer to THIS call is still the server's, though, and it is still this
       call's to hand back: a chest card waiting to hear which weapon it drew
       must not be told "bad luck" because the socket was a moment quicker
       than the reply. */

    // The coin already walked during `moved`; syncing here is what puts the
    // weapons and the final slot on screen without moving anybody twice.
    pieces.sync(game.pieces);
    paint({ animate: true });

    // The landing may have opened a card, and a card takes the middle: the die
    // goes with it. The phase was painted before the walk, when the middle was
    // still empty, so the die's visibility has to be read again now that the
    // card is there - otherwise the die sits behind it.
    paintPhase();

    /* THE BLACKOUT IS OFFERED THE MOMENT THE WALK HAS ENDED - after the
       coin has landed, before anything is drawn for this state. Everything
       downstream (the panels, the cards) is gated on its flag, so a capture
       at the corner falls to black first and shows its panel only when the
       five seconds are completely over. */
    playHoleVeilOnce();

    /* THE CHEST IS REDRAWN FROM THE STATE, EVERY TIME IT MOVES.

       The chest is a shared screen, so both devices redraw it the moment the
       state says it has moved - whether this board pressed the button or the
       other one did. The redraw is a pure function of `game.chest`, so it
       cannot show one device something the other does not. */
    if (game.chest) {
      openChestStage();
    } else if (chestStage) {
      /* The chest is gone: the middle is the board's again. */
      chestStage = null;
      if (holder()?.dataset.cardKind === "chest") {
        await dismissCard();
      }
    }
    /* Whether the chest stayed or went, the glow answers the same state. */
    syncShieldTargets();
    if (game.fight) {
      openFightStage();
    } else if (fightStage) {
      /* The fight is gone: the middle is the board's again, and the tiles
         are put back the way a quiet board has them. */
      fightStage = null;
      clearFightMarks(frame);
      if (holder()?.dataset.cardKind === "fight") {
        await dismissCard();
      }
    }
    if (game.epoch) {
      openEpochStage();
    } else if (epochStage) {
      /* The Epoch visit is over: the middle is the board's again. */
      epochStage = null;
      if (holder()?.dataset.cardKind === "epoch") {
        await dismissCard();
      }
    }

    /* THE OUTER SPACE COUNTER, ON BOTH SCREENS - opened for the visit's
       DECISION and taken down the moment the visit ends, from the same
       state fact on every device. */
    if (game.space && game.phase === PHASE.DECISION && game.landing?.kind === "space") {
      openSpaceStage();
    } else if (spaceStage) {
      spaceStage = null;
      if (holder()?.dataset.cardKind === "space") {
        await dismissCard();
      }
    }

    /* THE BLACK HOLE, ON BOTH SCREENS - the flag from the call above is
       already up, so the panel here is gated and opens only once the five
       seconds have finished. It is drawn for every DECISION of the held
       seat's own turn: the capture's panel, and the panel that reopens
       after each entropy throw with the new figure on it - and it stays
       there until a choice is made, because the walk stops at DECISION and
       the hole's own guard refuses the continue. On the die turns the
       middle belongs to the die, and the chip carries the confinement. */
    if (
      game.hole &&
      game.hole.playerId === game.active &&
      (game.phase === PHASE.DECISION || game.phase === PHASE.RESOLVING)
    ) {
      openHoleStage();
    } else if (holeStage) {
      holeStage = null;
      if (holder()?.dataset.cardKind === "hole") {
        await dismissCard();
      }
    }

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
        /* The blackout is offered the moment the walk has been played -
           before any drawing below - so the panel every path is about to
           ask for is gated, and opens only after the five seconds. */
        playHoleVeilOnce();
        // A decision the other player is making is shown here as a read-only
        // card. Their own board is the one with the buttons.
        if (game.phase === PHASE.DECISION && !isMyTurn()) {
          await openDecision();
        } else if (cardIsStale()) {
          // The decision that card was standing in for has been answered, so
          // the card goes the same way the answering player's own card goes.
          // The next player starts with a clear middle and a die they can see.
          await dismissCard();
        }

        /* THE CHEST, ON THE WATCHING SCREEN.

           The other player sees the same chest the acting player sees - the
           same draw, the same weapon, the same card, the same amount - because
           it is drawn from the state and the state is the same. The only
           difference is that the buttons are not theirs to press. */
        if (game.chest) {
          openChestStage();
        } else if (chestStage) {
          chestStage = null;
          if (holder()?.dataset.cardKind === "chest") {
            await dismissCard();
          }
        }
        /* Whether the chest stayed or went, the glow answers the same state. */
        syncShieldTargets();
        if (game.fight) {
          openFightStage();
        } else if (fightStage) {
          fightStage = null;
          clearFightMarks(frame);
          if (holder()?.dataset.cardKind === "fight") {
            await dismissCard();
          }
        }
        /* Epoch, on the watching screen: the same shared card, drawn from the
           same state, with the buttons not theirs to press. */
        if (game.epoch) {
          openEpochStage();
        } else if (epochStage) {
          epochStage = null;
          if (holder()?.dataset.cardKind === "epoch") {
            await dismissCard();
          }
        }
        /* The same counter on the watching screen: the state is the same
           fact there, so the same gate opens it and the same walk takes
           it down when the visit ends. */
        if (game.space && game.phase === PHASE.DECISION && game.landing?.kind === "space") {
          openSpaceStage();
        } else if (spaceStage) {
          spaceStage = null;
          if (holder()?.dataset.cardKind === "space") {
            await dismissCard();
          }
        }
        /* The Black Hole, on both screens - the flag from the call above is
           already up, so the panel here is gated: it opens only after the
           five seconds, and the chip carries the confinement everywhere
           else. */
        if (
          game.hole &&
          game.hole.playerId === game.active &&
          (game.phase === PHASE.DECISION || game.phase === PHASE.RESOLVING)
        ) {
          openHoleStage();
        } else if (holeStage) {
          holeStage = null;
          if (holder()?.dataset.cardKind === "hole") {
            await dismissCard();
          }
        }
      } finally {
        busy = false;
        paintPhase();
        /* The snapshot has been applied and the board has come to rest. If it
           came to rest waiting for a decision that has no card, the board asks
           the server to move it on rather than sitting there with nothing to
           press. */
        if (!pendingSnapshot) void recoverStranded();
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

  /** Say what happened, worded for this viewer, or say nothing.
   *
   * The announcement is waited for, because it is a thing the player is
   * reading and the middle belongs to it while it is there. A queued
   * announcement - one that arrives while a card has the middle - resolves at
   * once: the game does not stand still for a notice it cannot show yet.
   */
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
          /* A test move skips the die tumble and hold delay. The coin starts
             moving immediately with the normal hop animation. */
          if (event.test) {
            await pieces.walk(event.path, event.seat);
            paintPhase();
            break;
          }
          /* THE DIE GOES FIRST.
             The coin does not move while the die is still tumbling. The die
             tumbles for DICE_ROLL_MS, the face is held for DICE_HOLD_MS - still,
             to be read - and only then does the coin start to walk. Both devices
             are playing the same event, so both wait the same time and the
             coin starts at the same moment on both phones.

             A reader who has asked for reduced motion gets no tumble, but the
             hold is kept: the face still sits there before anything moves. */
          frame.dataset.throwing = "true";
          paintPhase();
          const still = prefersStill();
          const started = performance.now();
          if (die) await throwTo(die, event.face);
          if (!still) {
            // The ticks are scaled to DICE_ROLL_MS, and the chain between them
            // costs a little; the remainder is waited out, so the throw takes
            // exactly as long as the timings say and not a few ticks more.
            await pause(Math.max(0, DICE_ROLL_MS - (performance.now() - started)));
          }
          await pause(DICE_HOLD_MS);
          await pieces.walk(event.path, event.seat);
          delete frame.dataset.throwing;
          paintPhase();
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

        case "epochMoved": {
          /* A TIME CARD MOVED THE COIN. There was no throw, so there is no die
             to tumble and no number to display: the coin simply walks the path
             the card produced, forward or back, and the board repaints. If a
             card moved without a dice roll, no fabricated throw is animated. */
          await pieces.walk(event.path, event.seat);
          paint({ animate: true });
          const moved = cellAt(
            ( CELLS.find((c) => c.index === event.to) || {}).id,
          );
          if (moved) {
            moved.classList.add("is-just-landed");
            setTimeout(() => moved.classList.remove("is-just-landed"), 420);
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

        case "redemption": {
          // The lap is paid at the end of the turn, after every other part of
          // the visit has resolved. Both phones see the same Redemption land.
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
          // What the payer could actually hand over still flies; the shortfall
          // is written into the rent sentence itself, so there is no second
          // notice flashing under the board.
          if (event.amount > 0) {
            paint({ animate: true });
            await Promise.all([say(event), flyRent(root(), frame, event)]);
          } else {
            await say(event);
          }
          break;
        }

        case "weaponDrawn":
          // The chest card reveals the weapon itself; the chip is repainted
          // from the game's pieces at the end of the step.
          break;

        case "weaponCollected": {
          /* The weapon is the player's now. Collect is the LAST press of
             the Ragnarok flow: the board closes the chest behind it as soon
             as it is free, so there is no Done screen and no second tap. */
          if (isMyTurn()) closeChestWhenFree();
          break;
        }

        case "shieldDrawn": {
          /* The card was REVEALED, not deployed: the popup draws itself from
             the state, and the repaint here keeps the board in step. Nothing
             is stored anywhere and no chip appears - a shield exists only
             once a colony takes it. */
          paint({ animate: false });
          break;
        }

        case "shieldTargeting":
        case "shieldDeployed": {
          /* COLLECT moved the chest into targeting (the glow is drawn with
             the stage in the step's tail) and the colony tap stood the
             shield up (the tile mark is drawn by this repaint). Same rule
             as every chest: the event animates nothing the state has not
             already said. */
          paint({ animate: false });
          break;
        }

        case "shieldBlocked": {
          /* THE STRIKE IS SPENT AGAINST THE SHIELD, and there is no war to
             play: fightWar is the blow LANDING, and this is the blow NOT
             landing. What both screens show is drawn from the state they
             both hold - the fight card's own line saying what stopped the
             strike, and the shield's mark leaving the defender's chip in the
             repaint. The closing is the same as a captured strike's: the
             acting player's board ends the fight once it has been seen, and
             the turn goes with it. */
          paint({ animate: true });
          if (isMyTurn()) void finishFightWhenFree();
          break;
        }

        case "shieldExpired": {
          /* The turn has handed over and the shield is gone from the state.
             The repaint takes the mark off the chip at the moment it goes -
             the chip is where carried things are shown, so the chip is where
             the ending of a carrying is shown. Nothing else speaks: this is a
             fact about an item, not an event in the middle of a decision. */
          paint({ animate: false });
          break;
        }

        case "holeOpened": {
          /* The confinement is a fact in the state from this moment; the
             chip says so at once, and the cinematic is played from the
             stage's own first sight of the capture - never from the event,
             which a screen that missed it would never replay. */
          paint({ animate: false });
          break;
        }

        case "holeEntropy": {
          /* THE ENTROPY THROW, AND THE PANEL IT LEAVES BEHIND. The same
             die and the same tumble an ordinary roll gives - no walk,
             because nothing moves. The dismissal key is cleared first so a
             panel somebody had closed with the × cannot swallow this fresh
             stage: the popup reopens over the new figure the moment the
             throw is read, and it stays until the player chooses. */
          holeDismissedKey = null;
          frame.dataset.throwing = "true";
          paintPhase();
          if (die) await throwTo(die, event.face);
          delete frame.dataset.throwing;
          paint({ animate: false });
          break;
        }

        case "holeBuilt":
        case "holeCommitted":
        case "holeVessel": {
          /* The panel redraws itself from the state in the step's tail - a
             committed seat's line, a released card - and the chip keeps
             step with the entropy or with the release. */
          paint({ animate: false });
          break;
        }

        case "spaceOpened":
        case "suitAcquired":
        case "suitExpired": {
          /* The counter and its popups are drawn from the state in the
             tail that follows these events - the arrival, the acquisition,
             the retirement - so the event itself only keeps the paint in
             step. The screen decides what it shows; nothing here does. */
          paint({ animate: false });
          break;
        }

        case "fightResolved": {
          /* THE WAR IS PLAYED FROM THE EVENT.

             The events are the one thing both boards are handed
             identically, in the same order, at the same turn - the same
             weapon, the same target, the same names. So the board shakes,
             the streak runs and the tile takes its colour here, and both
             phones watch the same strike at the same moment.

             The tile's ring is redrawn only AFTER the war: a tile that
             changed hands before the strike arrived would show the answer
             before the question. */
          const target = cellAt(event.id);
          await fightWar(frame, {
            weaponId: event.weapon,
            fromNode: chip(event.from),
            toNode: target,
          });
          markBoard(frame, game.ledger);
          ringDraw(target);
          paint({ animate: true });
          await say(event);
          // The strike has been seen on BOTH screens now; the acting
          // player's board closes the fight, and the turn ends with it.
          if (isMyTurn()) void finishFightWhenFree();
          break;
        }

        case "prayed":
        case "nexusDrawn": {
          // The Nexus card shows its own result; the board just keeps the purse
          // in step so the other player sees the new balance at the same time.
          paint({ animate: true });
          break;
        }

        case "turnChanged": {
          // The ring and the chip's emphasis move with the state, not after it.
          // The middle changes from one status to the other only once the last
          // fact of the finished turn has been read; `run` repaints it when the
          // action is done. Nothing sweeps across the board on top of it.
          paint({ animate: true });
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
        if (!(await step({ type: "continue" }))) return;
        continue;
      }
      if (game.phase === PHASE.RESOLVING) {
        await wait(260);
        if (!(await step({ type: "continue" }))) return;
        continue;
      }
      if (game.phase === PHASE.TURN_END) {
        await wait(220);
        if (!(await step({ type: "continue" }))) return;
        continue;
      }
      return;
    }
    /* The walk ran out of steps and the turn is still waiting for a decision.
       The board checks for a stranded turn once the action is over and the
       board is free - see `recoverStranded`. */
  }

  /* ------------------------------------------------------------ the chest

     The chest is a SHARED screen, and it is drawn from the state.

     `game.chest` is the whole truth about it: which chest it is, who is at
     it, and how far along its own little story it is. Both players draw the
     middle from that, so the two screens are the same screen - the same
     draw, the same weapon, the same card, the same amount - and the only
     difference is that the acting player has the buttons.

     Because it is drawn from the state and not from an event, a device that
     missed a message, that reconnected, or that joined late shows exactly
     the same thing. Nobody has to refresh.

     The stage is re-read whenever the state moves, and the animation runs
     once per stage: a device that arrives late joins the animation where it
     is rather than starting it over. */

  /* The stage that has been played, so an animation is not played twice. */
  let chestStage = null;
  /* Whether the current stage's animation has played to the end. The reveal
     is asked for only after it has: the card turns over at the end of the
     shuffle, not before it. */
  let chestAnimationDone = false;
  /* When this board first saw the current stage, in this board's own clock.
     The shuffle is measured from here, because the server's clock is not this
     browser's clock and the two cannot be subtracted. */
  let chestStageAt = 0;

  /* The name of the player at the chest, for the caption. */
  const chestName = (seat) =>
    game?.ledger?.players?.find((p) => p.seat === Number(seat))?.name || "Your opponent";

  /**
   * Draw the chest, from the state, and play whatever its stage has to play.
   */
  function openChestStage() {
    const chest = game?.chest;
    if (!chest) return;

    /* The glow follows the chest's own list, refreshed on every stage - and
       cleared here too when the chest has moved out of targeting. */
    syncShieldTargets();

    cardMode = isMyTurn() ? "decision" : "read";
    reading = false;
    cardKey = `chest:${chest.kind}:${chest.phase}:${chest.startedAt || 0}`;

    const mine = isMyTurn();
    const name = chestName(chest.playerId);

    /* THE STAGE KEY.

       The chest is a stage, and the stage is what the middle is drawn from.
       The key says which stage this is: which chest, which phase, and which
       moment it began. While the key is the same, the screen on the board is
       already right and is NOT drawn again - because drawing it again would
       wipe the deck that is halfway through its shuffle.

       When the key changes, the screen is drawn again from the new state and
       the new stage's animation is played. */
    const stageKey = `${chest.kind}:${chest.phase}:${chest.startedAt || 0}`;
    const changed = chestStage !== stageKey;
    chestStage = stageKey;
    if (changed) {
      chestStageAt = Date.now();
      chestAnimationDone = false;
    }

    let card = holder()?.querySelector(".nexus-card, .chest-card") || null;

    if (changed || !card || holder()?.hidden) {
      /* The handlers. Only the acting player gets them: the server refuses
         anything from anybody else, and a live button that does nothing is a
         worse thing than a disabled one. */
      const handlers = {};
      if (mine) {
        if (chest.kind === "nexus") {
          handlers['[data-action="pray"]'] = () => {
            void run({ type: "pray" });
          };
          handlers['[data-action="draw"]'] = () => {
            void run({ type: "drawNexus" });
          };
        } else if (chest.kind === "kronos") {
          /* KRONOS OFFERS THREE SHIELD FACES, and the player touches one of
             them - or THE ONE PILL, which is the whole flow in one button:
             open draws, revealed collects (the DEPLOY press that starts the
             targeting), and every terminal state - the shield standing, a
             miss, a declined deployment - closes the visit with `continue`,
             the same press every landing ends with: the chest goes down and
             the turn carries on through the normal walk, never through a
             second button. Only the server decides what any press means. */
          for (const slot of [0, 1, 2]) {
            handlers[`.chest-card__slot[data-slot="${slot}"]`] = () => {
              if (game.chest?.phase !== "open") return;
              void run({ type: "drawShield", slot });
            };
          }
          handlers['[data-action="draw"]'] = () => {
            const c = game.chest;
            if (!c) return;
            if (c.phase === "open") {
              void run({ type: "drawShield", slot: 1 });
            } else if (c.phase === "revealed" && !c.result?.none) {
              void run({ type: "collectShield" });
            } else if (
              (c.phase === "revealed" && c.result?.none) ||
              (c.phase === "targeting" && !(c.result?.compatible || []).length) ||
              c.phase === "deployed"
            ) {
              void run({ type: "continue" });
            }
          };
        } else {
          /* Ragnarok offers three faces, and the player touches one of them.
             The Draw pill is the same draw said once more: it takes the
             middle face, which is what a straight read of the row takes
             too. Both answer ONLY at the "open" stage: a second tap after
             the draw has begun can do nothing at all, and the server would
             refuse it anyway. */
          for (const slot of [0, 1, 2]) {
            handlers[`.chest-card__slot[data-slot="${slot}"]`] = () => {
              if (game.chest?.phase !== "open") return;
              void run({ type: "drawWeapon", slot });
            };
          }
          handlers['[data-action="draw"]'] = () => {
            if (game.chest?.phase !== "open") return;
            void run({ type: "drawWeapon", slot: 1 });
          };
          handlers['[data-action="collect"]'] = () => {
            if (game.chest?.phase !== "revealed") return;
            void run({ type: "collectWeapon" });
          };
        }
      }

      card = drawChestStage(frame, chest, { mine, handlers, playerName: name });
      if (!card) return;

      /* THE CLOSING.

         A real Ragnarok draw ends at Collect. Done survives where there is
         no collect to make (a bad-luck draw), where the chest's own rules
         asked for it (an answered Nexus, an offering) - and NEVER at
         Kronos. The shield chest has exactly one control: the pill, which
         walks DRAW -> DEPLOY -> DONE through the flow itself. The card
         appends no Done button for Kronos at any stage, so nothing but
         that pill can close the visit, and it only offers DONE once the
         deployment has succeeded (or the draw has conclusively failed). */
      const ragnarokRevealed =
        chest.kind === "ragnarok" && chest.phase === "revealed";
      const needsDone =
        chest.phase === "praying" ||
        (chest.kind === "nexus" && chest.phase === "revealed") ||
        (ragnarokRevealed && Boolean(chest.result?.badLuck));
      if (needsDone) {
        if (mine) {
          if (!card.querySelector('[data-action="done"]')) {
            card.append(chestDoneButton(() => {
              void run({ type: "done" });
            }));
          }
        } else if (!card.querySelector('[data-role="waiting"]')) {
          card.append(chestWaiting(name));
        }
      } else if (!mine && ragnarokRevealed && !card.querySelector('[data-role="waiting"]')) {
        /* The watcher waits with the player who is about to collect. */
        card.append(chestWaiting(name));
      }

      /* COLLECT IS THE LAST PRESS.

         The revealed card shows exactly one CTA: Collect. Pressed once, it
         awards the weapon server-side and the chest is on its way out -
         see closeChestWhenFree below. At the "done" phase any Collect left
         on the card is removed; it has already done its work. */
      if (chest.kind === "ragnarok") {
        if (chest.phase === "done") {
          card.querySelector('[data-action="collect"]')?.remove();
        } else if (
          chest.phase === "revealed" &&
          chest.result?.weapon &&
          mine &&
          !card.querySelector('[data-action="collect"]')
        ) {
          card.querySelector(".chest-card__collect-slot")?.append(chestCollectButton(() => {
            if (game.chest?.phase !== "revealed") return;
            void run({ type: "collectWeapon" });
          }));
        }
        if (chest.phase === "done" && mine) closeChestWhenFree();
      }

      paintPhase();
    }

    if (!changed) {
      /* THE STAGE HAS NOT MOVED, BUT IT MAY WANT SOMETHING DONE.

         The reveal is not an event - it is a stage that has to be left. So
         every time the board looks at the chest, it asks: is this stage
         waiting for something to be asked of the server?

         It is asked for only once the ANIMATION has played, because the card
         is turned over at the end of the shuffle: a request sent before the
         shuffle is over would turn the card over before the player has seen
         it shuffled. */
      if (chestAnimationDone) {
        if (
          chest.kind === "nexus" &&
          chest.phase === "shuffling" &&
          chest.choice === "draw" &&
          !chest.result?.revealed
        ) {
          revealNexusWhenFree();
        }
        if (
          chest.kind === "ragnarok" &&
          chest.phase === "drawing" &&
          chest.choice === "draw"
        ) {
          revealWeaponWhenFree();
        }
      }
      /* The Collect has been accepted and the chest is on its way out. The
         closing is asked for here as well as at the draw, so a board that
         re-enters the "done" stage (a repaint, a reload) still returns to
         the game instead of waiting for a Done pill that no longer exists. */
      if (chest.kind === "ragnarok" && chest.phase === "done" && mine) {
        closeChestWhenFree();
      }
      return;
    }

    /* The animation, once per stage. */
    chestAnimationDone = false;
    const playing = chest.kind === "nexus"
      ? playNexusStage(frame, chest, {
          chip: chip(chest.playerId),
          elapsed: Date.now() - chestStageAt,
        })
      : chest.kind === "kronos"
        ? playKronosStage(frame, chest)
        : playRagnarokStage(frame, chest);
    Promise.resolve(playing)
      .then(() => {
        /* The animation has played to the end. The card may now be turned
           over, and the money may move with it. */
        chestAnimationDone = true;
        /* The card is turned over, and the money moves with it.

           The board's lock is released first: a request sent into a busy
           board is dropped, and a dropped request is a card that is never
           turned over. */
        if (
          chest.kind === "nexus" &&
          chest.phase === "shuffling" &&
          chest.choice === "draw" &&
          !chest.result?.revealed
        ) {
          revealNexusWhenFree();
        }
        if (
          chest.kind === "ragnarok" &&
          chest.phase === "drawing" &&
          chest.choice === "draw"
        ) {
          revealWeaponWhenFree();
        }
      })
      .catch(() => {});
  }

  /* THE COMPATIBLE COLONIES, BLINKING RED - the fight's own selection
     treatment, reused at its strongest.

     The blink is drawn from the chest's AUTHORITATIVE compatible list on
     every stage of the chest - the same strong outline a weapon's target
     wears while a strike is armed, unmistakable rather than subtle - and
     cleared the moment there is no chest or no targeting. Both screens run
     this from the same state, so both see the same colonies offered, and
     no colony can look selectable when the server would refuse it. The
     frame class is only for the cursor: a lit colony is a colony that can
     be pressed. */
  function syncShieldTargets() {
    clearFightMarks(frame);
    const chest = game?.chest;
    const targeting = chest?.kind === "kronos" && chest.phase === "targeting";
    frame.classList.toggle("board--shield-targeting", targeting);
    if (targeting) {
      for (const id of chest.result?.compatible || []) {
        frame.querySelector(`.board__cell[data-id="${id}"]`)?.classList.add("is-fight-blink");
      }
    }
  }

  /* Ask the server to turn the Nexus card over, once the board is free.

     The board's lock is held while an action is running, and a request sent
     into a busy board is dropped - so the request waits its turn rather than
     being lost. */
  /* THE REVEAL IS ASKED FOR UNTIL IT IS ANSWERED.

     The card has to be turned over, and the request is dropped when the board
     is busy - so the request is asked for again, and again, until the server
     answers. It stops when the chest has moved on, which is what an answer
     looks like from here.

     It is stopped when the board is torn down, so a player who leaves does
     not leave a request running. */
  let revealing = false;
  async function revealNexusWhenFree() {
    if (revealing) return;
    revealing = true;
    try {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        if (!await waitForFree()) {
          await wait(250);
          continue;
        }
        const result = await run({ type: "revealNexus" });
        if (result) return;
        await wait(250);
      }
    } catch {
      /* The server refused, which means the chest has moved on. */
    } finally {
      revealing = false;
    }
  }

  /* The same, for the weapon at Ragnarok. */
  let revealingWeapon = false;
  async function revealWeaponWhenFree() {
    if (revealingWeapon) return;
    revealingWeapon = true;
    try {
      /* The request is not lost if the board is busy for a while: it waits, and
         if it is still busy it waits again. A reveal that gave up would leave
         the chest on "drawing" for ever - a weapon that was drawn and never
         turned over, and a visit that could not be ended. */
      for (let attempt = 0; attempt < 400; attempt += 1) {
        if (!await waitForFree()) {
          await wait(250);
          continue;
        }
        const result = await run({ type: "revealWeapon" });
        if (result) return;
        await wait(250);
      }
    } catch {
      /* The server refused, which means the chest has moved on. */
    } finally {
      revealingWeapon = false;
    }
  }

  /* Wait until the board is free, or give up. */
  async function waitForFree() {
    for (let i = 0; i < 200; i += 1) {
      if (!busy) return true;
      await wait(50);
    }
    return false;
  }

  /**
   * Close the Ragnarok chest once its Collect has been accepted.
   *
   * The weapon is the player's the moment the server says so; the chest is a
   * stage with nothing left to show, so the board closes it as soon as the
   * board is free and the turn carries on. Collect is therefore the last
   * press - no Done pill, no confirmation screen. Sent by the player at the
   * chest only; the watcher's chest closes from the same server state when
   * the snapshot arrives. The same shape as finishFightWhenFree: a request
   * sent into a busy board is dropped, and a dropped request is a chest that
   * never closes.
   */
  let closingChest = false;
  async function closeChestWhenFree() {
    if (closingChest) return;
    closingChest = true;
    try {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (!await waitForFree()) {
          await wait(250);
          continue;
        }
        if (
          game.chest?.kind !== "ragnarok" ||
          game.chest?.phase !== "done" ||
          !isMyTurn()
        ) {
          return;
        }
        const result = await run({ type: "done" });
        if (result) return;
        await wait(250);
      }
    } catch {
      /* The server refused, which means the chest has moved on. */
    } finally {
      closingChest = false;
    }
  }

  /* ------------------------------------------------------------- the fight

     The corner is a SHARED screen, drawn from the state the same way the
     chests are: `game.fight` is the whole truth about it, both players draw
     the middle from it, the acting player holds the buttons, and nothing
     about it has to be announced to be seen.

     The war is NOT drawn here. It is played from the `fightResolved` event,
     the one thing both boards are handed identically; the stage only shows
     the screen and marks the tiles the strike is looking at. */

  /* The stage that has been played, so a redraw does not wipe a screen that
     is already right. Unlike the chest, nothing inside the card is
     mid-animation: the blink and the glow live on the tiles, and they are
     repainted from the state every time the stage is looked at. */
  let fightStage = null;

  /** Draw the Fight, from the state, and mark the tiles it is looking at. */
  function openFightStage() {
    const fight = game?.fight;
    if (!fight) return;

    cardMode = isMyTurn() ? "decision" : "read";
    reading = false;
    cardKey = `fight:${fight.playerId}:${fight.phase}:${fight.startedAt || 0}`;

    const mine = isMyTurn();
    const stageKey =
      `fight:${fight.phase}:${fight.selectedWeaponId || ""}:${fight.armed}:${fight.startedAt || 0}`;
    const changed = fightStage !== stageKey;
    fightStage = stageKey;

    /* THE TILES SAY WHAT THE STRIKE IS LOOKING AT, on both screens alike:
       the soft glow while a weapon is chosen, the slow blink while it is
       armed. Marks are drawn from the ledger the whole game shares, so a
       tile that glows on one phone glows on the other. */
    drawFightMarks(frame, fight, game.ledger);

    if (!changed && holder() && !holder().hidden) return;

    const card = drawFightStage(frame, fight, {
      mine,
      ledger: game.ledger,
      pieces: game.pieces,
      /* The half at the bottom is the viewer's own player. viewerSeat is
         what orders them, and it is this browser's seat, not the game's. */
      viewerSeat: mySeat === null ? (mine ? fight.playerId : null) : Number(mySeat),
      playerName: chestName(fight.playerId),
    });
    if (!card) return;

    /* THE BUTTONS. Only the acting player's are live: the server refuses
       anything from anybody else, and a button that does nothing would be
       worse than one that is not there. One press does one thing - a face
       chooses or, already chosen, arms; the pill says it again. */
    if (mine) {
      const choose = (weaponId) => {
        const current = game.fight;
        if (!current || current.phase === "armed" || current.phase === "resolving") return;
        if (current.phase === "selected" && current.selectedWeaponId === weaponId) {
          /* THE SAME FACE AGAIN IS THE ARMING TOO, and so is the pill:
             choose, then arm, one face at a time. */
          void run({ type: "armWeapon" });
          return;
        }
        void run({ type: "selectWeapon", weaponId });
      };
      for (const btn of card.querySelectorAll('[data-action="face"]')) {
        btn.addEventListener("click", () => choose(btn.dataset.weapon));
      }
      /* THE ATTACK PILL ENTERS THE ARMED STATE IN ONE PRESS: the weapon is
         chosen first if it is not already the selected one, and then armed,
         so the valid colonies start blinking and the instruction to tap one
         appears. Two existing actions, in the order they must happen; the
         server still decides whether either is allowed. */
      for (const btn of card.querySelectorAll('[data-action="attack"]')) {
        btn.addEventListener("click", async () => {
          const weaponId = btn.dataset.weapon;
          const current = game.fight;
          if (!current || current.phase === "armed" || current.phase === "resolving") return;
          if (current.selectedWeaponId !== weaponId) {
            const picked = await run({ type: "selectWeapon", weaponId });
            if (!picked) return;
          }
          if (game.fight?.phase === "selected" && game.fight?.selectedWeaponId === weaponId) {
            void run({ type: "armWeapon" });
          }
        });
      }
      card.querySelector('[data-action="cancel"]')
        ?.addEventListener("click", () => void run({ type: "cancelArm" }));
      card.querySelector('[data-action="leave"]')
        ?.addEventListener("click", () => void run({ type: "leaveFight" }));
    }

    paintPhase();
  }

  /* ------------------------------------------------------------- the epoch

     The threshold, drawn from `game.epoch` the same way the chests and the
     fight are. One shared screen, both devices the same, buttons only on the
     player who landed. Nothing here decides what a card does - the server has
     already applied the effect to the real state and ledger; this only draws
     it. */
  let epochStage = null;

  /** Draw the Epoch card from the state, and wire its one action. */
  function openEpochStage() {
    const epoch = game?.epoch;
    if (!epoch) return;

    cardMode = isMyTurn() ? "decision" : "read";
    reading = false;
    cardKey = `epoch:${epoch.playerId}:${epoch.phase}:${epoch.startedAt || 0}`;

    const mine = isMyTurn();
    const stageKey = `epoch:${epoch.phase}:${epoch.cardId || ""}:${epoch.startedAt || 0}`;
    const changed = epochStage !== stageKey;
    epochStage = stageKey;
    if (!changed && holder() && !holder().hidden) return;

    const card = drawEpochStage(frame, epoch, {
      mine,
      ledger: game.ledger,
      pieces: game.pieces,
      viewerSeat: mySeat,
      playerName: chestName(epoch.playerId),
    });
    if (!card) return;

    /* Only the acting player's buttons are live: the server refuses anything
       from anybody else, and a button that does nothing is worse than one that
       is not there. Draw is the one action; it cannot be pressed twice because
       the card leaves the "open" stage the moment the server answers. */
    if (mine) {
      card.querySelector('[data-action="draw"]')
        ?.addEventListener("click", () => void run({ type: "drawTimeCard" }));
      for (const btn of card.querySelectorAll('[data-action="choice"]')) {
        btn.addEventListener("click", () =>
          void run({ type: "epochChoice", option: btn.dataset.option }));
      }
      card.querySelector('[data-action="continue"]')
        ?.addEventListener("click", () => void run({ type: "continue" }));
    }

    paintPhase();
  }

  /* ------------------------------------------------------- Outer Space

     THE SUIT COUNTER, drawn from `game.space` the way every other shared
     screen is drawn: one fact, both devices, buttons only for the seat at
     the counter. Its stage key carries the phase and the suit, so the
     arrival, the acquisition popup and the retirement each redraw the card
     once, and a repaint of the stage already on screen is left alone -
     which is also what keeps a locally dismissed expiry notice dismissed. */

  let spaceStage = null;

  function openSpaceStage() {
    const space = game?.space;
    if (!space) return;
    if (game.phase !== PHASE.DECISION) return; // the counter appears with the decision, never mid-walk
    if (cinematic) return;

    cardMode = isMyTurn() ? "decision" : "read";
    reading = false;
    cardKey = `space:${space.playerId}:${space.startedAt || 0}`;

    const mine = isMyTurn() && space.playerId === game.active;
    const stageKey =
      `space:${space.playerId}:${space.phase}:${space.suit || ""}:` +
      `${space.expired || ""}:${space.startedAt || 0}`;
    const changed = spaceStage !== stageKey;
    spaceStage = stageKey;
    if (!changed && holder() && !holder().hidden) return;

    const money =
      game.ledger.players.find((player) => player.seat === game.active)?.money ?? 0;
    const card = drawSpaceStage(frame, space, { mine, money });
    if (!card) return;

    /* Only the seat at the counter can press: the server refuses everybody
       else, and a live button that does nothing is worse than a dead one.

       THE PRESS IS DELEGATED TO THE CARD, not bound to the individual
       buttons. On a returning visit the card's first face is the expiry
       notice, and its CONTINUE - a purely local dismissal - swaps the
       card's own contents for the counter underneath. Those counter
       buttons were built AFTER this wiring pass, so binding them at draw
       time left every one of them dead and the turn unfinishable. One
       listener on the card itself rides that swap (and any repaint of the
       same card), so the face that appears late is as live as the face
       drawn first. The notice's own press carries a different data-action
       and wires itself inside the stage, so it is left alone. */
    if (mine) {
      card.addEventListener("click", (event) => {
        const btn = event.target?.closest?.('[data-action="acquire"], [data-action="continue"]');
        if (!btn || btn.disabled) return;
        if (btn.dataset.action === "acquire") {
          void run({ type: "acquireSuit", suitId: btn.dataset.suit });
          return;
        }
        void run({ type: "continue" });
      });
    }

    paintPhase();
  }

  /* ------------------------------------------------------- the black hole */

  let holeStage = null;

  /* THE PANEL'S OWN DISMISSAL, BY STAGE.

     The close button hides the SCREEN and remembers which stage it hid:
     the next repaint of that same stage stays hidden (so the card does not
     pop straight back), a NEW stage - committed, released, a fresh capture -
     shows again because the state has moved on, and tapping the tile clears
     it so the same live panel can be brought back at will. The confinement
     itself is never touched: this is a screen key, not a game fact. */
  let holeDismissedKey = null;

  /** Draw the confinement panel from the state, and wire its presses. */
  function openHoleStage() {
    const hole = game?.hole;
    if (!hole) return;
    if (cinematic) return; // never behind the blackout, never during it

    const stageKey = `hole:${hole.playerId}:${hole.phase}:${hole.startedAt || 0}`;
    if (holeDismissedKey && holeDismissedKey !== stageKey) holeDismissedKey = null;
    if (holeDismissedKey === stageKey) return; // closed by the ×; the tile reopens it

    cardMode = isMyTurn() ? "decision" : "read";
    reading = false;
    cardKey = stageKey;

    const mine = isMyTurn() && hole.playerId === game.active;
    const changed = holeStage !== stageKey;
    holeStage = stageKey;
    if (!changed && holder() && !holder().hidden) return;

    const handlers = {};
    if (mine) {
      handlers['[data-action="build"]'] = () => {
        if (game.hole?.phase !== "confined") return;
        void run({ type: "buildEntropy" });
      };
      handlers['[data-action="escape"]'] = () => {
        if (game.hole?.phase !== "confined") return;
        void run({ type: "escapeNext" });
      };
      handlers['[data-action="vessel"]'] = () => {
        if (game.hole?.phase !== "confined") return;
        void run({ type: "acquireVessel" });
      };
    }

    drawHoleStage(frame, hole, {
      mine,
      ledger: game.ledger,
      handlers,
      playerName: chestName(hole.playerId),
      onClose: () => {
        holeDismissedKey = stageKey;
        const box = holder();
        if (box) box.hidden = true;
        paintPhase();
      },
    });
    paintPhase();
  }

  /* THE CINEMATIC, ONCE PER CAPTURE, AND THE PANEL ONLY AFTER IT.

     Keyed by the capture's own moment: a repaint, a re-render or a snapshot
     carrying the same `startedAt` cannot play it twice, and the capture is
     remembered in this tab's session - so a refresh or a reconnect during
     the five seconds neither replays the fade nor withholds the panel: what
     has been seen stays seen, and the panel simply opens.

     THE SEQUENCE, IN ORDER: the veil goes up and the flag freezes the
     board; five seconds later the veil is gone, the flag falls, and the
     panel opens from the same state - once, because the stage key below
     only ever draws a stage that has changed. It carries no game effect:
     nothing in the state waits on it. */
  let veilAt = null;
  function playHoleVeilOnce() {
    const hole = game?.hole;
    if (!hole || veilAt === hole.startedAt) return;
    veilAt = hole.startedAt;

    /* A refresh mid-capture has seen this one already: no replay, and the
       panel opens at once (the `cinematic` flag never rises). */
    const seenKey = `samrajya:hole:${hole.startedAt}`;
    try {
      if (sessionStorage.getItem(seenKey)) return;
      sessionStorage.setItem(seenKey, "1");
    } catch {
      /* A browser that withholds session storage still gets one play per
         mount of this capture - the key above stops the repeats we control. */
    }

    cinematic = true;
    paintPhase();
    void playHoleCinematic(hole)
      .catch(() => {})
      .finally(() => {
        cinematic = false;
        paintPhase();
        /* THE PANEL OPENS HERE, AND ONLY HERE - after the blackout has
           completely finished. Both screens run this same sequence from
           the same state, so both show the panel at the same moment, and
           neither ever shows it during or behind the fade. */
        if (
          game?.hole &&
          game.hole.playerId === game.active &&
          (game.phase === PHASE.DECISION || game.phase === PHASE.RESOLVING)
        ) {
          openHoleStage();
        }
      });
  }

  /** Ask the server to close the fight, once the board is free.

      The war has played to its end on this screen, and the turn ends only
      when the state says the strike has been seen. The fight is sent on its
      way here rather than inside the event, because the board's lock is held
      while an event plays - and a request sent into a busy board is dropped. */
  let finishingFight = false;
  async function finishFightWhenFree() {
    if (finishingFight) return;
    finishingFight = true;
    try {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        if (!await waitForFree()) {
          await wait(250);
          continue;
        }
        /* The fight has moved on - by the other screen's own press arriving
           first, or by a leave - so there is nothing this board owes it. */
        if (game.fight?.phase !== "resolving" || !isMyTurn()) return;
        const result = await run({ type: "done" });
        if (result) return;
        await wait(250);
      }
    } catch {
      /* The server refused, which means the fight has moved on. */
    } finally {
      finishingFight = false;
    }
  }

  /** Open the card the decision belongs to. */
  async function openDecision() {
    try {
      /* A TEST-ONLY FAULT INJECTION. It exists so the fallback below can be
         proved in a real browser: set `data-fail-draw="1"` on the board and
         the next decision draw throws exactly as a broken stage would. Only
         test-mode rooms can reach it. */
      if (game?.testMode && frame.dataset.failDraw === "1") {
        frame.dataset.failDraw = "0";
        throw new Error("test: the decision draw threw");
      }
      await openDecisionUnsafe();
    } catch (error) {
      drawFailure(error);
    }
  }

  /* A CARD THAT THREW IS NOT A BLANK SCREEN.

     Every stage draws from the state, and the state can name a card a stage
     cannot build - a bad suit id, a missing record, a bug in a brand new
     branch. The old failure mode was the worst one: the draw threw mid-way,
     the holder kept whatever was in it, and the turn sat in DECISION with
     nothing to press and no way out but a reload.

     So a throw is caught at the one place all decisions pass through, and the
     holder is given a card that says what happened and a 44px TRY AGAIN that
     redraws from the same state. The turn is untouched; retrying is safe
     because drawing reads the game and never changes it. */
  function drawFailure(error) {
    console.error("Samrajya: a card could not be drawn", error);
    const box = holder();
    if (!box) return;
    // The stage keys guard against redrawing; a retry must not be mistaken for
    // "the same stage is already on screen".
    spaceStage = null;
    chestStage = null;
    epochStage = null;
    holeStage = null;
    cardKey = null;
    cardMode = isMyTurn() ? "decision" : "read";
    reading = false;
    box.dataset.cardKind = "fallback";
    box.hidden = false;
    box.scrollTop = 0;
    box.replaceChildren(el("div", { class: "draw-failure" }, [
      el("p", { class: "draw-failure__title", text: "This card did not draw" }),
      el("p", {
        class: "draw-failure__note",
        text: "Your turn is safe. Try drawing it again.",
      }),
      el("button", {
        type: "button",
        class: "draw-failure__retry",
        text: "Try again",
        onclick: () => {
          box.hidden = true;
          void openDecision();
        },
      }),
    ]));
    paintPhase();
  }

  async function openDecisionUnsafe() {
    const landing = game.landing;
    /* A CONFINED TURN HAS NO SQUARE - the panel IS the decision, and it is
       opened here so the ordinary walk (settle asks for the decision) finds
       it the same way it finds every other card. */
    if (game.hole && game.hole.playerId === game.active) {
      openHoleStage();
      return;
    }
    if (!landing) return;
    // The card belongs to whoever is looking at it. On the player whose turn it
    // is it is a decision with buttons; on the other screen it is a read-only
    // card, because the buttons would only be refused.
    const mine = isMyTurn();
    // The turn is in the key as well as the square: the same square can be
    // landed on twice in a game, and the second visit is a different card.
    const key = `${game.turn}:${landing.id}:${mine ? "decision" : "read"}`;

    /* The same decision can be offered twice: once by the answer to the
       action, and once by the copy of that action that comes down the socket.
       A card that is built twice is a card whose buttons belong to a card
       nobody can see - so the card that is already up stays up. */
    if (cardKey === key && holder() && !holder().hidden) return;
    cardKey = key;

    if (landing.kind === "fight") {
      /* THE FIGHT IS DRAWN FROM THE STATE, ON BOTH SCREENS. The same shared
         stage the chests draw from: `game.fight` is the truth, the buttons
         belong to the player who landed, and a device that reconnects or
         joins late draws the same middle. Nobody has to refresh. */
      openFightStage();
      return;
    }

    if (landing.kind === "chest") {
      /* THE CHEST IS DRAWN FROM THE STATE, ON BOTH SCREENS.

         The chest is a shared screen: it is a fact about the game, and the
         fact is in `game.chest`. So the middle is drawn from that fact, and
         the acting player and the waiting player get the SAME screen - the
         same draw, the same weapon, the same card, the same amount - with
         the buttons only on the acting player's side.

         Nothing here is an event that might be missed. A device that
         reconnects, or that joined late, reads the same chest out of the
         same state and shows the same screen. Nobody has to refresh. */
      openChestStage();
      return;
    }

    if (landing.kind === "epoch") {
      /* EPOCH IS DRAWN FROM THE STATE, THE SAME WAY. `game.epoch` is the
         truth; the buttons belong to the player who landed; a device that
         reconnects or joins late draws the same middle. Nobody refreshes. */
      openEpochStage();
      return;
    }

    if (landing.kind === "space") {
      /* THE OUTER SPACE COUNTER, THE SAME WAY: `game.space` is the truth,
         the seat that landed presses, and a device that reconnects or
         joined late draws the same screen. This is also the auto-open -
         landing here walks into this branch and the counter is simply
         there, with no tap on the tile needed. */
      openSpaceStage();
      return;
    }

    if (!landing.id || !isPurchasable(landing.id)) return;
    cardMode = mine ? "decision" : "read";
    reading = false;
    // `showCard` puts the card into the holder synchronously, so the phase is
    // painted once here (the die and status step aside the moment the card is
    // up, before its entrance animation) and once after the turn settles.
    const showing = showCard(frame, landing.id, context());
    paintPhase();
    try {
      await showing;
    } finally {
      paintPhase();
    }
  }

  /** Slide the decision card away and take it out of the holder. */
  async function dismissCard() {
    await cardAway(holder());
    hideCard(frame);
    cardKey = null;
    cardMode = "read";
    frame.dataset.cardMode = "read";
    // The middle is empty again, so the die comes back.
    paintPhase();
  }

  /**
   * The chest card has closed: the visit is over, and the turn carries on.
   *
   * The player whose turn it is is the one who drives this. The other screen
   * is watching a decision it is not answering, and its card is taken away
   * when the decision is answered - not by anything it does itself.
   */
  async function afterChest() {
    /* The chest is a shared screen now: it is closed by the acting player
       pressing Done, which is the `done` action. Nothing here closes it. */
    if (!isMyTurn()) return;
    await settle();
  }

  /**
   * Is the card on screen standing in for a decision that has been answered?
   *
   * Two cards can be on this screen and they do not belong to the same thing.
   * A card this screen opened for itself to read belongs to the reader: it
   * stays until they close it. A card that is here because the other player
   * was making a decision belongs to that decision, and when the decision is
   * answered the card has to go - or it stands over the next player's dice.
   *
   * A read card is the reader's (`reading` is true); a decision card is not.
   */
  const cardIsStale = () =>
    !isDecision() && !reading && Boolean(holder()) && !holder().hidden;

  /* ------------------------------------------------------------------ cards */

  /**
   * Open the card for a square the player pressed.
   *
   * EVERY square on the board answers a tap with a card in the middle: a
   * property with its price, the Nexus with its keeper, Ragnarok with its
   * weapons, and the corners and the quiet chests with the plain card that
   * says what they are. The only square that answers with nothing is the one
   * whose card is already open - and even that does not close and reopen it
   * under the player's finger.
   */
  function openRead(id) {
    if (busy || cinematic) return;

    const cell = CELLS.find((entry) => entry.id === id);
    if (!cell) return;

    /* THE CHEST TILES ANSWER AT ANY TIME.

       Pressing the Nexus or Ragnarok tile opens its pop-up whatever the game
       is doing - the god's picture, the mythology, the two options, disabled.
       The tile is a place a player can look at, and a place that only answers
       sometimes is a place that looks broken.

       Everything else waits for the board to be at rest, because a card in
       the middle during a turn would cover the thing being decided. */
    const isChestTile = cell.id === NEXUS.id || cell.id === RAGNAROK.id;
    /* BLACK HOLE ANSWERS A TAP ON ANY TURN. While nobody is held it is a
       reading card, not a decision - so the "only at rest" guards, which
       exist so a card cannot cover a decision in progress, must not keep
       the tile's own explanation from the player. While somebody IS held,
       a tap brings back the LIVE panel - never the lore card, never the
       landing cinematic. */
    const isBlackHoleRead = cell.id === "black-hole" && !game.hole;
    const isHoleReopen = cell.id === "black-hole" && Boolean(game.hole);
    if (!isChestTile && !isBlackHoleRead && !isHoleReopen) {
      if (game.phase !== PHASE.AWAITING_ROLL) return;
      if (isDecision()) return;
    }

    /* THE LIVE PANEL, BROUGHT BACK. Tap, and the same active popup returns
       from the same state - current entropy, current threshold, the presses
       that apply right now - with no cinematic (that belongs to the capture
       alone) and no state change of any kind. A tap while it is already up
       is swallowed before any bookkeeping runs, so nothing flickers and the
       panel keeps its own reading of the middle. */
    if (isHoleReopen) {
      const box = frame.querySelector(".board__card");
      if (box && box.dataset.cardKind === "hole" && !box.hidden) return;
      holeDismissedKey = null;
      openHoleStage();
      paintPhase();
      return;
    }

    const wantedKey = `${game.turn}:${id}:read`;
    // Already reading the requested tile: swallow the tap so the card stays
    // put and does not flash closed and open again.
    if (reading && cardKey === wantedKey) return;

    // A different tile is already open: close it cleanly first, then open the
    // new one in the same call so the middle is never empty between them.
    if (reading && cardKey !== wantedKey) closeRead();

    reading = true;
    cardMode = "read";
    cardKey = wantedKey;

    /* THE CHESTS ARE LOOKED AT, NOT VISITED.

       Pressing the Nexus or Ragnarok tile opens the same screen the visit
       opens - the god's picture, the mythology, the two options - with the
       options disabled, because nobody is at the chest.

       It is drawn by the same code that draws the shared stage, so the pop-up
       and the visit can never drift apart. The old version had its own
       drawing, built when the press happened and living until it was closed:
       that is a screen that waits for its own event, and it is why a press
       could seem to do nothing until the page was reloaded.

       A chest that is OPEN is not looked at: the visit is on the screen and
       it is the same screen, so there is nothing to open. */
    if (cell.id === NEXUS.id || cell.id === RAGNAROK.id || cell.id === KRONOS_CHEST.id) {
      if (game.chest) return;
      drawChestPeek(frame,
        cell.id === NEXUS.id ? "nexus" : cell.id === KRONOS_CHEST.id ? "kronos" : "ragnarok",
        { onClose: () => closeRead() },
      );
      paintPhase();
      return;
    }

    if (cell.type === "property") {
      // The card's turn can be interrupted, and then the promise it returns is
      // refused rather than settled - so the middle is put right either way.
      const showing = showCard(frame, id, context());
      paintPhase();
      showing.finally(() => paintPhase());
      return;
    }

    // A corner opens its own information panel; an undecided chest keeps the
    // plain read-only card. Neither changes the turn or any game state.
    const holder = frame.querySelector(".board__card");
    if (!holder) {
      closeRead();
      return;
    }
    /* The holder is put right before the card is drawn, so that no card is ever
       drawn inside a box the last one left transparent. See `resetHolder`. */
    resetHolder(holder);
    if (cell.type === "corner") {
      holder.replaceChildren(cornerCard(cell, { onClose: () => closeRead() }));
      holder.dataset.cardKind = "corner";
    } else {
      holder.replaceChildren(squareCard(cell, { onClose: () => closeRead() }));
      holder.dataset.cardKind = "property";
    }
    holder.hidden = false;
    holder.dataset.property = cell.id;
    holder.scrollTop = 0;
    frame.dataset.property = cell.id;
    paintPhase();
  }

  function closeRead() {
    reading = false;
    cardMode = "read";
    cardKey = null;
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
      if (busy) return;
      const id = cell.dataset.id;
      /* THE ARMED STRIKE IS ASKED OF THE TILE ITSELF.

          While a weapon is armed, a tap on the board is not a request to
          read a card - it is the strike, or it is nothing. A blinking tile
          is in reach and takes the strike at once, with no second
          question; anything else gets a very small shake and keeps the
          strike armed. */
      const fight = game.fight;
      if (fight && fight.phase === "armed" && isMyTurn()) {
        if (cell.classList.contains("is-fight-blink")) {
          void run({ type: "fightAttack", targetId: id });
        } else {
          void shake(cell);
        }
        return;
      }
      /* THE SHIELD IS ASSIGNED AT THE TILE, THE WAY A STRIKE IS ARMED.

          While DEPLOY has put the chest into targeting, a tap on the board
          is not a request to read a card - it is the assignment, or it is
          nothing. A blinking colony is compatible and takes the shield at
          once; everything else gets the same very small shake, and no card
          opens underneath the targeting. */
      const chest = game.chest;
      if (chest && chest.kind === "kronos" && chest.phase === "targeting" && isMyTurn()) {
        const compatible = chest.result?.compatible || [];
        if (compatible.includes(id)) {
          void run({ type: "deployShield", colonyId: id });
        } else {
          void shake(cell);
        }
        return;
      }
      /* The chest tiles answer at any time - the pop-up is read-only and
         covers nothing that is being decided. Everything else waits for the
         board to be at rest. */
      const isChestTile = id === NEXUS.id || id === RAGNAROK.id;
      if (!isChestTile) {
        if (isDecision()) return;
        if (game.phase !== PHASE.AWAITING_ROLL) return;
      }
      // The same tile is already open: ignore the click entirely. The card
      // must not close and reopen under the player's finger.
      if (reading && cardKey === `${game.turn}:${id}:read`) return;
      openRead(id);
    });
  }

  // A tap outside the card closes a read-only one. A tap on a cell button is
  // left to the cell's own click handler, which ignores repeated taps on the
  // already-open tile and swaps cleanly to a different one.
  frame.addEventListener("pointerdown", (event) => {
    if (profileSeat !== null) return;
    if (!reading) return;
    if (event.target.closest?.("button[data-id]")) return;
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

  /* Escape closes whatever is open, wherever the focus happens to be.

     The record is opened from a chip, and a chip sits outside the board: a key
     press on a chip never reaches a listener on the board itself, so for the
     player who opened the record that way, Escape would do nothing at all.
     The listener is therefore on the document, and it takes itself off again
     as soon as the board it belongs to is gone. */
  const onEscape = (event) => {
    if (event.key !== "Escape") return;
    if (!frame.isConnected) {
      document.removeEventListener("keydown", onEscape, true);
      return;
    }
    if (profileSeat !== null) {
      closeProfile();
      return;
    }
    if (!reading) return;
    closeRead();
  };
  document.addEventListener("keydown", onEscape, true);

  /* ---------------------------------------------------------- the coins */

  const pieces = coins(frame, { players, pieces: game.pieces });
  frame.coins = pieces;

  /* ------------------------------------------------------------ first paint */

  paint({ animate: false });
  if (game.phase === PHASE.DECISION) openDecision();
  /* A board that loads while a chest is open shows that chest. This is what
     makes a late join and a reconnect work: the chest is in the state, and
     the state is what the board is built from. */
  else if (game.chest) openChestStage();
  /* and the Fight is the same kind of fact: whatever stage it is in, it is
     on the screen without a refresh. */
  else if (game.fight) openFightStage();
  /* and Epoch too: the threshold is a fact in the state, so a board that
     loads mid-visit draws the same card without a refresh. */
  else if (game.epoch) openEpochStage();
  /* and the Outer Space counter is the same kind of fact - a board loading
     in the middle of the suit visit draws the same screen. */
  else if (game.space) openSpaceStage();

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
