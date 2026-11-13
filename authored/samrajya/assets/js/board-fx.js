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

/** Where a node sits inside the board, in the board's own coordinates.

    Exported because a caller that must measure BEFORE a repaint replaces the
    card the node lives in hands the answer to `coinFountain` as a point. */
export function localTo(board, node) {
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
 * MEASURE AN ORIGIN.
 *
 * An element is measured where it is right now; a POINT - `{ left, top }` in
 * the board's own coordinates, read before a repaint swapped the card face
 * the element lived in - is taken as it is. Both answers are the same shape,
 * so everything downstream only ever sees a position.
 */
function measureIn(board, origin) {
  if (!board || !origin) return null;
  if (typeof origin.getBoundingClientRect === "function") {
    const at = localTo(board, origin);
    const box = origin.getBoundingClientRect();
    if (!at || box.width === 0 || box.height === 0) return null;
    return at;
  }
  if (Number.isFinite(origin.left) && Number.isFinite(origin.top)) {
    return { left: origin.left, top: origin.top, box: board.getBoundingClientRect() };
  }
  return null;
}

/**
 * THE SOUL OF THE PROPERTY, TAKEN TO ITS NEW KEEPER.
 *
 * On a purchase the square itself lifts off the tile. What travels is a
 * CLONE of the square the board just drew - its name, its pill, its price,
 * the wash of its set, the ring of its new owner - so what crosses the board
 * is recognisably the property that changed hands and not a particle. It
 * rises, crosses in one slow deliberate arc of two seconds, and dissolves
 * into the buyer's name chip, which answers with a single ring of light in
 * the buyer's own coin colour: the essence of the square joining the player.
 *
 * Both ends are measured from the live DOM - the tile that was bought and
 * whichever seat's chip bought it - so it is the same journey for Player 1
 * and Player 2 and at every screen size. Nothing here is a coordinate anybody
 * typed.
 *
 * REDUCED MOTION: the soul fades where it stands, over the tile it belongs
 * to, and there is no travel. The information - this property, this buyer -
 * is unchanged.
 */
export async function soulTransfer(board, { from, to } = {}) {
  if (!board || !from) return;
  const start = localTo(board, from);
  if (!start) return;
  const box = from.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return;

  const face = from.cloneNode(true);
  /* The ghost is a picture, never a control: the marks that made the square
     a live thing are stripped, and nothing inside it can be pressed. */
  face.classList.remove(
    "is-loan-target",
    "is-loan-picked",
    "is-fight-blink",
    "is-just-bought",
    "is-just-built",
    "is-just-landed",
  );
  face.classList.add("board__soul-face");
  const kept = ["--wash", "--wash-strength", "--owner", "--pips", "--accent"];
  const keptValues = kept.map((prop) => [prop, from.style.getPropertyValue(prop)]);
  face.removeAttribute("style");
  for (const [prop, value] of keptValues) {
    if (value) face.style.setProperty(prop, value);
  }
  face.removeAttribute("data-id");
  face.removeAttribute("data-base-label");
  face.removeAttribute("data-landed");
  for (const inner of face.querySelectorAll("[id]")) inner.removeAttribute("id");
  for (const button of face.querySelectorAll("button")) {
    button.disabled = true;
    button.tabIndex = -1;
  }
  face.style.width = `${box.width}px`;
  face.style.height = `${box.height}px`;

  /* The glow is the BUYER's own coin colour, read off the chip itself, so the
     soul is seen joining the right player without a name being written on it. */
  const soul = to && typeof to.style?.getPropertyValue === "function"
    ? to.style.getPropertyValue("--coin").trim()
    : "";

  const ghost = el("div", {
    class: "board__soul",
    "aria-hidden": "true",
    style: {
      left: `${start.left}px`,
      top: `${start.top}px`,
      ...(soul ? { "--soul": soul } : {}),
    },
  }, [face]);
  board.append(ghost);

  const end = to ? localTo(board, to) : null;
  const quiet = prefersStill();

  if (!end || quiet) {
    /* No chip to travel to, or a reader who asked for still: the soul says
       the same thing - this square is that player's now - where it stands. */
    const fade = ghost.animate(
      [
        { transform: "translate(-50%, -50%)", opacity: 0 },
        { transform: "translate(-50%, -50%)", opacity: 0.9, offset: 0.4 },
        { transform: "translate(-50%, -50%)", opacity: 0 },
      ],
      { duration: 760, easing: "ease-in-out", fill: "forwards" },
    );
    await settled(fade.finished, 940);
    ghost.remove();
    return;
  }

  const dx = end.left - start.left;
  const dy = end.top - start.top;
  const dist = Math.hypot(dx, dy);
  const arc = Math.max(16, Math.min(56, dist * 0.14));
  const tilt = dist > 48 ? 5 : 0;
  const duration = 2000;

  const flight = ghost
    .animate(
      [
        { transform: "translate(-50%, -50%) scale(.94) rotate(0deg)", opacity: 0, offset: 0 },
        {
          transform: "translate(-50%, calc(-50% - 10px)) scale(1.05) rotate(0deg)",
          opacity: 0.95,
          offset: 0.08,
        },
        {
          transform:
            `translate(calc(-50% + ${dx * 0.5}px), calc(-50% + ${dy * 0.5 - arc}px)) ` +
            `scale(.8) rotate(${tilt}deg)`,
          opacity: 0.9,
          offset: 0.52,
        },
        {
          transform:
            `translate(calc(-50% + ${dx * 0.9}px), calc(-50% + ${dy * 0.9 - 4}px)) ` +
            `scale(.34) rotate(0deg)`,
          opacity: 0.6,
          offset: 0.9,
        },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.14) rotate(0deg)`,
          opacity: 0,
          offset: 1,
        },
      ],
      { duration, easing: "cubic-bezier(.42, .2, .32, 1)", fill: "forwards" },
    )
    .finished.catch(() => {});

  /* The chip answering: one soft ring in the buyer's own colour, opening
     once where the soul went in. It says "yours" and adds no figure. */
  const ring = el("span", { class: "board__coin-land", "aria-hidden": "true" });
  ring.style.left = `${end.left}px`;
  ring.style.top = `${end.top}px`;
  if (soul) ring.style.borderColor = soul;
  board.append(ring);
  const pulse = ring
    .animate(
      [
        { transform: "translate(-50%, -50%) scale(.4)", opacity: 0 },
        { transform: "translate(-50%, -50%) scale(1.3)", opacity: 0.75, offset: 0.35 },
        { transform: "translate(-50%, -50%) scale(1.7)", opacity: 0 },
      ],
      {
        duration: 520,
        delay: duration - 440,
        easing: "cubic-bezier(.2, .7, .3, 1)",
        /* "both", or the ring waits out its 1.5s delay as a plain circle
           parked on the player's chip. */
        fill: "both",
      },
    )
    .finished.catch(() => {});

  await settled(Promise.all([flight, pulse]), duration + 560);
  ghost.remove();
  ring.remove();
}

/**
 * A FOUNTAIN OF GOLD, OUT OF THE SQUARE ITSELF.
 *
 * Rent paid, or a suit bought: the place the money came from throws a burst
 * golden coins straight up out of its own centre. Every coin leaves on its
 * own parabola - its own angle, its own reach, its own spin - scatters wide,
 * takes one small bounce where it lands, and fades as it falls away. Two
 * seconds from first coin to last, and then every coin has taken itself
 * down.
 *
 * The ORIGIN is measured from the live element wherever it sits: a board
 * tile for rent, the suit's own card at the counter for a purchase. A point
 * already measured in the board's coordinates is accepted too, for the card
 * whose face a repaint is about to replace. Nothing is a fixed screen
 * position, and it plays only for a transaction that actually happened.
 *
 * `celebrate` widens the cone and adds coins for the suit purchase, so that
 * burst reads as more than the rent's.
 *
 * REDUCED MOTION: one soft gold glow where the money came from, and gone.
 */
export async function coinFountain(board, origin, { celebrate = false } = {}) {
  const at = measureIn(board, origin);
  if (!at) return;

  const quiet = prefersStill();
  if (quiet) {
    const flash = el("span", {
      class: "board__coin-gold board__coin-gold--flash",
      "aria-hidden": "true",
      style: { left: `${at.left}px`, top: `${at.top}px` },
    });
    board.append(flash);
    await settled(
      flash
        .animate([{ opacity: 0 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], {
          duration: 700,
          easing: "ease-out",
          fill: "forwards",
        })
        .finished,
      780,
    );
    flash.remove();
    return;
  }

  const count = celebrate ? 20 : 14;
  const reach = Math.max(30, Math.min(at.box.width * 0.14, 96));
  const duration = celebrate ? 1650 : 1500;
  const flights = [];

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    /* An upward cone, widest for the celebration. Every coin still leaves
       heavenward; the spread is what makes it a fountain rather than a jet. */
    const spread = celebrate ? 2.5 : 2.1;
    const angle = -Math.PI / 2 + (t - 0.5) * spread + (Math.random() - 0.5) * 0.24;
    const power = reach * (0.62 + Math.random() * 0.56);
    const vx = Math.cos(angle) * power;
    const peak = Math.sin(angle) * power; // negative: above the tile
    const ground = reach * (0.22 + Math.random() * 0.3);
    const hop = ground - reach * 0.18;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * 240);
    const sizeClass = ["board__coin-gold--small", "", "board__coin-gold--big"][i % 3];

    const coin = el("span", {
      class: `board__coin-gold ${sizeClass}`.trim(),
      "aria-hidden": "true",
      text: "\u20b9",
      style: { left: `${at.left}px`, top: `${at.top}px` },
    });
    board.append(coin);

    const at0 = (x, y, rot, scale, opacity) => ({
      transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`,
      opacity,
    });

    const delay = t * (celebrate ? 260 : 200) + Math.random() * 70;
    const live = duration + Math.random() * 240;
    /* `fill: "both"` matters here: the coins are created at the origin with a
       delay of up to a third of a second, and "forwards" alone would paint
       every waiting coin stacked on the tile before the first one launches. */
    const animation = coin.animate(
      [
        at0(0, 0, 0, 0.5, 0),
        { ...at0(vx * 0.16, peak * 0.3, spin * 0.15, 1, 1), offset: 0.1, easing: "ease-out" },
        { ...at0(vx * 0.55, peak, spin * 0.5, 1, 1), offset: 0.45, easing: "ease-in" },
        { ...at0(vx * 0.92, ground, spin * 0.85, 0.96, 0.95), offset: 0.78, easing: "ease-out" },
        { ...at0(vx, hop, spin, 0.94, 0.8), offset: 0.87, easing: "ease-in" },
        at0(vx * 1.06, ground + reach * 0.5, spin * 1.2, 0.86, 0),
      ],
      { duration: live, delay, fill: "both" },
    );

    flights.push(
      settled(animation.finished, delay + live + 160).then(() => coin.remove()),
    );
  }

  await Promise.all(flights);
}

/**
 * THE PLEDGE: the pledged colonies drawn into the keeper.
 *
 * Each selected colony's own square - its name, its pill, its price, exactly
 * as the board drew it - lifts off the tile, holds for a beat, and travels in a
 * shallow arc into the god's picture in the middle, shrinking as it is taken.
 * One after another, so the eye can follow each one, and never anywhere but
 * between the tile that was pledged and the keeper who accepted it.
 *
 * The ghost is a CLONE of the square, so what travels is recognisably the
 * property the player pledged. The coin layer is not inside the cell, so the
 * player's own piece stays where it is.
 *
 * REDUCED MOTION: the same cards fade where they stand, one after the other,
 * and there is no travel. The information - these properties, this god - is
 * unchanged.
 */
export async function pledgeSouls(board, cells, target) {
  if (!board || !target || !cells || cells.length === 0) return;
  const end = localTo(board, target);
  if (!end) return;

  const quiet = prefersStill();
  const flights = [];

  cells.forEach((cell, index) => {
    if (!cell) return;
    const start = localTo(board, cell);
    if (!start) return;
    const box = cell.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    const face = cell.cloneNode(true);
    /* The ghost is a picture, never a control: the marks that made the square
       a target are stripped, and nothing inside it can be pressed. */
    face.classList.remove("is-loan-target", "is-fight-blink", "is-just-bought", "is-just-built");
    face.classList.add("board__pledge-face");
    const kept = ["--wash", "--wash-strength", "--owner", "--pips", "--accent"];
    const keptValues = kept.map((prop) => [prop, cell.style.getPropertyValue(prop)]);
    face.removeAttribute("style");
    for (const [prop, value] of keptValues) {
      if (value) face.style.setProperty(prop, value);
    }
    face.removeAttribute("data-id");
    face.removeAttribute("data-base-label");
    for (const inner of face.querySelectorAll("[id]")) inner.removeAttribute("id");
    for (const button of face.querySelectorAll("button")) {
      button.disabled = true;
      button.tabIndex = -1;
    }
    face.style.width = `${box.width}px`;
    face.style.height = `${box.height}px`;

    const ghost = el("div", {
      class: "board__pledge",
      "aria-hidden": "true",
      style: { left: `${start.left}px`, top: `${start.top}px` },
    }, [face]);
    board.append(ghost);

    const dx = end.left - start.left;
    const dy = end.top - start.top;
    const lift = Math.max(8, Math.min(22, Math.hypot(dx, dy) * 0.08));
    const tilt = index % 2 ? 1.2 : -1.2;
    const delay = quiet ? index * 110 : index * 150;
    const duration = quiet ? 460 : 620;

    const frames = quiet
      ? [
          { transform: "translate(-50%, -50%)", opacity: 0 },
          { transform: "translate(-50%, -50%)", opacity: 0.85, offset: 0.35 },
          { transform: "translate(-50%, -50%)", opacity: 0 },
        ]
      : [
          { transform: "translate(-50%, -50%) scale(1) rotate(0deg)", opacity: 0, offset: 0 },
          {
            transform: `translate(-50%, calc(-50% - ${lift}px)) scale(1.03) rotate(${tilt}deg)`,
            opacity: 1,
            offset: 0.16,
          },
          {
            transform:
              `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.55}px - ${lift}px)) ` +
              `scale(.82) rotate(${tilt * 2}deg)`,
            opacity: 0.92,
            offset: 0.66,
          },
          {
            transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.22) rotate(0deg)`,
            opacity: 0,
          },
        ];

    const animation = ghost.animate(frames, {
      duration,
      delay,
      easing: "cubic-bezier(.34,.62,.36,1)",
      fill: "forwards",
    });
    flights.push(
      settled(animation.finished, duration + delay + 220).then(() => ghost.remove()),
    );
  });

  await Promise.all(flights);
}

/**
 * THE RELEASE: the pledged colonies given back to the board.
 *
 * The exact reverse of `pledgeSouls`. Each colony's square lifts out of the
 * keeper's picture and travels the same shallow arc back to the tile it was
 * pledged from, growing from a point into the square as it lands. One after
 * another, so the eye follows each property home, and never anywhere but
 * between the keeper who held it and the tile it belongs to.
 *
 * The ghost is a CLONE of the square, so what lands is recognisably the
 * property the gods held. The tile underneath is already the player's again;
 * the ghost is the saying of it, and it is removed the moment it settles.
 *
 * REDUCED MOTION: the same cards fade where they are, one after the other, and
 * there is no travel. The information - these properties, released - is
 * unchanged.
 */
export async function releaseSouls(board, cells, origin) {
  if (!board || !origin || !cells || cells.length === 0) return;
  const start = localTo(board, origin);
  if (!start) return;

  const quiet = prefersStill();
  const flights = [];

  cells.forEach((cell, index) => {
    if (!cell) return;
    const end = localTo(board, cell);
    if (!end) return;
    const box = cell.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;

    const face = cell.cloneNode(true);
    /* The ghost is a picture, never a control: the marks that made the square
       a target are stripped, and nothing inside it can be pressed. */
    face.classList.remove("is-loan-target", "is-loan-picked", "is-fight-blink", "is-just-bought", "is-just-built");
    face.classList.add("board__pledge-face");
    const kept = ["--wash", "--wash-strength", "--owner", "--pips", "--accent"];
    const keptValues = kept.map((prop) => [prop, cell.style.getPropertyValue(prop)]);
    face.removeAttribute("style");
    for (const [prop, value] of keptValues) {
      if (value) face.style.setProperty(prop, value);
    }
    face.removeAttribute("data-id");
    face.removeAttribute("data-base-label");
    for (const inner of face.querySelectorAll("[id]")) inner.removeAttribute("id");
    for (const button of face.querySelectorAll("button")) {
      button.disabled = true;
      button.tabIndex = -1;
    }
    face.style.width = `${box.width}px`;
    face.style.height = `${box.height}px`;

    const ghost = el("div", {
      class: "board__pledge",
      "aria-hidden": "true",
      style: { left: `${start.left}px`, top: `${start.top}px` },
    }, [face]);
    board.append(ghost);

    const dx = end.left - start.left;
    const dy = end.top - start.top;
    const lift = Math.max(8, Math.min(22, Math.hypot(dx, dy) * 0.08));
    const tilt = index % 2 ? 1.2 : -1.2;
    const delay = quiet ? index * 110 : index * 150;
    const duration = quiet ? 460 : 620;

    const frames = quiet
      ? [
          { transform: "translate(-50%, -50%)", opacity: 0 },
          { transform: "translate(-50%, -50%)", opacity: 0.85, offset: 0.35 },
          { transform: "translate(-50%, -50%)", opacity: 0 },
        ]
      : [
          {
            /* The ghost starts as a point in the keeper's hands. */
            transform: `translate(-50%, -50%) scale(.22) rotate(0deg)`,
            opacity: 0,
            offset: 0,
          },
          {
            /* It grows a little as the god lets it go. */
            transform:
              `translate(calc(-50% + ${dx * 0.34}px), calc(-50% + ${dy * 0.34}px - ${lift}px)) ` +
              `scale(.6) rotate(${tilt}deg)`,
            opacity: 0.92,
            offset: 0.4,
          },
          {
            transform:
              `translate(calc(-50% + ${dx * 0.78}px), calc(-50% + ${dy * 0.78}px - ${lift}px)) ` +
              `scale(1.05) rotate(${tilt * 1.6}deg)`,
            opacity: 1,
            offset: 0.78,
          },
          {
            /* It settles exactly on the tile it belongs to. */
            transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(0deg)`,
            opacity: 1,
          },
        ];

    const animation = ghost.animate(frames, {
      duration,
      delay,
      easing: "cubic-bezier(.34,.62,.36,1)",
      fill: "forwards",
    });
    flights.push(
      settled(animation.finished, duration + delay + 220).then(() => ghost.remove()),
    );
  });

  await Promise.all(flights);
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

/* ========================================================== the breach

   THE STRIKE THAT MEETS A SHIELD.

   Deliberately NOT the war. `fightWar` is the blow landing: the blackout,
   the quake, the tile stained by its weapon, the colony taken. A strike
   that meets a shield is the blow NOT landing - so none of that is here.
   What is here is the shield's own answer: the weapon's streak still
   crosses the board (the war's own streak element, in the weapon's own
   colour), and where it lands the SHIELD speaks - a flare shaped like the
   shield flashes inside the tile, the standing mark cracks bright and
   shatters, a ring of the shield's colour opens over the colony, six
   shards scatter and fade, and the ground gives once, a quarter as hard
   as a quake. The colony itself never moves, never rings and never
   changes: it was protected, not taken.

   Every piece is measured from the live tile, every one is
   `pointer-events: none`, and every one takes itself down after its own
   flight. The mark's shatter is the last thing painted before board.js
   repaints, and the repaint - the shield having left the state - is what
   carries the wreckage away.

   REDUCED MOTION: one flash of the shield's colour where it stood, the
   mark fades, and nothing crosses the board. */
export async function shieldBreak(
  board,
  { fromNode = null, toNode = null, strike = null, shieldTint = null } = {},
) {
  if (!board || !toNode) return;
  const end = localTo(board, toNode);
  if (!end) return;

  const mark = toNode.querySelector?.(".cell-shield") || null;
  const tint = shieldTint || "";
  const quiet = prefersStill();

  /* THE STILL PATH: the shield's colour burns once where it stands, the
     mark fades, and there is no travel, no shard and no jolt. */
  if (quiet) {
    const flash = el("span", {
      class: "board__shield-break",
      "aria-hidden": "true",
      style: tint ? { "--shield": tint } : {},
    });
    toNode.append(flash);
    const flare = flash
      .animate(
        [
          { transform: "translate(-50%, -50%) scale(.7)", opacity: 0 },
          { transform: "translate(-50%, -50%) scale(1.05)", opacity: 0.9, offset: 0.35 },
          { transform: "translate(-50%, -50%) scale(1)", opacity: 0 },
        ],
        { duration: 720, easing: "ease-out", fill: "both" },
      )
      .finished.catch(() => {});
    const fade = mark
      ? mark
          .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 480, fill: "forwards" })
          .finished.catch(() => {})
      : Promise.resolve();
    await settled(Promise.all([flare, fade]), 860);
    flash.remove();
    return;
  }

  const start = fromNode ? localTo(board, fromNode) : null;
  const STREAK_MS = 460;
  const cleanup = [];

  /* THE WEAPON CROSSING: the war's own streak, so the flight there reads
     as the same kind of strike - it is the LANDING that is different. */
  if (start) {
    const dx = end.left - start.left;
    const dy = end.top - start.top;
    const length = Math.hypot(dx, dy);
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const streak = el("span", {
      class: "board__war-streak",
      "aria-hidden": "true",
      style: { "--war": strike || tint },
    });
    streak.style.left = `${start.left}px`;
    streak.style.top = `${start.top}px`;
    streak.style.width = `${length}px`;
    streak.style.transform = `rotate(${angle}deg)`;
    board.append(streak);
    streak
      .animate(
        [
          { transform: `rotate(${angle}deg) scaleX(0)`, opacity: 0.25 },
          { transform: `rotate(${angle}deg) scaleX(1)`, opacity: 1, offset: 0.5 },
          { transform: `rotate(${angle}deg) scaleX(1.03)`, opacity: 0 },
        ],
        { duration: STREAK_MS + 140, easing: "cubic-bezier(.2,.75,.4,1)", fill: "both" },
      )
      .finished.catch(() => {});
    cleanup.push(settled(wait(STREAK_MS + 160), STREAK_MS + 300).then(() => streak.remove()));
    await wait(STREAK_MS);
  }

  /* THE IMPACT - all of it at the moment the streak would land. */

  // The flare, inside the tile: a shield-shaped burst in the shield's own
  // colour, clipped by the cell so it never spills over a neighbour.
  const flare = el("span", {
    class: "board__shield-break",
    "aria-hidden": "true",
    style: tint ? { "--shield": tint } : {},
  });
  toNode.append(flare);
  const flareDone = flare
    .animate(
      [
        { transform: "translate(-50%, -50%) scale(.5)", opacity: 0, offset: 0 },
        { transform: "translate(-50%, -50%) scale(1.12)", opacity: 1, offset: 0.22 },
        { transform: "translate(-50%, -50%) scale(1)", opacity: 0.75, offset: 0.55 },
        { transform: "translate(-50%, -50%) scale(1.06)", opacity: 0, offset: 1 },
      ],
      { duration: 820, easing: "ease-out", fill: "both" },
    )
    .finished.catch(() => {});

  // THE MARK SHATTERS: bright, then broken - gone in pieces while the tile
  // underneath stays exactly as it was. The repaint after this function
  // removes the element for good.
  const shatter = mark
    ? mark
        .animate(
          [
            { transform: "scale(1)", opacity: 1, filter: "brightness(1)", offset: 0 },
            { transform: "scale(1.3)", opacity: 1, filter: "brightness(2.4)", offset: 0.22 },
            {
              transform: "scale(.72) rotate(12deg) translate(2px, 4px)",
              opacity: 0,
              filter: "brightness(3)",
              offset: 0.55,
            },
            { transform: "scale(.6) rotate(18deg)", opacity: 0, filter: "brightness(3)", offset: 1 },
          ],
          { duration: 640, easing: "cubic-bezier(.4,.1,.7,1)", fill: "forwards" },
        )
        .finished.catch(() => {})
    : Promise.resolve();

  // The ring: one wave of the shield's colour opening over the colony.
  const ring = el("span", {
    class: "board__shield-ring",
    "aria-hidden": "true",
    style: tint ? { "--shield": tint } : {},
  });
  ring.style.left = `${end.left}px`;
  ring.style.top = `${end.top}px`;
  board.append(ring);
  const ringDone = ring
    .animate(
      [
        { transform: "translate(-50%, -50%) scale(.35)", opacity: 0.95, offset: 0 },
        { transform: "translate(-50%, -50%) scale(1.1)", opacity: 0.7, offset: 0.35 },
        { transform: "translate(-50%, -50%) scale(1.75)", opacity: 0, offset: 1 },
      ],
      { duration: 900, easing: "cubic-bezier(.2,.7,.3,1)", fill: "both" },
    )
    .finished.catch(() => {});
  cleanup.push(settled(wait(1000), 1140).then(() => ring.remove()));

  // The shards: six pieces of the broken shield thrown out of the tile,
  // each on its own heading, spinning once, fading as they go.
  const reach = Math.max(16, Math.min(end.box.width * 0.42, 44));
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const dist = reach * (0.7 + Math.random() * 0.5);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 140);
    const shard = el("span", {
      class: "board__shield-shard",
      "aria-hidden": "true",
      style: tint ? { "--shield": tint } : {},
    });
    shard.style.left = `${end.left}px`;
    shard.style.top = `${end.top}px`;
    board.append(shard);
    const live = 560 + Math.random() * 260;
    const delay = i * 26;
    const animation = shard.animate(
      [
        {
          transform: "translate(-50%, -50%) translate(0, 0) rotate(0deg) scale(.6)",
          opacity: 0,
          offset: 0,
        },
        {
          transform:
            `translate(-50%, -50%) translate(${dx * 0.3}px, ${dy * 0.3 - 6}px) ` +
            `rotate(${spin * 0.3}deg) scale(1)`,
          opacity: 1,
          offset: 0.18,
        },
        {
          transform:
            `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(.9)`,
          opacity: 0,
          offset: 1,
        },
      ],
      { duration: live, delay, easing: "cubic-bezier(.3,.6,.5,1)", fill: "both" },
    );
    cleanup.push(
      settled(animation.finished, live + delay + 150).then(() => shard.remove()),
    );
  }

  /* THE GROUND GIVES ONCE - a quarter of the war's quake, and it is over
     before the fight card can say what stopped the strike. */
  board.classList.add("is-shield-jolt");
  wait(470)
    .then(() => board.classList.remove("is-shield-jolt"))
    .catch(() => {});

  /* Everything above runs from the impact, so one generous clock behind the
     whole tail - flare, ring, shards, mark - is what ends it even in a tab
     that is not painting. */
  await settled(Promise.all([flareDone, shatter, ringDone, ...cleanup]), 2150);
  flare.remove();
  // Everything else has taken itself down through `cleanup`.
}

/** A node that takes itself away, after its own farewell has had its turn. */
function aggressive(node, ms) {
  if (!node) return;
  wait(ms).then(() => node.remove()).catch(() => {});
}
