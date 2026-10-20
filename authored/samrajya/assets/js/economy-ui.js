/* ==========================================================================
   SAMRAJYA - THE ECONOMY ON SCREEN

   Four small jobs, none of which knows a rule:

     the purse beside each name, kept live and counted,
     the mark on a square that somebody holds,
     the line of confirmation after a rent is paid,
     and the level pips that say how far a square is built.

   All four read the ledger and write the DOM. The rules are in shared/ledger.js
   and the numbers in shared/economy.js, so there is nothing in this file to get
   wrong except the writing itself - which is exactly why it is allowed to know
   nothing else.

   THE OWNER'S MARK
   ----------------
   A thin ring in the holder's own coin colour, and nothing else. The rule that
   matters is the one it must not break: the square still has to be readable.
   So it is 2px at 40% opacity, drawn as an overlay rather than as a border on
   the cell, because a real border would move the cell's own content inwards and
   every name would shift when a square changed hands. An overlay draws on top
   of the tile and displaces nothing.

   Built levels get three pips in the TOP RIGHT corner, in the same colour. They
   moved there from the bottom edge when the coins did: the lower strip belongs
   to the coins now, and a pip under a coin reads as part of it. The corner is
   the one part of a tile neither the name nor the coin uses.
   ========================================================================== */

import { el } from "./dom.js";
import { coinColor } from "./shared/civilizations.js";
import { MAX_UPGRADE, moneyOf, ownerOf, levelOf, nameOfSeat } from "./shared/ledger.js";
import { rupees } from "./shared/economy.js";

/** How long a confirmation stays up before it takes itself away. */
const TOAST_MS = 2600;

/** How long the balance takes to count to its new figure. */
export const COUNT_MS = 500;

/** Reduce the work for a reader who has asked for less motion. */
function still() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The purse for a seat, as it is written on the board.
 *
 * Indian grouping, so a player reads two thousand rather than counting digits.
 */
export function purseOf(ledger, seat) {
  return rupees(moneyOf(ledger, seat));
}

/** The figure without its sign, for the span that carries the sign separately. */
export function figureOf(amount) {
  return rupees(amount).slice(1);
}

/**
 * Count a figure to its new value.
 *
 * The rupee sign is a sibling span, so it does not flicker while the number
 * counts. `dataset.value` is the honest value - the text is a performance of it
 * over half a second, and a check that reads the state rather than the frame can
 * use it.
 */
function countTo(node, target, animate) {
  const from = Number(node.dataset.value ?? target);
  node.dataset.value = String(target);
  const write = (value) => {
    node.textContent = figureOf(value);
  };

  if (!animate || still() || from === target || typeof requestAnimationFrame !== "function") {
    write(target);
    return;
  }

  const started = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - started) / COUNT_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    write(Math.round(from + (target - from) * eased));
    if (t < 1) requestAnimationFrame(tick);
    else write(target);
  };
  requestAnimationFrame(tick);
}

/**
 * Repaint every purse on the page from the ledger.
 *
 * `animate: false` is for the first paint: a board arriving should show the
 * money it starts with, not count up to it from a number nobody saw.
 */
export function syncPurses(root, ledger, { animate = true } = {}) {
  for (const node of root.querySelectorAll(".who[data-seat]")) {
    const seat = Number(node.dataset.seat);
    const money = moneyOf(ledger, seat);
    const figure = node.querySelector(".who__figure");
    if (figure) countTo(figure, money, animate);
    else node.querySelector(".who__money").textContent = purseOf(ledger, seat);
    node.dataset.money = String(money);
    node.querySelector(".who__money")?.setAttribute("aria-label", purseOf(ledger, seat));
  }
}

/** Mark the seat whose turn it is, and only that seat. */
export function syncActive(root, seat) {
  for (const node of root.querySelectorAll(".who[data-seat]")) {
    const on = Number(node.dataset.seat) === Number(seat);
    node.classList.toggle("who--active", on);
    const tag = node.querySelector(".who__turn");
    if (tag) tag.hidden = !on;
  }
}

/**
 * Draw the owner's ring and the build pips on every purchasable square.
 *
 * Walked rather than applied square by square: a square that has just changed
 * hands and a square that has not need exactly the same treatment, and a walk
 * cannot get out of step with itself.
 *
 * The ring colour comes from the holder's civilization, the same token the coin
 * is drawn in. That is deliberate - the mark on the square and the coin moving
 * along the board are the same fact about the same player, and using the same
 * colour is what lets a player read a board at arm's length.
 */
export function markBoard(root, ledger) {
  for (const cell of root.querySelectorAll(".board__cell[data-id]")) {
    const id = cell.dataset.id;
    const owner = ownerOf(ledger, id);
    const level = owner === null ? 0 : levelOf(ledger, id);

    if (owner === null) {
      delete cell.dataset.owner;
      delete cell.dataset.built;
    } else {
      const player = ledger.players.find((p) => p.seat === owner);
      cell.dataset.owner = String(owner);
      cell.dataset.built = String(level);
      cell.style.setProperty("--owner", coinColor(player?.civ) || "var(--ink)");
    }

    // The pips are drawn by the stylesheet from this count. One custom property
    // beats up to three child nodes per square, which is what keeps repainting
    // all twenty cheap enough to do on every purchase.
    cell.style.setProperty("--pips", level);
  }
}

/** The sentence a card says about who holds a square. */
export function statusOf(ledger, id, seat) {
  const owner = ownerOf(ledger, id);
  if (owner === null) return "Unowned";
  if (owner === seat) return "You own this";
  return `Owned by ${nameOfSeat(ledger, owner)}`;
}

/* ------------------------------------------------------------------- toasts */

/**
 * A short confirmation, put where a player can see it without it blocking.
 *
 * Non-blocking by design: the brief asks for a confirmation of a rent payment
 * and nothing more, and a rent that interrupted play the way the chest does
 * would be a rent paid by pressing something.
 *
 * One at a time. A second message replaces the first rather than queueing, so a
 * player who lands twice in quick succession reads the latest fact and not a
 * backlog of the ones before it.
 */
export function toast(root, message, { tone = "plain" } = {}) {
  const host = root.querySelector(".board__toasts") || mountToasts(root);

  const node = el("p", {
    class: `board__toast board__toast--${tone}`,
    text: message,
    role: "status",
  });
  host.replaceChildren(node);

  // Restart the animation rather than skipping it when a message lands within
  // the previous one's lifetime, or the second message arrives invisible.
  node.animate(
    [
      { transform: "translateY(6px)", opacity: 0 },
      { transform: "translateY(0)", opacity: 1 },
    ],
    { duration: 180, easing: "ease-out" },
  );

  clearTimeout(node._timer);
  node._timer = setTimeout(() => {
    node
      .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: "ease-in" })
      .finished.then(() => node.remove())
      .catch(() => node.remove());
  }, TOAST_MS);

  return node;
}

function mountToasts(root) {
  const host = el("div", { class: "board__toasts", "aria-live": "polite" });
  (root.querySelector(".board") || root).append(host);
  return host;
}

/* --------------------------------------------------------------- the pips */

/** How many pips a built square wears, for a check to count. */
export function pipsFor(ledger, id) {
  const owner = ownerOf(ledger, id);
  return owner === null ? 0 : Math.max(0, Math.min(MAX_UPGRADE, levelOf(ledger, id)));
}

/** The sentence a rent payment gets, in the room's own voice. */
export function rentMessage(ledger, { from, to, rent }) {
  if (!rent) return "";
  const payer = nameOfSeat(ledger, from) || "Someone";
  const holder = nameOfSeat(ledger, to) || "Someone";
  return `${payer} paid ${rupees(rent)} rent to ${holder}`;
}

/**
 * The notice a short rent gets. The payer paid everything they hold and the
 * ledger kept the rest as a short; the notice says only that, because nothing
 * else happened.
 */
export function rentShortMessage({ shortfall }) {
  if (!shortfall) return "";
  return `Short ${rupees(shortfall)}`;
}