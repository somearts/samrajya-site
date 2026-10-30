/* ==========================================================================
   SAMRAJYA - THE OUTER SPACE SUITS

   Pure data for the interstellar journey: the three purchasable suits, what
   each one costs at the Outer Space counter, and how much of a property's
   price each one takes off.

   Nothing here decides anything. shared/game.js validates every acquisition
   and every discount against these fields; the screen draws its cards from
   them. The discount is a percentage of a property's PURCHASE PRICE only -
   rent, upgrades, fees and every other charge are untouched, and one suit
   carries one use: the first eligible purchase consumes it.

   The circuit rule lives with the screen, not here: a suit is retired when
   its owner lands on Outer Space again - a full lap from the square it was
   bought on - with the expiry notice when its discount was never spent.
   ========================================================================== */

/** The three suits, in tier order. Frozen; nothing mutates a suit. */
export const SUITS = Object.freeze([
  Object.freeze({
    id: "quantum-one",
    name: "Quantum One",
    tier: "TIER I",
    descriptor: "Quantum-Enhanced Exploration",
    discount: 15,
    price: 150,
    acquiredTitle: "QUANTUM ONE ACQUIRED",
    acquiredText:
      "Quantum technology is now at your disposal. May your next acquisition bring you closer to the stars.",
  }),
  Object.freeze({
    id: "photon-weave",
    name: "Photon Weave",
    tier: "TIER II",
    descriptor: "Advanced Photonic Architecture",
    discount: 25,
    price: 250,
    acquiredTitle: "PHOTON WEAVE ACQUIRED",
    acquiredText:
      "Your technology has evolved beyond conventional limits. The universe awaits your next move.",
  }),
  Object.freeze({
    id: "singularity-mantle",
    name: "Singularity Mantle",
    tier: "TIER III",
    descriptor: "Singularity-Grade Adaptive Exosuit",
    discount: 50,
    price: 400,
    acquiredTitle: "SINGULARITY MANTLE ACQUIRED",
    acquiredText:
      "Advanced technology. Uncharted frontiers. Your journey into the unknown continues.",
  }),
]);

/** The suit with this id, or null. */
export function suitById(id) {
  return SUITS.find((suit) => suit.id === id) || null;
}

/**
 * A price after a suit's discount, rounded to the whole rupee.
 *
 * The single arithmetic the card, the button and the ledger all share, so the
 * figure shown before a purchase is the figure the ledger takes for it.
 */
export function discountPrice(price, discount = 0) {
  const pct = Math.max(0, Math.min(100, Number(discount) || 0));
  if (!pct) return Number(price) || 0;
  return Math.round(((Number(price) || 0) * (100 - pct)) / 100);
}
