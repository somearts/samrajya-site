/* ==========================================================================
   SAMRAJYA - THE PLAIN SQUARE

   A read-only card for the squares that have no other card of their own: the
   four corners, and the two chests whose purpose has not been decided yet.

   WHY IT EXISTS
   -------------
   Every one of the twenty-eight squares can be pressed, and every one of them
   puts something in the middle of the board. A square that took a tap and did
   nothing was a square that looked broken, and a player who has learned that
   some squares answer and some do not stops trusting the whole board.

   So the corners and the quiet chests get a card too. It is the smallest card
   in the game: a name, a line about what the square is, and a way to close it.
   It offers nothing, because there is nothing to offer - it is a thing to read,
   not a thing to act on.

   THE COPY
   --------
   One line about the square, and one about what happens there. Nothing is
   invented: a corner cannot be owned, Start pays the lap, and a chest with no
   purpose says so rather than promising something.
   ========================================================================== */

import { el } from "./dom.js";

/** What each of these squares is, in two lines. */
const COPY = {
  start: {
    kind: "A corner",
    lines: [
      "Every lap begins and ends here.",
      "Crossing it pays the player ₹200 for the lap.",
    ],
  },
  "outer-space": {
    kind: "A corner",
    lines: [
      "The edge of the board, and nothing beyond it.",
      "This square cannot be owned.",
    ],
  },
  "black-hole": {
    kind: "A corner",
    lines: [
      "Where the light stops and the board stops with it.",
      "Landing here holds you: gather entropy across your turns to earn an escape, or buy a Relativistic Escape Vessel for ₹500 and go at once. Holding Event Horizon halves what you need.",
    ],
  },
  fight: {
    kind: "A corner",
    lines: [
      "Where the empires meet.",
      "This square cannot be owned.",
    ],
  },
  epoch: {
    kind: "A chest",
    lines: [
      "A chest on the board, and nothing has been decided to come out of it yet.",
      "The tile says nothing, and so does this card.",
    ],
  },
  kronos: {
    kind: "A chest",
    lines: [
      "The shield-circle. Draw once per visit: the shield deploys the moment it is drawn and stands for two of your own turns.",
      "It answers one weapon and no other - tap the chest to see the three.",
    ],
  },
};

/**
 * The card for one of these squares.
 *
 * `cell` is the square's own record: its id, its name and the lines its name
 * is broken across. `onClose` is called when the reader dismisses the card.
 */
export function squareCard(cell, { onClose = null } = {}) {
  const copy = COPY[cell?.id] || {
    kind: "A square",
    lines: ["This square cannot be owned."],
  };

  const card = el(
    "article",
    {
      class: "property-card square-card",
      "data-property": cell.id,
      "data-square": cell.id,
      style: { "--accent": "var(--ink)" },
      "aria-live": "polite",
    },
    [
      el("button", {
        type: "button",
        class: "property-card__close",
        "aria-label": "Close",
        title: "Close",
        "data-action": "close",
        text: "\u00d7",
      }),

      el("div", { class: "property-card__head" }, [
        el("div", { class: "property-card__title" }, [
          el("span", { class: "property-card__pill", "aria-hidden": "true" }),
          el(
            "h3",
            {
              class: "property-card__name",
              html: (cell.lines || [cell.name])
                .map((line) => `<span>${line}</span>`)
                .join(""),
            },
          ),
        ]),
      ]),

      el("p", { class: "square-card__kind", text: copy.kind }),

      el("p", { class: "square-card__body" },
        copy.lines.map((line) => el("span", { text: line })),
      ),
    ],
  );

  const close = card.querySelector('[data-action="close"]');
  if (close) {
    close.addEventListener("click", () => {
      if (typeof onClose === "function") onClose();
    });
  }

  return card;
}
