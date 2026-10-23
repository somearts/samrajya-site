/* ==========================================================================
   SAMRAJYA - RAGNAROK

   The chest card, and the draw.

   THE CARD IS A PROPERTY CARD WITH THREE THINGS CHANGED
   -----------------------------------------------------
   Same shell, same typography, same pill, same turn animation, because it is
   the same object: a thing the board puts in the middle and reads. What says
   "chest" rather than "property" is three details and nothing else - a dark ink
   edge down the left instead of a set colour, the words COMMUNITY CHEST where a
   price would go, and no price. A chest is not for sale and the card should not
   pretend otherwise by quoting a figure.

   It is TALLER, because there is more in it: three card faces, a button, a
   result and a list of targets do not fit in three rows of cells. It runs from
   the top of the middle down about two thirds of it, and scrolls inside itself
   on a short screen. The height is written as a fraction of the middle's own
   height rather than in cells, so it stays the same proportion of the board at
   every size and can never grow into the ring.

   IT CANNOT BE DISMISSED BEFORE THE DRAW IS ANSWERED
   -------------------------------------------------
   A chest card that could be swiped away would be a chest that sometimes gives
   nothing, and a player would learn to close it without looking. So while the
   draw is unresolved the card stays, and tapping the square it came from during
   that time does not replace it.

   Opened by hand rather than by landing, it is read-only: the Draw button is
   there and disabled, so the card still says what the chest is and still says
   what a draw would give, without pretending this visit is a draw. The pill is
   visibly a pill and visibly not available, which is a different thing from
   hiding it.

   THE DRAW
   --------
   Three face-down cards, a shuffle, and an answer. The answer comes from
   drawWeapon() in shared/weapons.js - the same function the tests check against
   a hundred thousand seeded draws, and the one that would move to the server
   without changing. Nothing here decides anything; it only shows what it was
   told.

   A weapon turns one card over and brings it forward, and the other two go. Bad
   luck shakes them, takes them away, and says so, and the card closes itself a
   moment later: there is nothing to collect and nothing to decide, so the
   visitor is let go rather than left looking at an empty card.

   THE DOT
   -------
   Collecting shrinks the card into a dot in the weapon's own colour and flies it
   to the player's name at the top of the board, where it stays. The dot is the
   weapon: there is no hand, no inventory and no count, and a player can see at a
   glance what they are carrying and who is carrying what.

   Six dots, then a count. The chip holds a name, and a name is the thing that
   has to stay readable at 360px - so past six the rest become a number rather
   than the chip growing until the name is the part that gets squeezed.
   ========================================================================== */

import { el } from "./dom.js";
import { RAGNAROK, WEAPONS, drawWeapon, weaponById } from "./shared/weapons.js";
import { SETS } from "./shared/spaces.js";
import { propertyFor } from "./shared/properties.js";

/** How long the three cards shuffle before the answer. */
const SHUFFLE_MS = 1500;
/** How long bad luck is shown before the card lets the player go. */
const BAD_LUCK_MS = 2200;
/** How long the dot takes to reach the name at the top. */
const FLY_MS = 720;
/** How many dots a name chip shows before it counts the rest instead. */
export const DOT_CAP = 6;

/** The colour a weapon is drawn in, from the set the data names. */
export function weaponColor(id) {
  return SETS[weaponById(id)?.set]?.color || "var(--ink)";
}

/* ---------------------------------------------------------------- emblems

   Flat geometric placeholders, drawn in one stroke weight and no fill
   gradients, in the same flat vocabulary as everything else on the board. Real
   art can replace them without anything else changing: each one is a function
   of a colour and nothing else. */

const EMBLEMS = {
  // Two rings and a spark: something arriving at a star and not stopping.
  rings: (c) => `
    <circle cx="16" cy="22" r="13" fill="none" stroke="${c}" stroke-width="1.6"/>
    <circle cx="16" cy="22" r="7.5" fill="none" stroke="${c}" stroke-width="1.6" opacity="0.7"/>
    <circle cx="16" cy="22" r="2.6" fill="${c}"/>
    <path d="M16 22 L27 11 M16 22 L5 11" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,

  // A cone with two fins, nose down.
  cone: (c) => `
    <path d="M16 6 L23 22 L16 30 L9 22 Z" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M9 22 L4 28 M23 22 L28 28" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M13 14 L19 14" stroke="${c}" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>`,

  // An eye, and in it a third eye that is a slit rather than a pupil.
  eye: (c) => `
    <path d="M3 20 C10 10 22 10 29 20 C22 30 10 30 3 20 Z" fill="none" stroke="${c}" stroke-width="1.6"/>
    <circle cx="16" cy="20" r="6" fill="none" stroke="${c}" stroke-width="1.6"/>
    <line x1="16" y1="12" x2="16" y2="28" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
};

/** One weapon's emblem, as an SVG string. */
export function emblem(weapon) {
  const draw = EMBLEMS[weapon?.emblem];
  if (!draw) return "";
  const colour = weaponColor(weapon.id);
  return (
    `<svg viewBox="0 0 32 40" class="chest-card__emblem" xmlns="http://www.w3.org/2000/svg"` +
    ` aria-hidden="true" focusable="false">${draw(colour)}</svg>`
  );
}

/* ------------------------------------------------------------ the pieces */

/** One of the three face-down cards. */
function slot(weapon, index) {
  return el("button", {
    type: "button",
    class: "chest-card__slot",
    "data-weapon": weapon.id,
    "data-slot": String(index),
    style: { "--weapon": weaponColor(weapon.id) },
    "aria-label": "Draw a weapon",
  }, [
    el("span", { class: "chest-card__back", "aria-hidden": "true" }, [
      el("span", { class: "chest-card__mark", text: "?" }),
    ]),
    el("span", { class: "chest-card__face", "aria-hidden": "true", html: emblem(weapon) }),
    el("span", { class: "chest-card__pill", "aria-hidden": "true" }),
    el("span", { class: "chest-card__slot-name", text: weapon.name }),
  ]);
}

/** Rewrite a slot so the face it turns over matches the drawn weapon. */
function fillSlot(slot, id) {
  const weapon = weaponById(id);
  if (!weapon) return;
  slot.dataset.weapon = weapon.id;
  slot.style.setProperty("--weapon", weaponColor(weapon.id));
  const face = slot.querySelector(".chest-card__face");
  if (face) face.innerHTML = emblem(weapon);
  const pill = slot.querySelector(".chest-card__pill");
  if (pill) pill.style.background = weaponColor(weapon.id);
  const name = slot.querySelector(".chest-card__slot-name");
  if (name) name.textContent = weapon.name;
}

/** The property's own label, which is what a player knows the place by. */
function targetName(id) {
  const property = propertyFor(id);
  return property ? property.lines.join(" ") : id;
}

/** A small pill naming one colony a weapon reaches. */
function targetPill(id) {
  return el("span", { class: "chest-card__target", text: targetName(id) });
}

/* ------------------------------------------------------------- the card */

/**
 * The Ragnarok card.
 *
 * `drawable` is the whole of the difference between the two ways this opens:
 * true when a player has just landed here and may draw, false when somebody has
 * tapped Ragnarok to look at it.
 */
export function chestCard({ drawable = false } = {}) {
  const card = el("article", {
    class: "property-card chest-card",
    "data-property": "ragnarok",
    "data-chest": "ragnarok",
    // A chest belongs to no set, so the edge is the board's own ink rather than
    // a set colour that would say it belongs to one.
    style: { "--accent": "var(--ink)" },
    "aria-live": "polite",
  }, [
    drawable
      ? null
      : el("button", {
          type: "button",
          class: "property-card__close",
          "aria-label": "Close",
          title: "Close",
          "data-action": "close",
          text: "\u00d7",
        }),

    el("div", { class: "property-card__head" }, [
      // No sigil here, and no "COMMUNITY CHEST" label where the price would go.
      // The head is one column and the title has it all. The label was removed
      // because the card already says what Ragnarok is in its title, and a
      // second line saying it again was taking the width the title needed -
      // which is how "Welcome to Ragnarok" came out as "WELCO... RAGNAR...".
      el("div", { class: "property-card__title" }, [
        el("span", { class: "property-card__pill", "aria-hidden": "true" }),
        el("h3", { class: "property-card__name", html: RAGNAROK.titleLines.map((line) => `<span>${line}</span>`).join("") }),
      ]),
    ]),

    el("p", { class: "chest-card__tagline", text: RAGNAROK.tagline }),

    el("p", { class: "chest-card__body", text: RAGNAROK.body }),

    el("div", { class: "chest-card__slots" }, WEAPONS.map((w, i) => slot(w, i))),

    drawable
      ? el("button", {
          class: "chest-card__draw",
          type: "button",
          "data-action": "draw",
          text: "Draw",
        })
      : el("button", {
          class: "chest-card__draw",
          type: "button",
          "data-action": "draw",
          text: "Draw",
          disabled: true,
          // Said out loud as well as shown greyed, because a disabled control
          // is invisible to a screen reader otherwise.
          "aria-disabled": "true",
          title: "Draw only when you land here",
        }),

    el("div", { class: "chest-card__result", hidden: true }),
  ]);

  return card;
}

/* --------------------------------------------------------- the name chip */

/**
 * Draw a player's weapons on their name chip.
 *
 * Six dots and then a count. The name is the part of that chip that has to
 * survive at 360px, so it is the one thing here that is never allowed to be
 * squeezed.
 */
export function renderWeapons(root, seatIndex, weapons = []) {
  const chip = root.querySelectorAll(".who")[seatIndex];
  if (!chip) return null;

  let holder = chip.querySelector(".who__weapons");
  if (!holder) {
    holder = el("span", { class: "who__weapons", "aria-hidden": "true" });
    const name = chip.querySelector(".who__name");
    // Before the name, which is where a player looks first.
    chip.insertBefore(holder, name);
  }

  const shown = weapons.slice(0, DOT_CAP);
  const hidden = weapons.length - shown.length;

  // Filtered rather than passed through. `replaceChildren` stringifies anything
  // that is not a Node, so a trailing `null` for "there is no count to show"
  // became a literal "null" in front of the player's name - which is exactly
  // the sort of thing that reads as a name being called something.
  const children = shown.map((id) =>
    el("span", {
      class: "who__weapon",
      "data-weapon": id,
      style: { "--weapon": weaponColor(id) },
    }),
  );
  if (hidden > 0) children.push(el("span", { class: "who__count", text: `+${hidden}` }));

  holder.replaceChildren(...children);
  holder.dataset.count = String(weapons.length);
  return holder;
}

/** Clear a player's dots. Used by a new game. */
export function clearWeapons(root, seatIndex) {
  const holder = root.querySelectorAll(".who")[seatIndex]?.querySelector(".who__weapons");
  if (holder) holder.replaceChildren();
  return holder;
}

/* -------------------------------------------------------------- the flow */

/**
 * Is a chest card on the board waiting for an answer?
 *
 * While this is true the card cannot be replaced by a tap or by a new roll. A
 * chest card that could be swiped away would be a chest that sometimes gives
 * nothing, and a player would learn to close it without looking.
 *
 * Read from the card's own phase rather than kept in a variable here, so there
 * is one place that knows what state a card is in and it is the card.
 */
export function chestPending(board) {
  const card = board.querySelector(".board__card .chest-card");
  if (!card) return false;
  return card.dataset.phase === "drawing" || card.dataset.phase === "revealed";
}

/** Honour a reader who has asked for less motion, the same way the card does. */
function still() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Show Ragnarok, and run the draw to its end.
 *
 * Resolves when the visit is over - after the weapon is collected, or after bad
 * luck has been said and the card has closed itself. `drawable` decides whether
 * a draw is offered at all.
 */
export async function showChest(
  board,
  { drawable = false, draw = null, collect = null, onWeapon = null, onClose = null } = {},
) {
  const holder = board.querySelector(".board__card");
  if (!holder) return null;

  board.dataset.property = "ragnarok";
  holder.replaceChildren(chestCard({ drawable }));
  holder.hidden = false;
  holder.dataset.property = "ragnarok";
  // The chest is taller than a property card, so the holder is told which one it
  // is holding. The stylesheet reads it; nothing else needs to know.
  holder.dataset.cardKind = "chest";

  const card = holder.firstElementChild;
  if (!drawable) {
    // Opened by hand: there is nothing to do here, and saying so with a
    // disabled pill is better than pretending a visit happened.
    const close = card.querySelector('[data-action="close"]');
    if (close) {
      close.addEventListener("click", () => {
        if (typeof onClose === "function") onClose();
        holder.hidden = true;
        holder.replaceChildren();
        holder.dataset.property = "";
        delete holder.dataset.cardKind;
        board.dataset.property = "";
      }, { once: true });
    }
    return { drawn: null, resolved: true };
  }

  const drawButton = card.querySelector('[data-action="draw"]');
  const result = card.querySelector(".chest-card__result");
  const slots = [...card.querySelectorAll(".chest-card__slot")];
  let drawing = false;

  async function doDraw(chosenSlot = slots[1]) {
    if (drawing) return null;
    drawing = true;
    drawButton.disabled = true;
    for (const s of slots) s.disabled = true;
    card.dataset.phase = "drawing";

    /* The shuffle. Three cards shift and settle, slower than before, so the
       draw feels like a deliberate moment rather than a quick transaction. */
    if (still()) {
      await wait(SHUFFLE_MS);
    } else {
      for (const slot of slots) {
        slot.animate(
          [
            { transform: "translateX(0) rotate(0deg)" },
            { transform: "translateX(-4px) rotate(-2deg)" },
            { transform: "translateX(4px) rotate(2deg)" },
            { transform: "translateX(-2px) rotate(-1deg)" },
            { transform: "translateX(0) rotate(0deg)" },
          ],
          { duration: SHUFFLE_MS / 3, iterations: 3, easing: "ease-in-out" },
        );
      }
      await wait(SHUFFLE_MS);
    }

    const outcome =
      typeof draw === "function" ? await draw() : drawWeapon();
    card.dataset.phase = outcome === "bad-luck" ? "bad-luck" : "revealed";
    await reveal(card, slots, outcome, result, { still: still(), chosenSlot });
    return outcome;
  }

  /* THE BUTTON IS LIVE AT ONCE.

     The card turns in over three hundred milliseconds, and the listener used to
     be attached after that turn - so a player who tapped the moment the card
     appeared was tapping a button that was not listening yet, and nothing
     happened at all. The turn is decoration: it must not delay the card being
     playable. */
  const drawnPromise = new Promise((resolve) => {
    drawButton.addEventListener("click", () => {
      doDraw(slots[1]).then(resolve);
    }, { once: true });
    slots.forEach((slot) => {
      slot.addEventListener("click", () => {
        doDraw(slot).then(resolve);
      }, { once: true });
    });
  });

  /* The card's turn-in, now that the button is listening. */
  if (!still()) {
    await holder
      .animate(
        [
          { transform: "rotateY(-88deg)", opacity: 0 },
          { transform: "rotateY(0deg)", opacity: 1 },
        ],
        { duration: 320, easing: "cubic-bezier(.22,.7,.3,1)", fill: "both" },
      )
      .finished.catch(() => {});
  }

  const drawn = await drawnPromise;

  /* Nothing came of it: say so, wait, and let the player go. */
  if (drawn === "bad-luck") {
    if (typeof onClose === "function") await onClose();
    holder.hidden = true;
    holder.replaceChildren();
    holder.dataset.property = "";
    delete holder.dataset.cardKind;
    board.dataset.property = "";
    return { drawn: null, badLuck: true, resolved: true };
  }

  /* Something did: the player collects it, which is what makes it theirs. */
  await new Promise((resolve) => {
    const collectButton = card.querySelector('[data-action="collect"]');
    collectButton.addEventListener("click", async () => {
      collectButton.disabled = true;
      card.dataset.phase = "collecting";
      await flyToName(board, card, drawn, { still: still() });
      if (typeof collect === "function") await collect(drawn);
      if (typeof onWeapon === "function") await onWeapon(drawn);
      resolve(drawn);
    }, { once: true });
  });

  if (typeof onClose === "function") await onClose();
  holder.hidden = true;
  holder.replaceChildren();
  holder.dataset.property = "";
  delete holder.dataset.cardKind;
  board.dataset.property = "";
  return { drawn, resolved: true };
}

/** Show the answer: a weapon turning over, or bad luck going away. */
async function reveal(card, slots, outcome, result, { still: quiet, chosenSlot }) {
  const bad = outcome === "bad-luck";
  const chosen = chosenSlot && slots.includes(chosenSlot) ? chosenSlot : slots.find((s) => s.dataset.weapon === outcome);

  if (!bad && chosen) {
    // The card the player touched turns over to show the weapon they drew,
    // regardless of which weapon was originally assigned to that position.
    fillSlot(chosen, outcome);
  }

  if (quiet) {
    for (const slot of slots) slot.hidden = bad || slot !== chosen;
    if (!bad && chosen) chosen.classList.add("is-drawn");
  } else if (bad) {
    // A light shake and away. Not a punishment - the draw was unlucky, not
    // wrong, and the animation says so by being small.
    for (const slot of slots) {
      slot.animate(
        [
          { transform: "translateX(0)", opacity: 1 },
          { transform: "translateX(-4px)", opacity: 1 },
          { transform: "translateX(4px)", opacity: 1 },
          { transform: "translateX(0)", opacity: 1 },
          { transform: "translateX(-2px)", opacity: 1 },
          { transform: "translateX(0)", opacity: 0 },
        ],
        { duration: BAD_LUCK_MS * 0.7, easing: "ease-in-out", fill: "forwards" },
      );
    }
    await wait(BAD_LUCK_MS * 0.7);
    for (const slot of slots) slot.hidden = true;
  } else {
    for (const slot of slots) {
      if (slot === chosen) continue;
      slot.animate([{ opacity: 1 }, { opacity: 0 }],
        { duration: 360, easing: "ease-in", fill: "forwards" });
    }
    // Turn it over, then bring it forward.
    chosen.classList.add("is-drawn");
    if (!quiet) {
      await chosen
        .animate(
          [
            { transform: "rotateY(0deg) scale(1)" },
            { transform: "rotateY(180deg) scale(1)" },
            { transform: "rotateY(360deg) scale(1.08)" },
          ],
          { duration: 560, easing: "cubic-bezier(.3,.7,.3,1)", fill: "both" },
        )
        .finished.catch(() => {});
    }
    for (const slot of slots) if (slot !== chosen) slot.hidden = true;
    await wait(160);
  }

  result.hidden = false;
  result.replaceChildren(...(bad ? badLuckLines() : weaponLines(outcome)));
  result.animate([{ opacity: 0 }, { opacity: 1 }],
    { duration: quiet ? 1 : 280, easing: "ease-out", fill: "both" });

  if (bad) await wait(BAD_LUCK_MS);
}

function badLuckLines() {
  return [
    el("p", { class: "chest-card__drew", text: RAGNAROK.badLuck }),
  ];
}

function weaponLines(id) {
  const weapon = weaponById(id);
  return [
    el("p", { class: "chest-card__drew", text: `You drew the ${weapon.name}.` }),
    el("p", { class: "chest-card__reach", text: "It can strike:" }),
    el("div", { class: "chest-card__targets" },
      weapon.targets.map((t) => targetPill(t))),
    el("p", { class: "chest-card__blurb", text: weapon.blurb }),
    el("button", {
      class: "chest-card__collect",
      type: "button",
      "data-action": "collect",
      text: "Collect",
      style: { "--weapon": weaponColor(id) },
    }),
  ];
}

/**
 * Shrink the drawn card into a dot and send it to the player's name.
 *
 * A real element is flown rather than a transform on the card, because the card
 * stays put afterwards and a dot has to arrive somewhere else. Under reduced
 * motion the dot is simply placed - it appears rather than travels, which is
 * the same information without the journey.
 */
async function flyToName(board, card, weaponId, { still: quiet }) {
  const drawn = card.querySelector(`[data-weapon="${weaponId}"].is-drawn`);
  if (!drawn || quiet) return;

  const chip = board.querySelectorAll(".who")[0];
  const from = drawn.getBoundingClientRect();
  const to = chip?.querySelector(".who__name")?.getBoundingClientRect();
  if (!to) return;

  const dot = el("span", { class: "chest-card__flying", style: { "--weapon": weaponColor(weaponId) } });
  document.body.append(dot);

  const size = from.width * 0.5;
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  dot.style.left = `${from.left + from.width / 2 - size / 2}px`;
  dot.style.top = `${from.top + from.height / 2 - size / 2}px`;

  await dot
    .animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        {
          transform:
            `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ` +
            `${to.top + to.height / 2 - (from.top + from.height / 2)}px) scale(0.28)`,
          opacity: 0.9,
        },
      ],
      { duration: FLY_MS, easing: "cubic-bezier(.4,.1,.2,1)", fill: "forwards" },
    )
    .finished.catch(() => {});
  dot.remove();
}