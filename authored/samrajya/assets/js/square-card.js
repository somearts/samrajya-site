/* ==========================================================================
   SAMRAJYA - THE PLAIN SQUARE AND THE CORNER PANELS

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

   THE CORNER PANELS
   -----------------
   The four corner tiles - START, OUTER SPACE, BLACK HOLE and FIGHT - each open
   their own information panel when tapped. Each panel shares one layout: a
   logo, a heading, a subtitle, a short description, and one key fact drawn out
   in a box. The panels sit in the central hole of the board, sized to the same
   four-by-eight cell rectangle on every screen.

   Only the inspection UI changes here. Landing on a corner, its rules, and its
   effect on the turn are untouched.
   ========================================================================== */

import { el } from "./dom.js";
import { cornerMark } from "./corner-art.js";

/** What each of the quiet chests is, in two lines. */
const CHEST_COPY = {
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

/** One corner panel each. The accent colour is the corner tile's own stamp. */
const CORNER_PANEL = {
  start: {
    accent: "var(--corner-start)",
    heading: "START",
    subtitle: "THE LAUNCH TILE",
    description:
      "Begin your journey across worlds, timelines, and lost civilizations.",
    keyLabel: "Cross START and receive",
    keyValue: "₹200 for the lap.",
    mark: cornerMark("start"),
  },
  "outer-space": {
    accent: "var(--corner-outer-space)",
    heading: "OUTER SPACE",
    subtitle: "THE EDGE OF KNOWN",
    description:
      "The gateway beyond the board. Here you can acquire a Suit, prepare for the cycle, and seek an advantage.",
    keyLabel: "Land here to",
    keyValue: "choose a Suit.",
    mark: cornerMark("space"),
  },
  "black-hole": {
    accent: "var(--corner-black-hole)",
    heading: "BLACK HOLE",
    subtitle: "THE WOUND IN KAALCHAKRA",
    description:
      "A gravity of its own. Land here and you are pulled out of play — trapped until you find a way to break free.",
    keyLabel: "Land here and face",
    keyValue: "the Black Hole's setback.",
    mark: cornerMark("hole"),
  },
  fight: {
    accent: "var(--corner-fight)",
    heading: "FIGHT",
    subtitle: "THE ARENA",
    description:
      "Where empires collide. Land here to challenge your opponent and test your strength, strategy, or fortune.",
    keyLabel: "Trigger a",
    keyValue: "Fight challenge.",
    mark: cornerMark("fight"),
  },
};

/**
 * The card for one of the quiet chests.
 *
 * `cell` is the square's own record: its id, its name and the lines its name
 * is broken across. `onClose` is called when the reader dismisses the card.
 */
export function squareCard(cell, { onClose = null } = {}) {
  const copy = CHEST_COPY[cell?.id] || {
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

/**
 * The information panel for one corner tile.
 *
 * All four corners share one layout: logo, heading, subtitle, description and
 * one key fact. The panel fills the central hole of the board - four cells by
   eight - so nothing is cramped and nothing spills into the ring. `onClose` is
 * called when the reader dismisses the panel.
 */
export function cornerCard(cell, { onClose = null } = {}) {
  const panel = CORNER_PANEL[cell?.id];
  if (!panel) return null;

  const card = el(
    "article",
    {
      class: "corner-card",
      "data-corner": cell.id,
      style: { "--accent": panel.accent },
      "aria-live": "polite",
    },
    [
      el("button", {
        type: "button",
        class: "corner-card__close",
        "aria-label": "Close",
        "data-action": "close",
        text: "\u00d7",
      }),

      el("div", { class: "corner-card__logo", html: panel.mark }),

      el("h2", { class: "corner-card__heading", text: panel.heading }),

      el("p", { class: "corner-card__subtitle", text: panel.subtitle }),

      el("div", { class: "corner-card__divider" }),

      el("p", { class: "corner-card__description", text: panel.description }),

      el("div", { class: "corner-card__key" }, [
        el("span", { class: "corner-card__key-icon" }),
        el("div", { class: "corner-card__key-text" }, [
          el("span", { class: "corner-card__key-label", text: panel.keyLabel }),
          el("span", { class: "corner-card__key-value", text: panel.keyValue }),
        ]),
      ]),
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
