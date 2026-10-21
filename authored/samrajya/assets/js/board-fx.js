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
 * Rupee tokens flying from one node to another, along a gentle arc.
 *
 * Six to eight discs, staggered, over a little under a second. `amount` only
 * chooses how many - the number itself is said by the announcement, not by a
 * label on a coin.
 */
export async function flyCoins(board, { from, to, amount = 0 } = {}) {
  if (!board || !from || !to) return;

  const start = localTo(board, from);
  const end = localTo(board, to);
  if (!start || !end) return;

  const count = Math.max(6, Math.min(8, Math.round((Number(amount) || 0) / 80)));

  if (prefersStill()) {
    await wait(220);
    return;
  }

  const tokens = [];
  for (let n = 0; n < count; n += 1) {
    const token = el("span", { class: "board__rupee", "aria-hidden": "true", text: "\u20b9" });
    token.style.left = `${start.left}px`;
    token.style.top = `${start.top}px`;
    board.append(token);
    tokens.push(token);
  }

  const dx = end.left - start.left;
  const dy = end.top - start.top;
  // The arc lifts sideways as well as up, alternating a little, so seven coins
  // do not run along one line like a queue.
  const bend = Math.max(18, Math.min(52, Math.abs(dx) * 0.18 + Math.abs(dy) * 0.12));

  await Promise.all(
    tokens.map((token, n) =>
      token
        .animate(
          [
            { transform: "translate(-50%, -50%) scale(.7)", opacity: 0, offset: 0 },
            { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.1 },
            {
              transform:
                `translate(calc(-50% + ${dx * 0.55}px), ` +
                `calc(-50% + ${dy * 0.55 - bend}px)) scale(1)`,
              opacity: 1,
              offset: 0.55,
            },
            {
              transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.7)`,
              opacity: 0,
            },
          ],
          {
            duration: 660,
            delay: n * 34,
            easing: "cubic-bezier(.3,.7,.4,1)",
            fill: "forwards",
          },
        )
        .finished.catch(() => {}),
    ),
  );
  for (const token of tokens) token.remove();
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

/** The turn banner: a quiet sweep across the middle of the board. */
export async function banner(board, text, { mine = false } = {}) {
  const node = el("p", {
    class: `board__banner${mine ? " board__banner--mine" : ""}`,
    text,
    role: "status",
  });
  board.append(node);
  if (prefersStill()) {
    node.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], {
      duration: 640,
      fill: "forwards",
    });
    await wait(660);
    node.remove();
    return;
  }
  await node
    .animate(
      [
        { transform: "translate(-50%, 8px)", opacity: 0, clipPath: "inset(0 100% 0 0)" },
        { transform: "translate(-50%, 0)", opacity: 1, clipPath: "inset(0 0 0 0)", offset: 0.35 },
        { transform: "translate(-50%, 0)", opacity: 1, offset: 0.72 },
        { transform: "translate(-50%, -6px)", opacity: 0 },
      ],
      { duration: 700, easing: "cubic-bezier(.22,.7,.3,1)", fill: "forwards" },
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
