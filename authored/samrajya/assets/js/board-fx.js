/* ==========================================================================
   SAMRAJYA - WHAT AN ACTION LOOKS LIKE

   The animations, and nothing else. Each function is handed an event's numbers
   by board.js, plays one calm piece of motion, and resolves when it is done. No
   function here reads the game, and none of them decides whether something
   happened - that is the whole point of animating from events rather than from
   a diff.

   THE RULE
   --------
   Nothing in here may hold the game up. A movement is 300-700ms and the state
   has already moved on before it starts; the animation is the screen catching
   up, not the rule waiting. Input is guarded by the board's own `busy` flag only
   for the duration of the piece, never for a second longer.

   REDUCED MOTION
   --------------
   Every function has a still path: the same information, written at once or
   faded quietly, with no travel. `prefers-reduced-motion` is a request, and a
   request that is honoured only by the big animations is not honoured.
   ========================================================================== */

import { el } from "./dom.js";
import { prefersStill } from "./dice.js";
import { seatId } from "./coins.js";
import { rupees } from "./shared/economy.js";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Where a node sits inside the board, in the board's own coordinates. */
function localTo(board, node) {
  if (!board || !node) return null;
  const box = board.getBoundingClientRect();
  const rect = node.getBoundingClientRect();
  return {
    left: rect.left - box.left + rect.width / 2,
    top: rect.top - box.top + rect.height / 2,
    box,
  };
}

/** The chip for a seat, or null. */
function chipFor(root, board, seat) {
  const id = seatId(seat);
  return (
    root.querySelector(`.who[data-seat="${seat}"]`) ||
    (board && board.querySelector(`.coin[data-player="${id}"]`))
  );
}

/**
 * A figure lifting off a player's chip: "-₹100" on a purchase, "+₹100" on a
 * sale. It rises, fades, and is gone; it never sits over the board.
 */
export async function lift(root, board, seat, text, { tone = "spend" } = {}) {
  const chip = chipFor(root, board, seat);
  if (!chip) return;
  const at = localTo(board, chip);
  if (!at) return;

  const node = el("span", {
    class: `board__lift board__lift--${tone}`,
    text,
    "aria-hidden": "true",
  });
  node.style.left = `${at.left}px`;
  node.style.top = `${at.top}px`;
  board.append(node);

  if (prefersStill()) {
    node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: "forwards" });
    await wait(280);
    node.remove();
    return;
  }

  await node
    .animate(
      [
        { transform: "translate(-50%, -50%) scale(.9)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.15 },
        { transform: "translate(-50%, -160%) scale(1)", opacity: 0 },
      ],
      { duration: 620, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" },
    )
    .finished.catch(() => {});
  node.remove();
}

/**
 * Rupee tokens moving from one node to another, on one quiet arc.
 *
 * One coin leads, two fainter echoes follow it, and a thin ring opens where it
 * lands. The old version sent seven or eight identical discs along the same
 * line and read as a spray rather than a payment; a payment is one amount, so
 * the animation is one gesture. `amount` only tints the weight of the lead -
 * the number itself is said by the announcement, never by a label on a coin.
 */
export async function flyCoins(board, { from, to, amount = 0 } = {}) {
  if (!board || !from || !to) return;

  const start = localTo(board, from);
  const end = localTo(board, to);
  if (!start || !end) return;

  if (prefersStill()) {
    await wait(200);
    return;
  }

  const dx = end.left - start.left;
  const dy = end.top - start.top;
  // A soft lift at the midpoint, never a loop: the coin travels, it does not
  // perform. The bend grows with the distance but stays inside a tile.
  const bend = Math.max(14, Math.min(38, Math.hypot(dx, dy) * 0.16));

  const tokens = [1, 0.72, 0.5].map((scale, n) => {
    const token = el("span", {
      class: `board__rupee${n ? " board__rupee--echo" : ""}`,
      "aria-hidden": "true",
      text: "\u20b9",
    });
    token.style.left = `${start.left}px`;
    token.style.top = `${start.top}px`;
    token.style.setProperty("--echo", String(scale));
    board.append(token);
    return token;
  });

  const travel = tokens.map((token, n) =>
    token
      .animate(
        [
          { transform: "translate(-50%, -50%) scale(.72)", opacity: 0, offset: 0 },
          { transform: "translate(-50%, -50%) scale(1)", opacity: n ? 0.35 : 1, offset: 0.12 },
          {
            transform:
              `translate(calc(-50% + ${dx * 0.5}px), ` +
              `calc(-50% + ${dy * 0.5 - bend}px)) scale(${n ? 0.86 : 1})`,
            opacity: n ? 0.3 : 1,
            offset: 0.55,
          },
          {
            transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.78)`,
            opacity: 0,
          },
        ],
        {
          duration: 560,
          delay: n * 55,
          easing: "cubic-bezier(.3,.7,.4,1)",
          fill: "forwards",
        },
      )
      .finished.catch(() => {}),
  );

  // The landing: one thin ring, opening once. It says "here" without adding a
  // number or another object to read.
  const ring = el("span", { class: "board__coin-land", "aria-hidden": "true" });
  ring.style.left = `${end.left}px`;
  ring.style.top = `${end.top}px`;
  board.append(ring);
  const pulse = ring
    .animate(
      [
        { transform: "translate(-50%, -50%) scale(.55)", opacity: 0.55 },
        { transform: "translate(-50%, -50%) scale(1.5)", opacity: 0 },
      ],
      { duration: 420, delay: 210, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" },
    )
    .finished.catch(() => {});

  await Promise.all([...travel, pulse]);
  for (const token of tokens) token.remove();
  ring.remove();
}

/**
 * Rupee tokens flying from the payer's chip to the holder's, with the two
 * deltas beside them. Both balances count afterwards; that is the board's job,
 * because the figures belong to the ledger.
 */
export async function flyRent(root, board, { from, to, amount }) {
  const payer = chipFor(root, board, from);
  const holder = chipFor(root, board, to);
  if (!payer || !holder) return;
  await flyCoins(board, { from: payer, to: holder, amount });
}

/** The owner's ring drawing itself around a square, clockwise. */
export async function ringDraw(cell) {
  if (!cell) return;
  cell.classList.add("is-just-bought");
  await wait(prefersStill() ? 280 : 620);
  cell.classList.remove("is-just-bought");
}

/** The pip that just filled, pulsing softly. */
export async function pipPulse(cell) {
  if (!cell) return;
  cell.classList.add("is-just-built");
  await wait(prefersStill() ? 220 : 460);
  cell.classList.remove("is-just-built");
}

/** A small "Passed" near the coin that said it. */
export async function passedLabel(root, board, seat) {
  // The coin, not the chip. "Passed" is about the piece that stayed on the
  // square, and the header is a long way from where the player is looking.
  const id = seatId(seat);
  const chip =
    board?.querySelector(`.coin[data-player="${id}"]`) || chipFor(root, board, seat);
  const at = localTo(board, chip);
  if (!at) return;
  const node = el("span", { class: "board__passed", text: "Passed", "aria-hidden": "true" });
  node.style.left = `${at.left}px`;
  node.style.top = `${at.top}px`;
  board.append(node);
  await node
    .animate(
      [
        { transform: "translate(-50%, -50%)", opacity: 0 },
        { transform: "translate(-50%, -70%)", opacity: 1, offset: 0.25 },
        { transform: "translate(-50%, -110%)", opacity: 0 },
      ],
      { duration: prefersStill() ? 240 : 620, easing: "ease-out", fill: "forwards" },
    )
    .finished.catch(() => {});
  node.remove();
}

/** A gentle shake for a pill that was refused. */
export async function shake(node) {
  if (!node) return;
  if (prefersStill()) return;
  await node
    .animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-3px)" },
        { transform: "translateX(3px)" },
        { transform: "translateX(-2px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 260, easing: "ease-in-out" },
    )
    .finished.catch(() => {});
}

/** Slide a card away. Resolves after the card has gone. */
export async function cardAway(holder) {
  if (!holder || holder.hidden) return;
  if (prefersStill()) {
    holder.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: "forwards" });
    await wait(210);
    return;
  }
  await holder
    .animate(
      [
        { transform: "translateY(0) scale(1)", opacity: 1 },
        { transform: "translateY(14px) scale(.985)", opacity: 0 },
      ],
      { duration: 240, easing: "ease-in", fill: "forwards" },
    )
    .finished.catch(() => {});
}
