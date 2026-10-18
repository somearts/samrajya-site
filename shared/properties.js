/* ==========================================================================
   SAMRAJYA - THE PROPERTIES

   What the twenty purchasable squares are worth, and what they are.

   PRICES ARE DERIVED, NOT TYPED
   -----------------------------
   Moon is 200 and every subsequent purchasable property along the board's own
   travel order is 44 more than the one before it. None of those twenty numbers
   is written out here. They are computed from the board, so if a property ever
   moves, the scale moves with it and no price can be left behind on the wrong
   square - which is exactly the sort of thing that happens when twenty numbers
   are written down by hand next to twenty names.

   Two things follow from the derivation that are worth stating, because they are
   decisions rather than consequences:

     Only properties are priced. The four corners and the four chests are not
     places anybody buys, so they have no price and asking for one gives null
     rather than a number that means nothing.

     The step is 44, and 44 divides the round numbers the scale lands on -
     200, 244, 288 - which is not a coincidence worth relying on and is not
     relied on here. The scale is simply arithmetic.

   THE WRITING
   -----------
   Every description is exactly two lines, and the line breaks are here rather
   than left to the renderer, so the same two lines appear on the card whatever
   width the card is. An advantage says what owning the place is worth and never
   says to buy it.
   ========================================================================== */

import { CELLS, CURRENCY } from "./spaces.js";

/** What Moon costs, and what each step along the board adds. */
export const PRICE_FIRST = 200;
export const PRICE_STEP = 44;

/**
 * The twenty purchasable properties, in the order the board is travelled.
 *
 * Sorted by index rather than left in array order on purpose: the price depends
 * on being Nth along the board, so the order it is computed in is the whole
 * meaning of the number.
 */
export const PROPERTIES = Object.freeze(
  CELLS.filter((cell) => cell.type === "property")
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((cell, n) =>
      Object.freeze({
        id: cell.id,
        index: cell.index,
        col: cell.col,
        row: cell.row,
        name: cell.name,
        lines: Object.freeze([...cell.lines]),
        set: cell.set,
        color: cell.color,
        art: cell.art,
        step: n,
        price: PRICE_FIRST + n * PRICE_STEP,
      }),
    ),
);

/**
 * The copy, keyed by cell id.
 *
 * `lines` is always exactly two, and `advantage` is one sentence. The
 * descriptions are about the place; the advantages are about holding it.
 */
const COPY = {
  moon: {
    lines: [
      "Grey rock scoured by airless impacts,",
      "and the nearest world to Start.",
    ],
    advantage: "Everyone crosses it early and often, so its holder is paid for the traffic.",
  },
  "lagrange-l2": {
    lines: [
      "A gravity balance point in orbit,",
      "stationed between the Earth and the Sun.",
    ],
    advantage: "Paired with Moon it completes a set, and the pair straddles the whole left column.",
  },
  "asteroid-belt": {
    lines: [
      "A churning rubble field between Mars",
      "and Jupiter, dense with untouched ore.",
    ],
    advantage: "Whoever holds the belt holds the region's wealth, and both approaches to it.",
  },
  jupiter: {
    lines: [
      "The largest planet in the system,",
      "a failed star with dozens of moons.",
    ],
    advantage: "Its gravity pulls every route inward, and it sits across the board's centre of gravity.",
  },
  pluto: {
    lines: [
      "A frozen world at the edge of the",
      "known system, barely brighter than a star.",
    ],
    advantage: "A remote foothold: far from the crowds, and everything past it runs through here.",
  },
  "kuiper-belt": {
    lines: [
      "The icy debris ring beyond Neptune,",
      "where the Sun's light barely reaches.",
    ],
    advantage: "Cut off from the crowded lanes, and a natural bridge to the frontier worlds beyond it.",
  },
  "halleys-comet": {
    lines: [
      "A periodic visitor with a return",
      "every seventy-six years, watched for centuries.",
    ],
    advantage: "Passed often and recognised at a glance, so its holder is never overlooked.",
  },
  "voyager-1": {
    lines: [
      "Humanity's farthest-reaching probe,",
      "still transmitting beyond the edge of the Sun.",
    ],
    advantage: "The longest sight-line on the board: what it sees, its holder sees first.",
  },
  "proxima-centauri": {
    lines: [
      "The nearest star beyond the Sun,",
      "four light years and four companions away.",
    ],
    advantage: "The closest door out of the system, and the one every rival wants standing open.",
  },
  "event-horizon": {
    lines: [
      "The boundary of a black hole, where",
      "escape is impossible and light cannot return.",
    ],
    advantage: "It commands the road to Black Hole, and whatever passes through does not pass back.",
  },
  "earth-137": {
    lines: [
      "A colony world on the third orbit of",
      "a star the catalogue never numbered.",
    ],
    advantage: "Deep in friendly territory, where a strong position pays out turn after turn.",
  },
  "orions-belt": {
    lines: [
      "Three stars in a straight line, the",
      "most recognisable pattern in the sky.",
    ],
    advantage: "A landmark every player can find unprompted, which makes it a natural pivot.",
  },
  "wow-signal": {
    lines: [
      "The unexplained pulse of 1977, sixty",
      "seconds of narrowband noise, never repeated.",
    ],
    advantage: "One moment of signal is worth more than any amount of quiet space around it.",
  },
  "dyson-sphere": {
    lines: [
      "A shell of collectors built around a",
      "star to take all of the light it gives.",
    ],
    advantage: "An engine rather than a holding, and it dwarfs every ordinary property beside it.",
  },
  wormhole: {
    lines: [
      "A theoretical shortcut folded through",
      "space, joining points very far apart.",
    ],
    advantage: "Collapses the distance between two edges of the board, and its holder picks where.",
  },
  "milky-way": {
    lines: [
      "A hundred thousand light years of",
      "stars, of which the Sun is one.",
    ],
    advantage: "A territory rather than a tile: hold its centre and the rest is within reach.",
  },
  rama: {
    lines: [
      "The perfect cylinder found in orbit,",
      "manned by no one, silent for decades.",
    ],
    advantage: "Yields to whoever reaches it best prepared, and rewards the party that arrives first.",
  },
  quasar: {
    lines: [
      "A galaxy's heart seen edge-on,",
      "shining with more light than its whole spiral.",
    ],
    advantage: "It reads as the horizon itself, and its light reaches past every other point here.",
  },
  supernova: {
    lines: [
      "A dying star collapsing and exploding,",
      "briefly outshining its entire galaxy.",
    ],
    advantage: "Short-lived and unmistakable, so a position there is never taken for a quiet one.",
  },
  "sagittarius-a-star": {
    lines: [
      "The dark mass at the centre of our",
      "own galaxy, imaged by radio waves.",
    ],
    advantage: "The anchor at the very end of the road, and the last square before the circuit closes.",
  },
};

/** Every property has an entry, and every entry has exactly two lines. */
export const PROPERTIES_WITH_COPY = Object.freeze(
  PROPERTIES.map((property) => {
    const copy = COPY[property.id];
    if (!copy) throw new Error(`no description written for ${property.id}`);
    return Object.freeze({
      ...property,
      description: Object.freeze([...copy.lines]),
      advantage: copy.advantage,
    });
  }),
);

const BY_ID = new Map(PROPERTIES_WITH_COPY.map((p) => [p.id, p]));

/**
 * Everything the card needs about one square, or null if it is not for sale.
 *
 * Null is the answer for the four corners and the four chests, and it is a real
 * answer: those squares are not places anybody buys, so there is no card to
 * show and no price to quote.
 */
export function propertyFor(id) {
  return BY_ID.get(String(id ?? "")) || null;
}

/** The price as it is written on the board, or null where there is none. */
export function priceOf(id) {
  const property = propertyFor(id);
  return property ? `${CURRENCY}${property.price}` : null;
}

/** Is this square one somebody can buy? */
export function isPurchasable(id) {
  return BY_ID.has(String(id ?? ""));
}