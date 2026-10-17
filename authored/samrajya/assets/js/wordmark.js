/* ==========================================================================
   SAMRAJYA - THE WORDMARK

   The approved lettering, drawn rather than typed.

   Why an SVG and not a font: the A in this mark has no crossbar. It is a
   lambda, and that single detail is the whole character of the word - a stock
   geometric sans would either supply a crossbar nobody approved or force a
   substitute face that reads as a different logo. So the eight letters of
   SAMRAJYA and the nine of KALCHAKRA are drawn here, once, on a shared
   100-unit cap height, and used everywhere the mark appears.

   Everything is one colour (currentColor), one weight, no fill - the marks
   are geometry, not pictures, and they inherit the ink of whatever they sit
   on. The letterforms are stroke paths so they stay hairline-crisp at any
   size without a hint of the pixel grid.
   ========================================================================== */

/* The drawing grid: cap height 100, stroke 5, ink from y 0 to y 100.
   Five parts in a hundred is the weight in the approved artwork: present
   enough to hold a letterform at a glance, light enough to read as drawn
   rather than printed. Heavier than this and the mark turns into a word in a
   font; lighter and the diagonals of the A fall apart on a phone. */
const STROKE = 5;

/**
 * One letterform per glyph, on a 100-unit cap height.
 *
 * Each is a centreline. The letters are deliberately wide and the joins are
 * round, which is what gives the mark its thin, drawn-with-one-stroke quality
 * rather than the drawn-and-filled look of a typeface.
 */
const GLYPHS = {
  S: {
    w: 76,
    d: "M72,24 C72,11 62,3 38,3 C15,3 4,11 4,24 C4,37 15,43 38,50 C61,57 72,63 72,76 C72,89 62,97 38,97 C15,97 4,89 4,76",
  },
  // The lambda. No crossbar - this is the mark, not a typeface A.
  A: {
    w: 82,
    d: "M3,97 L41,3 L79,97",
  },
  M: {
    w: 100,
    d: "M3,97 L3,3 L50,66 L97,3 L97,97",
  },
  R: {
    w: 78,
    d: "M3,97 L3,3 L30,3 C48,3 58,13 58,29 C58,45 48,55 30,55 L3,55 M32,55 L74,97",
  },
  J: {
    w: 62,
    d: "M59,3 L59,70 C59,86 50,97 33,97 C20,97 11,94 4,88",
  },
  Y: {
    w: 80,
    d: "M3,3 L40,54 L77,3 M40,54 L40,97",
  },
  K: {
    w: 64,
    d: "M3,97 L3,3 M58,3 L3,53 M3,53 L60,97",
  },
  L: {
    w: 56,
    d: "M3,3 L3,97 L52,97",
  },
  C: {
    w: 72,
    d: "M68,26 C68,12 58,3 40,3 C18,3 3,17 3,50 C3,83 18,97 40,97 C58,97 68,88 68,74",
  },
  H: {
    w: 70,
    d: "M3,3 L3,97 M67,3 L67,97 M3,50 L67,50",
  },
};

/**
 * Lay out a word on the cap-height grid.
 *
 * The tracking is the design: SAMRAJYA is set with 33 units of air, KALCHAKRA
 * with 131, which is what makes the second line read as a wide, quiet
 * companion rather than a caption.
 */
function lay(text, tracking) {
  const glyphs = [...text].map((ch) => GLYPHS[ch]);
  if (glyphs.some((g) => !g)) {
    throw new Error(`wordmark: no glyph for one of "${text}"`);
  }
  const parts = [];
  let x = 0;
  for (const g of glyphs) {
    parts.push({ d: g.d, x });
    x += g.w + tracking;
  }
  const width = x - tracking;
  return { parts, width };
}

function svg(text, tracking, { label, className = "" } = {}) {
  const { parts, width } = lay(text, tracking);
  const pad = STROKE / 2;
  const viewBox = `${-pad} 0 ${width + STROKE} 100`;
  const body = parts
    .map((p) => `<path d="${p.d}" transform="translate(${p.x} 0)"/>`)
    .join("");
  return (
    `<svg class="wordmark ${className}" viewBox="${viewBox}" role="img" ` +
    `aria-label="${label}" preserveAspectRatio="xMidYMid meet" ` +
    `fill="none" stroke="currentColor" stroke-width="${STROKE}" ` +
    `stroke-linecap="butt" stroke-linejoin="round">${body}</svg>`
  );
}

/** SAMRAJYA - the large mark. */
export function samrajyaMark() {
  return svg("SAMRAJYA", 33, { label: "Samrajya", className: "wordmark--samrajya" });
}

/** KALCHAKRA - the quiet line beneath it. */
export function kalchakraMark() {
  return svg("KALCHAKRA", 131, { label: "Kalchakra", className: "wordmark--kalchakra" });
}

/**
 * The four-point ornament that sits under the mark: a small star with a
 * hairline running away to either side. Drawn on the same weight as the
 * lettering so it reads as part of the same pen.
 */
export function ornament() {
  return (
    `<svg class="ornament" viewBox="0 0 240 24" role="presentation" aria-hidden="true" ` +
    `fill="none" stroke="currentColor">` +
    // The star: a tall four-point diamond, pinched on all four sides. Taller
    // than it is wide, which is what stops it reading as a blob.
    `<path d="M120,1 C121.4,8.6 123.4,10.6 127.5,12 C123.4,13.4 121.4,15.4 120,23 ` +
    `C118.6,15.4 116.6,13.4 112.5,12 C116.6,10.6 118.6,8.6 120,1 Z" ` +
    `fill="currentColor" stroke="none"/>` +
    `<path d="M106,12 H20" stroke-width="1" stroke-linecap="round"/>` +
    `<path d="M134,12 H220" stroke-width="1" stroke-linecap="round"/>` +
    `</svg>`
  );
}

/** Both marks and the ornament, in the order they are set. */
export function masthead() {
  return `${samrajyaMark()}${kalchakraMark()}${ornament()}`;
}
