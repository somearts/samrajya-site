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

   THE ECONOMY ON THE CARD
   -----------------------
   The card now carries three things it did not: who holds the square, what it
   charges right now, and the three things that square can be built into.

   It is drawn once and then SYNCED, never redrawn. `syncCard` recomputes every
   number on it from the ledger and writes it into the nodes already on screen.
   Redrawing instead would be simpler to write and wrong to use: a redraw is a
   turn animation, so every purchase would swing the card away and back and the
   upgrade cards would jump - and a player who has bought three times would have
   watched it three times for no reason. The one thing a card must not do while
   you are using it is move.

   Every figure on it is derived at the moment it is written. There is no
   stored price on the card and no remembered rent: the rent line is `rentAt`
   called again, so it cannot be stale by even one purchase.
   ========================================================================== */

import { el } from "./dom.js";
import { cardArt } from "./cards.js";
import { propertyArt } from "./property-art.js";
import { propertyFor } from "./shared/properties.js";
import { upgradesOf, rupees, rupeesBare } from "./shared/economy.js";
import {
  MAX_UPGRADE,
  canBuy,
  canUpgrade,
  levelOf,
  moneyOf,
  nameOfSeat,
  ownerOf,
  rentAt,
} from "./shared/ledger.js";

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
export function propertyCard(property, ctx) {
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

    /* WHO HOLDS IT, AND WHAT IT COSTS RIGHT NOW.

       Both are written by `syncCard` and both are derived at the moment they
       are written. The status line says who; the rent line says what somebody
       landing here would be charged, which is a different number once anybody
       has built anything on it. */
    el("div", { class: "property-card__standing" }, [
      el("p", { class: "property-card__status" }),
      el("p", { class: "property-card__rent" }),
    ]),

    el("p", {
      class: "property-card__description",
      html: property.description.map((line) => `<span>${line}</span>`).join(""),
    }),

    el("div", { class: "property-card__advantage" }, [
      el("span", { class: "property-card__label", text: "Advantage" }),
      el("p", { class: "property-card__advantage-text", text: property.advantage }),
    ]),

    // The Buy button. Drawn here for a square nobody holds and taken away for
    // one somebody does, because there is nothing to buy when it is taken -
    // `syncCard` decides which, and it decides again on every change.
    el("div", { class: "property-card__buy-slot" }, [
      el("button", {
        type: "button",
        class: "property-card__buy",
        onclick: () => ctx?.onBuy?.(),
      }, [
        el("span", { class: "property-card__buy-label" }),
        el("span", { class: "property-card__buy-cost" }),
      ]),
    ]),

    isSet ? null : el("span", { class: "property-card__noset", hidden: true }),
  ]);
}

/* ------------------------------------------------------------- the three builds */

/**
 * The three things a square can become, below the card.
 *
 * Drawn in the chest's own vocabulary - the same inset ground, the same 6px
 * radius, the same hairline, the same type sizes - because they are the same
 * idea as the three weapon cards on a Ragnarok chest: three portrait panels
 * telling you what is on the table and what each one costs.
 *
 * What is deliberately not copied is their arrangement. Those are three columns
 * of a wide card; these are three rows beneath a card that already fills the
 * middle of the board, so they run across the width instead. Same look, same
 * voice, the shape the space actually allows.
 */
function buildCard(property) {
  const steps = upgradesOf(property.id);

  return el("section", { class: "builds", "aria-label": `What ${property.name} can be built into` }, [
    el("p", { class: "builds__label", text: "Build" }),
    ...steps.map((step, n) =>
      el("article", { class: "build", "data-build": String(n + 1) }, [
        el("div", { class: "build__head" }, [
          // The pips first, so a card that is already built says which of the
          // three it is before the name does.
          el("span", { class: "build__step", "aria-hidden": "true" }, [
            el("span", { class: "build__pip" }),
            el("span", { class: "build__pip" }),
            el("span", { class: "build__pip" }),
          ]),
          el("h4", { class: "build__name", text: step.name }),
          el("p", { class: "build__cost" }, [
            el("span", { class: "build__cost-rupee", "aria-hidden": "true", text: "₹" }),
            el("span", { class: "build__cost-figure" }),
          ]),
        ]),

        el("p", { class: "build__description", text: step.description }),

        el("div", { class: "build__foot" }, [
          el("p", { class: "build__becomes" }),
          el("button", {
            type: "button",
            class: "build__button",
          }, [el("span", { class: "build__button-label" })]),
        ]),
      ]),
    ),
  ]);
}

/* ---------------------------------------------------------------------- sync */

/**
 * Put every derived figure on the open card back in step with the ledger.
 *
 * Called after anything changes the game, and safe to call when no card is
 * open - which is most of the time. It writes only text and the `disabled`
 * attribute; it never adds or removes a node except the Buy button, which is
 * the one thing on the card that appears and disappears.
 */
export function syncCard(board, ctx) {
  const holder = board?.querySelector(".board__card");
  const id = holder?.dataset.property;
  const card = holder?.querySelector(".property-card");
  if (!card || !id || holder.dataset.cardKind !== "property") return;

  const { ledger, seat } = ctx || {};
  if (!ledger) return;

  /* --- who holds it, and what it charges --- */

  const owner = ownerOf(ledger, id);
  const level = levelOf(ledger, id);
  const rent = rentAt(ledger, id);

  const status = card.querySelector(".property-card__status");
  status.textContent =
    owner === null
      ? `Unowned • ${rupeesBare(propertyFor(id).price)}`
      : owner === seat
        ? "You own this"
        : `Owned by ${nameOfSeat(ledger, owner)} • Rent ${rupees(rent)}`;

  // The rent line does not repeat the status line. The status says whose square
  // this is; this says what the square is actually worth right now, which is the
  // only number that changes when somebody builds. On a bare square it is the
  // figure nobody can act on yet, and saying so is more useful than repeating it.
  card.querySelector(".property-card__rent").textContent =
    owner === null
      ? `Charges ${rupees(rent)} to whoever takes it`
      : level === 0
        ? `Not built • rent ${rupees(rent)}`
        : `Built ${level} of ${MAX_UPGRADE} • rent ${rupees(rent)}`;

  /* --- the Buy button --- */

  const slot = card.querySelector(".property-card__buy-slot");
  if (owner !== null) {
    // Taken. There is nothing to buy, so the button goes away rather than
    // sitting there greyed out explaining a purchase that cannot happen.
    slot.hidden = true;
    slot.style.display = "none";
  } else {
    const verdict = canBuy(ledger, id, seat);
    const price = propertyFor(id).price;
    const money = moneyOf(ledger, seat);
    const affordable = money >= price;
    slot.hidden = false;
    slot.style.removeProperty("display");

    const button = slot.querySelector(".property-card__buy");
    button.disabled = !verdict.ok;
    button.setAttribute("aria-disabled", String(!verdict.ok));
    slot.querySelector(".property-card__buy-label").textContent =
      affordable ? "Buy" : "Not enough";
    // The shortfall on the button, in the four words that fit on one line of it:
    // the ledger's own sentence ("You need 1190 more to take it") is a useful
    // thing to be able to read, and far too long to be the thing sitting inside a
    // pill two hundred pixels wide, where it wrapped into four ragged lines. It
    // stays, as the button's title, so the reason is still there to be found.
    slot.querySelector(".property-card__buy-cost").textContent = affordable
      ? rupeesBare(price)
      : `${rupees(price - money)} short`;
    button.title = affordable ? `Buy for ${rupees(price)}` : verdict.why;
  }

  /* --- the three builds --- */

  const steps = upgradesOf(id);
  for (const node of holder.querySelectorAll(".build")) {
    const n = Number(node.dataset.build) - 1;
    const step = steps[n];
    const verdict = canUpgrade(ledger, id, seat);

    // The button is enabled for exactly one build: the one the square is ready
    // for. The other two are shown, priced and explained, and are not live -
    // which is what makes the order visible rather than merely enforced.
    const next = level === n && verdict.ok;

    node.dataset.state = next ? "next" : level > n ? "done" : "locked";
    node.querySelector(".build__becomes").textContent = `Rent becomes ${rupees(step.rentAfter)}`;

    const button = node.querySelector(".build__button");
    const label = node.querySelector(".build__button-label");
    button.disabled = !next;
    button.setAttribute("aria-disabled", String(!next));
    label.textContent = next ? "Upgrade" : level > n ? "Built" : "Locked";

    node.querySelector(".build__cost-figure").textContent = String(step.cost);

    // Only the reachable build carries a handler at all. An inert button is not
    // merely disabled for now - there is nothing behind it to become live later
    // without the card being synced, and sync is what puts this back.
    if (next) button.onclick = () => ctx?.onUpgrade?.(n);
    else button.onclick = null;
  }
}

/* --------------------------------------------------------------- on the board */

/**
 * Show a property's card on the board, or take the current one away.
 *
 * Returns a promise that settles when the card has finished turning, so a caller
 * can wait for it - and so a check can wait for it too.
 */
export function showCard(board, id, ctx = null) {
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

  // The card and the three builds together, and both written in one go so the
  // builds can never appear beside an empty card on a slow frame.
  const draw = () => {
    holder.replaceChildren(propertyCard(property, ctx), buildCard(property));
    holder.hidden = false;
    holder.dataset.property = id;
    // Back to the top, every time. The holder is the thing that scrolls, and it
    // keeps its position across a swap - so without this, opening a square after
    // building on the last one showed the new card already scrolled past its own
    // name and price, which is the part the player came to read.
    holder.scrollTop = 0;
    // Said on every swap rather than cleared when a chest goes away. A chest
    // card is taller than a property card, and the height lives on this holder -
    // so leaving "chest" behind when a property card arrives kept the tall
    // rectangle, and the property card hung 137px into the rows below the die.
    holder.dataset.cardKind = "property";
    // Filled in as it is drawn rather than synced afterwards, so the card is
    // never on screen for a frame with an empty status line and no figures.
    syncCard(board, ctx);
  };

  if (still()) {
    draw();
    return Promise.resolve(property);
  }

  // Already showing the right one: nothing to do. Sync it anyway, because the
  // turn may have handed the turn to the other player since it was opened.
  if (!turning && holder.firstElementChild) {
    // Back to the top: tapping a square is a request to read it, and a player who
    // scrolled down to the third build and then tapped the square again is asking
    // to see the top of it. This is the tap path only - `syncCard` is what runs
    // after a purchase, and that one must leave the scroll exactly where it is.
    holder.scrollTop = 0;
    syncCard(board, ctx);
    return Promise.resolve(property);
  }

  if (!turning) {
    // Appearing for the first time: turn in from the left.
    draw();
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
      draw();
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