/* ==========================================================================
   SAMRAJYA - THE NEXUS

   A full-middle card for the Nexus tile. It is not a property: there is nothing
   to buy, only a choice between a fixed offering and a random draw from thirty
   cards. The card uses the whole middle, floats a figure of the Unnamed Keeper
   above the text, and keeps the tone reverent and spare.

   TWO MODES
   ---------
   `drawable: true`  the player has landed here and may pray or draw.
   `drawable: false` the tile was tapped for reading; the actions are disabled.

   The card closes itself after the result is shown, the same way a chest does.
   ========================================================================== */

import { el } from "./dom.js";
import { NEXUS_CARDS, NEXUS_PRAY_COST } from "./shared/nexus-cards.js";
import { rupees } from "./shared/economy.js";

/** How long the drawn card takes to settle before the card closes. */
const RESULT_MS = 2200;
/** How long the coin flies on a prayer. */
const FLY_MS = 620;

function still() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** The provided image of the Unnamed Keeper. */
function godFigure() {
  return el("img", {
    class: "nexus-card__god",
    src: "assets/img/god.png",
    alt: "He Who Must Not Be Named",
    draggable: "false",
  });
}

const MYTHOLOGY = [
  "He is not named in any scripture, yet every scripture owes him its silence.",
  "They call him the Unnamed Keeper, the one who holds the thread from which every colony, every empire, and every roll of the dice is suspended.",
  "Before the first board was carved, he was already watching.",
  "He does not play, but without his stillness the game would scatter like dust.",
  "Kings have offered him temples; priests have swept his floors for a thousand years.",
  "He asks nothing, yet everything given to his upkeep returns to the balance of the board.",
  "Some say he is the silence between turns, the breath before the die is thrown.",
  "Approach him with reverence, or do not approach him at all.",
];

function nexusCard({ drawable = false } = {}) {
  return el("article", {
    class: "property-card nexus-card",
    "data-property": "nexus",
    "data-chest": "nexus",
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

    el("div", { class: "nexus-card__figure-wrap" }, [godFigure()]),

    el("h3", { class: "nexus-card__title", text: "He Who Must Not Be Named" }),

    el("p", { class: "nexus-card__mythology" },
      MYTHOLOGY.map((sentence) => el("span", { text: sentence })),
    ),

    el("div", { class: "nexus-card__actions" }, [
      el("button", {
        type: "button",
        class: "nexus-card__pray",
        "data-action": "pray",
        disabled: !drawable,
        "aria-disabled": String(!drawable),
        title: drawable ? "Contribute to the upkeep of the sacred places" : "Only when you land here",
      }, [
        el("span", { class: "nexus-card__action-name", text: "Pray" }),
        el("span", { class: "nexus-card__action-note", text: `Tend the temples • ${rupees(NEXUS_PRAY_COST)}` }),
      ]),
      el("button", {
        type: "button",
        class: "nexus-card__draw",
        "data-action": "draw",
        disabled: !drawable,
        "aria-disabled": String(!drawable),
        title: drawable ? "Draw one of thirty cards" : "Only when you land here",
      }, [
        el("span", { class: "nexus-card__action-name", text: "Take My Chances" }),
        el("span", { class: "nexus-card__action-note", text: "Draw a card" }),
      ]),
    ]),

    el("div", { class: "nexus-card__result", hidden: true }),
  ]);
}

/** Fly a single coin from the active player's chip to the Nexus tile. */
async function flyOffering(board, { from }) {
  if (!board || !from || still()) return;
  const holder = board.querySelector(".board__card");
  const start = from.getBoundingClientRect();
  const end = holder ? holder.getBoundingClientRect() : null;
  if (!end) return;

  const dot = el("span", { class: "nexus-card__offering", "aria-hidden": "true", text: "\u20b9" });
  document.body.append(dot);
  const size = Math.max(14, Math.min(22, end.width * 0.08));
  dot.style.width = `${size}px`;
  dot.style.height = `${size}px`;
  dot.style.left = `${start.left + start.width / 2 - size / 2}px`;
  dot.style.top = `${start.top + start.height / 2 - size / 2}px`;

  await dot
    .animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        {
          transform:
            `translate(${end.left + end.width / 2 - (start.left + start.width / 2)}px, ` +
            `${end.top + end.height / 2 - (start.top + start.height / 2)}px) scale(0.35)`,
          opacity: 0.7,
        },
      ],
      { duration: FLY_MS, easing: "cubic-bezier(.4,.1,.2,1)", fill: "forwards" },
    )
    .finished.catch(() => {});
  dot.remove();
}

/**
 * Show the Nexus card and resolve the player's choice.
 *
 * `pray` and `draw` are async functions that perform the server action and
 * return the resulting event. `onClose` is called when the card dismisses.
 */
export async function showNexus(
  board,
  { drawable = false, pray = null, draw = null, chip = null, onClose = null } = {},
) {
  const holder = board.querySelector(".board__card");
  if (!holder) return null;

  board.dataset.property = "nexus";
  holder.replaceChildren(nexusCard({ drawable }));
  holder.hidden = false;
  holder.dataset.property = "nexus";
  holder.dataset.cardKind = "chest";

  const card = holder.firstElementChild;

  if (!drawable) {
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
    return { resolved: true };
  }

  const result = card.querySelector(".nexus-card__result");
  const prayBtn = card.querySelector('[data-action="pray"]');
  const drawBtn = card.querySelector('[data-action="draw"]');

  const outcome = await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    prayBtn.addEventListener("click", async () => {
      prayBtn.disabled = true;
      drawBtn.disabled = true;
      await flyOffering(board, { from: chip });
      const event = typeof pray === "function" ? await pray() : null;
      finish({ kind: "pray", event });
    }, { once: true });

    drawBtn.addEventListener("click", async () => {
      prayBtn.disabled = true;
      drawBtn.disabled = true;
      const event = typeof draw === "function" ? await draw() : null;
      finish({ kind: "draw", event });
    }, { once: true });
  });

  // Show the result before closing: what the offering bought, or what the
  // card revealed.
  result.hidden = false;
  if (outcome.kind === "pray") {
    result.replaceChildren(
      el("p", { class: "nexus-card__result-name", text: "Your offering is received" }),
      el("p", { class: "nexus-card__result-text", text: "The temples are tended, the lamps are lit, and the silence holds." }),
      el("p", { class: "nexus-card__result-amount nexus-card__result-amount--spend", text: `\u2212${rupees(NEXUS_PRAY_COST)}` }),
    );
  } else {
    const cardData = outcome.event?.card || NEXUS_CARDS[0];
    const tone = cardData.amount < 0 ? "spend" : "earn";
    result.replaceChildren(
      el("p", { class: "nexus-card__result-name", text: cardData.name }),
      el("p", { class: "nexus-card__result-text", text: cardData.text }),
      el("p", { class: `nexus-card__result-amount nexus-card__result-amount--${tone}`, text: `${cardData.amount < 0 ? "\u2212" : "+"}${rupees(Math.abs(cardData.amount))}` }),
    );
  }

  result.animate([{ opacity: 0 }, { opacity: 1 }], { duration: still() ? 1 : 280, fill: "both" });
  await wait(RESULT_MS);

  if (typeof onClose === "function") await onClose();
  holder.hidden = true;
  holder.replaceChildren();
  holder.dataset.property = "";
  delete holder.dataset.cardKind;
  board.dataset.property = "";
  return { ...outcome, resolved: true };
}
