/* ==========================================================================
   SAMRAJYA - A CARD

   Twelve cards, generated from the supplied SVG files by gen-cards.mjs, then
   laid out by refine-cards.mjs and measured by fit-titles. Do not hand-edit:
   edit the generator, or the drawing and its source will drift apart.

   The artwork inside every card is lifted verbatim from its source file. The
   wrapper is this project's: a viewBox per card (two formats), a unique clip id
   per instance, and a hairline border drawn last, outside the clip.

   ONE LAYOUT SYSTEM FOR ALL TWELVE
   --------------------------------
   The pill is drawn AROUND the type, not beside it. That is the whole fix.

   Each format has ONE pill geometry - position, height, radius, padding - and
   every card of that format uses it, so no two pills on the board differ in
   shape. The baseline is not authored: it is solved per card from the font's
   own ink box, so the type is vertically centred in its pill with the same
   padding above and below. The text is centred horizontally on the pill's
   centre line with text-anchor="middle", and the pill is then sized to the
   measured title plus equal padding either side.

   Getting this wrong is not subtle and is easy to repeat: give a card a larger
   font while leaving its baseline where it was, and the type grows upward out
   of a pill sized for something smaller. That is what happened here - Pluto's
   cap-top ended up above its own pill, and Jupiter's and Moon's followed. The
   fix is structural rather than twelve corrections that would drift apart
   again: the baseline is derived, so the two cannot disagree.

   Type size is capped by the height available, then reduced - tracking first,
   glyph size second, and tracking only down to a floor - until the title fits on
   one line. Every name is measured in the real font before it is written.

   THE CARD FILLS ITS CELL
   -----------------------
   width: 100%; height:auto, and the board cell decides the size.

   GROUNDS
   -------
   Every card sits on the shared ivory, including Ragnarok, Nexus and Event
   Horizon. Their artwork is remapped onto the same stone ramp the rest of the
   board uses, so nothing disappears onto paper. Event Horizon's glow ring keeps
   its warmth by taking the group's own terracotta, and its black disc is left
   alone: that disc is the point of the card.

   Nexus and Ragnarok carry no pill. Their titles sit at the same inset from the
   card's edge that every pill sits at, so they line up with them.
   ========================================================================== */

/** The four property groups. A card's pill is its group's colour, always. */
export const GROUPS = Object.freeze({
  purple: "#7B68B0",
  terracotta: "#CF7A4B",
  teal: "#3F8F96",
  rose: "#B8557A",
});

/**
 * The pill geometry each card format is drawn with - one position, one height
 * and one radius per format, and every card of that format uses it. Only the
 * width varies, because it has to hold the name.
 *
 * Published so that the check can measure against the design rather than against
 * a copy of it. The padding is NOT here, because it is not a number: it is
 * whatever is left of this height once the measured ink has taken its share, and
 * it is applied to all four edges.
 */
export const PILL_LAYOUT = Object.freeze({
  328: Object.freeze({ x: 14, y: 14, height: 40, rx: 8 }),
  190: Object.freeze({ x: 10, y: 10, height: 34, rx: 7 }),
});

const CARDS = Object.freeze({
  "moon": Object.freeze({
    type: "property",
    name: "Moon",
    group: "purple",
    w: 328,
    h: 212,
    rx: 8,
    border: "#D9D3C7",
    Art: artmoon,
  }),
  "lagrange-point": Object.freeze({
    type: "property",
    name: "Lagrange Point",
    group: "purple",
    w: 328,
    h: 212,
    rx: 8,
    border: "#D9D3C7",
    Art: artlagrangePoint,
  }),
  "ragnarok": Object.freeze({
    type: "chest",
    name: "Ragnarok",
    group: null,
    w: 328,
    h: 212,
    rx: 8,
    border: "#D9D3C7",
    Art: artragnarok,
  }),
  "asteroid-belt": Object.freeze({
    type: "property",
    name: "Asteroid Belt",
    group: "terracotta",
    w: 328,
    h: 212,
    rx: 8,
    border: "#D9D3C7",
    Art: artasteroidBelt,
  }),
  "jupiter": Object.freeze({
    type: "property",
    name: "Jupiter",
    group: "terracotta",
    w: 328,
    h: 212,
    rx: 8,
    border: "#D9D3C7",
    Art: artjupiter,
  }),
  "pluto": Object.freeze({
    type: "property",
    name: "Pluto",
    group: "terracotta",
    w: 328,
    h: 212,
    rx: 8,
    border: "#D9D3C7",
    Art: artpluto,
  }),
  "kuiper-belt": Object.freeze({
    type: "property",
    name: "Kuiper Belt",
    group: "teal",
    w: 190,
    h: 300,
    rx: 6,
    border: "#D9D3C7",
    Art: artkuiperBelt,
  }),
  "halleys-comet": Object.freeze({
    type: "property",
    name: "Halley's Comet",
    group: "teal",
    w: 190,
    h: 300,
    rx: 6,
    border: "#D9D3C7",
    Art: arthalleysComet,
  }),
  "nexus": Object.freeze({
    type: "chest",
    name: "Nexus",
    group: null,
    w: 190,
    h: 300,
    rx: 6,
    border: "#D9D3C7",
    Art: artnexus,
  }),
  "voyager-1": Object.freeze({
    type: "property",
    name: "Voyager 1",
    group: "rose",
    w: 190,
    h: 300,
    rx: 6,
    border: "#D9D3C7",
    Art: artvoyager1,
  }),
  "proxima-centauri": Object.freeze({
    type: "property",
    name: "Proxima Centauri",
    group: "rose",
    w: 190,
    h: 300,
    rx: 6,
    border: "#D9D3C7",
    Art: artproximaCentauri,
  }),
  "event-horizon": Object.freeze({
    type: "property",
    name: "Event Horizon",
    group: "rose",
    w: 190,
    h: 300,
    rx: 6,
    border: "#D9D3C7",
    Art: arteventHorizon,
  }),
});

/** Which keys have a card, in board order. */
export function cardKeys() {
  return Object.keys(CARDS);
}

/** The card for a key, or undefined. */
export function cardFor(key) {
  return CARDS[key];
}

/* ------------------------------------------------------- unique clip ids

   A duplicate id on one page breaks the clipping, and a board draws its cards
   at the same time, so this counter is what keeps them apart. It only goes up. */

let clipSeq = 0;

/** A whole card, wrapper and all. */
export function cardSvg(key) {
  const card = CARDS[key];
  if (!card) return "";
  const id = `card-${key}-${++clipSeq}`;
  return (
    `<svg viewBox="0 0 ${card.w} ${card.h}" xmlns="http://www.w3.org/2000/svg" role="img" ` +
    `aria-label="${card.name}" preserveAspectRatio="xMidYMid meet" ` +
    `style="display:block;width:100%;height:auto" data-card="${key}" data-type="${card.type}">\n` +
    `  <defs><clipPath id="${id}"><rect width="${card.w}" height="${card.h}" rx="${card.rx}"/></clipPath></defs>\n` +
    `  <g clip-path="url(#${id})">${card.Art(id)}</g>\n` +
    `  <rect width="${card.w}" height="${card.h}" rx="${card.rx}" fill="none" stroke="${card.border}" stroke-width="0.5"/>\n` +
    `</svg>`
  );
}

/**
 * The artwork on its own, without the pill or the title.
 *
 * The board's property card shows the drawing rather than a photograph of the
 * finished card, so the pill and the word on it are not wanted twice - once in
 * the artwork and once in the card's own heading. Everything else here is the
 * same markup `cardSvg` draws: the same ground, the same figures, the same
 * reference geometry, with this instance's clip id.
 *
 * Null for a card that has no artwork, which is a real answer and not a
 * failure: ten of the twenty properties have a drawing and ten do not, and the
 * caller decides what to show in the gap.
 */
export function cardArt(key) {
  const card = CARDS[key];
  if (!card) return "";
  const id = `art-${key}-${++clipSeq}`;
  // The pill and the title live INSIDE each card's own artwork, not in the
  // wrapper - which is right for a card and wrong for the board's property card,
  // where the same pill and name are already set beside it. They are removed
  // here rather than in the drawing, so the artwork stays exactly the artwork
  // and the only thing that changes is what this function hands back.
  const drawing = card
    .Art(id)
    .replace(/<g class="title-pill">[\s\S]*?<\/g>/g, "")
    .replace(/<text class="title-text"[^>]*>[\s\S]*?<\/text>/g, "");
  return (
    // `slice`, not `meet`: the board shows the drawing in a square, and a card
    // drawn as a wide rectangle or a tall one letterboxed into that square is
    // mostly empty ground with a small subject in it. Filled and cropped, the
    // artwork is the size of the space it is given at every board size. The
    // crop takes from whichever axis the card is long in, and every drawing
    // keeps its subject near the middle.
    `<svg viewBox="0 0 ${card.w} ${card.h}" xmlns="http://www.w3.org/2000/svg" ` +
    `aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice" ` +
    `class="property-card__art-svg" data-art="${key}">\n` +
    `  <defs><clipPath id="${id}"><rect width="${card.w}" height="${card.h}" rx="${card.rx}"/></clipPath></defs>\n` +
    `  <rect width="${card.w}" height="${card.h}" fill="#F7F4EF"/>\n` +
    `  <g clip-path="url(#${id})">${drawing}</g>\n` +
    `</svg>`
  );
}

/** Which keys have artwork, for the caller that has to offer something else. */
export function hasArt(key) {
  return Boolean(CARDS[key]);
}

/* ------------------------------------------------------------------ artwork

   One function per card. Each returns the reference's own markup, with any clip
   id it referenced rewritten to hang off this instance's unique id. */

function artmoon(id) {
  return `<rect width="328" height="212" fill="#F7F4EF"/>
<g class="moon-body"><circle cx="170" cy="332" r="200" fill="#D8D0C0"/><circle cx="176" cy="340" r="200" fill="#CFC7B8"/><circle cx="196" cy="354" r="200" fill="#B8AE9C"/></g>
<g class="craters" fill="#8E8472" opacity="0.5"><circle cx="120" cy="168" r="12"/><circle cx="226" cy="158" r="8"/><circle cx="170" cy="192" r="6"/><circle cx="268" cy="182" r="10"/><circle cx="76" cy="204" r="8"/><circle cx="240" cy="148" r="5"/><circle cx="148" cy="152" r="4"/></g>
<g class="crater-rims" fill="none" stroke="#8E8472" stroke-width="1" opacity="0.45"><circle cx="120" cy="168" r="16"/><circle cx="268" cy="182" r="14"/><circle cx="226" cy="158" r="11"/></g>
<g class="stars"><circle cx="290" cy="60" r="1.5" fill="#8E8472"/><circle cx="250" cy="40" r="1.5" fill="#8E8472"/><circle cx="300" cy="110" r="1.5" fill="#8E8472"/></g><g class="title-pill">
  <rect x="14" y="14" width="107" height="40" rx="8" fill="#7B68B0" opacity="0.9"/><text class="title-text" x="67.5" y="43.5" text-anchor="middle" textLength="98" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="28" letter-spacing="2.5" fill="#FFFFFF">MOON</text></g>`;
}

function artlagrangePoint(id) {
  return `<rect width="328" height="212" fill="#F7F4EF"/>
<g class="moon-limb"><circle cx="30" cy="250" r="110" fill="#CFC7B8"/><circle cx="42" cy="264" r="110" fill="#B8AE9C"/><circle cx="70" cy="196" r="8" fill="#8E8472" opacity="0.5"/><circle cx="40" cy="206" r="5" fill="#8E8472" opacity="0.5"/></g>
<line x1="124" y1="184" x2="206" y2="130" stroke="#A39986" stroke-width="1.2" stroke-dasharray="3 4"/>
<g class="gravity-rings" fill="none" stroke="#B8AE9C" stroke-width="1.5" transform="rotate(-20 222 122)"><ellipse cx="222" cy="122" rx="92" ry="40" opacity="0.5"/><ellipse cx="222" cy="122" rx="62" ry="27" opacity="0.75"/><ellipse cx="222" cy="122" rx="32" ry="14"/></g>
<g class="satellite"><rect x="190" y="119" width="22" height="6" fill="#8E8472"/><rect x="232" y="119" width="22" height="6" fill="#8E8472"/><rect x="213" y="113" width="18" height="18" rx="2" fill="#5A5044"/></g>
<g class="stars"><circle cx="290" cy="80" r="1.5" fill="#8E8472"/><circle cx="180" cy="60" r="1.5" fill="#8E8472"/><circle cx="300" cy="170" r="1.5" fill="#8E8472"/><circle cx="120" cy="96" r="1.5" fill="#8E8472"/></g><g class="title-pill">
  <rect x="14" y="14" width="293" height="40" rx="8" fill="#7B68B0" opacity="0.9"/><text class="title-text" x="160.5" y="43.5" text-anchor="middle" textLength="284" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="28" letter-spacing="2.5" fill="#FFFFFF">LAGRANGE POINT</text></g>`;
}

function artragnarok(id) {
  return `<rect width="328" height="212" fill="#F7F4EF"/><ellipse class="mound" cx="222" cy="200" rx="130" ry="16" fill="#B8AE9C"/>
<g class="sword" transform="rotate(14 215 196)" fill="#5A5044"><polygon points="208,80 222,80 220,172 215,198 210,172"/><rect x="188" y="72" width="54" height="8" rx="2"/><rect x="211" y="48" width="8" height="26"/><circle cx="215" cy="44" r="6"/></g>
<g class="debris" fill="#8E8472"><polygon points="180,160 186,150 192,162"/><polygon points="262,136 268,126 274,140"/><polygon points="276,170 281,162 286,172"/><polygon points="168,184 172,178 177,186"/></g>
<path class="mist" d="M0,200 Q80,194 160,202 T328,198 V212 H0 Z" fill="#E5DFD3" opacity="0.9"/>
<text class="title-text" x="18.5" y="43.5" textLength="181" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="28" letter-spacing="2.5" fill="#241F19">RAGNAROK</text>`;
}

function artasteroidBelt(id) {
  return `<rect width="328" height="212" fill="#F7F4EF"/><g class="rocks"><polygon points="21.6,177.4 24.0,194.8 10.4,203.4 -3.1,197.7 -2.8,181.2 12.5,173.4" fill="#B8AE9C" opacity="1"/><polygon points="32.7,166.1 36.5,177.5 28.4,185.0 18.5,182.9 16.7,171.7 26.0,164.5" fill="#CFC7B8" opacity="1"/><polygon points="31.5,165.8 39.8,157.1 50.2,160.7 53.0,170.4 44.0,177.3 33.3,172.5" fill="#B8AE9C" opacity="1"/><polygon points="54.2,164.8 59.0,162.3 63.0,165.4 62.7,170.0 57.8,171.6 53.9,168.0" fill="#B8AE9C" opacity="1"/><polygon points="64.8,164.0 67.1,152.2 77.9,149.7 85.4,156.4 81.5,167.0 69.9,168.7" fill="#CFC7B8" opacity="1"/><polygon points="76.4,163.0 79.8,145.8 95.5,142.2 106.5,152.0 100.7,167.4 83.8,169.8" fill="#5A5044" opacity="1"/><polygon points="98.5,150.7 102.1,141.5 111.2,141.1 116.2,147.6 111.5,155.6 101.9,155.2" fill="#CFC7B8" opacity="1"/><polygon points="128.4,128.0 128.3,134.6 122.8,137.0 118.1,134.1 119.2,128.0 125.2,126.0" fill="#A39986" opacity="1"/><polygon points="150.3,138.4 140.8,145.9 131.0,140.8 129.7,130.8 139.6,125.3 149.5,131.6" fill="#A39986" opacity="1"/><polygon points="160.6,134.4 156.1,137.5 151.8,134.9 151.5,130.3 156.2,128.1 160.5,131.3" fill="#5A5044" opacity="1"/><polygon points="187.9,121.0 175.0,132.9 160.2,126.7 157.1,112.3 170.8,103.2 185.9,111.2" fill="#CFC7B8" opacity="1"/><polygon points="186.5,106.1 191.8,107.5 192.7,112.4 189.4,115.7 184.7,113.7 184.2,108.3" fill="#5A5044" opacity="1"/><polygon points="213.1,116.3 210.1,125.7 201.1,126.8 195.6,120.6 199.8,112.3 209.4,112.1" fill="#A39986" opacity="1"/><polygon points="219.9,112.4 227.5,116.7 226.8,124.7 220.4,128.4 214.0,123.3 215.5,114.9" fill="#A39986" opacity="1"/><polygon points="242.6,104.5 237.1,108.1 232.0,104.9 231.7,99.4 237.4,96.9 242.5,100.8" fill="#CFC7B8" opacity="1"/><polygon points="256.8,122.1 240.6,115.3 240.1,99.3 251.9,90.5 265.9,99.1 264.9,116.2" fill="#A39986" opacity="1"/><polygon points="274.4,99.1 271.3,103.6 266.3,102.7 264.4,98.6 267.9,94.8 273.1,96.2" fill="#CFC7B8" opacity="1"/><polygon points="278.6,98.4 279.5,89.7 287.2,87.2 293.0,91.6 290.9,99.5 282.6,101.5" fill="#B8AE9C" opacity="1"/><polygon points="301.9,111.5 289.4,102.7 292.0,88.8 303.8,83.6 314.1,93.7 310.0,108.1" fill="#CFC7B8" opacity="1"/><polygon points="321.4,105.7 312.8,104.1 310.9,96.3 315.7,90.8 323.5,93.5 324.8,102.0" fill="#A39986" opacity="1"/><polygon points="190.5,157.9 191.1,154.9 193.8,154.2 195.7,155.9 194.8,158.6 191.8,159.1" fill="#B8AE9C" opacity="0.8"/><polygon points="156.5,164.5 157.9,166.2 157.0,167.9 155.2,168.1 154.2,166.4 155.3,164.7" fill="#8E8472" opacity="0.8"/><polygon points="189.9,166.3 190.5,169.3 188.2,170.9 185.8,170.1 185.7,167.2 188.3,165.7" fill="#8E8472" opacity="0.8"/><polygon points="218.3,94.2 215.4,95.2 213.4,93.2 213.9,90.7 216.7,90.1 218.6,92.5" fill="#B8AE9C" opacity="0.8"/><polygon points="161.8,112.7 164.1,114.0 163.9,116.4 162.0,117.5 160.0,116.0 160.5,113.4" fill="#8E8472" opacity="0.8"/><polygon points="131.9,188.9 132.1,191.1 130.4,192.1 128.7,191.3 128.9,189.2 130.8,188.4" fill="#A39986" opacity="0.8"/><polygon points="95.8,103.0 98.1,104.9 97.3,107.6 95.0,108.4 93.1,106.3 94.2,103.5" fill="#8E8472" opacity="0.8"/><polygon points="135.4,128.4 139.5,128.0 141.4,131.3 139.9,134.4 136.1,134.2 134.4,130.5" fill="#B8AE9C" opacity="0.8"/><polygon points="63.3,118.8 62.1,116.6 63.4,114.7 65.5,114.7 66.4,116.9 64.8,118.8" fill="#A39986" opacity="0.8"/><polygon points="67.5,120.7 68.1,123.0 66.5,124.4 64.6,123.9 64.3,121.7 66.2,120.4" fill="#8E8472" opacity="0.8"/><polygon points="181.4,200.9 182.1,197.4 185.4,196.7 187.6,198.7 186.4,201.9 182.9,202.4" fill="#8E8472" opacity="0.8"/><polygon points="211.2,177.8 209.1,175.6 210.2,173.0 212.7,172.4 214.3,174.8 212.9,177.5" fill="#8E8472" opacity="0.8"/><polygon points="132.4,134.5 132.6,136.7 130.8,137.8 129.1,137.0 129.3,134.9 131.2,134.0" fill="#8E8472" opacity="0.8"/><polygon points="70.0,200.8 71.4,203.4 69.6,205.6 67.1,205.5 66.2,202.8 68.2,200.6" fill="#B8AE9C" opacity="0.8"/><polygon points="24.2,90.9 24.7,88.6 26.8,88.1 28.3,89.5 27.5,91.5 25.2,91.8" fill="#B8AE9C" opacity="0.8"/><polygon points="197.5,96.4 200.0,96.1 201.1,98.1 200.3,100.0 198.0,99.9 196.9,97.7" fill="#A39986" opacity="0.8"/><polygon points="85.6,128.4 88.3,127.5 90.1,129.4 89.6,131.8 86.9,132.2 85.2,130.0" fill="#B8AE9C" opacity="0.8"/><polygon points="157.7,201.2 160.5,199.7 162.8,201.4 162.7,204.0 159.9,205.0 157.7,203.0" fill="#A39986" opacity="0.8"/></g><g class="title-pill">
  <rect x="14" y="14" width="247" height="40" rx="8" fill="#CF7A4B" opacity="0.9"/><text class="title-text" x="138" y="43" text-anchor="middle" textLength="234" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="25.75" letter-spacing="2.5" fill="#FFFFFF">ASTEROID BELT</text></g>`;
}

function artjupiter(id) {
  return `<clipPath id="\${id}-jup"><circle cx="190" cy="242" r="120"/></clipPath><rect width="328" height="212" fill="#F7F4EF"/>
<defs><clipPath id="jup"><circle cx="190" cy="242" r="120"/></clipPath></defs>
<g class="planet" clip-path="url(#\${id}-jup)"><rect x="0" y="110" width="328" height="110" fill="#A39986"/><rect x="0" y="122" width="328" height="20" fill="#D8D0C0"/><rect x="0" y="142" width="328" height="16" fill="#B8AE9C"/><rect x="0" y="158" width="328" height="20" fill="#CFC7B8"/><rect x="0" y="178" width="328" height="18" fill="#A39986"/><rect x="0" y="196" width="328" height="20" fill="#CFC7B8"/></g>
<ellipse class="red-spot" cx="226" cy="168" rx="26" ry="12" fill="#B58A6E"/>
<g class="moons" fill="#8E8472"><circle cx="70" cy="100" r="4"/><circle cx="276" cy="70" r="3"/><circle cx="296" cy="112" r="5"/></g><g class="title-pill">
  <rect x="14" y="14" width="134" height="40" rx="8" fill="#CF7A4B" opacity="0.9"/><text class="title-text" x="81" y="42.5" text-anchor="middle" textLength="121" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="24.75" letter-spacing="2.5" fill="#FFFFFF">JUPITER</text></g>`;
}

function artpluto(id) {
  return `<rect width="328" height="212" fill="#F7F4EF"/>
<circle class="moon" cx="272" cy="64" r="7" fill="#B8AE9C"/>
<g class="planet"><circle cx="170" cy="332" r="200" fill="#CFC7B8"/><circle cx="176" cy="340" r="200" fill="#B8AE9C"/><circle cx="196" cy="354" r="200" fill="#A39986"/><circle cx="120" cy="168" r="8" fill="#8E8472" opacity="0.6"/><circle cx="224" cy="160" r="5" fill="#8E8472" opacity="0.6"/><circle cx="160" cy="190" r="4" fill="#8E8472" opacity="0.6"/></g><g class="title-pill">
  <rect x="14" y="14" width="115" height="40" rx="8" fill="#CF7A4B" opacity="0.9"/><text class="title-text" x="71.5" y="43.5" text-anchor="middle" textLength="106" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="28" letter-spacing="2.5" fill="#FFFFFF">PLUTO</text></g>`;
}

function artkuiperBelt(id) {
  return `<rect width="190" height="300" fill="#F7F4EF"/><g class="ice-bodies"><circle cx="24.4" cy="230.4" r="4.0" fill="#DDE3E3"/><circle cx="20.4" cy="233.2" r="1.9" fill="#A39986"/><circle cx="18.7" cy="227.1" r="1.9" fill="#DDE3E3"/><circle cx="85.4" cy="225.8" r="3.7" fill="#CFC7B8"/><circle cx="23.1" cy="195.3" r="2.7" fill="#A39986"/><circle cx="34.8" cy="178.3" r="3.7" fill="#CFC7B8"/><circle cx="168.6" cy="165.1" r="2.1" fill="#CFC7B8"/><circle cx="93.0" cy="146.1" r="3.1" fill="#B8AE9C"/><circle cx="13.5" cy="217.9" r="2.8" fill="#CFC7B8"/><circle cx="27.2" cy="227.2" r="4.2" fill="#CFC7B8"/><circle cx="60.4" cy="162.2" r="2.0" fill="#C9D3D6"/><circle cx="175.6" cy="155.3" r="1.7" fill="#CFC7B8"/><circle cx="125.5" cy="137.1" r="4.1" fill="#CFC7B8"/><circle cx="131.2" cy="212.4" r="1.5" fill="#DDE3E3"/><circle cx="168.8" cy="145.5" r="1.6" fill="#B8AE9C"/><circle cx="93.2" cy="146.5" r="1.6" fill="#C9D3D6"/><circle cx="172.7" cy="152.7" r="4.0" fill="#B8AE9C"/><circle cx="111.4" cy="215.9" r="1.6" fill="#DDE3E3"/><circle cx="144.2" cy="200.2" r="2.7" fill="#B8AE9C"/><circle cx="175.2" cy="143.5" r="2.6" fill="#DDE3E3"/><circle cx="162.6" cy="181.0" r="2.0" fill="#C9D3D6"/><circle cx="137.9" cy="130.4" r="3.1" fill="#CFC7B8"/><circle cx="128.9" cy="209.0" r="3.8" fill="#A39986"/><circle cx="174.5" cy="175.1" r="2.0" fill="#C9D3D6"/><circle cx="175.5" cy="150.0" r="3.7" fill="#DDE3E3"/><circle cx="165.6" cy="169.2" r="3.0" fill="#B8AE9C"/><circle cx="172.1" cy="153.0" r="3.1" fill="#B8AE9C"/><circle cx="166.1" cy="141.2" r="3.0" fill="#DDE3E3"/><circle cx="138.4" cy="200.4" r="3.9" fill="#A39986"/><circle cx="110.3" cy="217.2" r="3.5" fill="#A39986"/><circle cx="139.5" cy="207.4" r="3.9" fill="#A39986"/><circle cx="164.4" cy="170.7" r="1.7" fill="#A39986"/><circle cx="163.3" cy="143.9" r="3.4" fill="#C9D3D6"/><circle cx="29.2" cy="237.3" r="2.8" fill="#A39986"/><circle cx="146.7" cy="199.9" r="1.6" fill="#B8AE9C"/><circle cx="17.5" cy="226.7" r="3.1" fill="#CFC7B8"/><circle cx="96.1" cy="229.1" r="2.0" fill="#CFC7B8"/><circle cx="171.1" cy="166.9" r="2.1" fill="#CFC7B8"/><circle cx="142.9" cy="199.2" r="3.0" fill="#B8AE9C"/><circle cx="163.7" cy="174.3" r="2.7" fill="#C9D3D6"/><circle cx="36.4" cy="176.0" r="3.0" fill="#B8AE9C"/><circle cx="14.3" cy="198.3" r="2.7" fill="#C9D3D6"/><circle cx="52.5" cy="161.2" r="1.5" fill="#CFC7B8"/><circle cx="15.8" cy="226.8" r="2.3" fill="#CFC7B8"/><circle cx="172.4" cy="168.2" r="3.5" fill="#B8AE9C"/><circle cx="100.9" cy="138.5" r="2.4" fill="#DDE3E3"/><circle cx="152.9" cy="131.7" r="2.6" fill="#CFC7B8"/><circle cx="134.4" cy="134.5" r="3.1" fill="#DDE3E3"/><circle cx="53.9" cy="230.2" r="1.6" fill="#CFC7B8"/><circle cx="26.6" cy="181.5" r="3.9" fill="#C9D3D6"/><circle cx="43.5" cy="237.3" r="3.0" fill="#DDE3E3"/><circle cx="22.3" cy="228.7" r="2.9" fill="#A39986"/><polygon points="176.3,172.7 170.2,175.4 165.7,171.3 166.4,165.8 172.5,164.2 176.9,169.0" fill="#D8DEE0" opacity="1"/><polygon points="68.0,226.3 75.0,229.2 75.2,236.2 70.0,240.0 63.9,236.2 64.4,228.8" fill="#D8DEE0" opacity="1"/><polygon points="25.4,201.5 21.4,208.6 14.0,208.0 10.6,202.1 15.3,196.1 23.1,197.5" fill="#D8DEE0" opacity="1"/><polygon points="95.7,145.8 95.9,137.8 102.6,135.0 108.2,138.5 106.9,145.8 99.5,148.2" fill="#D8DEE0" opacity="1"/></g><circle class="sun" cx="95" cy="185" r="3.5" fill="#E9A66B"/><g class="title-pill">
  <rect x="10" y="10" width="167" height="34" rx="7" fill="#3F8F96" opacity="0.9"/><text class="title-text" x="93.5" y="35" text-anchor="middle" textLength="159" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="23" letter-spacing="1" fill="#FFFFFF">KUIPER BELT</text></g>`;
}

function arthalleysComet(id) {
  return `<rect width="190" height="300" fill="#F7F4EF"/>
<g class="comet-tail"><polygon points="62,226 188,74 176,104 58,246" fill="#B8AE9C" opacity="0.45"/><polygon points="62,230 168,102 160,120 58,240" fill="#8E8472" opacity="0.55"/><polygon points="62,234 140,138 136,148 58,238" fill="#5A5044" opacity="0.6"/></g>
<circle class="comet-head" cx="50" cy="240" r="12" fill="#4A4338"/>
<g class="stars"><circle cx="150" cy="200" r="1.5" fill="#8E8472"/><circle cx="30" cy="150" r="1.5" fill="#8E8472"/><circle cx="120" cy="60" r="1.5" fill="#8E8472"/><circle cx="170" cy="250" r="1.5" fill="#8E8472"/></g><g class="title-pill">
  <rect x="10" y="10" width="169" height="34" rx="7" fill="#3F8F96" opacity="0.9"/><text class="title-text" x="94.5" y="33" text-anchor="middle" textLength="155" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="17.5" letter-spacing="0.3" fill="#FFFFFF">HALLEY'S COMET</text></g>`;
}

function artnexus(id) {
  return `<rect width="190" height="300" fill="#F7F4EF"/><g class="links" stroke="#8E8472" stroke-width="1" opacity="0.6"><line x1="95" y1="160" x2="40" y2="100"/><line x1="95" y1="160" x2="150" y2="108"/><line x1="95" y1="160" x2="46" y2="236"/><line x1="95" y1="160" x2="148" y2="230"/></g>
<g class="coins-outer" fill="none" stroke="#8E8472" stroke-width="1.5"><circle cx="40" cy="100" r="14"/><circle cx="150" cy="108" r="11"/><circle cx="46" cy="236" r="11"/><circle cx="148" cy="230" r="15"/></g>
<g class="coin-core"><circle cx="95" cy="160" r="38" fill="#5A5044"/><circle cx="95" cy="160" r="29" fill="none" stroke="#F7F4EF" stroke-width="2"/><circle cx="95" cy="160" r="9" fill="#F7F4EF"/></g>
<ellipse class="mound" cx="95" cy="300" rx="110" ry="14" fill="#B8AE9C"/><text class="title-text" x="14" y="35" textLength="89" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="23" letter-spacing="1.8" fill="#241F19">NEXUS</text>`;
}

function artvoyager1(id) {
  return `<rect width="190" height="300" fill="#F7F4EF"/>
<path class="trajectory" d="M12,288 Q40,250 70,220" fill="none" stroke="#B8AE9C" stroke-width="1.5" stroke-dasharray="2 5"/>
<g class="craft">
<line x1="84" y1="184" x2="36" y2="244" stroke="#5A5044" stroke-width="3"/><circle cx="34" cy="246" r="4" fill="#8E8472"/>
<line x1="116" y1="184" x2="170" y2="238" stroke="#5A5044" stroke-width="3"/><rect x="164" y="234" width="12" height="16" fill="#8E8472"/>
<polygon points="84,168 116,168 124,184 116,200 84,200 76,184" fill="#5A5044"/>
<path d="M56,128 Q100,200 144,128 Z" fill="#CFC7B8" stroke="#5A5044" stroke-width="1.5"/>
<line x1="56" y1="128" x2="100" y2="94" stroke="#5A5044" stroke-width="1.2"/><line x1="144" y1="128" x2="100" y2="94" stroke="#5A5044" stroke-width="1.2"/><circle cx="100" cy="92" r="3.5" fill="#5A5044"/>
</g>
<g class="stars"><circle cx="160" cy="70" r="1.5" fill="#8E8472"/><circle cx="30" cy="100" r="1.5" fill="#8E8472"/><circle cx="165" cy="150" r="1.5" fill="#8E8472"/><circle cx="20" cy="190" r="1.5" fill="#8E8472"/></g><g class="title-pill">
  <rect x="10" y="10" width="150" height="34" rx="7" fill="#B8557A" opacity="0.9"/><text class="title-text" x="85.5" y="34" text-anchor="middle" textLength="139" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="21.5" letter-spacing="1.8" fill="#FFFFFF">VOYAGER 1</text></g>`;
}

function artproximaCentauri(id) {
  return `<rect width="190" height="300" fill="#F7F4EF"/>
<g class="halo"><circle cx="100" cy="180" r="74" fill="#F1E8DD"/><circle cx="100" cy="180" r="54" fill="#EBDDCF"/></g>
<circle class="star" cx="100" cy="180" r="34" fill="#D9876B"/>
<g class="orbit" fill="none" stroke="#B8AE9C" stroke-width="1.5"><ellipse cx="100" cy="180" rx="84" ry="26" transform="rotate(-15 100 180)"/></g>
<circle class="planet-b" cx="176" cy="160" r="6" fill="#5A5044"/>
<g class="stars"><circle cx="28" cy="90" r="1.5" fill="#8E8472"/><circle cx="160" cy="100" r="1.5" fill="#8E8472"/><circle cx="40" cy="260" r="1.5" fill="#8E8472"/><circle cx="160" cy="270" r="1.5" fill="#8E8472"/></g><g class="title-pill">
  <rect x="10" y="10" width="170" height="34" rx="7" fill="#B8557A" opacity="0.9"/><text class="title-text" x="95" y="32.5" text-anchor="middle" textLength="153" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="15" letter-spacing="0.3" fill="#FFFFFF">PROXIMA CENTAURI</text></g>`;
}

function arteventHorizon(id) {
  return `<rect width="190" height="300" fill="#F7F4EF"/>
<g class="warp" fill="none" stroke="#B8AE9C" stroke-width="1.2"><path d="M0,110 Q95,50 190,110"/><path d="M0,130 Q95,80 190,130"/><path d="M0,270 Q95,330 190,270"/><path d="M0,250 Q95,300 190,250"/></g>
<g class="hole" transform="skewY(-5) rotate(-10 95 175)">
<ellipse cx="95" cy="175" rx="92" ry="62" fill="none" stroke="#8E8472" stroke-width="1.2" opacity="0.5"/>
<ellipse cx="95" cy="175" rx="74" ry="22" fill="none" stroke="#CF7A4B" stroke-width="3"/>
<path d="M45,168 A50,50 0 0 1 145,168" fill="none" stroke="#CF7A4B" stroke-width="2.5" opacity="0.8"/>
<circle cx="95" cy="175" r="38" fill="#17121B"/>
<path d="M45,184 A50,50 0 0 0 145,184" fill="none" stroke="#CF7A4B" stroke-width="2.5" opacity="0.5"/>
</g>
<g class="stars"><circle cx="30" cy="80" r="1.5" fill="#8E8472"/><circle cx="160" cy="70" r="1.5" fill="#8E8472"/><circle cx="40" cy="250" r="1.5" fill="#8E8472"/><circle cx="165" cy="260" r="1.5" fill="#8E8472"/></g><g class="title-pill">
  <rect x="10" y="10" width="169" height="34" rx="7" fill="#B8557A" opacity="0.9"/><text class="title-text" x="94.5" y="33.5" text-anchor="middle" textLength="156" lengthAdjust="spacing" font-family="Jost, 'Helvetica Neue', Arial, sans-serif" font-size="18.5" letter-spacing="0.3" fill="#FFFFFF">EVENT HORIZON</text></g>`;
}

