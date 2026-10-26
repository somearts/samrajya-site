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
import { settled } from "./motion.js";
import { resetHolder } from "./board-fx.js";
import { NEXUS_CARDS, NEXUS_KEEPER, NEXUS_PRAY_COST } from "./shared/nexus-cards.js";
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
    alt: NEXUS_KEEPER.title,
    draggable: "false",
  });
}

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

    el("h3", { class: "nexus-card__title", text: NEXUS_KEEPER.title }),

    el("p", { class: "nexus-card__tagline", text: NEXUS_KEEPER.tagline }),

    el("p", { class: "nexus-card__mythology" },
      NEXUS_KEEPER.mythology.map((sentence) => el("span", { text: sentence })),
    ),

    el("div", { class: "nexus-card__actions" }, [
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

  await settled(
    dot
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
      .finished,
    FLY_MS + 150,
  );
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

  /* THE HOLDER IS PUT RIGHT BEFORE THE CARD IS DRAWN.

     The holder is one box for every card, and the card that slid away before
     this one left it at `opacity: 0`. A Nexus card drawn inside that is a card
     that is in the page, has a rectangle, and paints nothing - a keeper nobody
     can see, and two buttons nobody can press. The board looks frozen, because
     it is: the player is being asked a question that has no visible answer. */
  resetHolder(holder);

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

  /* A REFUSAL IS NOT AN ANSWER.

     When the server refuses the offering - the turn has moved on, the visit was
     already made, the network answered with a refusal - nothing happened. The
     card used to close anyway, which left the board in DECISION with no card
     and no die: a game that could only be restarted by reloading the page.

     So a refusal keeps the card up and puts the buttons back. The player is
     still at the Nexus and still has something to press. The board's own
     announcement says why, in the middle, exactly as it does for a refused
     purchase. */
  const outcome = await new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };

    /* THE CARD ALWAYS ANSWERS.

       Whatever happens when the player presses a button - the network drops,
       the action is refused, the animation throws - the card has to come back
       to a state the player can act on. A promise that never settles is a
       board that is locked for the rest of the game, and a card that never
       closes is a card nobody can get rid of. */
    prayBtn.addEventListener("click", async () => {
      prayBtn.disabled = true;
      drawBtn.disabled = true;
      try {
        await flyOffering(board, { from: chip });
        const event = typeof pray === "function" ? await pray() : null;
        if (!event) {
          // Nothing happened. The card stays, the buttons come back.
          prayBtn.disabled = false;
          drawBtn.disabled = false;
          result.hidden = true;
          return;
        }
        finish({ kind: "pray", event });
      } catch {
        prayBtn.disabled = false;
        drawBtn.disabled = false;
        result.hidden = true;
      }
    });

    drawBtn.addEventListener("click", async () => {
      prayBtn.disabled = true;
      drawBtn.disabled = true;
      try {
        const event = typeof draw === "function" ? await draw() : null;
        if (!event) {
          drawBtn.disabled = false;
          prayBtn.disabled = false;
          result.hidden = true;
          return;
        }
        finish({ kind: "draw", event });
      } catch {
        drawBtn.disabled = false;
        prayBtn.disabled = false;
        result.hidden = true;
      }
    });
  });

  // Show the result before closing: what the offering bought, or what the
  // card revealed. If the action did not happen - the network dropped, the
  // turn had moved on - the card says so rather than inventing an answer.
  result.hidden = false;
  if (outcome.kind === "pray") {
    const took = Boolean(outcome.event);
    result.replaceChildren(
      el("p", {
        class: "nexus-card__result-name",
        text: took ? "Your offering is received" : NEXUS_KEEPER.refusal.name,
      }),
      el("p", {
        class: "nexus-card__result-text",
        text: took
          ? "The temples are tended, the lamps are lit, and the silence holds."
          : NEXUS_KEEPER.refusal.text,
      }),
      took
        ? el("p", {
            class: "nexus-card__result-amount nexus-card__result-amount--spend",
            text: `\u2212${rupees(NEXUS_PRAY_COST)}`,
          })
        : el("p", { class: "nexus-card__result-amount", text: "" }),
    );
  } else {
    const cardData = outcome.event?.card || null;
    if (!cardData) {
      result.replaceChildren(
        el("p", { class: "nexus-card__result-name", text: NEXUS_KEEPER.noCard.name }),
        el("p", {
          class: "nexus-card__result-text",
          text: NEXUS_KEEPER.noCard.text,
        }),
        el("p", { class: "nexus-card__result-amount", text: "" }),
      );
    } else {
      const tone = cardData.amount < 0 ? "spend" : "earn";
      result.replaceChildren(
        el("p", { class: "nexus-card__result-name", text: cardData.name }),
        el("p", { class: "nexus-card__result-text", text: cardData.text }),
        el("p", { class: `nexus-card__result-amount nexus-card__result-amount--${tone}`, text: `${cardData.amount < 0 ? "\u2212" : "+"}${rupees(Math.abs(cardData.amount))}` }),
      );
    }
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
