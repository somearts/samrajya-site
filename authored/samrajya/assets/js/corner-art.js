/* ==========================================================================
   SAMRAJYA - THE FOUR CORNER MARKS

   The board's four corners carry the game's vocabulary: where you begin, what
   you are, what lies beyond, and what you can do about it. Each is a single
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
  /* OUTER SPACE - a world, its orbit, and two points a long way off. The orbit
     is a flat ellipse tipped off the horizontal so it reads as a path rather
     than as a belt, and the two distant dots are the only stars on the board.
     Three strokes, and the whole idea is in them. */
  space: `<svg ${FRAME}>
    <circle cx="24" cy="24" r="8.5"/>
    <ellipse cx="24" cy="24" rx="17" ry="6.5" transform="rotate(-28 24 24)"/>
    <circle cx="40.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="8" cy="39" r="1.5" fill="currentColor" stroke="none"/>
  </svg>`,

  /* BLACK HOLE - the disc alone, and nothing inside it.

     There is no core drawn, and that is the point: a black hole's shadow is
     darker than anything can be painted on a black tile, so the only honest
     drawing is the bright ring of matter around a hole that is simply the tile
     showing through. Putting a filled circle in the middle was tried first and
     was wrong twice over - it read as a ringed planet, and it made this mark
     nearly indistinguishable from OUTER SPACE, which has a planet in exactly
     that position. The absence is what tells the two apart. */
  hole: `<svg ${FRAME}>
    <ellipse cx="24" cy="24" rx="18" ry="8.5"/>
  </svg>`,

  /* START - an arrowhead and a stem, and nothing else. The stem runs well below
     the head so the mark reads as "from here, upward" rather than as an
     upwards-pointing triangle. */
  start: `<svg ${FRAME}>
    <path d="M24 42 L24 12"/>
    <path d="M14.5 21.5 L24 12 L33.5 21.5"/>
  </svg>`,

  /* FIGHT - two blades crossed, each with a guard near its hilt. The guards sit
     low and well apart on purpose: crossing them in the middle would turn the
     mark into a knot, and a bare X reads as an error rather than as a clash. */
  fight: `<svg ${FRAME}>
    <path d="M13 35 L35 13"/>
    <path d="M13.8 27.8 L20.2 34.2"/>
    <path d="M35 35 L13 13"/>
    <path d="M27.8 34.2 L34.2 27.8"/>
  </svg>`,
});

/** The mark for a corner id. Never throws; falls back to the hole. */
export function cornerMark(id) {
  return CORNER_MARKS[id] || CORNER_MARKS.hole;
}