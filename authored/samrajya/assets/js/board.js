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
import { renderWeapons, showChest } from "./chest-card.js";
import { showNexus } from "./nexus-card.js";
import { squareCard } from "./square-card.js";
import { RAGNAROK, BAD_LUCK } from "./shared/weapons.js";
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
import { ENABLE_SELL, PHASE, restoreGame } from "./shared/game.js";
import { coinColor } from "./shared/civilizations.js";
import { CELLS, CORNER_IDS, SETS } from "./shared/spaces.js";
import {
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
      game.phase === PHASE.AWAITING_ROLL && !reading && !busy && isMyTurn();
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
       not happened yet. */
    if (owner) {
      announce.status(null);
    } else if (!busy) {
      const status = statusFor(game, { viewer: mySeat });
      announce.status(status ? { ...status, color: seatColour(status.seat) } : null);
    }

    frame.dataset.die = dieVisible(game, {
      seat: mySeat,
      throwing: frame.dataset.throwing === "true",
      card: cardUp,
      announcement: announce.covering(),
      profile: profileSeat !== null,
    })
      ? "shown"
      : "hidden";
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
      shake(target);
      await announce.show({
        label: "NOT NOW",
        big: "That cannot happen",
        sub: no.why,
        tone: "refused",
      });
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
        } else if (cardIsStale()) {
          // The decision that card was standing in for has been answered, so
          // the card goes the same way the answering player's own card goes.
          // The next player starts with a clear middle and a die they can see.
          await dismissCard();
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
        case "weaponCollected":
          // The chest card reveals and flies the weapon itself; the chip is
          // repainted from the game's pieces at the end of the step.
          break;

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
  }

  /** Open the card the decision belongs to. */
  async function openDecision() {
    const landing = game.landing;
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

    if (landing.kind === "chest") {
      cardMode = mine ? "decision" : "read";
      reading = false;

      /* THE CHEST CARD DOES NOT HOLD THE BOARD'S LOCK.

         The card asks a question - draw, or pray - and the player answers it
         in their own time. Waiting for that answer INSIDE the turn's own lock
         meant the whole board was locked while the card was up: the die would
         not roll, no square could be read, and a card whose buttons could not
         be reached was a game that looked frozen.

         So the card is opened and the turn's lock is released. The card's own
         close hands the turn on. */
      const closed = () => {
        closeRead();
        void afterChest();
      };

      if (landing.id === NEXUS.id) {
        const showing = mine
          ? showNexus(frame, {
              drawable: true,
              chip: chip(game.active),
              pray: async () => {
                const result = await step({ type: "pray" });
                return result?.events?.find((event) => event.type === "prayed") || null;
              },
              draw: async () => {
                const result = await step({ type: "drawNexus" });
                return result?.events?.find((event) => event.type === "nexusDrawn") || null;
              },
              onClose: closed,
            })
          : showNexus(frame, { drawable: false, onClose: closed });
        // The card is in the holder already; the die and status step aside now,
        // before the player is asked, rather than after their answer.
        paintPhase();
        showing.catch(() => {});
        return;
      }

      const showing = mine
        ? showChest(frame, {
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
            // The chest closes itself when the visit is over, and the board has
            // to be told, so the die comes back to the middle.
            onClose: closed,
            onWeapon: () => paint({ animate: false }),
          })
        : showChest(frame, { drawable: false, onClose: closed });
      // The card is in the middle now, so the die gives way to it.
      paintPhase();
      showing.catch(() => {});
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
    if (!isMyTurn()) return;
    if (game.phase === PHASE.DECISION && game.landing?.kind === "chest") {
      await run({ type: "continue" });
      return;
    }
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
    if (game.phase !== PHASE.AWAITING_ROLL) return;
    if (busy) return;
    if (isDecision()) return;

    const wantedKey = `${game.turn}:${id}:read`;
    // Already reading the requested tile: swallow the tap so the card stays
    // put and does not flash closed and open again.
    if (reading && cardKey === wantedKey) return;

    // A different tile is already open: close it cleanly first, then open the
    // new one in the same call so the middle is never empty between them.
    if (reading && cardKey !== wantedKey) closeRead();

    const cell = CELLS.find((entry) => entry.id === id);
    if (!cell) return;

    reading = true;
    cardMode = "read";
    cardKey = wantedKey;

    if (cell.id === NEXUS.id) {
      showNexus(frame, { drawable: false, onClose: () => closeRead() });
      paintPhase();
      return;
    }
    if (cell.id === RAGNAROK.id) {
      showChest(frame, { drawable: false, onClose: () => closeRead() });
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

    // A corner, or a chest whose purpose has not been decided: the plain card.
    const holder = frame.querySelector(".board__card");
    if (!holder) {
      closeRead();
      return;
    }
    holder.replaceChildren(squareCard(cell, { onClose: () => closeRead() }));
    holder.hidden = false;
    holder.dataset.property = cell.id;
    holder.dataset.cardKind = "property";
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
      if (busy || isDecision()) return;
      if (game.phase !== PHASE.AWAITING_ROLL) return;
      const id = cell.dataset.id;
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
