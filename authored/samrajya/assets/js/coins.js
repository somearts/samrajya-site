/* ==========================================================================
   SAMRAJYA - THE COINS

   One coin per player, and the arithmetic that moves it.

   WHY THIS FILE IS MOSTLY PURE
   ---------------------------
   The rules worth getting right here are two: where a coin lands, and how two
   coins stand on one square. Neither needs a browser, so neither is written
   where a browser would be needed to test it. `advance`, `pathFrom` and `slotAt`
   are the whole rule and take their arguments as arguments. The DOM arrives
   afterwards, only to draw the answer.

   THE ARITHMETIC
   --------------
   A cell's index is its place in the order a game travels, 0 to 27, and it is
   the same number the board already carries on every cell. A move ADDS the
   roll and wraps at 28, so 27 + 1 is 0 - a coin laps the board rather than
   walking off the end of it.

   Wrapping is where this kind of arithmetic usually goes wrong, and it goes
   wrong quietly: `from + steps` with a negative or an oversized `steps` lands
   outside the array and the coin vanishes rather than wraps. So the modulus is
   written to normalise negatives as well, and the tests drive the four cases
   that pin it down - 0+1, 0+6, 25+6, 27+1.

   SLOTS, SO TWO COINS DO NOT SIT ON TOP OF EACH OTHER
   --------------------------------------------------
   Two coins on one square would overlap at a glance and neither could be picked
   out, which is worse than not having coins. So every square's coins are laid
   out on slots: one centred, two side by side, three in a triangle, four in a
   2x2. The offsets are fractions of the cell, so the arrangement is the same
   shape at every cell size and needs nothing recalculated when the board
   resizes.

   The offsets are chosen so that no two coin centres ever come closer than
   COIN_DIAMETER, which is what makes them not overlap rather than approximately
   not overlap. It is asserted in test/coins.test.js against every pair in every
   layout rather than left to the eye.

   WHAT THIS FILE DOES NOT KNOW
   ---------------------------
   Buying, rent, what a chest holds, what a fight does. A coin knows which
   square it is on and nothing about what that square is worth, because the
   moment it knew the price of a square it would be a game rather than a piece
   moving across a board.
   ========================================================================== */

import { el } from "./dom.js";
import { coinColor } from "./shared/civilizations.js";
import { isPurchasable } from "./shared/properties.js";
import { showCard } from "./property-card.js";
import { prefersStill } from "./dice.js";

/** How many squares the board has. The wrap is at this number and no other. */
export const BOARD_SIZE = 28;

/** A coin's diameter, as a fraction of one cell. */
export const COIN_DIAMETER = 0.36;

/** One hop, and the ceiling on a whole move however many hops that is. */
export const STEP_MS = 160;
export const MOVE_BUDGET_MS = 1200;

/** How long the final slide into a shared square takes. */
const SETTLE_MS = 260;

/** How far a coin rises at the top of a hop, as a fraction of a cell. */
const LIFT = 0.06;

/**
 * The name a coin knows its player by.
 *
 * A seat, because that is the only identity the roster carries - see the note
 * on `state` below. Exported so that whatever asks "whose coin is this" builds
 * the same name rather than inventing a second one.
 */
export function seatId(seat) {
  return `seat-${Math.max(0, Math.trunc(Number(seat) || 0))}`;
}

/* ------------------------------------------------------------------- rules */

/**
 * Where a coin standing on `from` ends up after `steps`.
 *
 * The one function the whole movement rests on. `total` is a parameter rather
 * than the constant so the rule can be stated against a board of any size, but
 * every caller passes BOARD_SIZE.
 */
export function advance(from, steps, total = BOARD_SIZE) {
  if (!(total > 0)) return 0;
  const start = Number(from) || 0;
  const move = Math.trunc(Number(steps) || 0);
  // Two roundings, because one of them alone does not fix a negative: -1 % 28 is
  // -1 in JavaScript, and a coin on -1 is not on the board at all.
  return ((((start + move) % total) + total) % total);
}

/**
 * Every index a move touches, starting where the coin already is.
 *
 * The first entry is where it is NOW, so a caller can walk this and use every
 * entry: index 0 is the coin's current square, and the last is where it lands.
 * A six takes seven entries; a zero takes one, and nothing happens.
 */
export function pathFrom(from, steps, total = BOARD_SIZE) {
  const start = advance(from, 0, total);
  const hops = Math.max(0, Math.trunc(Number(steps) || 0));
  const path = [start];
  for (let n = 1; n <= hops; n++) path.push(advance(start + n, 0, total));
  return path;
}

/**
 * Where the nth of `count` coins stands on a shared square, as a fraction of the
 * cell's half-width from the cell's centre.
 *
 * One is centred. Two are side by side. Three are a triangle - one above, two
 * below - because that is the shape that fits three discs in a square with room
 * left. Four are a 2x2.
 *
 * Past four the four-square layout is reused. The game is built for two and
 * designed for four, and there is no fifth player to lay out for; returning the
 * four offsets means a fifth coin would land on the first rather than on top of
 * it, which is the best that can honestly be done rather than a silent guess.
 */
export function slotAt(count, n) {
  const howMany = Math.max(1, Math.trunc(Number(count) || 1));
  const which = Math.max(0, Math.trunc(Number(n) || 0));

  const layouts = {
    1: [[0, 0]],
    2: [[-0.2, 0], [0.2, 0]],
    3: [[0, -0.22], [-0.21, 0.18], [0.21, 0.18]],
    4: [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]],
  };

  const layout = layouts[Math.min(howMany, 4)];
  return layout[Math.min(which, layout.length - 1)];
}

/**
 * The smallest gap any layout puts between two coins, as a fraction of a cell.
 *
 * This is what makes the slots an arrangement rather than an approximation: if
 * the number it returns is below COIN_DIAMETER, two of those coins overlap. It
 * is exported so the test can ask the question of every layout at once instead
 * of trusting that four pairs of numbers were eyeballed.
 */
export function slotSpread(count) {
  const table = {
    2: [[-0.2, 0], [0.2, 0]],
    3: [[0, -0.22], [-0.21, 0.18], [0.21, 0.18]],
    4: [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]],
  };
  if (count <= 1) return Infinity;

  const pts = table[Math.min(Math.max(Math.trunc(count), 2), 4)];
  let closest = Infinity;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d < closest) closest = d;
    }
  }
  return closest;
}

/* ---------------------------------------------------------------- the coin */

/** One coin. The colour is set here from the civilisation, nowhere else. */
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

/* --------------------------------------------------------------- the layer */

/**
 * The coin layer, and everything that moves a coin.
 *
 * One absolutely positioned overlay over the grid, with pointer-events off so a
 * tap still lands on the cell underneath rather than on a coin sitting on it.
 *
 * The positions come from the cells' own rectangles rather than from arithmetic
 * about the grid, so a coin is on the square that square is drawn on whatever
 * the cell size is. That is also why this is recomputed on resize and on
 * rotation: the numbers that put a coin at the centre of a 40px cell are wrong
 * the moment that cell is 52px.
 */
export function coins(board, { players = [] } = {}) {
  /* One source of truth for where everybody is. `position` is a board index,
     and nothing else in this file keeps a copy of it - the DOM is redrawn from
     this, never the other way round, so a coin and its state cannot disagree.

     A player is identified here by their SEAT, and not by the id the server
     holds. That is not a shortcut - the roster the browser is given carries
     `name`, `civ`, `joined` and `role` and deliberately no `id`, because `id` is
     the identity token and the whole point of it is that the other end of the
     socket is not handed it back. So the seat is the only name a coin can have
     here, and it is the same seat the turn pill already counts on. */
  const state = {
    players: (players || [])
      .filter((p) => p && p.name)
      .map((p, i) => ({
        id: seatId(i),
        name: p.name,
        color: coinColor(p.civ),
        position: 0,
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

  /** Every coin's target place, as left/top/width in board pixels. */
  function targets() {
    const box = board.getBoundingClientRect();
    const out = new Map();

    // Who is on each square, so a square can be told how many of them to fit.
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

      // The coin's own order in this square's queue decides which slot it takes.
      // Sorting by id rather than by arrival keeps the layout stable, so two
      // coins on one square do not swap places when a third one is added.
      const here = [...(occupancy.get(player.position) || [])].sort();
      const [dx, dy] = slotAt(here.length, here.indexOf(player.id));

      const left = rect.left - box.left + (rect.width - size) / 2 + dx * rect.width;
      const top = rect.top - box.top + (rect.height - size) / 2 + dy * rect.height;

      out.set(player.id, { left, top, size });
    }
    return out;
  }

  /**
   * Put every coin where it belongs.
   *
   * The glide between squares is a CSS transition on left and top, and the
   * stylesheet reads its duration from `--glide` on the layer. That is how the
   * slide into a slot happens without a second animation running: when a square
   * becomes shared, the only thing that changed is where these two numbers
   * point, and a transition is the right tool for two numbers changing.
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

  /** Redraw from scratch. Used on mount, and whenever the board is resized. */
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
    if (landed) landed.removeAttribute("data-landed");
    const cell = cells.get(index);
    if (!cell || !player) {
      landed = null;
      return null;
    }
    cell.dataset.landed = player.id;
    cell.style.setProperty("--land", player.color || "var(--ink)");
    landed = cell;
    return cell;
  }

  /** Take the mark off whatever has it. Called at the start of a move. */
  function clearHighlight() {
    if (landed) landed.removeAttribute("data-landed");
    landed = null;
  }

  /* ------------------------------------------------------------ the move */

  let run = null;

  /**
   * Move a player. The one function the board's own dice calls and the one a
   * server will call when there is a server that knows who rolled what.
   *
   * Resolves when the coin has landed and the square has been dealt with. A move
   * asked for while one is in the air is refused rather than queued: the die is
   * disabled for the duration, and a caller that got this far anyway is a bug
   * worth hearing about rather than a move to stack.
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
    const perStep = hops > 0 ? Math.min(STEP_MS, MOVE_BUDGET_MS / hops) : 0;
    const still = prefersStill();

    // Intermediate squares are stepped through, not dealt with. A coin hopping
    // from Start to Pluto passes over five squares and buys nothing on any of
    // them; only where it stops is a place it has arrived.
    try {
      for (let n = 1; n <= hops && !mine.cancelled; n++) {
        player.position = path[n];
        // The glide is as long as the hop that goes with it, so the coin is
        // arriving at the next square's centre at the moment it lands from the
        // hop above rather than trailing behind it.
        layout(perStep);

        if (!still && perStep > 0) {
          await hop(node, perStep);
        } else {
          await frame();
        }
      }

      if (mine.cancelled) return null;

      player.position = to;
      // The last layout is where a shared square gets re-fitted, so it is given
      // its own slightly longer glide: this is the slide the coin makes into
      // its slot, and it should look deliberate rather than incidental.
      layout(still ? 0 : SETTLE_MS);
      highlight(to, player);

      // Only a square somebody can act on opens its card. A corner and a chest
      // get the mark and nothing else - there is no card to show, and inventing
      // one here would be the first step towards inventing the whole game.
      const cell = cells.get(to);
      if (cell && isPurchasable(cell.dataset.id)) {
        await showCard(board, cell.dataset.id);
      }

      return { id: player.id, from, to, steps: hops };
    } finally {
      run = null;
      delete board.dataset.moving;
      if (mine.cancelled) layout(SETTLE_MS);
      // The glide is left set for a moment so the last slide finishes before
      // the duration reverts to none and would jump to the same place.
      setTimeout(() => layer.style.setProperty("--glide", "0ms"), SETTLE_MS + 60);
    }
  }

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

  /** Give the browser one frame to paint, which is what "arrive" means here. */
  function frame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  /* ------------------------------------------------------------- resizing */

  // The rectangles are read, never assumed, so anything that changes the size of
  // a cell has to be listened for. ResizeObserver covers a window drag and most
  // of a rotation; the two window events are here because a rotation does not
  // always resize the observer's box in time.
  const relayout = () => layout(false);
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
    /** Re-read the cells' rectangles. Called by the board on a rotation. */
    relayout: () => layout(0),
  };
}