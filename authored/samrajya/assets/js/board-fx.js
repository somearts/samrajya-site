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
import { settled } from "./motion.js";
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

  await settled(
    node
      .animate(
        [
          { transform: "translate(-50%, -50%) scale(.9)", opacity: 0 },
          { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.15 },
          { transform: "translate(-50%, -160%) scale(1)", opacity: 0 },
        ],
        { duration: 620, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" },
      )
      .finished,
    700,
  );
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
    await wait(240);
    return;
  }

  const dx = end.left - start.left;
  const dy = end.top - start.top;
  const dist = Math.hypot(dx, dy);
  // A shallow arc: enough to read as travel, not enough to loop or spray.
  const bend = Math.max(10, Math.min(26, dist * 0.1));
  const leadDuration = 680;

  const makeToken = (scale, echo) => {
    const token = el("span", {
      class: `board__rupee${echo ? " board__rupee--echo" : ""}`,
      "aria-hidden": "true",
      text: "\u20b9",
    });
    token.style.left = `${start.left}px`;
    token.style.top = `${start.top}px`;
    token.style.setProperty("--echo", String(scale));
    board.append(token);
    return token;
  };

  const lead = makeToken(1, false);
  const echo = makeToken(0.62, true);

  const leadFlight = lead
    .animate(
      [
        { transform: "translate(-50%, -50%) scale(.78) rotate(-8deg)", opacity: 0, offset: 0 },
        { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 1, offset: 0.1 },
        {
          transform:
            `translate(calc(-50% + ${dx * 0.5}px), ` +
            `calc(-50% + ${dy * 0.5 - bend}px)) scale(1) rotate(4deg)`,
          opacity: 1,
          offset: 0.5,
        },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.85) rotate(0deg)`,
          opacity: 0,
        },
      ],
      { duration: leadDuration, easing: "cubic-bezier(.3,.7,.4,1)", fill: "forwards" },
    )
    .finished.catch(() => {});

  const echoFlight = echo
    .animate(
      [
        { transform: "translate(-50%, -50%) scale(.72)", opacity: 0, offset: 0 },
        { transform: "translate(-50%, -50%) scale(.92)", opacity: 0.35, offset: 0.18 },
        {
          transform:
            `translate(calc(-50% + ${dx * 0.5}px), ` +
            `calc(-50% + ${dy * 0.5 - bend * 0.7}px)) scale(.86)`,
          opacity: 0.25,
          offset: 0.55,
        },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.78)`,
          opacity: 0,
        },
      ],
      { duration: leadDuration, delay: 80, easing: "cubic-bezier(.35,.72,.42,1)", fill: "forwards" },
    )
    .finished.catch(() => {});

  // The landing: one soft ring, opening once. It says "here" without adding a
  // number or another object to read.
  const ring = el("span", { class: "board__coin-land", "aria-hidden": "true" });
  ring.style.left = `${end.left}px`;
  ring.style.top = `${end.top}px`;
  board.append(ring);
  const pulse = ring
    .animate(
      [
        { transform: "translate(-50%, -50%) scale(.5)", opacity: 0.5 },
        { transform: "translate(-50%, -50%) scale(1.45)", opacity: 0 },
      ],
      { duration: 480, delay: 260, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" },
    )
    .finished.catch(() => {});

  await settled(Promise.all([leadFlight, echoFlight, pulse]), leadDuration + 250);
  lead.remove();
  echo.remove();
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
  await settled(
    node
      .animate(
        [
          { transform: "translate(-50%, -50%)", opacity: 0 },
          { transform: "translate(-50%, -70%)", opacity: 1, offset: 0.25 },
          { transform: "translate(-50%, -110%)", opacity: 0 },
        ],
        { duration: prefersStill() ? 240 : 620, easing: "ease-out", fill: "forwards" },
      )
      .finished,
    700,
  );
  node.remove();
}

/** A gentle shake for a pill that was refused. */
export async function shake(node) {
  if (!node) return;
  if (prefersStill()) return;
  await settled(
    node
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
      .finished,
    340,
  );
}

/**
 * The holder is one element for every card, and an animation that ends with
 * `fill: "forwards"` stays applied to it for good.
 *
 * That is the whole trouble: a card that slides away leaves the holder at
 * `opacity: 0`, and every card that arrives afterwards is drawn inside a
 * transparent box - so it is in the DOM, it has a rectangle, and it paints
 * nothing. The property card hid this by starting an animation of its own
 * (`fill: "both"`, ending at opacity 1), but the chest and the Nexus start no
 * animation at all, so they inherited the invisible holder.
 *
 * A player who answered one property decision and then landed on the Nexus saw
 * an empty middle, a die that would not come back, and a game they could only
 * restart by reloading the page.
 *
 * So the holder is put back the way it was found. `cardAway` cancels its own
 * animation when it is done, and every card that opens clears whatever is left
 * before it draws itself.
 */
export function resetHolder(holder) {
  if (!holder) return;
  if (typeof holder.getAnimations === "function") {
    for (const animation of holder.getAnimations()) {
      try {
        animation.cancel();
      } catch {
        /* An animation that refuses to be cancelled is already gone. */
      }
    }
  }
  // The stylesheet's own values are the truth: no animation, no inline paint.
  holder.style.opacity = "";
  holder.style.transform = "";
}

/** Slide a card away. Resolves after the card has gone. */
export async function cardAway(holder) {
  if (!holder || holder.hidden) return;
  if (prefersStill()) {
    const animation = holder.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 200,
      fill: "forwards",
    });
    await wait(210);
    // The fill is undone, so the next card is not drawn inside a ghost.
    animation.cancel();
    resetHolder(holder);
    return;
  }
  const animation = holder.animate(
    [
      { transform: "translateY(0) scale(1)", opacity: 1 },
      { transform: "translateY(14px) scale(.985)", opacity: 0 },
    ],
    { duration: 240, easing: "ease-in", fill: "forwards" },
  );
  await settled(animation.finished, 320);
  // The card has gone; the holder goes back to being an empty, ordinary box.
  animation.cancel();
  resetHolder(holder);
}

/* ================================================================= the war

   One strike, on both phones at the same moment, and nothing clever.

   Every piece of it is played where the event says it should be and nowhere
   else: the board shakes with a decay under six pixels, the air of the board
   darkens once, a bright streak runs from the striker to the tile, and the
   tile takes the weapon's own flavour. Nothing here reads the game and
   nothing here decides anything - the events carry the numbers, this file
   only says what they look like.

   REDUCED MOTION: one flash of the tile, and no shake. */

const WAR_WEAPONS = {
  antimatter: "antimatter",
  nuclear: "nuclear",
  shiva: "shiva",
};

/** How long the whole war runs, on every device alike. */
const WAR_MS = 2500;

/** The shake with the decay under six pixels: transform only. */
const WAR_QUAKE_MS = 1400;

export async function fightWar(board, { weaponId = "", tint = null, fromNode = null, toNode = null } = {}) {
  if (!board) return;

  const flavour = WAR_WEAPONS[weaponId] || "plain";
  const quiet = prefersStill();

  /* Measured BEFORE the shake is put on, so the streak is not drawn off by
     a board that is already moving under the measurement. */
  const start = fromNode ? localTo(board, fromNode) : null;
  const end = toNode ? localTo(board, toNode) : null;

  /* The tile's flash - or for the Eye of Shiva, the gold eye - lives in the
     cell itself, so it dies with the cell and never lies over another one. */
  const node = toNode;
  const taste = flavour === "shiva"
    ? el("span", { class: "board__war-eye", "aria-hidden": "true", style: { "--war": tint || "" } })
    : el("span", {
        class: `board__war-flash board__war-flash--${flavour}`,
        "aria-hidden": "true",
        style: { "--war": tint || "" },
      });
  node?.append(taste);

  /* A reader who asked for still: the one flash, and nothing else. */
  if (quiet) {
    const flash = taste?.animate(
      [{ opacity: 0 }, { opacity: 0.9, offset: 0.25 }, { opacity: 0 }],
      { duration: 700, easing: "ease-out", fill: "forwards" },
    );
    await settled(flash?.finished ?? Promise.resolve(), 760);
    taste.remove();
    return;
  }

  /* The air darkens once, at the strike, and opens again. */
  const vignette = el("span", { class: "board__war-vignette", "aria-hidden": "true" });
  board.append(vignette);
  const vignetteIn = vignette.animate(
    [
      { opacity: 0 },
      { opacity: 1, offset: 0.18 },
      { opacity: 0.85, offset: 0.4 },
      { opacity: 0 },
    ],
    { duration: WAR_QUAKE_MS, easing: "ease-out", fill: "forwards" },
  );

  /* The ground of the board gives once, and gives less every time. It is a
     one-time class and a one-time animation; nothing else on the board is
     asked to know about it. */
  board.classList.add("is-quake");
  await wait(WAR_QUAKE_MS - 100);
  board.classList.remove("is-quake");

  /* The streak: bright, quick, and smaller than the time it takes to name
     it. It runs from the striker's own chip to the tile. */
  if (start && end) {
    const dx = end.left - start.left;
    const dy = end.top - start.top;
    const length = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const streak = el("span", {
      class: "board__war-streak",
      "aria-hidden": "true",
      style: { "--war": tint || "" },
    });
    streak.style.left = `${start.left}px`;
    streak.style.top = `${start.top}px`;
    streak.style.width = `${length}px`;
    streak.style.transform = `rotate(${angle}deg)`;
    board.append(streak);
    streak
      .animate(
        [
          { transform: `rotate(${angle}deg) scaleX(0)`, opacity: 0.2 },
          { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 1, offset: 0.55 },
          { transform: `rotate(${angle}deg) scaleX(1.04)`, opacity: 0 },
        ],
        { duration: 720, easing: "cubic-bezier(.2,.75,.4,1)", fill: "forwards" },
      )
      .finished.catch(() => {});
    aggressive(streak, 800); // the streak takes itself down after the flight
  }

  /* The tile takes the weapon's flavour at the moment the streak would
     reach it. With the chip unavailable - a board that has no striker's
     chip on it - the strike lands at once instead. */
  const strikeDelay = start && end ? 700 : 0;
  const firstLanding = wait(strikeDelay).then(() => {
    taste
      .animate(
        [{ opacity: 0 }, { opacity: 0.95, offset: 0.3 }, { opacity: 0 }],
        { duration: 900, easing: "ease-out", fill: "forwards" },
      )
      .finished.catch(() => {});
    if (end) {
      const ring = el("span", {
        class: `board__war-ring board__war-ring--${flavour}`,
        "aria-hidden": "true",
        style: { "--war": tint || "" },
      });
      ring.style.left = `${end.left}px`;
      ring.style.top = `${end.top}px`;
      board.append(ring);
      ring
        .animate(
          [
            { transform: "translate(-50%, -50%) scale(.4)", opacity: 0.95 },
            { transform: "translate(-50%, -50%) scale(1.35)", opacity: 0 },
          ],
          { duration: 900, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" },
        )
        .finished.catch(() => {});
      wait(950).then(() => ring.remove());
    }
  });

  /* The war lasts the same time on both devices, whatever the pieces inside
     it did individually. Everything above is fire-and-forget; this wait is
     what keeps the board still for the whole of it. */
  await wait(WAR_MS - WAR_QUAKE_MS + 100);
  await firstLanding.catch(() => {});

  vignetteIn.finished.catch(() => {});
  vignette.remove();
  taste.remove();
}

/** A node that takes itself away, after its own farewell has had its turn. */
function aggressive(node, ms) {
  if (!node) return;
  wait(ms).then(() => node.remove()).catch(() => {});
}
