/* ==========================================================================
   SAMRAJYA - THE EPOCH TIME CARDS

   Eight cards, and nothing else. Epoch is the threshold where the Kaalchakra
   changes direction; a Time Card is one fragment of that power. This module is
   the deck and the draw, and nothing else about Epoch: the effects are applied
   by shared/game.js, which owns the state, the ledger and the turn.

   THE DRAW IS UNIFORM, AND DOCUMENTED
   ----------------------------------
   There is no physical deck to shuffle across a distributed server, so the
   draw is a uniform pick over the eight cards, driven by the injected `rng`
   exactly like the Nexus draw and the Ragnarok draw. Every card is equally
   likely; nothing is sorted, seeded or fixed, and no card can be favoured by
   the order of this file. The server calls it; a browser never does.
   ========================================================================== */

/** The eight Time Cards, in no special order. */
export const TIME_CARDS = Object.freeze([
  {
    id: "time-rewind",
    name: "Time Rewind",
    effect: "rewind",
    text: "The Kaalchakra returns you to the moment you last crossed. Step back by the distance of your most recent throw.",
  },
  {
    id: "time-leap",
    name: "Time Leap",
    effect: "leap",
    text: "A gap in the ordinary flow opens ahead. Cross it, and advance three spaces further along the wheel.",
  },
  {
    id: "frozen-moment",
    name: "Frozen Moment",
    effect: "freeze",
    text: "For one instant the Kaalchakra suspends an opponent's fortune. Their next earned advantage is held back.",
  },
  {
    id: "future-sight",
    name: "Future Sight",
    effect: "sight",
    text: "Epoch parts the veil and shows the number the Kaalchakra has already prepared for your next throw.",
  },
  {
    id: "temporal-loop",
    name: "Temporal Loop",
    effect: "loop",
    text: "The moment repeats. You are granted one additional roll of the die before time moves on.",
  },
  {
    id: "time-fracture",
    name: "Time Fracture",
    effect: "fracture",
    text: "The present fractures, and you are returned to the place you stood before your last movement.",
  },
  {
    id: "alternate-timeline",
    name: "Alternate Timeline",
    effect: "timeline",
    text: "The same moment reveals two futures. Choose to advance two spaces, or to fall back two.",
  },
  {
    id: "time-theft",
    name: "Time Theft",
    effect: "theft",
    text: "One ruler's stolen moment becomes yours. Take an opponent's unspent advantage, if any remains.",
  },
]);

/** Outcome id for a card whose effect has no valid target. */
export const NO_TARGET = "no-target";

/** Outcome id for a card that could not resolve (no previous position, etc.). */
export const NO_EFFECT = "no-effect";

const BY_ID = new Map(TIME_CARDS.map((c) => [c.id, c]));

/** A Time Card by id, or null. Never a fallback and never a guess. */
export function timeCardById(id) {
  return BY_ID.get(String(id ?? "").trim().toLowerCase()) || null;
}

/**
 * Draw one Time Card uniformly.
 *
 * `rng` is injected and defaults to Math.random. Anything in [0, 1) works, so
 * a test can force a specific card. The server is the only caller.
 */
export function drawTimeCard(rng = Math.random) {
  const roll = Number(rng());
  const point = Number.isFinite(roll) ? Math.min(0.999999999, Math.max(0, roll)) : 0;
  return TIME_CARDS[Math.floor(point * TIME_CARDS.length)];
}
