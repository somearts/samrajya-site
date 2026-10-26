/* ==========================================================================
   SAMRAJYA - THE SHARED CHEST

   Ragnarok and Nexus are SHARED screens. They are not a thing one player's
   browser invented and then showed to the other: they are a fact about the
   game, and that fact lives in the state as `chest`.

   WHY THIS IS A SEPARATE FILE

   A shared screen has to be a pure function of the state. If the screen were
   built by the player's press and then sent to the other device as an event,
   then a device that missed the event - because it was reconnecting, or it
   had just joined, or the message was dropped - would show a different thing
   from the other device, or nothing at all. The player would have to refresh.

   So: the server decides what the chest is doing, and writes it into the
   state. Every client reads the state and draws the middle from it. The
   acting player presses a button, which is an action; the server moves the
   chest along and the state says what it is now. Both devices draw the same
   thing, and neither of them needed to hear anything.

   THE STAGES

   Ragnarok   open -> drawing -> revealed -> done
   Nexus      open -> praying -> shuffling -> revealed -> done

   The phase names are the server's. The client never decides which one it is
   in: it reads `chest.phase` and draws that.

   THE ANIMATION CLOCK

   `chest.startedAt` is the moment the server moved the chest to its next
   stage. Both devices start their animation from that moment, so the shuffle
   begins at the same second on both phones - and a device that arrives late
   works out how much of the animation is already gone and joins in at the
   right point rather than starting it over.
   ========================================================================== */

import { el } from "./dom.js";
import { settled } from "./motion.js";
import { resetHolder } from "./board-fx.js";
import { prefersStill } from "./dice.js";
import { NEXUS_KEEPER, NEXUS_PRAY_COST } from "./shared/nexus-cards.js";
import { RAGNAROK, WEAPONS, weaponById } from "./shared/weapons.js";
import { rupees } from "./shared/economy.js";

/** How long the deck shuffles for, in milliseconds. */
export const SHUFFLE_MS = 3500;
/** How long the top card takes to lift and turn over. */
export const FLIP_MS = 900;
/** How many card backs are drawn in the stack. Performance, not realism. */
export const STACK_LAYERS = 12;

/** Honour a reader who has asked for less motion, the same way the cards do. */
function still() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/* ------------------------------------------------------------------ the card */

/** The god's picture, the name, and the line that says what the place is. */
function nexusCard({ drawable, phase, caption }) {
  const actions = el("div", { class: "nexus-card__actions" }, [
    el("button", {
      type: "button",
      class: "nexus-card__pray",
      "data-action": "pray",
      disabled: !drawable || phase !== "open",
      "aria-disabled": String(!drawable || phase !== "open"),
      title: drawable ? NEXUS_KEEPER.actions.pray.title : NEXUS_KEEPER.actions.pray.titleIdle,
    }, [
      el("span", { class: "nexus-card__action-name", text: NEXUS_KEEPER.actions.pray.name }),
      el("span", { class: "nexus-card__action-note", text: `Tend the temples • ${rupees(NEXUS_PRAY_COST)}` }),
    ]),
    el("button", {
      type: "button",
      class: "nexus-card__draw",
      "data-action": "draw",
      disabled: !drawable || phase !== "open",
      "aria-disabled": String(!drawable || phase !== "open"),
      title: drawable ? NEXUS_KEEPER.actions.draw.title : NEXUS_KEEPER.actions.draw.titleIdle,
    }, [
      el("span", { class: "nexus-card__action-name", text: NEXUS_KEEPER.actions.draw.name }),
      el("span", { class: "nexus-card__action-note", text: NEXUS_KEEPER.actions.draw.note }),
    ]),
  ]);

  const card = el("article", {
    class: "property-card nexus-card",
    "data-property": "nexus",
    "data-chest": "nexus",
    "data-phase": phase,
    style: { "--accent": "var(--ink)" },
    "aria-live": "polite",
  }, [
    el("div", { class: "nexus-card__figure-wrap" }, [
      el("img", {
        class: "nexus-card__god",
        src: "assets/img/god.png",
        alt: NEXUS_KEEPER.title,
        draggable: "false",
      }),
    ]),
    el("h3", { class: "nexus-card__title", text: NEXUS_KEEPER.title }),
    el("p", { class: "nexus-card__tagline", text: NEXUS_KEEPER.tagline }),
    el("p", { class: "nexus-card__mythology" },
      NEXUS_KEEPER.mythology.map((sentence) => el("span", { text: sentence })),
    ),
    actions,
    el("div", { class: "nexus-card__result", hidden: true }),
  ]);

  if (caption) card.append(caption);
  return card;
}

/** The chest of weapons: three slots and a draw. */
function ragnarokCard({ drawable, phase, caption }) {
  const slots = el("div", { class: "chest-card__slots" }, [
    el("button", {
      type: "button",
      class: "chest-card__slot",
      "data-action": "draw",
      disabled: !drawable || phase !== "open",
      "aria-label": "Draw a weapon",
    }, [
      el("span", { class: "chest-card__slot-back", "aria-hidden": "true" }),
      el("span", { class: "chest-card__slot-name" }, [el("span", { text: "?" })]),
      el("span", { class: "chest-card__pill" }),
    ]),
  ]);

  const card = el("article", {
    class: "property-card chest-card",
    "data-property": "ragnarok",
    "data-chest": "ragnarok",
    "data-phase": phase,
    "aria-live": "polite",
  }, [
    el("div", { class: "chest-card__head" }, [
      el("h3", { class: "chest-card__title", text: "Welcome to Ragnarok" }),
      el("p", { class: "chest-card__tagline", text: RAGNAROK.tagline }),
    ]),
    slots,
    el("div", { class: "chest-card__result", hidden: true }),
  ]);

  if (caption) card.append(caption);
  return card;
}

/* ------------------------------------------------------------- the caption */

/**
 * The quiet line that says who is at the chest.
 *
 * The other player sees exactly the screen the acting player sees, with this
 * one addition: a muted line naming them. It is the only thing that is
 * different between the two screens, and it is there so that the waiting
 * player knows the screen is not waiting for them.
 */
export function chestCaption(name, text) {
  return el("p", { class: "chest-card__caption", "data-role": "caption" }, [
    el("span", { class: "chest-card__caption-name", text: name }),
    el("span", { class: "chest-card__caption-text", text }),
  ]);
}

/* ------------------------------------------------------------- the shuffle */

/**
 * The deck, and the shuffle.
 *
 * Transform only: no layout is read and nothing is measured, so the animation
 * cannot be thrown off by a slow frame or a card that has not been laid out
 * yet. The halves split, riffle back together, and it repeats with a gentle
 * arc and a little rotation.
 */
async function shuffleDeck(card, { duration }) {
  const deck = card.querySelector(".nexus-card__deck");
  if (!deck) return;

  const quiet = still();

  /* HOW LONG THE SHUFFLE HAS LEFT.

     The stage was begun by the server, and the server's clock is not this
     browser's clock - so the two cannot be subtracted. What can be is the
     moment THIS browser first saw the stage, and that is when the shuffle
     began here.

     A device that arrives late therefore sees the whole shuffle, which is
     what a player who walks in halfway through a card game wants: the card
     is turned over in front of them, rather than appearing already turned. */
  const left = duration;

  if (quiet) {
    // A reader who has asked for less motion gets the card, not the shuffle.
    deck.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: "both" });
    await wait(Math.min(left, 220));
    return;
  }

  /* The two halves the deck splits into. They are a sibling of the stack, so
   they are found from the wrapper rather than from the stack itself. */
  const halves = [...(card.querySelectorAll(".nexus-card__deck-half") || [])];

  // The shuffle is two beats of split-and-riffle, repeated, so about three and
  // a half seconds of it. Each beat is a transform on two halves.
  const beat = Math.max(400, Math.floor(left / 3));
  const beats = Math.max(1, Math.min(3, Math.floor(left / beat)));

  for (let b = 0; b < beats; b += 1) {
    const left0 = halves[0];
    const right0 = halves[1];
    if (!left0 || !right0) break;
    await settled(
      Promise.all([
        left0.animate(
          [
            { transform: "translate(0, 0) rotate(0deg)" },
            { transform: "translate(-38%, -6px) rotate(-7deg)", offset: 0.45 },
            { transform: "translate(-22%, -3px) rotate(-4deg)", offset: 0.7 },
            { transform: "translate(0, 0) rotate(0deg)" },
          ],
          { duration: beat, easing: "cubic-bezier(.3,.6,.3,1)", fill: "both" },
        ).finished,
        right0.animate(
          [
            { transform: "translate(0, 0) rotate(0deg)" },
            { transform: "translate(38%, -6px) rotate(7deg)", offset: 0.45 },
            { transform: "translate(22%, -3px) rotate(4deg)", offset: 0.7 },
            { transform: "translate(0, 0) rotate(0deg)" },
          ],
          { duration: beat, easing: "cubic-bezier(.3,.6,.3,1)", fill: "both" },
        ).finished,
      ]),
      beat + 150,
    );
  }
}

/**
 * The top card lifts out of the deck, scales up, and turns to its face.
 */
async function flipTop(card) {
  const top = card.querySelector(".nexus-card__deck-top");
  if (!top) return;
  if (still()) {
    top.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: "both" });
    await wait(200);
    return;
  }
  await settled(
    top.animate(
      [
        { transform: "translate(-50%, 0) scale(1) rotateY(0deg)", opacity: 1 },
        { transform: "translate(-50%, -34px) scale(1.25) rotateY(0deg)", offset: 0.4 },
        { transform: "translate(-50%, -34px) scale(1.25) rotateY(180deg)", offset: 1 },
      ],
      { duration: FLIP_MS, easing: "cubic-bezier(.3,.7,.3,1)", fill: "both" },
    ).finished,
    FLIP_MS + 200,
  );
}

/* ---------------------------------------------------------------- the deck */

/** The stack of card backs, and the top card that will be turned over. */
function buildDeck({ layers = STACK_LAYERS } = {}) {
  const backs = el("div", { class: "nexus-card__deck", "aria-hidden": "true" });
  for (let i = 0; i < layers; i += 1) {
    backs.append(el("span", { class: "nexus-card__deck-back" }));
  }
  const halves = el("div", { class: "nexus-card__deck-halves" }, [
    el("div", { class: "nexus-card__deck-half" }, [
      el("span", { class: "nexus-card__deck-back" }),
    ]),
    el("div", { class: "nexus-card__deck-half" }, [
      el("span", { class: "nexus-card__deck-back" }),
    ]),
  ]);
  const top = el("div", { class: "nexus-card__deck-top" }, [
    el("div", { class: "nexus-card__deck-top-inner" }, [
      el("div", { class: "nexus-card__deck-top-back" }),
      el("div", { class: "nexus-card__deck-top-face" }),
    ]),
  ]);
  return el("div", { class: "nexus-card__deck-wrap" }, [backs, halves, top]);
}

/* -------------------------------------------------------------- the result */

/** The Nexus card's face: its heading, its one line, and the amount. */
function nexusFace(card, { name, text, amount }) {
  const tone = Number(amount) < 0 ? "spend" : "earn";
  const face = card.querySelector(".nexus-card__deck-top-face");
  if (!face) return;
  face.replaceChildren(
    el("p", { class: "nexus-card__face-name", text: name }),
    el("p", { class: "nexus-card__face-text", text }),
    el("p", {
      class: `nexus-card__face-amount nexus-card__face-amount--${tone}`,
      text: `${Number(amount) < 0 ? "−" : "+"}${rupees(Math.abs(Number(amount) || 0))}`,
    }),
  );
  face.dataset.tone = tone;
  face.dataset.amount = String(Number(amount) || 0);
}

/* ------------------------------------------------------------- the stage */

/**
 * The chest, drawn from the state.
 *
 * `chest` is the state's chest, `mine` says whether this screen is the acting
 * player's, and `handlers` are the three things a player can press. Returns
 * the card it drew, and the promise that ends when the stage has played out.
 */
export function drawChestStage(board, chest, { mine = false, handlers = {}, playerName = "" } = {}) {
  const holder = board.querySelector(".board__card");
  if (!holder || !chest) return null;

  resetHolder(holder);
  holder.dataset.cardKind = "chest";
  holder.dataset.property = chest.kind === "nexus" ? "nexus" : "ragnarok";
  board.dataset.property = holder.dataset.property;

  const name = playerName || "Your opponent";
  const card = chest.kind === "nexus"
    ? nexusCard({
        drawable: mine,
        phase: chest.phase,
        caption: mine ? null : chestCaption(name, `is at the Nexus`),
      })
    : ragnarokCard({
        drawable: mine,
        phase: chest.phase,
        caption: mine ? null : chestCaption(name, `is at Ragnarok`),
      });

  holder.replaceChildren(card);
  holder.hidden = false;

  /* The buttons. They are wired to the actions, and the server decides what
     happens. A button that is not the acting player's is not wired at all. */
  if (mine) {
    for (const [selector, handler] of Object.entries(handlers)) {
      const button = card.querySelector(selector);
      if (button && typeof handler === "function") {
        button.addEventListener("click", handler, { once: true });
      }
    }
  }

  return card;
}

/**
 * A chest that is being LOOKED AT rather than visited.
 *
 * This is the pop-up a player gets for pressing the Nexus or Ragnarok tile:
 * the god's picture, the mythology, the two options - all there, all disabled,
 * because nobody is at the chest. It is the same drawing as the shared stage,
 * so the two can never drift apart, and it is drawn the same way: from a
 * record of what the screen is, not from an event that may never arrive.
 */
export function drawChestPeek(board, kind, { onClose = null } = {}) {
  const holder = board.querySelector(".board__card");
  if (!holder) return null;

  resetHolder(holder);
  holder.dataset.cardKind = "chest";
  holder.dataset.property = kind === "nexus" ? "nexus" : "ragnarok";
  board.dataset.property = holder.dataset.property;

  const card = kind === "nexus"
    ? nexusCard({ drawable: false, phase: "peek", caption: null })
    : ragnarokCard({ drawable: false, phase: "peek", caption: null });

  /* A close button, so the pop-up can be dismissed. */
  card.prepend(el("button", {
    type: "button",
    class: "property-card__close",
    "aria-label": "Close",
    title: "Close",
    "data-action": "close",
    text: "\u00d7",
    onclick: () => {
      if (typeof onClose === "function") onClose();
    },
  }));

  holder.replaceChildren(card);
  holder.hidden = false;
  return card;
}

/**
 * The Nexus's shuffle and reveal, played from the state's own clock.
 *
 * The stage is a pure function of `chest`, so this runs whenever the state
 * says the chest has moved to "shuffling". A device that arrives late finds
 * the shuffle already part-way through and joins it where it is.
 */
export async function playNexusStage(board, chest) {
  const holder = board.querySelector(".board__card");
  const card = holder?.querySelector(".nexus-card");
  if (!card || !chest) return null;

  /* The deck is in the card while the shuffle is on. */
  if (chest.phase === "shuffling") {
    if (!card.querySelector(".nexus-card__deck-wrap")) {
      const wrap = buildDeck();
      const result = card.querySelector(".nexus-card__result");
      card.insertBefore(wrap, result || null);
    }
    await shuffleDeck(card, { duration: SHUFFLE_MS });
    if (chest.phase !== "shuffling") return card;
  }

  /* The card is turned over. */
  if (chest.phase === "revealed" && chest.result?.card) {
    if (!card.querySelector(".nexus-card__deck-wrap")) {
      const wrap = buildDeck();
      const result = card.querySelector(".nexus-card__result");
      card.insertBefore(wrap, result || null);
    }
    nexusFace(card, chest.result);
    await flipTop(card);
    const result = card.querySelector(".nexus-card__result");
    if (result) {
      result.hidden = false;
      result.replaceChildren(
        el("p", { class: "nexus-card__result-name", text: chest.result.card.name }),
        el("p", { class: "nexus-card__result-text", text: chest.result.card.text }),
        el("p", {
          class: `nexus-card__result-amount nexus-card__result-amount--${chest.result.card.amount < 0 ? "spend" : "earn"}`,
          text: `${chest.result.card.amount < 0 ? "−" : "+"}${rupees(Math.abs(chest.result.card.amount))}`,
        }),
      );
    }
  }

  /* The offering, after Pray. */
  if (chest.phase === "praying") {
    const result = card.querySelector(".nexus-card__result");
    if (result) {
      result.hidden = false;
      result.replaceChildren(
        el("p", { class: "nexus-card__result-name", text: "Your offering is received" }),
        el("p", {
          class: "nexus-card__result-text",
          text: "The temples are tended, the lamps are lit, and the silence holds.",
        }),
        el("p", {
          class: "nexus-card__result-amount nexus-card__result-amount--spend",
          text: `−${rupees(NEXUS_PRAY_COST)}`,
        }),
      );
    }
  }

  return card;
}

/**
 * The Ragnarok stage: the draw, and the weapon that was drawn.
 */
export async function playRagnarokStage(board, chest) {
  const holder = board.querySelector(".board__card");
  const card = holder?.querySelector(".chest-card");
  if (!card || !chest) return null;

  const result = card.querySelector(".chest-card__result");
  const bad = Boolean(chest.result?.badLuck);
  const weapon = chest.result?.weapon ? weaponById(chest.result.weapon) : null;

  if (chest.phase === "drawing" || chest.phase === "revealed") {
    const slot = card.querySelector(".chest-card__slot");
    if (slot) {
      slot.dataset.phase = chest.phase;
      if (!bad && weapon) {
        slot.dataset.weapon = chest.result.weapon;
        const name = slot.querySelector(".chest-card__slot-name");
        if (name) name.replaceChildren(el("span", { text: weapon.name }));
        const pill = slot.querySelector(".chest-card__pill");
        if (pill) pill.style.setProperty("--weapon", weapon.color || "var(--ink)");
      }
    }
    if (result) {
      result.hidden = false;
      result.replaceChildren(
        el("p", {
          class: "chest-card__drew",
          text: bad ? RAGNAROK.badLuck : `You drew the ${weapon?.name || "weapon"}.`,
        }),
      );
    }
  }

  return card;
}

/* -------------------------------------------------------------- the closing */

/**
 * The Done pill.
 *
 * It is for the acting player only. The other player sees the same card with
 * a muted line saying who they are waiting for.
 */
export function chestDoneButton(onDone) {
  return el("button", {
    type: "button",
    class: "chest-card__done",
    "data-action": "done",
    text: "Done",
    onclick: onDone,
  });
}

/** The waiting line, for the player who is not acting. */
export function chestWaiting(name) {
  return el("p", { class: "chest-card__waiting", "data-role": "waiting" }, [
    el("span", { text: `Waiting for ${name}` }),
  ]);
}

export { WEAPONS };
