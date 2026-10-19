/* ==========================================================================
   THE TEN DRAWINGS

   Earth 137 through Sagittarius A* were the half of the collection that had
   none, and these are the tests for what they are now.

   Most of what matters here is not that the markup parses - it is that the ten
   stay inside the visual language the other twenty set. That is a claim about
   restraint, and restraint is exactly the sort of thing that rots silently: one
   gradient, one off-palette hex and the collection quietly stops being a
   collection, with nothing red anywhere to point at it.

   So the checks are for the things that would be easy to add by accident and
   hard to notice: a colour from outside the ramp, a blur, a shadow, a fetch.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  ART,
  ART_IDS,
  LANDSCAPE,
  PORTRAIT,
  hasPropertyArt,
  propertyArt,
} from "../authored/samrajya/assets/js/property-art.js";

/** The colours the twenty finished drawings are drawn in, and no others. */
const RAMP = [
  "#F7F4EF", "#D8D0C0", "#CFC7B8", "#B8AE9C", "#A39986", "#8E8472",
  "#5A5044", "#4A4338", "#17121B", "#E5DFD3", "#F1E8DD", "#EBDDCF",
  "#D9876B", "#CF7A4B", "#B58A6E",
];

/** What the board crops away, per canvas, because the box is square. */
const CROP = {
  [LANDSCAPE.w + "x" + LANDSCAPE.h]: { w: LANDSCAPE.h, h: LANDSCAPE.h },
  [PORTRAIT.w + "x" + PORTRAIT.h]: { w: PORTRAIT.w, h: PORTRAIT.w },
};

test("there are ten drawings, for the ten that had none", () => {
  assert.equal(ART_IDS.length, 10);
  assert.deepEqual(ART_IDS, Object.keys(ART).sort((a, b) => ART_IDS.indexOf(a) - ART_IDS.indexOf(b)));
});

test("each is asked for by the property's own id, and nothing else answers", () => {
  for (const id of ART_IDS) {
    assert.equal(hasPropertyArt(id), true, `${id} has a drawing`);
  }
  for (const nope of ["moon", "ragnarok", "", null, undefined, 42, "EARTH-137"]) {
    assert.equal(hasPropertyArt(nope), false, `${nope} has none`);
    assert.equal(propertyArt(nope), null, `${nope} draws nothing`);
  }
});

test("each draws inside one of the two canvases the finished cards use", () => {
  const sizes = new Set();
  for (const id of ART_IDS) {
    const { w, h } = ART[id];
    assert.ok(
      (w === LANDSCAPE.w && h === LANDSCAPE.h) || (w === PORTRAIT.w && h === PORTRAIT.h),
      `${id} is on one of the two canvases`,
    );
    sizes.add(`${w}x${h}`);
  }
  assert.equal(sizes.size, 2, "both canvases are used, as the finished twelve do");
});

test("each is drawn only in the ramp the finished twenty are drawn in", () => {
  for (const id of ART_IDS) {
    const svg = propertyArt(id);
    const used = new Set(svg.match(/#[0-9A-Fa-f]{6}/g).map((c) => c.toUpperCase()));
    for (const colour of used) {
      assert.ok(RAMP.includes(colour), `${id} uses ${colour}, which is not in the ramp`);
    }
  }
});

test("and each is flat, like every other drawing on this board", () => {
  for (const id of ART_IDS) {
    const svg = propertyArt(id);
    assert.doesNotMatch(svg, /<linearGradient|<radialGradient|<filter\b|feGaussian|drop-shadow|blur\(|box-shadow|text-shadow/i, `${id} has no gradient, filter or shadow`);
    assert.doesNotMatch(svg, /<image\b|xlink:href|<use\b/i, `${id} fetches nothing`);
    assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org)/i, `${id} points at nothing`);
  }
});

test("no drawing says its own name again inside the artwork", () => {
  // The card sets the property's own pill and the property's own name beside
  // the drawing, so a title drawn inside it would say it twice. The twelve
  // finished cards carry titles because they are cards.
  for (const id of ART_IDS) {
    const svg = propertyArt(id);
    assert.doesNotMatch(svg, /title-pill|title-text|<text\b/i, `${id} draws no title`);
  }
});

test("no two of the ten are the same drawing", () => {
  const bodies = ART_IDS.map((id) => propertyArt(id));
  assert.equal(new Set(bodies).size, 10);
});

/**
 * Where a drawing puts its ink, as a box.
 *
 * This is approximate and the test below leans on it knowing that. Path data is
 * read as a bag of numbers with no regard for which command owns which, so a
 * curve's control points and an arc's radii land in the x set when they are
 * really y values. Every axis gets the other's numbers as well, which makes the
 * box generous rather than tight - and a generous box is the right way round
 * here, because the test is trying to catch art composed in a corner, not to
 * measure how neatly anything is centred.
 */
function inkBox(svg, w, h) {
  const numbers = (re) =>
    [...svg.matchAll(re)].flatMap(([, d]) => (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number));

  const xs = [
    ...[...svg.matchAll(/\b(?:cx|x|x1|x2)="(-?[\d.]+)"/g)].map((m) => Number(m[1])),
    ...numbers(/\bd="([^"]+)"/g),
  ];
  const ys = [
    ...[...svg.matchAll(/\b(?:cy|y|y1|y2)="(-?[\d.]+)"/g)].map((m) => Number(m[1])),
    ...numbers(/\bd="([^"]+)"/g),
  ];

  return {
    x0: Math.max(0, Math.min(...xs)), x1: Math.min(w, Math.max(...xs)),
    y0: Math.max(0, Math.min(...ys)), y1: Math.min(h, Math.max(...ys)),
  };
}

test("every drawing survives the crop the square art box applies", () => {
  // The box is square and fills, so only the middle of each canvas is shown. A
  // drawing composed entirely outside that middle would render blank, and that
  // is the failure this catches.
  //
  // The bar is that the ink box reaches the middle half of the crop. It is NOT a
  // claim that the subject is centred or that it fits - scripts/e2e.js counts
  // the shapes a real card actually renders, and whether any of it looks good
  // was decided by looking at it.
  for (const id of ART_IDS) {
    const { w, h } = ART[id];
    const shown = CROP[`${w}x${h}`];
    assert.ok(shown, `${id} is on a known canvas`);

    const box = inkBox(propertyArt(id), w, h);
    const cx = (w - shown.w) / 2;
    const cy = (h - shown.h) / 2;
    const reachesX = box.x0 <= cx + shown.w / 2 && box.x1 >= cx;
    const reachesY = box.y0 <= cy + shown.h / 2 && box.y1 >= cy;

    assert.ok(reachesX && reachesY,
      `${id} draws from ${box.x0.toFixed(0)},${box.y0.toFixed(0)} to ${box.x1.toFixed(0)},${box.y1.toFixed(0)}` +
      ` and the crop keeps ${cx.toFixed(0)},${cy.toFixed(0)} for ${shown.w}x${shown.h}`);
  }
});

test("each drawing's clip is its own", () => {
  // Two of the same card on one page must not point at the first one's clip.
  const first = propertyArt("dyson-sphere");
  const second = propertyArt("dyson-sphere");
  const clipOf = (svg) => (svg.match(/<clipPath id="([^"]+)"/) || [])[1];
  assert.ok(clipOf(first), "the one drawing that clips does clip");
  assert.notEqual(clipOf(first), clipOf(second), "and two of them do not share the id");
});