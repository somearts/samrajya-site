/* ==========================================================================
   SAMRAJYA - THE FOUR CORNER MARKS

   The board's four corners carry the game's vocabulary: where you begin, where
   the world turns, what you are, and where things are traded. Each is a single
   hairline drawing on a 48-unit grid, in the same weight and the same
   one-stroke discipline as the wordmark and the token marks, so that four very
   different ideas sit on one page without shouting at each other.

   Every mark is currentColor, so the board draws them in the corner tile's ink
   (light on dark) and in the tile's own colour if they are ever placed on the
   off-white.
   ========================================================================== */

const FRAME =
  'viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

export const CORNER_MARKS = Object.freeze({
  /* OMEGA - the open ring and its two feet. Drawn as the letter is written:
     a circle that does not close at the bottom, and two strokes going down from
     where it stops. It is the only mark here that is also a word. */
  omega: `<svg ${FRAME}>
    <path d="M33.2 30.4 A12 12 0 1 0 14.8 30.4"/>
    <path d="M14.8 30.4 L14.8 38.5"/>
    <path d="M33.2 30.4 L33.2 38.5"/>
  </svg>`,

  /* AKASH CORE - a circle on a vertical axis with a point at its centre. The
     axis runs past the circle at both ends, which is what makes it read as an
     instrument rather than as a target. */
  core: `<svg ${FRAME}>
    <circle cx="24" cy="24" r="11"/>
    <path d="M24 5.5 L24 42.5"/>
    <circle cx="24" cy="24" r="2.4" fill="currentColor" stroke="none"/>
  </svg>`,

  /* START - an arrowhead and a stem, and nothing else. The stem runs well below
     the head so the mark reads as "from here, upward" rather than as an
     upwards-pointing triangle. */
  start: `<svg ${FRAME}>
    <path d="M24 42 L24 12"/>
    <path d="M14.5 21.5 L24 12 L33.5 21.5"/>
  </svg>`,

  /* MARKETPLACE - three discs seen from slightly above, stacked. Drawn as a
     full ellipse on top and two more as their lower halves, joined at the
     sides, which is how a stack actually reads rather than how it is drawn. */
  market: `<svg ${FRAME}>
    <ellipse cx="24" cy="15.5" rx="11" ry="5.4"/>
    <path d="M13 15.5 L13 22.2"/>
    <path d="M35 15.5 L35 22.2"/>
    <path d="M13 22.2 C13 25.3 17.9 27.8 24 27.8 C30.1 27.8 35 25.3 35 22.2"/>
    <path d="M13 25.4 L13 32.1"/>
    <path d="M35 25.4 L35 32.1"/>
    <path d="M13 32.1 C13 35.2 17.9 37.7 24 37.7 C30.1 37.7 35 35.2 35 32.1"/>
  </svg>`,
});

/** The mark for a corner id. Never throws; falls back to the core. */
export function cornerMark(id) {
  return CORNER_MARKS[id] || CORNER_MARKS.core;
}