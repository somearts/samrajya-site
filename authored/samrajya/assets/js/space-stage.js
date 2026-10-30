/* ==========================================================================
   SAMRAJYA - OUTER SPACE, THE INTERSTELLAR COUNTER

   A SHARED screen, drawn from the state the way the chests, the fight, Epoch
   and the Black Hole panel are: `game.space` is the whole truth about it -
   which seat is at the counter, whether the suits are being chosen or the
   acquisition popup is speaking, and which suit was retired by this
   arrival. Every device draws the middle from that fact, so a phone that
   reconnects or joined late shows exactly the same journey.

   THE LOOK: CLASSIFIED TECHNOLOGY, NOT A SHOP. An obsidian panel over the
   cream board - charcoal suit cards with hairline silver borders, silver
   caps, steel secondary text, one controlled indigo for energy. The artwork
   is the argument: three engineered suit concepts drawn as refined vector
   concepts inside their own dark display case - angular plating, visor
   slits, restrained highlights - progressing from sleek steel (Tier I)
   through layered photonic lamellae (Tier II) to the heavy indigo-cored
   mantle (Tier III). No cartoon proportions, no faces, no badges.

   THREE SHAPES, ONE CARD, PORTRAIT STACK:

   1. THE EXPIRY NOTICE - shown first when the arriving seat was still
      carrying a suit whose discount was never spent. Its CONTINUE is local:
      it takes the notice down and reveals the counter underneath, with no
      action sent anywhere.

   2. THE SELECTION - the section label, headline and subtitle, then the
      three portrait suit cards stacked in one column: artwork, name, one
      price line, ACQUIRE. Compact enough that a normal phone fits all
      three without scrolling; a single scroll is the fallback on short
      boards. The secondary exit sits right-set at the foot.

   3. THE ACQUISITION POPUP - the suit, its narrative and the one CTA,
      CONTINUE JOURNEY, which the board wires to the same `continue` that
      ends every visit.

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

   One frame, one stance, one light: every suit is drawn front-on inside the
   same dark display case at 100x132 portrait, lit from the upper left, so
   the row reads as one issued set. The tiers differ by construction, not
   by colour games - plate count, edge language, silhouette weight - and
   the palette stays noir: muted steel, gunmetal, silver trim, indigo
   glass and indigo energy, never literal bright metal. */

const SUIT_ART = Object.freeze({
  "quantum-one": `<svg viewBox="0 0 100 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="q1-case" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#23262f"/>
        <stop offset="1" stop-color="#13151b"/>
      </linearGradient>
      <linearGradient id="q1-plate" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#aeb6c2"/>
        <stop offset="0.5" stop-color="#78818e"/>
        <stop offset="1" stop-color="#474e59"/>
      </linearGradient>
      <linearGradient id="q1-side" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#59616e"/>
        <stop offset="1" stop-color="#8a93a1"/>
      </linearGradient>
      <linearGradient id="q1-visor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2b3454"/>
        <stop offset="1" stop-color="#111422"/>
      </linearGradient>
      <radialGradient id="q1-core">
        <stop offset="0" stop-color="#aab6f2"/>
        <stop offset="1" stop-color="#4d56a8"/>
      </radialGradient>
    </defs>
    <rect x="10" y="3" width="80" height="126" rx="5" fill="url(#q1-case)" stroke="#ffffff" stroke-opacity="0.07" stroke-width="0.8"/>
    <ellipse cx="50" cy="124" rx="20" ry="3.2" fill="#000000" opacity="0.5"/>
    <path d="M41.5 81 h7.5 l-.8 30 h-7.5 z" fill="url(#q1-plate)"/>
    <path d="M51 81 h7.5 l.8 30 h-7.5 z" fill="url(#q1-plate)"/>
    <rect x="40.6" y="95" width="8" height="1.2" fill="#cdd6e1" opacity="0.4"/>
    <rect x="51.4" y="95" width="8" height="1.2" fill="#cdd6e1" opacity="0.4"/>
    <rect x="38.5" y="111" width="11" height="6" rx="1" fill="#2f3541"/>
    <rect x="37.5" y="116" width="13" height="5" rx="1.5" fill="#262c36"/>
    <rect x="50.5" y="111" width="11" height="6" rx="1" fill="#2f3541"/>
    <rect x="49.5" y="116" width="13" height="5" rx="1.5" fill="#262c36"/>
    <path d="M37 75 h26 v5 q0 2 -2 2 h-22 q-2 0 -2 -2 z" fill="url(#q1-side)"/>
    <path d="M31 51 q1 -8 9 -8 h20 q8 0 9 8 l-2 19 q-.6 6 -6.5 6 h-21 q-5.9 0 -6.5 -6 z" fill="url(#q1-plate)"/>
    <rect x="47.5" y="44.5" width="5" height="24" rx="1.5" fill="#262b35"/>
    <circle cx="50" cy="52" r="3.6" fill="url(#q1-core)"/>
    <circle cx="50" cy="52" r="4.9" fill="none" stroke="#b9c4d6" stroke-width="0.7" opacity="0.5"/>
    <path d="M36 59 h9.5 M54.5 59 h9.5" stroke="#cdd6e1" stroke-width="1" opacity="0.4"/>
    <path d="M23 47 l11 -4 l2.5 9.5 l-10 3.5 z" fill="url(#q1-side)"/>
    <path d="M77 47 l-11 -4 l-2.5 9.5 l10 3.5 z" fill="url(#q1-side)"/>
    <rect x="23.5" y="51" width="8.5" height="27" rx="3.5" fill="url(#q1-side)"/>
    <rect x="68" y="51" width="8.5" height="27" rx="3.5" fill="url(#q1-side)"/>
    <rect x="23.5" y="63" width="8.5" height="1" fill="#cdd6e1" opacity="0.35"/>
    <rect x="68" y="63" width="8.5" height="1" fill="#cdd6e1" opacity="0.35"/>
    <rect x="23" y="76" width="9" height="7.5" rx="2.5" fill="#2b313c"/>
    <rect x="68" y="76" width="9" height="7.5" rx="2.5" fill="#2b313c"/>
    <rect x="43.5" y="40" width="13" height="6" rx="1.5" fill="#2e3440"/>
    <path d="M50 13 c8.5 0 13.5 6.5 13.5 14.5 c0 8.5 -6 14.5 -13.5 14.5 s-13.5 -6 -13.5 -14.5 c0 -8 5 -14.5 13.5 -14.5 z" fill="url(#q1-plate)"/>
    <path d="M50 14.5 v6" stroke="#d5dce6" stroke-width="1" opacity="0.6"/>
    <path d="M39.5 25 q10.5 -4.5 21 0 l-1.6 7.2 q-9 3.8 -17.8 0 z" fill="url(#q1-visor)" stroke="#cfd8e2" stroke-width="0.7" stroke-opacity="0.5"/>
    <path d="M42 26.5 q8 -3 16 0" stroke="#a9b6ef" stroke-width="1.2" fill="none" opacity="0.75"/>
  </svg>`,

  "photon-weave": `<svg viewBox="0 0 100 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="pw-case" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#242731"/>
        <stop offset="1" stop-color="#13151b"/>
      </linearGradient>
      <linearGradient id="pw-plate" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#d3dbe6"/>
        <stop offset="0.5" stop-color="#99a2ae"/>
        <stop offset="1" stop-color="#5c6470"/>
      </linearGradient>
      <linearGradient id="pw-side" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#666e7b"/>
        <stop offset="1" stop-color="#a6afbb"/>
      </linearGradient>
      <linearGradient id="pw-visor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2e3860"/>
        <stop offset="1" stop-color="#101426"/>
      </linearGradient>
    </defs>
    <rect x="10" y="3" width="80" height="126" rx="5" fill="url(#pw-case)" stroke="#ffffff" stroke-opacity="0.07" stroke-width="0.8"/>
    <ellipse cx="50" cy="124" rx="20" ry="3.2" fill="#000000" opacity="0.5"/>
    <path d="M41.5 81 h7.5 l-.8 30 h-7.5 z" fill="url(#pw-plate)"/>
    <path d="M51 81 h7.5 l.8 30 h-7.5 z" fill="url(#pw-plate)"/>
    <rect x="40.6" y="86" width="7.5" height="1.1" fill="#e4eaf2" opacity="0.5"/>
    <rect x="51.4" y="86" width="7.5" height="1.1" fill="#e4eaf2" opacity="0.5"/>
    <rect x="40.6" y="96" width="7.5" height="1.1" fill="#e4eaf2" opacity="0.4"/>
    <rect x="51.4" y="96" width="7.5" height="1.1" fill="#e4eaf2" opacity="0.4"/>
    <rect x="38.5" y="111" width="11" height="6" rx="1" fill="#333944"/>
    <rect x="37.5" y="116" width="13" height="5" rx="1.5" fill="#282e38"/>
    <rect x="50.5" y="111" width="11" height="6" rx="1" fill="#333944"/>
    <rect x="49.5" y="116" width="13" height="5" rx="1.5" fill="#282e38"/>
    <path d="M37 75 h26 v5 q0 2 -2 2 h-22 q-2 0 -2 -2 z" fill="url(#pw-side)"/>
    <path d="M31 51 q1 -8 9 -8 h20 q8 0 9 8 l-2 19 q-.6 6 -6.5 6 h-21 q-5.9 0 -6.5 -6 z" fill="url(#pw-plate)"/>
    <rect x="34.5" y="49.5" width="31" height="4.2" rx="1" fill="#dbe3ed" opacity="0.95"/>
    <rect x="35" y="56.5" width="30" height="4.2" rx="1" fill="#c8d1de" opacity="0.9"/>
    <rect x="35.5" y="63.5" width="29" height="4.2" rx="1" fill="#b3bcc9" opacity="0.85"/>
    <rect x="35" y="54.4" width="30" height="1.1" fill="#7d8ad4" opacity="0.85"/>
    <rect x="35" y="61.4" width="30" height="1.1" fill="#7d8ad4" opacity="0.6"/>
    <path d="M22.5 46.5 l11.5 -4.5 l3 10 l-10.5 4 z" fill="url(#pw-side)" stroke="#e8eef5" stroke-width="0.7" stroke-opacity="0.6"/>
    <path d="M77.5 46.5 l-11.5 -4.5 l-3 10 l10.5 4 z" fill="url(#pw-side)" stroke="#e8eef5" stroke-width="0.7" stroke-opacity="0.6"/>
    <rect x="23" y="51" width="9" height="12" rx="3" fill="url(#pw-side)"/>
    <rect x="23.5" y="65" width="8" height="13" rx="3" fill="url(#pw-side)"/>
    <rect x="68" y="51" width="9" height="12" rx="3" fill="url(#pw-side)"/>
    <rect x="68.5" y="65" width="8" height="13" rx="3" fill="url(#pw-side)"/>
    <rect x="23" y="77" width="9" height="7" rx="2.5" fill="#2b313c"/>
    <rect x="68" y="77" width="9" height="7" rx="2.5" fill="#2b313c"/>
    <rect x="43.5" y="40" width="13" height="6" rx="1.5" fill="#2e3440"/>
    <path d="M50 12.5 c8.5 0 13.5 6.5 13.5 14.5 c0 8.5 -6 14.5 -13.5 14.5 s-13.5 -6 -13.5 -14.5 c0 -8 5 -14.5 13.5 -14.5 z" fill="url(#pw-plate)"/>
    <rect x="36.5" y="23" width="3" height="7" rx="1" fill="#171b24"/>
    <rect x="60.5" y="23" width="3" height="7" rx="1" fill="#171b24"/>
    <path d="M50 14 v5.5" stroke="#eef2f7" stroke-width="1" opacity="0.7"/>
    <path d="M39.5 25 q10.5 -4.5 21 0 l-1.6 7.2 q-9 3.8 -17.8 0 z" fill="url(#pw-visor)" stroke="#dfe6ef" stroke-width="0.7" stroke-opacity="0.6"/>
    <path d="M41.5 26.5 q8.5 -3.2 17 0" stroke="#c3ccf2" stroke-width="1.4" fill="none" opacity="0.85"/>
    <path d="M43 31 q7 -2 14 0" stroke="#7d8ad4" stroke-width="0.9" fill="none" opacity="0.7"/>
  </svg>`,

  "singularity-mantle": `<svg viewBox="0 0 100 132" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="sm-case" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#23252f"/>
        <stop offset="1" stop-color="#12141a"/>
      </linearGradient>
      <linearGradient id="sm-plate" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#5b6271"/>
        <stop offset="0.5" stop-color="#3c4250"/>
        <stop offset="1" stop-color="#272b35"/>
      </linearGradient>
      <linearGradient id="sm-mantle" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#3b3866"/>
        <stop offset="1" stop-color="#201e3b"/>
      </linearGradient>
      <linearGradient id="sm-visor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#191d33"/>
        <stop offset="1" stop-color="#0b0d15"/>
      </linearGradient>
      <radialGradient id="sm-core">
        <stop offset="0" stop-color="#a5a2f4"/>
        <stop offset="1" stop-color="#413e9c"/>
      </radialGradient>
    </defs>
    <rect x="10" y="3" width="80" height="126" rx="5" fill="url(#sm-case)" stroke="#ffffff" stroke-opacity="0.07" stroke-width="0.8"/>
    <ellipse cx="50" cy="124" rx="21" ry="3.2" fill="#000000" opacity="0.5"/>
    <path d="M34 43 L19.5 49 L16.5 74 L27.5 70 L30 52 Z" fill="url(#sm-mantle)"/>
    <path d="M66 43 L80.5 49 L83.5 74 L72.5 70 L70 52 Z" fill="url(#sm-mantle)"/>
    <path d="M34 43 L19.5 49 M19.5 49 L16.5 74" stroke="#c9d2e0" stroke-width="1" fill="none" opacity="0.5"/>
    <path d="M66 43 L80.5 49 M80.5 49 L83.5 74" stroke="#c9d2e0" stroke-width="1" fill="none" opacity="0.5"/>
    <path d="M40.5 81 h9 l-1 30 h-9 z" fill="url(#sm-plate)"/>
    <path d="M50.5 81 h9 l1 30 h-9 z" fill="url(#sm-plate)"/>
    <rect x="40" y="88" width="9" height="1.3" fill="#c9d2e0" opacity="0.45"/>
    <rect x="51" y="88" width="9" height="1.3" fill="#c9d2e0" opacity="0.45"/>
    <rect x="38" y="111" width="12" height="6.5" rx="1.5" fill="#2a2e39"/>
    <rect x="37" y="117" width="14" height="4.5" rx="1.5" fill="#20232c"/>
    <rect x="50" y="111" width="12" height="6.5" rx="1.5" fill="#2a2e39"/>
    <rect x="49" y="117" width="14" height="4.5" rx="1.5" fill="#20232c"/>
    <path d="M30 52 q1.5 -9 10 -9.5 h20 q8.5 .5 10 9.5 l-2.5 20 q-.8 6.5 -7 6.5 h-21 q-6.2 0 -7 -6.5 z" fill="url(#sm-plate)"/>
    <circle cx="50" cy="56" r="6.5" fill="#14161f"/>
    <circle cx="50" cy="56" r="4" fill="url(#sm-core)"/>
    <circle cx="50" cy="56" r="7.4" fill="none" stroke="#c9d2e0" stroke-width="0.8" opacity="0.55"/>
    <path d="M40 41 q10 -4 20 0 l-2 5 q-8 -3 -16 0 z" fill="#262340"/>
    <path d="M21 45 l13 -5 l3 11 l-11.5 4.5 z" fill="url(#sm-plate)" stroke="#c9d2e0" stroke-width="0.7" stroke-opacity="0.5"/>
    <path d="M79 45 l-13 -5 l-3 11 l11.5 4.5 z" fill="url(#sm-plate)" stroke="#c9d2e0" stroke-width="0.7" stroke-opacity="0.5"/>
    <rect x="22.5" y="52" width="10" height="27" rx="4" fill="url(#sm-plate)"/>
    <rect x="67.5" y="52" width="10" height="27" rx="4" fill="url(#sm-plate)"/>
    <rect x="22.5" y="64" width="10" height="1.4" fill="#c9d2e0" opacity="0.4"/>
    <rect x="67.5" y="64" width="10" height="1.4" fill="#c9d2e0" opacity="0.4"/>
    <rect x="22" y="77" width="10" height="8" rx="3" fill="#23262f"/>
    <rect x="68" y="77" width="10" height="8" rx="3" fill="#23262f"/>
    <path d="M50 6.5 l3.5 6.5 h-7 z" fill="#c9d2e0" opacity="0.85"/>
    <path d="M50 11 c9.5 0 15 7 15 15.5 c0 9 -6.7 15.5 -15 15.5 s-15 -6.5 -15 -15.5 c0 -8.5 5.5 -15.5 15 -15.5 z" fill="url(#sm-plate)"/>
    <path d="M38.5 24.5 q11.5 -5 23 0 l-1.8 7.8 q-9.8 4.2 -19.4 0 z" fill="url(#sm-visor)" stroke="#c9d2e0" stroke-width="0.7" stroke-opacity="0.55"/>
    <path d="M41.5 26 q9 -3.5 17.5 0" stroke="#b6bcf0" stroke-width="1.3" fill="none" opacity="0.8"/>
  </svg>`,
});

/* ------------------------------------------------------------------ copy */

const HEADLINE = "HERE BEGINS YOUR INTERSTELLAR JOURNEY";
const SUBTITLE = "Beyond Earth, evolution is survival.";

/** Which suit's notice this visit has already shown, so a repaint cannot
    bring it back after the player has read it. One key per visit. */
let noticeDismissed = null;

/* ------------------------------------------------------------------ cards */

/** One portrait suit card: artwork, name, one price line, and its press. */
function suitCard(suit, { mine, money }) {
  const affordable = (money || 0) >= suit.price;
  return el("article", { class: "space-suit", "data-suit": suit.id }, [
    el("span", { class: "space-suit__art", html: SUIT_ART[suit.id] || "" }),
    el("h4", { class: "space-suit__name", text: suit.name }),
    el("p", { class: "space-suit__price" }, [
      el("b", { text: rupees(suit.price) }),
      el("span", { text: ` · ${suit.discount}% discount` }),
    ]),
    el("button", {
      type: "button",
      class: "chest-card__draw space-suit__buy",
      "data-action": "acquire",
      "data-suit": suit.id,
      disabled: !mine || !affordable,
      "aria-disabled": String(!mine || !affordable),
      text: affordable ? "Acquire suit" : "Insufficient funds",
    }),
  ]);
}

/** The selection: compact header, the three stacked portrait cards, the exit. */
function selectionContent(space, { mine, money }) {
  return [
    el("header", { class: "space-card__head" }, [
      el("p", { class: "space-card__eyebrow", text: "Outer Space" }),
      el("h3", { class: "space-card__headline", text: HEADLINE }),
      el("p", { class: "space-card__subtitle", text: SUBTITLE }),
    ]),
    el("div", { class: "space-card__suits" }, SUITS.map((suit) => suitCard(suit, { mine, money }))),
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
