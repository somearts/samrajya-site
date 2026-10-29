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
import { flyCoins, resetHolder } from "./board-fx.js";
import { prefersStill } from "./dice.js";
import { NEXUS_KEEPER, NEXUS_PRAY_COST } from "./shared/nexus-cards.js";
import { KRONOS_CHEST, RAGNAROK, SHIELDS, WEAPONS, shieldById, weaponById } from "./shared/weapons.js";
import { CELLS } from "./shared/spaces.js";
import { rupees } from "./shared/economy.js";
/* The chest card's face. The emblem and the colour a weapon is drawn in are
   exported there because the profile and the name chip draw them too, and
   they must all draw the same thing: one place knows what a weapon looks
   like and every screen that shows one asks it. */
import { emblem, shieldColor, weaponColor } from "./chest-card.js";

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
/* THE CARD IS BUILT FOR ITS STAGE.

   The two options are what the card is while nobody has chosen. Once the
   choice is made, the options are GONE and the deck is what the card is: a
   player who has pressed "Take My Chances" must not still be offered a
   choice, and a card that shows the buttons and the deck at once is a card
   that says two things at the same time.

   So the card is built for its stage, and the stage is the server's. */
function nexusCard({ drawable, phase, caption }) {
  const answered = phase !== "open";

  const actions = answered
    ? null
    : el("div", { class: "nexus-card__actions" }, [
        el("button", {
          type: "button",
          class: "nexus-card__pray",
          "data-action": "pray",
          disabled: !drawable,
          "aria-disabled": String(!drawable),
          title: drawable ? NEXUS_KEEPER.actions.pray.title : NEXUS_KEEPER.actions.pray.titleIdle,
        }, [
          el("span", { class: "nexus-card__action-name", text: NEXUS_KEEPER.actions.pray.name }),
          el("span", { class: "nexus-card__action-note", text: `Tend the temples • ${rupees(NEXUS_PRAY_COST)}` }),
        ]),
        el("button", {
          type: "button",
          class: "nexus-card__draw",
          "data-action": "draw",
          disabled: !drawable,
          "aria-disabled": String(!drawable),
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
    "data-shape": answered ? "deck" : "options",
    style: { "--accent": "var(--ink)" },
    "aria-live": "polite",
  }, [
    el("div", { class: "nexus-card__figure-wrap" }, [
      el("img", {
        class: "nexus-card__god",
        src: "assets/img/god.png",
        alt: NEXUS_KEEPER.title,
        draggable: "false",
        /* THE FALLBACK IS FOR A LOAD ERROR AND NOTHING ELSE. The picture is
           part of the build's output, and the build check answers for it; if
           it still fails to arrive, one line in the console says the page is
           being seen through the silhouette. */
        onerror: () => {
          console.warn("Nexus god image failed to load; showing the silhouette fallback.");
          card.classList.add("nexus-card--silhouette");
        },
      }),
    ]),
    el("h3", { class: "nexus-card__title", text: NEXUS_KEEPER.title }),
    el("p", { class: "nexus-card__tagline", text: NEXUS_KEEPER.tagline }),
    /* The mythology is what the card says about the keeper. It is the
       longest thing on the card, and it is what gives way to the deck when
       the draw begins. */
    el("p", { class: "nexus-card__mythology" },
      NEXUS_KEEPER.mythology.map((sentence) => el("span", { text: sentence })),
    ),
    actions,
    /* The deck's place is reserved from the start, so the card does not jump
       when the deck arrives. */
    el("div", { class: "nexus-card__deck-slot", hidden: !answered }),
    el("div", { class: "nexus-card__result", hidden: true }),
  ]);

  if (caption) card.append(caption);
  return card;
}

/** The chest of weapons: three faces, one per weapon, and a draw. */
function ragnarokCard({ drawable, phase, caption }) {
  /* THE THREE FACES.

   Ragnarok offers three card faces and the player touches one of them to
   draw. Each is labelled with the weapon it belongs to - the same three in
   every state, the same width, the same shape, the same label area - so the
   screen does not change size when the card is turned over, and the emblem
   waits on the face for the back to get out of its way. */
  const slot = (weapon, index) => el("button", {
    type: "button",
    class: "chest-card__slot",
    "data-weapon": weapon.id,
    "data-slot": String(index),
    style: { "--weapon": weaponColor(weapon.id) },
    "aria-label": "Draw a weapon",
    disabled: !drawable || phase !== "open",
  }, [
    el("span", { class: "chest-card__back", "aria-hidden": "true" }, [
      el("span", { class: "chest-card__mark", text: "?" }),
    ]),
    el("span", { class: "chest-card__face", "aria-hidden": "true", html: emblem(weapon) }),
    el("span", { class: "chest-card__pill", "aria-hidden": "true" }),
    el("span", { class: "chest-card__slot-name", text: weapon.name }),
  ]);

  const card = el("article", {
    class: "property-card chest-card",
    "data-property": "ragnarok",
    "data-chest": "ragnarok",
    "data-phase": phase,
    /* The shape never changes on this card: the three faces are the whole of
       it from open to done, and a card whose shape does not change is a card
       whose stage is written into it rather than rebuilt over it. */
    "data-shape": "chest",
    // A chest belongs to no set, so the edge is the board's own ink rather than
    // a set colour that would say it belongs to one.
    style: { "--accent": "var(--ink)" },
    "aria-live": "polite",
  }, [
    /* The head is the property card's head - the pill beside a two-line
       title - because the chest is the same object wearing the same shell as
       every other place on the board. Ragnarok is too long for one line at a
       phone's cell size, and the break lives in the data rather than being
       guessed here. */
    el("div", { class: "property-card__head" }, [
      el("div", { class: "property-card__title" }, [
        el("span", { class: "property-card__pill", "aria-hidden": "true" }),
        el("h3", {
          class: "property-card__name",
          html: RAGNAROK.titleLines.map((line) => `<span>${line}</span>`).join(""),
        }),
      ]),
    ]),
    el("p", { class: "chest-card__tagline", text: RAGNAROK.tagline }),
    el("p", { class: "chest-card__body", text: RAGNAROK.body }),
    el("div", { class: "chest-card__slots" },
      /* The faces are enumerated rather than derived, so a weapons list with
         one weapon too few is a bug here and not a card that quietly offers
         fewer choices. */
      [0, 1, 2].map((n) => slot(WEAPONS[n], n)),
    ),
    /* THE DRAW PILL. Touching a face draws from that face, and the pill is
       the same draw said once more for the player who reads buttons before
       they read cards. It takes the middle face, which is what a straight
       read of the row takes too. */
    el("button", {
      type: "button",
      class: "chest-card__draw",
      "data-action": "draw",
      disabled: !drawable || phase !== "open",
      "aria-disabled": String(!drawable || phase !== "open"),
      text: "Draw",
    }),
    el("div", { class: "chest-card__result", hidden: true }),
    /* The Collect pill. The weapon is drawn, and the player takes it: that is
       a second press, and it is the press that ends the visit. */
    el("div", { class: "chest-card__collect-slot" }),
  ]);

  if (caption) card.append(caption);
  return card;
}

/**
 * The chest of shields: three faces, one per shield, and a draw.
 *
 * THE SAME CARD AS RAGNAROK'S, WEARING ITS OWN DATA. The same shell, the same
 * three faces, the same shuffle and the same separate reveal - so nothing here
 * is a second card architecture to keep in step with the first. What is its
 * own is what the faces hold: the three shields, each in the shield's own
 * colour with the EMBLEM of the one weapon it answers, and that weapon named
 * under the shield's name so the counter is read rather than guessed.
 *
 * THERE IS NO COLLECT PILL. A shield deploys the moment it is drawn - it is
 * already standing before the face turns over - so a press that would only
 * confirm what has already happened is not offered. The visit's last press is
 * Done, appended by the board the same way Nexus's is.
 */
function kronosCard({ drawable, phase, caption }) {
  const slot = (shield, index) => {
    const stops = weaponById(shield.counters)?.name || "";
    return el("button", {
      type: "button",
      class: "chest-card__slot chest-card__slot--shield",
      "data-shield": shield.id,
      "data-slot": String(index),
      style: { "--weapon": shieldColor(shield.id) },
      "aria-label": `Draw a shield: ${shield.name}`,
      disabled: !drawable || phase !== "open",
    }, [
      el("span", { class: "chest-card__back", "aria-hidden": "true" }, [
        el("span", { class: "chest-card__mark", text: "?" }),
      ]),
      el("span", {
        class: "chest-card__face",
        "aria-hidden": "true",
        html: emblem(shield, shieldColor(shield.id)),
      }),
      el("span", { class: "chest-card__pill", "aria-hidden": "true" }),
      el("span", { class: "chest-card__slot-name" }, [
        el("span", { text: shield.name }),
        stops
          ? el("span", { class: "chest-card__slot-stops", text: `Stops ${stops}` })
          : null,
      ].filter(Boolean)),
    ]);
  };

  const card = el("article", {
    class: "property-card chest-card chest-card--kronos",
    "data-property": "kronos",
    "data-chest": "kronos",
    "data-phase": phase,
    /* The same constant shape as Ragnarok's: the three faces are the whole of
       the card from open to done, so the stage is written into it rather than
       rebuilt over it and the shuffle survives every repaint. */
    "data-shape": "chest",
    // A chest belongs to no set, so the edge is the board's own ink.
    style: { "--accent": "var(--ink)" },
    "aria-live": "polite",
  }, [
    el("div", { class: "property-card__head" }, [
      el("div", { class: "property-card__title" }, [
        el("span", { class: "property-card__pill", "aria-hidden": "true" }),
        el("h3", {
          class: "property-card__name",
          html: KRONOS_CHEST.titleLines.map((line) => `<span>${line}</span>`).join(""),
        }),
      ]),
    ]),
    el("p", { class: "chest-card__tagline", text: KRONOS_CHEST.tagline }),
    el("p", { class: "chest-card__body", text: KRONOS_CHEST.body }),
    el("div", { class: "chest-card__slots" },
      /* Enumerated rather than derived, the same way Ragnarok's are: a
         shields list with one too few is a bug here, not a chest that quietly
         offers fewer choices. */
      [0, 1, 2].map((n) => slot(SHIELDS[n], n)),
    ),
    el("button", {
      type: "button",
      class: "chest-card__draw",
      "data-action": "draw",
      disabled: !drawable || phase !== "open",
      "aria-disabled": String(!drawable || phase !== "open"),
      text: "Draw",
    }),
    el("div", { class: "chest-card__result", hidden: true }),
    /* No collect - a shield deploys at the draw - but the slot is kept so the
       card is the same grid at every stage and nothing jumps when Done
       arrives. */
    el("div", { class: "chest-card__collect-slot" }),
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
  const face = top.querySelector(".nexus-card__deck-top-face");

  if (still()) {
    top.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: "both" });
    if (face) face.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, fill: "both" });
    await wait(200);
    return;
  }

  /* The card lifts out of the deck and turns. The face REPLACES the back as
     the turn finishes: the back is not there afterwards, and the face is.
     Which of two faces a browser paints is its own business, and it is not
     a business that should decide whether a player can see the card they
     were dealt. */
  await settled(
    top.animate(
      [
        { transform: "translate(-50%, calc(-50% - 4px)) scale(1) rotateY(0deg)", opacity: 1 },
        { transform: "translate(-50%, calc(-50% - 4px)) scale(1.14) rotateY(84deg)", offset: 0.5 },
        { transform: "translate(-50%, calc(-50% - 4px)) scale(1.14) rotateY(0deg)", offset: 1 },
      ],
      { duration: FLIP_MS, easing: "cubic-bezier(.3,.7,.3,1)", fill: "both" },
    ).finished,
    FLIP_MS + 200,
  );

  if (face) {
    face.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: "both" });
  }
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
  const amountEl = el("p", {
    class: `nexus-card__face-amount nexus-card__face-amount--${tone}`,
    text: `${Number(amount) < 0 ? "−" : "+"}${rupees(Math.abs(Number(amount) || 0))}`,
  });
  /* The tone and the amount are written on the amount itself as well as on
     the face, so that anything reading the card can tell a gain from a loss
     without having to guess from the colour. */
  amountEl.dataset.tone = tone;
  amountEl.dataset.amount = String(Number(amount) || 0);
  face.replaceChildren(
    el("p", { class: "nexus-card__face-name", text: name }),
    el("p", { class: "nexus-card__face-text", text }),
    amountEl,
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
  holder.dataset.property = chest.kind;
  board.dataset.property = holder.dataset.property;

  const name = playerName || "Your opponent";

  /* THE CARD IS BUILT ONCE, AND THE STAGE UPDATES IT.

     A card that is rebuilt every time the stage changes is a card whose
     animation is thrown away: the deck that is halfway through its shuffle
     is wiped and started again, and - worst of all - the flip that turns the
     card over is wiped with it, so the card is left showing its BACK.

     So the card that is already up is kept, and only its stage is written
     into it. The card IS rebuilt when its shape changes: the Nexus card has
     the options while nobody has chosen and the deck afterwards, and a card
     showing both is a card saying two things at once. */
  const existing = holder.querySelector(".nexus-card, .chest-card");
  /* WHICH CHEST'S CARD IS ALREADY UP - answered by the card's OWN data, not
     by its class. The Ragnarok and the Kronos card wear the same class, and a
     class check alone would keep a shield card on screen through a visit to
     the armoury, or the other way round, with only the stage written into it. */
  const sameKind = existing && existing.dataset.chest === chest.kind;
  /* The shape of the card: does it have the options, or the deck? The Nexus
     card carries both and so it changes shape; the Ragnarok card is the same
     three faces from open to done, so it never does - and a card whose shape
     has not changed is a card that keeps its stage rather than being rebuilt
     over it. */
  const shape = chest.kind === "nexus"
    ? (phase) => (phase === "open" ? "options" : "deck")
    : () => "chest";
  const sameShape = sameKind && existing.dataset.shape === shape(chest.phase);

  let card = existing;
  if (!sameShape) {
    card = chest.kind === "nexus"
      ? nexusCard({
          drawable: mine,
          phase: chest.phase,
          caption: mine ? null : chestCaption(name, `is at the Nexus`),
        })
      : chest.kind === "kronos"
        ? kronosCard({
            drawable: mine,
            phase: chest.phase,
            caption: mine ? null : chestCaption(name, `is at Kronos`),
          })
        : ragnarokCard({
            drawable: mine,
            phase: chest.phase,
            caption: mine ? null : chestCaption(name, `is at Ragnarok`),
          });
    holder.replaceChildren(card);
  } else {
    card.dataset.phase = chest.phase;
  }
  holder.hidden = false;

  /* The buttons. They are wired to the actions, and the server decides what
     happens. A button that is not the acting player's is not wired at all. */
  if (mine) {
    for (const [selector, handler] of Object.entries(handlers)) {
      const button = card.querySelector(selector);
      if (button && typeof handler === "function") {
        button.replaceWith(button.cloneNode(true));
        const live = card.querySelector(selector);
        live.addEventListener("click", handler, { once: true });
      }
    }
  } else {
    /* The other player's buttons are shown, but they are not live. */
    for (const button of card.querySelectorAll('[data-action="pray"], [data-action="draw"]')) {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    }
  }

  return card;
}

/**
 * A chest that is being LOOKED AT rather than visited.
 *
 * This is the pop-up a player gets for pressing the Nexus, Ragnarok or Kronos
 * tile: the picture, the mythology, the faces - all there, all disabled,
 * because nobody is at the chest. It is the same drawing as the shared stage,
 * so the two can never drift apart, and it is drawn the same way: from a
 * record of what the screen is, not from an event that may never arrive.
 */
export function drawChestPeek(board, kind, { onClose = null } = {}) {
  const holder = board.querySelector(".board__card");
  if (!holder) return null;

  resetHolder(holder);
  holder.dataset.cardKind = "chest";
  holder.dataset.property = kind;
  board.dataset.property = holder.dataset.property;

  const card = kind === "nexus"
    ? nexusCard({ drawable: false, phase: "peek", caption: null })
    : kind === "kronos"
      ? kronosCard({ drawable: false, phase: "peek", caption: null })
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
export async function playNexusStage(board, chest, { chip = null, elapsed = 0 } = {}) {
  const holder = board.querySelector(".board__card");
  const card = holder?.querySelector(".nexus-card");
  if (!card || !chest) return null;

  /* THE DECK IS IN THE CARD'S OWN PLACE.

     The deck goes where the options were, so the card does not grow a second
     thing and the options are not left on the screen beside it. */
  const slot = card.querySelector(".nexus-card__deck-slot");
  if (slot && chest.phase !== "open" && !slot.querySelector(".nexus-card__deck-wrap")) {
    slot.hidden = false;
    slot.append(buildDeck());
  }

  /* The deck is in the card while the shuffle is on. */
  if (chest.phase === "shuffling") {
    await shuffleDeck(card, { duration: Math.max(0, SHUFFLE_MS - elapsed) });
    if (chest.phase !== "shuffling") return card;
  }

  /* The card is turned over. */
  if (chest.phase === "revealed" && chest.result?.card) {
    /* The face is written BEFORE the flip, so the card turns over onto its
       face rather than onto an empty card.

       The card's own name and line are inside the result's card; the amount
       is beside them. */
    nexusFace(card, {
      name: chest.result.card.name,
      text: chest.result.card.text,
      amount: chest.result.amount ?? chest.result.card.amount,
    });
    await flipTop(card);
    /* The card's face carries the heading, the line and the amount. The
       result underneath is the same three things said again, which is a card
       saying two things at once - so it is left empty. */
    const result = card.querySelector(".nexus-card__result");
    if (result) {
      result.hidden = true;
      result.replaceChildren();
    }

    /* THE MONEY MOVES, AND IT IS SHOWN MOVING.

       A gain flies from the middle of the board to the player's chip; a loss
       flies from the chip to the middle. The balance on the chip is already
       the new one - the server applied it when the card was turned over -
       and the coins are the saying of it.

       Both devices fly the same coins, because both are told the same amount
       by the same state. */
    const amount = Number(chest.result.card.amount) || 0;
    if (amount !== 0 && chip) {
      await flyCoins(board, {
        from: amount > 0 ? card : chip,
        to: amount > 0 ? chip : card,
        amount: Math.abs(amount),
      });
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
    /* The offering flies from the player's chip to the middle of the board. */
    if (chip) {
      await flyCoins(board, { from: chip, to: card, amount: NEXUS_PRAY_COST });
    }
  }

  return card;
}

/**
 * The Ragnarok stage: the draw, and the weapon that was drawn.
 *
 * The weapon turns over in the face the player touched, and the other two
 * go away. Both devices show the same face, because the weapon is in the
 * state and not in a browser.
 */
export async function playRagnarokStage(board, chest) {
  const holder = board.querySelector(".board__card");
  /* The RAGNAROK card specifically: the Kronos card wears the same class, and
     a stage that drew the wrong chest's faces would turn over a shield with a
     weapon's rules. */
  const card = holder?.querySelector(".chest-card:not(.chest-card--kronos)");
  if (!card || !chest) return null;

  const result = card.querySelector(".chest-card__result");
  const bad = Boolean(chest.result?.badLuck);
  const weapon = chest.result?.weapon ? weaponById(chest.result.weapon) : null;
  const slots = [...card.querySelectorAll(".chest-card__slot")];

  /* THE SHUFFLE. The draw was decided the moment the button was pressed and
     the answer is already in the state - but nothing about it is SHOWN
     until the shuffle is over. The old stage turned the chosen face over
     here, during "drawing", which flashed the weapon before the shuffle
     had run and made the reveal a second screen. The faces stay backs and
     move for three seconds; they are not touched otherwise. */
  if (chest.phase === "drawing") {
    await shuffleFaces(card);
    return card;
  }

  /* THE REVEAL, AND NOTHING AFTER IT. One face turns over and keeps its
     answer on screen; the other two step aside. The card is stable from
     here until Collect closes the chest - there is no later stage to fall
     into, and no second button. */
  if (chest.phase === "revealed") {
    /* The face the player touched is the one that turns over. The chest says
       which slot was chosen; without it, the middle one is the face. */
    const chosenIndex = Number(chest.result?.slot ?? 1);
    const chosen = slots[chosenIndex] || slots[1] || slots[0];
    for (const slot of slots) {
      if (!bad && weapon && slot === chosen) {
        /* The face that turns over shows the weapon that was drawn, which is
           not always the weapon the face was labelled with. The colour and
           the emblem both follow the weapon, and they are both named at the
           slot so the pill and the border read the same var. */
        const colour = weaponColor(chest.result.weapon);
        slot.dataset.weapon = chest.result.weapon;
        slot.style.setProperty("--weapon", colour);
        slot.classList.add("is-drawn");
        const face = slot.querySelector(".chest-card__face");
        if (face) face.innerHTML = emblem(weapon);
        const name = slot.querySelector(".chest-card__slot-name");
        if (name) name.replaceChildren(el("span", { text: weapon.name }));
        const pill = slot.querySelector(".chest-card__pill");
        if (pill) pill.style.removeProperty("background");
      } else {
        slot.hidden = true;
      }
    }
    if (result) {
      result.hidden = false;
      /* THE REVEALED WEAPON, IN FULL. Its name on the face above; under it,
         what it is and where it can strike - the weapon's own blurb and the
         colonies its own target list reaches, read from the same data the
         rules use. The card says everything the player needs before the one
         press (Collect) that takes it. */
      const targets = weapon
        ? weapon.targets
            .map((id) => CELLS.find((entry) => entry.id === id)?.name || id)
            .join(", ")
        : "";
      result.replaceChildren(
        ...[
          el("p", {
            class: "chest-card__drew",
            text: bad ? RAGNAROK.badLuck : `You drew the ${weapon?.name || "weapon"}.`,
          }),
          weapon?.blurb
            ? el("p", { class: "chest-card__weapon-blurb", text: weapon.blurb })
            : null,
          targets
            ? el("p", {
                class: "chest-card__weapon-targets",
                text: `Strikes: ${targets}`,
              })
            : null,
        ].filter(Boolean),
      );
    }
  }

  return card;
}

/**
 * The Kronos stage: the draw, and the shield that was drawn.
 *
 * The same two moments as Ragnarok's - the shuffle, then the face turning
 * over in the slot the player touched - because they ARE the same two moments
 * and the same shuffleFaces runs. What is its own is what the face shows: the
 * shield in its own colour, and under the answer, which weapon it stops and
 * how long it stands. A draw that found nothing left (all three already held)
 * says so and shows no face.
 */
export async function playKronosStage(board, chest) {
  const holder = board.querySelector(".board__card");
  const card = holder?.querySelector(".chest-card--kronos");
  if (!card || !chest) return null;

  const result = card.querySelector(".chest-card__result");
  const none = Boolean(chest.result?.none);
  const shield = chest.result?.shield ? shieldById(chest.result.shield) : null;
  const slots = [...card.querySelectorAll(".chest-card__slot")];

  /* THE SHUFFLE. The answer was decided when the button was pressed and is
     already in the state; nothing about it is SHOWN until the shuffle is
     over. The same three seconds, the same riffle, the same stillness for a
     reader who asked for less motion - so every device turns the face at the
     same moment. */
  if (chest.phase === "drawing") {
    await shuffleFaces(card);
    return card;
  }

  /* THE REVEAL, AND NOTHING AFTER IT. One face turns over and keeps its
     answer; the other two step aside. The shield was already deployed the
     moment it was drawn - this is the two screens agreeing on the moment the
     face turns, and the card is stable from here until Done closes the chest. */
  if (chest.phase === "revealed") {
    const chosenIndex = Number(chest.result?.slot ?? 1);
    const chosen = slots[chosenIndex] || slots[1] || slots[0];
    for (const slot of slots) {
      if (!none && shield && slot === chosen) {
        /* The face that turns over shows the shield that was drawn, in the
           shield's own colour, with the emblem of the weapon it answers. */
        slot.dataset.shield = shield.id;
        slot.style.setProperty("--weapon", shieldColor(shield.id));
        slot.classList.add("is-drawn");
        const face = slot.querySelector(".chest-card__face");
        if (face) face.innerHTML = emblem(shield, shieldColor(shield.id));
        const name = slot.querySelector(".chest-card__slot-name");
        if (name) {
          /* Filtered, for the reason the weapon card's own copy is: a trailing
             null is not a Node, and replaceChildren would refuse it. */
          name.replaceChildren(
            ...[
              el("span", { text: shield.name }),
              weaponById(shield.counters)
                ? el("span", {
                    class: "chest-card__slot-stops",
                    text: `Stops ${weaponById(shield.counters).name}`,
                  })
                : null,
            ].filter(Boolean),
          );
        }
        const pill = slot.querySelector(".chest-card__pill");
        if (pill) pill.style.removeProperty("background");
      } else {
        slot.hidden = true;
      }
    }
    if (result) {
      result.hidden = false;
      /* THE REVEALED SHIELD, IN FULL: its name, what it is, the one weapon it
         stops, and the two owned turns it stands for. Everything the player
         needs to know about what just happened is on the card they are
         already reading - no second screen, no splash. */
      const stops = shield ? weaponById(shield.counters)?.name : "";
      result.replaceChildren(
        ...[
          el("p", {
            class: "chest-card__drew",
            text: none
              ? KRONOS_CHEST.badLuck
              : `You drew the ${shield?.name || "shield"}.`,
          }),
          !none && shield?.blurb
            ? el("p", { class: "chest-card__weapon-blurb", text: shield.blurb })
            : null,
          stops
            ? el("p", { class: "chest-card__weapon-targets", text: `Stops: ${stops}` })
            : null,
          !none
            ? el("p", {
                class: "chest-card__weapon-targets",
                text: "Deployed now. Stands for two of your turns.",
              })
            : null,
        ].filter(Boolean),
      );
    }
  }

  return card;
}

/**
 * The three backs, moving, for the length of the shuffle.
 *
 * Three seconds, transform only, and the faces are never touched: the answer
 * stays in the state and appears only with the "revealed" stage. A reader who
 * asked for less motion gets the same three seconds of stillness, so the
 * reveal arrives at the same moment on every device.
 */
function shuffleFaces(card) {
  const slots = [...card.querySelectorAll(".chest-card__slot:not([hidden])")];
  if (still()) return wait(3000);
  const riffling = slots.map((slot, i) =>
    slot.animate(
      [
        { transform: "translate(0, 0) rotate(0deg)" },
        {
          transform: `translate(${i === 1 ? -7 : 7}px, -5px) rotate(${i === 1 ? -4 : 4}deg)`,
          offset: 0.4,
        },
        { transform: "translate(0, 0) rotate(0deg)" },
      ],
      { duration: 500, iterations: 6, easing: "ease-in-out" },
    ),
  );
  return wait(3000).then(() => {
    /* Cancelled rather than allowed to finish: a running animation's last
       frame would sit under the reveal until it timed out on its own. */
    riffling.forEach((a) => a.cancel());
  });
}

/* -------------------------------------------------------------- the closing */

/**
 * The Collect pill.
 *
 * The weapon has been drawn; collecting it is what makes it the player's. It
 * is a press of its own, and after it the visit is over.
 */
export function chestCollectButton(onCollect) {
  return el("button", {
    type: "button",
    class: "chest-card__collect",
    "data-action": "collect",
    text: "Collect",
    onclick: onCollect,
  });
}

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
