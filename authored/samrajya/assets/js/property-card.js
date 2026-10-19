/* ==========================================================================
   SAMRAJYA - THE PROPERTY CARD

   What a property says about itself when it is tapped.

   WHERE IT SITS, AND WHY IT IS WRITTEN THAT WAY
   ----------------------------------------------
   The card lives in the rectangle that HALLEY'S COMET, KUIPER BELT and PLUTO
   bound on the left and EARTH 137, ORION'S BELT and EPOCH bound on the right -
   that is, columns two to five of rows two to four. Not the whole middle, and
   not lower down, because the die is already in the lower band and two things
   in one field would be one too many.

   The position is written in cells and lines rather than as a percentage, so it
   lands on the same square at every board size, and the stylesheet is the only
   place that knows where it is. This file draws the card and puts it there.

   THE TURN
   --------
   Appearing, it turns in on its vertical axis. Changing to another property, it
   turns away and back - out to ninety degrees, the content swapped, in from
   the other side - so a change reads as a different card rather than as the
   same card having had its text overwritten. Both are drawn with the Web
   Animations API rather than with CSS classes, because the two halves have to
   happen in order and a class cannot say "and then".

   Nothing here is ever positioned by anything other than absolutely
   positioned boxes, so no card can move the board, and no card can push the
   die out of its band.
   ========================================================================== */

import { el } from "./dom.js";
import { cardArt } from "./cards.js";
import { propertyArt } from "./property-art.js";
import { propertyFor } from "./shared/properties.js";

/** How long a turn takes. Short enough not to wait for, long enough to see. */
const TURN_MS = 320;
const SWAP_MS = 180;

/** Reduce the work for a reader who has asked for less motion. */
function still() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The artwork for a property, or nothing.
 *
 * Two sources, in this order, and the order is the point:
 *
 *   1. `property-art.js` - the drawing written for the board. The ten that were
 *      made for the board's own use come from here.
 *   2. `cardArt` - the ten finished cards' own artwork, borrowed without its
 *      pill or its title, because the card has its own of each.
 *
 * The first source is asked first because it is the one meant for this
 * rectangle. The second is a borrowing, and a borrowing should never win over
 * the thing it borrows for.
 *
 * Only if neither has a drawing does the card fall back to a letter.
 */
function artwork(property) {
  const drawn = propertyArt(property.id);
  if (drawn) return el("div", { class: "property-card__art", html: drawn });

  if (property.art) {
    // The data's paths are "cards/horizontal/moon.svg"; the card module is keyed
    // by the card's own name, which is the same word without the set's path.
    const key = property.art.replace(/^cards\/(?:horizontal|vertical)\//, "").replace(/\.svg$/, "");
    const borrowed = cardArt(key);
    if (borrowed) return el("div", { class: "property-card__art", html: borrowed });
  }

  return null;
}

/** The mark shown where a property has no drawing. */
function monogram(property) {
  return el("div", {
    class: "property-card__art property-card__art--none",
    "aria-hidden": "true",
    text: (property.lines[0] || property.name).slice(0, 1),
  });
}

/** One card, for one property. */
export function propertyCard(property) {
  const isSet = Boolean(property.set);

  return el("article", {
    class: "property-card",
    "data-property": property.id,
    "data-set": property.set || "",
    // The accent is the property's own pill colour, so a card and the tile it
    // came from are unmistakably the same thing.
    style: { "--accent": property.color || "var(--ink)" },
    "aria-live": "polite",
  }, [
    el("div", { class: "property-card__head" }, [
      artwork(property) || monogram(property),
      el("div", { class: "property-card__title" }, [
        // The pill and the name, drawn exactly as the tile draws them: the same
        // colour, the same capitals, the same breaks.
        el("span", { class: "property-card__pill", "aria-hidden": "true" }),
        el("h3", {
          class: "property-card__name",
          html: property.lines
            .map((line) => `<span>${line}</span>`)
            .join(""),
        }),
      ]),
      el("p", { class: "property-card__price" }, [
        el("span", { "aria-hidden": "true", text: "₹" }),
        el("span", { text: String(property.price) }),
      ]),
    ]),

    el("p", {
      class: "property-card__description",
      html: property.description.map((line) => `<span>${line}</span>`).join(""),
    }),

    el("div", { class: "property-card__advantage" }, [
      el("span", { class: "property-card__label", text: "Advantage" }),
      el("p", { class: "property-card__advantage-text", text: property.advantage }),
    ]),

    isSet ? null : el("span", { class: "property-card__noset", hidden: true }),
  ]);
}

/* --------------------------------------------------------------- on the board */

/**
 * Show a property's card on the board, or take the current one away.
 *
 * Returns a promise that settles when the card has finished turning, so a caller
 * can wait for it - and so a check can wait for it too.
 */
export function showCard(board, id) {
  const property = propertyFor(id);
  const holder = board.querySelector(".board__card");
  if (!holder) return Promise.resolve(null);

  // Not a place anybody buys: take the card away and say so by returning null.
  if (!property) {
    holder.hidden = true;
    holder.replaceChildren();
    board.dataset.property = "";
    // A chest card is taller than this one. Leaving the flag behind would make
    // the NEXT property card open in the chest's rectangle, which is the kind of
    // thing that only shows up on the square after the one you were looking at.
    delete holder.dataset.cardKind;
    return Promise.resolve(null);
  }

  const turning = holder.dataset.property && holder.dataset.property !== id;
  board.dataset.property = id;

  if (still()) {
    holder.replaceChildren(propertyCard(property));
    holder.hidden = false;
    holder.dataset.property = id;
    holder.dataset.cardKind = "property";
    return Promise.resolve(property);
  }

  // Already showing the right one: nothing to do.
  if (!turning && holder.dataset.property === id && !holder.firstElementChild) {
    holder.replaceChildren(propertyCard(property));
  }
  if (!turning && holder.firstElementChild) return Promise.resolve(property);

  const swap = () => {
    holder.replaceChildren(propertyCard(property));
    holder.hidden = false;
    holder.dataset.property = id;
    // Said on every swap rather than cleared when a chest goes away. A chest
    // card is taller than a property card, and the height lives on this holder -
    // so leaving "chest" behind when a property card arrives kept the tall
    // rectangle, and the property card hung 137px into the rows below the die.
    holder.dataset.cardKind = "property";
  };

  if (!turning) {
    // Appearing for the first time: turn in from the left.
    swap();
    return holder
      .animate(
        [
          { transform: "rotateY(-88deg)", opacity: 0 },
          { transform: "rotateY(0deg)", opacity: 1 },
        ],
        { duration: TURN_MS, easing: "cubic-bezier(.22,.7,.3,1)", fill: "both" },
      )
      .finished.then(() => property);
  }

  // Changing property: away, swap, and back from the other side.
  return holder
    .animate(
      [
        { transform: "rotateY(0deg)", opacity: 1 },
        { transform: "rotateY(88deg)", opacity: 0 },
      ],
      { duration: SWAP_MS, easing: "ease-in", fill: "both" },
    )
    .finished.then(() => {
      swap();
      return holder
        .animate(
          [
            { transform: "rotateY(-88deg)", opacity: 0 },
            { transform: "rotateY(0deg)", opacity: 1 },
          ],
          { duration: TURN_MS, easing: "cubic-bezier(.22,.7,.3,1)", fill: "both" },
        )
        .finished;
    })
    .then(() => property);
}

/** Take the card away. */
export function hideCard(board) {
  const holder = board.querySelector(".board__card");
  if (!holder) return Promise.resolve();
  board.dataset.property = "";
  holder.replaceChildren();
  holder.hidden = true;
  delete holder.dataset.cardKind;
  return Promise.resolve();
}