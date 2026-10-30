/* ==========================================================================
   SAMRAJYA - OUTER SPACE, THE INTERSTELLAR COUNTER

   A SHARED screen, drawn from the state the way the chests, the fight, Epoch
   and the Black Hole panel are: `game.space` is the whole truth about it -
   which seat is at the counter, whether the suits are being chosen or the
   acquisition popup is speaking, and which suit was retired by this
   arrival. Every device draws the middle from that fact, so a phone that
   reconnects or joined late shows exactly the same journey.

   THREE SHAPES, ONE CARD

   1. THE EXPIRY NOTICE - shown first when the arriving seat was still
      carrying a suit whose discount was never spent. Its CONTINUE is local:
      it takes the notice down and reveals the counter underneath, with no
      action sent anywhere.

   2. THE SELECTION - the headline, the subtitle, the mythology, the three
      vertically stacked suit cards (art, name, descriptor, discount, price,
      ACQUIRE SUIT) and the Mission Protocols beneath. The card scrolls
      inside the holder if the small board needs it; nothing else moves.

   3. THE ACQUISITION POPUP - the suit, its illustration, its narrative and
      the one CTA, CONTINUE JOURNEY, which the board wires to the same
      `continue` that ends every visit.

   NOTHING HERE DECIDES ANYTHING

   Prices, the discount arithmetic, the funds check and the one-suit rule
   all live in shared/suits.js and shared/game.js. This file only shows
   them; every button press is an action the server answers.
   ========================================================================== */

import { el } from "./dom.js";
import { resetHolder } from "./board-fx.js";
import { SUITS, suitById } from "./shared/suits.js";
import { rupees } from "./shared/economy.js";

/* ------------------------------------------------------------- the suits

   Three full-body suits on one frame: the same stance, the same helmet,
   the same light falling from the upper left, so the row reads as one
   collection. The progression is carried by silhouette and detail - a
   slim seam-clean exploration suit, a layered photonic weave, a heavy
   singularity-grade mantle - and by colour that stays sophisticated:
   slate-teal, warm pearl, deep indigo, never literal metal. */

const SUIT_ART = Object.freeze({
  "quantum-one": `<svg viewBox="0 0 100 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="q1-body" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#b7c6ca"/>
        <stop offset="1" stop-color="#7f959d"/>
      </linearGradient>
      <linearGradient id="q1-helm" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0" stop-color="#c6d3d6"/>
        <stop offset="1" stop-color="#8ba0a7"/>
      </linearGradient>
    </defs>
    <rect x="35" y="47" width="30" height="36" rx="9" fill="#5c767e"/>
    <rect x="38" y="103" width="11" height="47" rx="5.5" fill="url(#q1-body)"/>
    <rect x="51" y="103" width="11" height="47" rx="5.5" fill="url(#q1-body)"/>
    <rect x="34" y="145" width="16" height="13" rx="4.5" fill="#456069"/>
    <rect x="50" y="145" width="16" height="13" rx="4.5" fill="#456069"/>
    <rect x="18" y="57" width="13" height="44" rx="6.5" fill="url(#q1-body)"/>
    <rect x="69" y="57" width="13" height="44" rx="6.5" fill="url(#q1-body)"/>
    <circle cx="24.5" cy="104" r="7.5" fill="#456069"/>
    <circle cx="75.5" cy="104" r="7.5" fill="#456069"/>
    <path d="M31 60 h38 a8 8 0 0 1 8 8 v22 a12 12 0 0 1 -12 12 h-30 a12 12 0 0 1 -12 -12 v-22 a8 8 0 0 1 8 -8 z" fill="url(#q1-body)"/>
    <rect x="42" y="65" width="16" height="21" rx="5" fill="#1e2f36"/>
    <circle cx="50" cy="74.5" r="5" fill="#7fd8c4"/>
    <rect x="44" y="43" width="12" height="9" rx="2" fill="#456069"/>
    <circle cx="50" cy="30" r="18" fill="url(#q1-helm)"/>
    <ellipse cx="50" cy="29.5" rx="12.5" ry="10.5" fill="#132229"/>
    <path d="M41.5 24.5 a13 9 0 0 1 13.5 -2.5" stroke="#cfe2e6" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.75"/>
    <rect x="45" y="92" width="10" height="14" rx="3" fill="#5c767e"/>
  </svg>`,

  "photon-weave": `<svg viewBox="0 0 100 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="pw-body" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#efe7d4"/>
        <stop offset="1" stop-color="#c9bb9d"/>
      </linearGradient>
      <linearGradient id="pw-helm" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0" stop-color="#f2ebda"/>
        <stop offset="1" stop-color="#c3b595"/>
      </linearGradient>
    </defs>
    <rect x="35" y="47" width="30" height="36" rx="9" fill="#a08f6d"/>
    <path d="M20 54 l14 -6 v10 l-14 6 z" fill="#c2705a"/>
    <path d="M80 54 l-14 -6 v10 l14 6 z" fill="#c2705a"/>
    <rect x="38" y="103" width="11" height="47" rx="5.5" fill="url(#pw-body)"/>
    <rect x="51" y="103" width="11" height="47" rx="5.5" fill="url(#pw-body)"/>
    <rect x="34" y="145" width="16" height="13" rx="4.5" fill="#8c7a56"/>
    <rect x="50" y="145" width="16" height="13" rx="4.5" fill="#8c7a56"/>
    <rect x="18" y="57" width="13" height="44" rx="6.5" fill="url(#pw-body)"/>
    <rect x="69" y="57" width="13" height="44" rx="6.5" fill="url(#pw-body)"/>
    <rect x="18" y="72" width="13" height="4" fill="#c2705a"/>
    <rect x="69" y="72" width="13" height="4" fill="#c2705a"/>
    <circle cx="24.5" cy="104" r="7.5" fill="#8c7a56"/>
    <circle cx="75.5" cy="104" r="7.5" fill="#8c7a56"/>
    <path d="M31 60 h38 a8 8 0 0 1 8 8 v22 a12 12 0 0 1 -12 12 h-30 a12 12 0 0 1 -12 -12 v-22 a8 8 0 0 1 8 -8 z" fill="url(#pw-body)"/>
    <path d="M35 66 h30 v5 h-30 z" fill="#c2705a" opacity="0.85"/>
    <path d="M35 76 h30 v3 h-30 z" fill="#c2705a" opacity="0.55"/>
    <rect x="42" y="83" width="16" height="10" rx="3" fill="#3a332a"/>
    <circle cx="50" cy="88" r="3.4" fill="#f0d9a8"/>
    <rect x="44" y="43" width="12" height="9" rx="2" fill="#8c7a56"/>
    <circle cx="50" cy="30" r="18" fill="url(#pw-helm)"/>
    <ellipse cx="50" cy="29.5" rx="12.5" ry="10.5" fill="#241f18"/>
    <path d="M41.5 24.5 a13 9 0 0 1 13.5 -2.5" stroke="#f6efdd" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.8"/>
    <path d="M31 60 h38" stroke="#a08f6d" stroke-width="1.4" fill="none" opacity="0.6"/>
  </svg>`,

  "singularity-mantle": `<svg viewBox="0 0 100 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="sm-body" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#565c8c"/>
        <stop offset="1" stop-color="#33375c"/>
      </linearGradient>
      <linearGradient id="sm-helm" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0" stop-color="#666c9e"/>
        <stop offset="1" stop-color="#3a3e66"/>
      </linearGradient>
      <linearGradient id="sm-mantle" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#6a4f95"/>
        <stop offset="1" stop-color="#463163"/>
      </linearGradient>
    </defs>
    <path d="M24 58 q-7 34 -2 74 h20 l-4 -66 z" fill="url(#sm-mantle)"/>
    <path d="M76 58 q7 34 2 74 h-20 l4 -66 z" fill="url(#sm-mantle)"/>
    <rect x="34" y="47" width="32" height="36" rx="9" fill="#262a49"/>
    <path d="M38 103 h11 l-1 47 h-10 z" fill="url(#sm-body)"/>
    <path d="M51 103 h11 l1 47 h-10 z" fill="url(#sm-body)"/>
    <rect x="33" y="144" width="17" height="14" rx="4.5" fill="#1f2340"/>
    <rect x="50" y="144" width="17" height="14" rx="4.5" fill="#1f2340"/>
    <path d="M17 57 h15 l1 44 h-15 z" fill="url(#sm-body)"/>
    <path d="M68 57 h15 l-1 44 h-15 z" fill="url(#sm-body)"/>
    <path d="M14 52 h21 l-2 13 h-17 z" fill="#262a49"/>
    <path d="M86 52 h-21 l2 13 h17 z" fill="#262a49"/>
    <rect x="14" y="52" width="21" height="3" fill="#c9a05a" opacity="0.85"/>
    <rect x="65" y="52" width="21" height="3" fill="#c9a05a" opacity="0.85"/>
    <circle cx="24.5" cy="104" r="7.5" fill="#1f2340"/>
    <circle cx="75.5" cy="104" r="7.5" fill="#1f2340"/>
    <path d="M31 60 h38 a8 8 0 0 1 8 8 v22 a12 12 0 0 1 -12 12 h-30 a12 12 0 0 1 -12 -12 v-22 a8 8 0 0 1 8 -8 z" fill="url(#sm-body)"/>
    <path d="M36 63 h28 v4 h-28 z" fill="#c9a05a" opacity="0.75"/>
    <path d="M38 72 h24 v14 a6 6 0 0 1 -6 6 h-12 a6 6 0 0 1 -6 -6 z" fill="#1c1f38"/>
    <circle cx="50" cy="81" r="6" fill="#463163"/>
    <circle cx="50" cy="81" r="3" fill="#b79ae0"/>
    <rect x="44" y="43" width="12" height="9" rx="2" fill="#1f2340"/>
    <path d="M50 8 l4 10 h-8 z" fill="#c9a05a" opacity="0.8"/>
    <circle cx="50" cy="30" r="18" fill="url(#sm-helm)"/>
    <ellipse cx="50" cy="29.5" rx="12.5" ry="10.5" fill="#12142b"/>
    <path d="M41.5 24.5 a13 9 0 0 1 13.5 -2.5" stroke="#cdd0f0" stroke-width="2.2" fill="none" stroke-linecap="round" opacity="0.8"/>
    <path d="M31 60 h38" stroke="#1c1f38" stroke-width="1.4" fill="none"/>
  </svg>`,
});

/* ------------------------------------------------------------------ copy */

const HEADLINE = "HERE BEGINS YOUR INTERSTELLAR JOURNEY";
const SUBTITLE = "Beyond Earth, evolution is survival.";
const MYTHOLOGY =
  "Humanity has crossed the boundaries of its known universe. Beyond Earth, " +
  "advanced technology defines the civilizations that survive and thrive. " +
  "Equip yourself for the journey ahead.";

const PROTOCOLS = [
  "Each suit discounts one eligible property purchase.",
  "Use the discount on any eligible property during your circuit.",
  "The discount does not expire when a turn ends.",
  "The suit expires after one full circuit, from Outer Space and back to Outer Space.",
  "A used discount is consumed immediately.",
  "An unused suit expires at the circuit's end, with a notice.",
  "The discount applies to the purchase price only - not rent, upgrades or fees.",
  "One suit at a time. Discounts cannot be stacked.",
];

/** Which suit's notice this visit has already shown, so a repaint cannot
    bring it back after the player has read it. One key per visit. */
let noticeDismissed = null;

/* ------------------------------------------------------------------ cards */

/** One suit card: art, name, descriptor, meta, price, and its press. */
function suitCard(suit, { mine, money }) {
  const affordable = (money || 0) >= suit.price;
  return el("article", { class: "space-suit", "data-suit": suit.id }, [
    el("span", { class: "space-suit__art", html: SUIT_ART[suit.id] || "" }),
    el("div", { class: "space-suit__info" }, [
      el("h4", { class: "space-suit__name", text: suit.name }),
      el("p", { class: "space-suit__descriptor", text: suit.descriptor }),
      el("div", { class: "space-suit__meta" }, [
        el("span", { class: "space-suit__off", text: `${suit.discount}% OFF` }),
        el("span", { class: "space-suit__tier", text: suit.tier }),
      ]),
      el("p", { class: "space-suit__price", text: rupees(suit.price) }),
      el("button", {
        type: "button",
        class: "chest-card__draw space-suit__buy",
        "data-action": "acquire",
        "data-suit": suit.id,
        disabled: !mine || !affordable,
        "aria-disabled": String(!mine || !affordable),
        text: affordable ? "Acquire suit" : "Insufficient funds",
      }),
    ]),
  ]);
}

/** The selection: header, the three stacked cards, the protocols, the leave. */
function selectionContent(space, { mine, money }) {
  return [
    el("header", { class: "space-card__head" }, [
      el("p", { class: "space-card__eyebrow", text: "Outer Space" }),
      el("h3", { class: "space-card__headline", text: HEADLINE }),
      el("p", { class: "space-card__subtitle", text: SUBTITLE }),
      el("p", { class: "space-card__myth", text: MYTHOLOGY }),
    ]),
    el("div", { class: "space-card__suits" }, SUITS.map((suit) => suitCard(suit, { mine, money }))),
    el("section", { class: "space-card__protocols" }, [
      el("h4", { class: "space-card__protocols-name", text: "Mission protocols" }),
      el("ul", { class: "space-card__protocols-list" },
        PROTOCOLS.map((line) => el("li", { text: line }))),
    ]),
    el("div", { class: "space-card__foot" }, [
      el("button", {
        type: "button",
        class: "chest-card__draw space-card__leave",
        "data-action": "continue",
        disabled: !mine,
        "aria-disabled": String(!mine),
        text: "Continue without a suit",
      }),
    ]),
  ];
}

/** The acquisition popup: the suit speaks, and the one CTA ends the visit. */
function acquiredContent(suit, { mine }) {
  const acquired = SUITS.find((entry) => entry.id === suit?.id) || suitById(suit?.id);
  if (!acquired) return [];
  return [
    el("div", { class: "space-popup" }, [
      el("span", { class: "space-popup__art", html: SUIT_ART[acquired.id] || "" }),
      el("h3", { class: "space-popup__title", text: acquired.acquiredTitle }),
      el("p", { class: "space-popup__text", text: acquired.acquiredText }),
      el("button", {
        type: "button",
        class: "chest-card__draw space-popup__cta",
        "data-action": "continue",
        disabled: !mine,
        "aria-disabled": String(!mine),
        text: "Continue journey",
      }),
    ]),
  ];
}

/** The expiry notice: local to this card; its CONTINUE only uncovers the counter. */
function noticeContent(onContinue) {
  const notice = el("div", { class: "space-popup space-popup--notice" }, [
    el("h3", { class: "space-popup__title", text: "Suit expired" }),
    el("p", {
      class: "space-popup__text",
      text: "Your suit's operational window has closed. New frontiers await.",
    }),
    el("button", {
      type: "button",
      class: "chest-card__draw space-popup__cta",
      "data-action": "notice-continue",
      text: "Continue",
    }),
  ]);
  notice.querySelector('[data-action="notice-continue"]').addEventListener("click", () => {
    onContinue();
  });
  return notice;
}

/* ------------------------------------------------------------------ stage */

/**
 * Draw the Outer Space screen from the state.
 *
 * Returns the card it built (so the board can wire the presses), or null
 * when there is nothing to show. The notice, when this visit has one and it
 * has not been read, is what the card opens with; its CONTINUE swaps the
 * card's own contents to the counter underneath, with nothing sent to the
 * server.
 */
export function drawSpaceStage(board, space, { mine = false, money = 0 } = {}) {
  const holder = board.querySelector(".board__card");
  if (!holder || !space) return null;

  resetHolder(holder);
  holder.dataset.cardKind = "space";
  holder.dataset.property = "outer-space";
  board.dataset.property = "outer-space";

  const ctx = { mine, money };
  const card = el("article", { class: "space-card" });
  holder.append(card);
  /* EVERY STAGE UNSHIDES ITS OWN HOLDER. The holder is hidden between cards
     (and starts hidden), and a card appended into a hidden box is a card
     nobody can see - the board's stranded-turn rescue then reads "decision
     with no card" and walks the visit closed, which is what made the counter
     vanish the moment it opened. */
  holder.hidden = false;

  const render = () => {
    if (space.phase === "acquired") {
      card.replaceChildren(...acquiredContent({ id: space.suit }, ctx));
      return;
    }
    card.replaceChildren(...selectionContent(space, ctx));
  };

  const noticeKey = `${space.playerId}:${space.startedAt || 0}`;
  const showNotice = Boolean(space.expiredNotice) && noticeDismissed !== noticeKey;
  if (showNotice) {
    card.replaceChildren(
      ...noticeContent(() => {
        noticeDismissed = noticeKey;
        render();
      }),
    );
  } else {
    render();
  }

  return card;
}
