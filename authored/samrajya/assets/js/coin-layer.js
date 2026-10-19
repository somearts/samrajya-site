/* ==========================================================================
   SAMRAJYA - THE COIN LAYER

   One coin per player, over the board, and the movement that walks it round.

   The rules - where a coin lands, and how two coins stand on one square - are
   in coins.js, which imports nothing and is tested without a browser. This file
   is the half that needs a document: it draws the coins, measures the squares
   they stand on, animates the hops and decides what landing means.

   THE LAYER
   ---------
   One absolutely positioned overlay over the grid with `pointer-events: none`,
   which is the whole reason a coin is allowed to sit on a square at all: a coin
   that swallowed taps would stop the square underneath being pressable, and the
   squares being pressable is the existing behaviour that this must not change.
   It sits below the card in z-order, so a card opening over the middle of the
   board is never covered by a coin crossing it.

   WHY THE POSITIONS ARE MEASURED
   ------------------------------
   A coin's place is read from the cells' own rectangles rather than computed
   from the grid, so it is on the square that square is drawn on whatever the
   cell size is. That is also why this is re-read on resize and on rotation: the
   numbers that centre a coin in a 40px cell are wrong the moment it is 52px.

   THE SLIDE AND THE HOP ARE DIFFERENT THINGS
   ------------------------------------------
   Sliding into a slot is a CSS transition on left and top - two numbers
   changing, which is exactly what a transition is for, and it means a square
   becoming shared needs no animation of its own.

   The hop is not a transition. It is a lift at the top of an arc, which is a
   transform, and a transform animates over the position underneath it rather
   than instead of it. So the position glides while the coin rises and comes
   back down, and the two do not fight.

   ONLY THE DESTINATION IS DEALT WITH
   ---------------------------------
   A coin hopping from Start to Pluto crosses five squares and does nothing on
   any of them: no highlight, no card, no attention. It is a piece travelling,
   not five places visited. Only where it stops is a place it has arrived, and
   that is the one square that gets the mark and the card.

   WHAT THIS FILE DOES NOT KNOW
   ---------------------------
   Buying, rent, what a chest holds, what a fight does. A coin knows which square
   it is on and nothing about what that square is worth, because the moment it
   knew the price of a square it would be a game rather than a piece moving
   across a board.
   ========================================================================== */

import { el } from "./dom.js";
import { coinColor } from "./shared/civilizations.js";
import { isPurchasable } from "./shared/properties.js";
import { showCard } from "./property-card.js";
import { prefersStill } from "./dice.js";
import {
  COIN_DIAMETER,
  LIFT,
  MOVE_BUDGET_MS,
  SETTLE_MS,
  STEP_MS,
  pathFrom,
  seatId,
  slotAt,
} from "./coins.js";

/** One coin. The colour comes from the civilisation and nowhere else. */
function coinNode(player, index) {
  return el("div", {
    class: "coin",
    "data-player": player.id,
    "data-slot": String(index),
    // A player who has not chosen a civilisation has no colour to be drawn in,
    // and `coinColor` says so rather than guessing one. The coin is still
    // drawn, in the board's own ink, so a player is never invisible.
    style: { "--coin": player.color || "var(--ink)" },
    "aria-hidden": "true",
  });
}

/**
 * The coin layer, and everything that moves a coin.
 *
 * `movePlayer` is the one function the board's own dice calls and the one a
 * server will call when there is a server that knows who rolled what. Nothing
 * else here is meant to be driven from outside.
 */
export function coins(board, { players = [], onLand = null } = {}) {
  /* One source of truth for where everybody is. `position` is a board index,
     and nothing else keeps a copy of it - the DOM is redrawn from this, never
     the other way round, so a coin and its state cannot disagree. */
  const state = {
    players: (players || [])
      .filter((p) => p && p.name)
      .map((p, i) => ({
        id: seatId(i),
        name: p.name,
        color: coinColor(p.civ),
        position: 0,
        // What this player is carrying. Empty to start, appended to by whoever
        // hands them a weapon, and nothing here reads it except the name chip -
        // there is no attacking yet, so a weapon is a thing you are seen with
        // rather than a thing you can do.
        weapons: [],
      })),
  };

  const layer = el("div", { class: "board__coins", "aria-hidden": "true" });
  const nodes = new Map();
  for (const [i, player] of state.players.entries()) {
    const node = coinNode(player, i);
    nodes.set(player.id, node);
    layer.append(node);
  }
  board.append(layer);

  const cells = new Map();
  for (const cell of board.querySelectorAll(".board__cell")) {
    cells.set(Number(cell.dataset.index), cell);
  }

  /** Every coin's target place, in board pixels. */
  function targets() {
    const box = board.getBoundingClientRect();
    const out = new Map();

    // Who is on each square, so a square can be told how many to fit.
    const occupancy = new Map();
    for (const player of state.players) {
      const list = occupancy.get(player.position) || [];
      list.push(player.id);
      occupancy.set(player.position, list);
    }

    for (const player of state.players) {
      const cell = cells.get(player.position);
      const node = nodes.get(player.id);
      if (!cell || !node || !box.width) continue;

      const rect = cell.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height) * COIN_DIAMETER;

      // Sorted by id rather than by arrival, so the arrangement does not
      // reshuffle when a third coin joins a square two coins already share.
      const here = [...(occupancy.get(player.position) || [])].sort();
      const [dx, dy] = slotAt(here.length, here.indexOf(player.id));

      out.set(player.id, {
        left: rect.left - box.left + (rect.width - size) / 2 + dx * rect.width,
        top: rect.top - box.top + (rect.height - size) / 2 + dy * rect.height,
        size,
      });
    }
    return out;
  }

  /**
   * Put every coin where it belongs.
   *
   * The glide is a CSS transition whose duration the stylesheet reads from
   * `--glide` on the layer. That is how a coin slides into a slot without a
   * second animation being needed: when a square becomes shared the only thing
   * that changed is where these two numbers point.
   */
  function place(glideMs = 0) {
    layer.style.setProperty("--glide", `${Math.max(0, glideMs)}ms`);
    for (const [id, at] of targets()) {
      const node = nodes.get(id);
      if (!node) continue;
      node.style.left = `${at.left}px`;
      node.style.top = `${at.top}px`;
      node.style.width = `${at.size}px`;
      node.style.height = `${at.size}px`;
    }
  }

  /** Redraw from scratch, and say in `data-slot` which slot each coin is in. */
  function layout(glideMs = 0) {
    for (const player of state.players) {
      const here = state.players
        .filter((p) => p.position === player.position)
        .sort((a, b) => a.id.localeCompare(b.id));
      nodes.get(player.id).dataset.slot = String(here.indexOf(player));
    }
    place(glideMs);
  }

  layout();

  /* --------------------------------------------------------- the landing */

  let landed = null;

  /** Put the soft mark on one square and take it off every other. */
  function highlight(index, player) {
    clearHighlight();
    const cell = cells.get(index);
    if (!cell || !player) return null;

    cell.dataset.landed = player.id;
    cell.style.setProperty("--land", player.color || "var(--ink)");
    landed = cell;
    return cell;
  }

  /** Take the mark off whatever has it. Called as a move starts. */
  function clearHighlight() {
    if (landed) landed.removeAttribute("data-landed");
    landed = null;
  }

  /* ------------------------------------------------------------ the move */

  let run = null;

  /** One hop: a short lift at the top of the arc, and down again. */
  function hop(node, ms) {
    const animation = node.animate(
      [
        { transform: "translateY(0)", offset: 0 },
        { transform: `translateY(${-LIFT * node.offsetHeight}px)`, offset: 0.5 },
        { transform: "translateY(0)", offset: 1 },
      ],
      { duration: ms, easing: "ease-in-out", fill: "none" },
    );
    return animation.finished.catch(() => {});
  }

  /** Give the browser one frame, which is what "arriving" means here. */
  const frame = () =>
    new Promise((resolve) => requestAnimationFrame(() => resolve()));

  /**
   * Move a player `steps` squares.
   *
   * Resolves when the coin has landed and the square has been dealt with. A move
   * asked for while one is in the air is refused rather than queued: the die is
   * disabled for the duration, and a caller that got this far anyway is a bug
   * worth returning null for rather than a move to stack on top of another.
   */
  async function movePlayer(playerId, steps) {
    if (run) return null;

    const player = state.players.find((p) => p.id === playerId);
    if (!player) return null;

    const path = pathFrom(player.position, steps);
    const hops = path.length - 1;
    const from = player.position;
    const to = path[path.length - 1];

    // The old mark goes before anything moves, so the square being left is not
    // still lit while the coin is on its way off it.
    clearHighlight();

    const mine = { cancelled: false };
    run = mine;
    board.dataset.moving = "true";

    const node = nodes.get(player.id);
    const still = prefersStill();
    // Short hops for a long walk, rather than a long wait: the ceiling is on the
    // whole move, not on the hop.
    const perStep = hops > 0 ? Math.min(STEP_MS, MOVE_BUDGET_MS / hops) : 0;

    try {
      // Intermediate squares are stepped through, not dealt with.
      for (let n = 1; n <= hops && !mine.cancelled; n++) {
        player.position = path[n];
        // The glide is as long as the hop that goes with it, so the coin is
        // arriving at the next square's centre at the moment it lands from the
        // hop above rather than trailing behind it.
        layout(perStep);

        if (still || perStep <= 0) await frame();
        else await hop(node, perStep);
      }

      if (mine.cancelled) return null;

      player.position = to;
      // The last layout is where a shared square gets re-fitted, so it gets its
      // own longer glide: this is the slide the coin makes into its slot, and it
      // should look deliberate rather than incidental.
      layout(still ? 0 : SETTLE_MS);
      highlight(to, player);

      // Only the destination is dealt with. What that MEANS is the board's business
      // rather than this file's: a property shows its card, Ragnarok runs a
      // draw, and a corner or a chest with nothing to say shows nothing. So the
      // landing is handed to `onLand` when there is one, and falls back to the
      // old behaviour when there is not - a card opened by hand for a square
      // that is not for sale closes whatever was open, because a card left on
      // screen from the last move is not this square's card.
      const cell = cells.get(to);
      if (typeof onLand === "function") {
        await onLand({ cell, player, index: to });
      } else {
        await showCard(board, (cell && isPurchasable(cell.dataset.id)) ? cell.dataset.id : "");
      }

      return { id: player.id, from, to, steps: hops };
    } finally {
      run = null;
      delete board.dataset.moving;
      if (mine.cancelled) layout(SETTLE_MS);
      // The glide is left set a moment longer than the last slide, so the slide
      // finishes before the duration reverts to none - which would otherwise put
      // the coin back where it already is, visibly, for no reason.
      setTimeout(() => layer.style.setProperty("--glide", "0ms"), SETTLE_MS + 60);
    }
  }

  /* ------------------------------------------------------------- resizing */

  // The rectangles are read and never assumed, so anything that changes the size
  // of a cell has to be listened for. ResizeObserver covers a window drag and
  // most of a rotation; the two window events are here because a rotation does
  // not always resize the observer's box in time.
  const relayout = () => layout(0);
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(relayout).observe(board);
  }
  if (typeof window !== "undefined") {
    window.addEventListener("resize", relayout);
    window.addEventListener("orientationchange", relayout);
  }

  return {
    node: layer,
    state,
    movePlayer,
    clearHighlight,
    /** Whether a coin is in the air. The die asks before it will throw. */
    isMoving: () => Boolean(run),
    /** Put everyone back on Start. For a new game, not for a move. */
    reset() {
      clearHighlight();
      for (const player of state.players) player.position = 0;
      layout(0);
    },
    /** Re-read the cells' rectangles. */
    relayout,
  };
}