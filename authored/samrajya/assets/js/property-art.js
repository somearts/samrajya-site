/* ==========================================================================
   SAMRAJYA - THE TEN REMAINING DRAWINGS

   Earth 137 through Sagittarius A* had no drawing, so their cards fell back to
   a letter. These are the other half of the collection, drawn in the same
   vocabulary as the ten that already exist rather than in a new one.

   THE LANGUAGE, TAKEN FROM THE TWENTY THAT WERE ALREADY THERE
   ------------------------------------------------------------
   Two canvases, and the choice between them is compositional rather than
   arbitrary: 328x212 for something wide - a body seen across, a spiral, a
   diagonal - and 190x300 for something tall. Both open on the same ivory and
   neither draws past it.

   Every fill comes from the ramp below and nothing else. There is no gradient,
   no filter, no shadow and no blur anywhere in this file, because there is none
   in the ten that came first; depth is made by overlapping flat shapes at
   partial opacity, which is what the existing drawings do.

   Two restrained accents are allowed - the warm #D9876B, already Proxima
   Centauri's star, and the terracotta #CF7A4B, already the Event Horizon's
   threshold - and each is used once, on the one thing that is the subject. A
   colour that means something is a colour worth having; a board where everything
   is warm has nothing warm to say.

   The thin grey circles are the collection's one recurring ornament. Proxima,
   Halley and Voyager each have a small group of them, they are always #8E8472,
   and they are always 1.5 in radius, so they read as the same sky.

   THE CENTRE OF THE CANVAS IS THE WHOLE OF IT
   --------------------------------------------
   The board shows a drawing in a square and fills it, so the square's crop is
   applied and only the middle of each canvas survives: the middle 190 of 300 on
   a tall card, the middle 212 of 328 on a wide one. Every subject here is
   composed inside those bounds. Centred composition is what the existing
   drawings do too - MOON's surface runs off the bottom edge, JUPITER's off both
   sides - and running off an edge is fine, being outside the crop is not.

   THE PILLS AND TITLES ARE NOT DRAWN HERE
   ---------------------------------------
   The card sets the property's own pill and the property's own name beside the
   drawing, so drawing either again inside the artwork would say it twice. The
   twelve finished cards carry them because they are cards, and `cardArt` strips
   them back off when the board borrows a drawing. These were drawn for the board
   and so simply do not have them.
   ========================================================================== */

/* ------------------------------------------------------------------ the ramp */

const IVORY = "#F7F4EF";
const BONE_HI = "#D8D0C0";
const BONE = "#CFC7B8";
const MID = "#B8AE9C";
const MID_DK = "#A39986";
const GREY = "#8E8472";
const DARK = "#5A5044";
const NEAR_BLACK = "#17121B";
const FAINT = "#E5DFD3";
const HALO_HI = "#F1E8DD";
const HALO_LO = "#EBDDCF";
const WARM = "#D9876B";
const EMBER = "#CF7A4B";

/** The two canvases. Wide for a subject seen across; tall for one seen along. */
export const LANDSCAPE = Object.freeze({ w: 328, h: 212 });
export const PORTRAIT = Object.freeze({ w: 190, h: 300 });

/* ---------------------------------------------------------------- ornaments */

/** The collection's sky. Always the same grey, always the same size. */
const stars = (points) =>
  `<g class="stars">${points
    .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="1.5" fill="${GREY}"/>`)
    .join("")}</g>`;

/** The soft disc a body sits in. Proxima has one; anything in space may. */
const halo = (cx, cy, outer, inner) =>
  `<g class="halo"><circle cx="${cx}" cy="${cy}" r="${outer}" fill="${HALO_HI}"/>` +
  `<circle cx="${cx}" cy="${cy}" r="${inner}" fill="${HALO_LO}"/></g>`;

/* ------------------------------------------------------------------ the ten */

/**
 * Every drawing is a function of nothing, returning the markup inside a canvas
 * of its own size. They are written out rather than generated because each one
 * is a composition chosen for that object and not for any of the others - the
 * same reason the twenty existing ones are twenty separate functions.
 */
export const ART = Object.freeze({
  /* EARTH 137 - a colony world, lit from one side.

     The distinguishing thing is that it is INHABITED, which no other planet on
     this board is: the third orbit is drawn, and the thing on the surface is a
     mast rather than a crater. The catalogue never numbered this star, so it
     has no name to put on it and is only ever shown as light.

     There is no terminator line. There was, and three overlapping circles
     already shade the world, so the extra arc across it read as a scratch on
     the surface rather than as the edge between day and night. */
  "earth-137": {
    ...PORTRAIT,
    draw: () =>
      `${halo(58, 86, 44, 32)}
<circle class="distant-sun" cx="58" cy="86" r="11" fill="${WARM}"/>
<g class="orbit" fill="none" stroke="${MID_DK}" stroke-width="1" stroke-dasharray="3 5" opacity="0.6">
  <ellipse cx="95" cy="300" rx="178" ry="132" transform="rotate(-16 95 300)"/></g>
<g class="world">
  <circle cx="95" cy="322" r="152" fill="${BONE}"/>
  <circle cx="95" cy="352" r="152" fill="${MID}"/>
  <circle cx="95" cy="382" r="152" fill="${MID_DK}"/></g>
<g class="ground-lines" fill="none" stroke="${GREY}" stroke-width="1" opacity="0.3">
  <path d="M8,258 Q95,246 182,258"/><path d="M0,290 Q95,276 190,290"/></g>
<g class="settlement">
  <line x1="66" y1="212" x2="66" y2="192" stroke="${DARK}" stroke-width="2"/>
  <circle cx="66" cy="190" r="2.5" fill="${DARK}"/>
  <line x1="126" y1="228" x2="126" y2="214" stroke="${DARK}" stroke-width="1.6" opacity="0.7"/>
  <circle cx="126" cy="212" r="2" fill="${DARK}" opacity="0.7"/></g>
${stars([[160, 96], [24, 130], [150, 200]])}`,
  },

  /* ORION'S BELT - three stars and nothing else.

     The belt is not a constellation, it is three stars in a line, and that line
     is the whole idea. They are drawn on a diagonal because a horizontal row
     across a wide canvas would read as a rule rather than as an alignment.

     The lane behind them is dust, so it is drawn as dust - two soft rotated
     ellipses with no edges of their own. It was a rectangle first, and a
     rectangle in this place read as a grey bar laid over the sky rather than
     as the lane the belt sits in. */
  "orions-belt": {
    ...LANDSCAPE,
    draw: () =>
      `<g class="dust-lane">
  <ellipse cx="166" cy="102" rx="150" ry="17" fill="${FAINT}" transform="rotate(-19 166 102)"/>
  <ellipse cx="166" cy="102" rx="112" ry="9" fill="${FAINT}" transform="rotate(-19 166 102)"/></g>
${halo(89, 137, 26, 17)}
<circle class="star" cx="89" cy="137" r="12" fill="${BONE_HI}"/>
${halo(166, 101, 32, 22)}
<circle class="star" cx="166" cy="101" r="15" fill="${WARM}"/>
${halo(243, 67, 20, 13)}
<circle class="star" cx="243" cy="67" r="9" fill="${BONE_HI}"/>
${stars([[66, 178], [258, 150], [120, 40], [240, 30]])}`,
  },

  /* WOW! SIGNAL - sixty seconds of narrowband noise in 1977.

     Drawn as what it was: a trace along a band that is flat, flat, flat, then is
     not. The burst is the only part of the drawing that moves, and everything
     else is there to make the burst legible - the dish it came from, and the
     quiet either side of it.

     The burst is NOT shaded underneath. It was, and a filled echo of a spike
     shape sitting a few pixels behind the line itself read as a printing
     mistake rather than as depth; the trace carries the whole idea on its own,
     and a thing that is already a single line does not need a second one. */
  "wow-signal": {
    ...PORTRAIT,
    draw: () =>
      `<g class="trace-quiet" fill="none" stroke="${GREY}" stroke-width="1.2" opacity="0.7">
  <path d="M0,144 H190"/></g>
<g class="trace-burst" fill="none" stroke="${DARK}" stroke-width="1.6" stroke-linejoin="round">
  <path d="M0,144 H58 L66,96 L74,190 L82,120 L90,168 L98,132 H130 L138,138 H190"/></g>
<g class="peak-mark">
  <line x1="66" y1="88" x2="66" y2="96" stroke="${EMBER}" stroke-width="1.6"/>
  <line x1="74" y1="190" x2="74" y2="200" stroke="${EMBER}" stroke-width="1.6"/></g>
<g class="dish">
  <path d="M56,238 A54,54 0 0 1 134,238" fill="none" stroke="${DARK}" stroke-width="2"/>
  <line x1="95" y1="224" x2="95" y2="262" stroke="${DARK}" stroke-width="2"/>
  <line x1="95" y1="262" x2="72" y2="268" stroke="${DARK}" stroke-width="1.6"/>
  <line x1="95" y1="262" x2="118" y2="268" stroke="${DARK}" stroke-width="1.6"/>
  <circle cx="95" cy="224" r="3" fill="${DARK}"/>
  <line x1="95" y1="224" x2="66" y2="152" stroke="${GREY}" stroke-width="1" opacity="0.6"/></g>
${stars([[28, 74], [164, 66], [140, 200]])}`,
  },

  /* DYSON SPHERE - a shell of collectors around one star.

     Nothing about it is built yet; that is the point of the object. So the star
     is at the centre and undrawn-through, and the collectors are a ring of small
     flat panels that stop well short of it, leaving the light they exist to
     catch still visible in the middle.

     It was three concentric ellipse outlines with panels sitting on the middle
     one, and that is a dartboard: any set of evenly spaced concentric curves
     around a bright centre reads as a target no matter what is drawn on it. So
     there is no diagram here at all. The shell is a SPHERE, shaded the way the
     moon in this same collection is shaded - three circles of one shape,
     nudged off one another - with a single limb line for the edge, and the
     collectors sit on its face at uneven radii and uneven sizes rather than on
     a circle.

     The three shaded circles are clipped to the shell's own limb, the same way
     JUPITER clips its bands to its circle. Without that clip the darker tones
     run past the edge of the sphere and stop at the edge of the canvas instead,
     which puts a hard step in the sky just outside the planet. */
  "dyson-sphere": {
    ...PORTRAIT,
    draw: (id) =>
      `<defs><clipPath id="${id}-shell"><circle cx="95" cy="150" r="94"/></clipPath></defs>
<g class="shell-body" clip-path="url(#${id}-shell)">
  <circle cx="95" cy="150" r="94" fill="${HALO_HI}"/>
  <circle cx="119" cy="168" r="94" fill="${BONE}" opacity="0.5"/>
  <circle cx="143" cy="186" r="94" fill="${MID}" opacity="0.35"/></g>
<g class="limb" fill="none" stroke="${GREY}" stroke-width="1" opacity="0.4">
  <circle cx="95" cy="150" r="94"/></g>
<g class="collectors" fill="${DARK}">
  <rect x="88" y="76" width="14" height="8" rx="1"/>
  <rect x="145" y="98" width="14" height="8" rx="1" transform="rotate(50 152 102)"/>
  <rect x="161" y="173" width="14" height="8" rx="1" transform="rotate(110 168 177)"/>
  <rect x="120" y="215" width="14" height="8" rx="1" transform="rotate(155 127 219)"/>
  <rect x="63" y="216" width="14" height="8" rx="1" transform="rotate(200 70 220)"/>
  <rect x="15" y="173" width="14" height="8" rx="1" transform="rotate(250 22 177)"/>
  <rect x="21" y="115" width="14" height="8" rx="1" transform="rotate(295 28 119)"/>
  <rect x="58" y="83" width="14" height="8" rx="1" transform="rotate(335 65 87)"/>
  <rect x="126" y="122" width="11" height="6" rx="1" transform="rotate(20 131 125)"/>
  <rect x="54" y="168" width="11" height="6" rx="1" transform="rotate(160 59 171)"/></g>
<g class="star">
  <circle cx="95" cy="150" r="30" fill="${BONE_HI}"/>
  <circle cx="95" cy="150" r="21" fill="${WARM}"/>
  <circle cx="95" cy="150" r="11" fill="${HALO_HI}"/></g>
${stars([[26, 52], [166, 46], [172, 252]])}`,
  },

  /* WORMHOLE - a passage, drawn as the field bending into it.

     The Event Horizon draws lines running past a dark disc. This draws the same
     lines running round one, which is the difference between a thing you cannot
     leave and a road.

     It was a black ELLIPSE inside two larger ellipses, on a field of straight
     horizontal lines, and every one of those three things says the same word:
     it read as an eye looking out of the page. It passed on the first look and
     failed when the twenty were laid out side by side, which is the only way
     this kind of mistake is visible - judged alone, a drawing is only ever
     being asked whether it is recognisable, and being recognisable is not the
     same as looking like what it is.

     So the throat is a CIRCLE, because a portal seen face on is round, and the
     field lines now arc over and under it instead of running straight across.
     Nothing is left that the eye can take hold of - including the pale rim light
     that went on the throat first, which put a white curved glint inside a dark
     round shape and finished the resemblance off. The throat is flat black with
     a warm rim and nothing else. */
  wormhole: {
    ...PORTRAIT,
    draw: () =>
      `<g class="warp-over" fill="none" stroke="${MID}" stroke-width="1.2" opacity="0.75">
  <path d="M0,150 Q95,84 190,150"/>
  <path d="M0,126 Q95,58 190,126"/></g>
<g class="warp-under" fill="none" stroke="${MID}" stroke-width="1.2" opacity="0.75">
  <path d="M0,162 Q95,228 190,162"/>
  <path d="M0,186 Q95,256 190,186"/></g>
<g class="warp-in" fill="none" stroke="${GREY}" stroke-width="1" opacity="0.6">
  <path d="M0,156 Q44,156 64,146"/>
  <path d="M190,156 Q146,156 126,146"/></g>
<g class="lensing" fill="none" stroke="${MID_DK}" stroke-width="1" opacity="0.45">
  <circle cx="95" cy="156" r="54"/></g>
<g class="throat">
  <circle cx="95" cy="156" r="31" fill="${NEAR_BLACK}"/>
  <circle cx="95" cy="156" r="35" fill="none" stroke="${EMBER}" stroke-width="2.4"/></g>
${stars([[30, 58], [162, 62], [58, 252], [150, 262]])}`,
  },

  /* MILKY WAY - the galaxy, seen face on.

     Two arms and a brightening centre, drawn as one continuous stroke each so
     that they read as arms rather than as a set of arcs. The disc behind them
     is the light of a hundred thousand light years, which is why it is pale. */
  "milky-way": {
    ...LANDSCAPE,
    draw: () =>
      `<g class="disc" fill="${HALO_HI}">
  <ellipse cx="164" cy="106" rx="128" ry="96"/></g>
<g class="disc-core" fill="${HALO_LO}">
  <ellipse cx="164" cy="106" rx="74" ry="56"/></g>
<g class="arms" fill="none" stroke-linecap="round">
  <path d="M164,106 C136,88 100,92 84,116" stroke="${MID}" stroke-width="6" opacity="0.6"/>
  <path d="M84,116 C66,144 92,178 132,178" stroke="${MID}" stroke-width="3.2" opacity="0.38"/>
  <path d="M132,178 C160,178 180,166 192,148" stroke="${MID}" stroke-width="1.6" opacity="0.22"/>
  <path d="M164,106 C192,124 228,120 244,96" stroke="${MID}" stroke-width="6" opacity="0.6"/>
  <path d="M244,96 C262,68 236,32 196,34" stroke="${MID}" stroke-width="3.2" opacity="0.38"/>
  <path d="M196,34 C168,34 148,46 136,64" stroke="${MID}" stroke-width="1.6" opacity="0.22"/></g>
<g class="core" fill="${BONE_HI}">
  <ellipse cx="164" cy="106" rx="22" ry="17"/></g>
<g class="core-warm" fill="${WARM}" opacity="0.85">
  <ellipse cx="164" cy="106" rx="9" ry="7"/></g>
${stars([[64, 62], [268, 158], [44, 150], [286, 62]])}`,
  },

  /* RAMA - a cylinder, and nobody aboard.

     Clarke's ship is a perfect cylinder fifty kilometres long, and it is the
     only object on this board with an obviously manufactured surface. So it is
     drawn as a machined cylinder: flat sides, a hard highlight down one edge, a
     shadow down the other, and a single row of panels. No lights. There is no
     one to switch them on. */
  rama: {
    ...PORTRAIT,
    draw: () =>
      `<g class="hull">
  <rect x="34" y="66" width="122" height="176" fill="${BONE}"/>
  <rect x="34" y="66" width="30" height="176" fill="${BONE_HI}"/>
  <rect x="128" y="66" width="28" height="176" fill="${MID}" opacity="0.8"/>
  <rect x="150" y="66" width="6" height="176" fill="${MID_DK}" opacity="0.6"/></g>
<g class="ends" fill="${MID}" opacity="0.7">
  <ellipse cx="95" cy="66" rx="61" ry="9"/>
  <ellipse cx="95" cy="242" rx="61" ry="9"/></g>
<g class="ribs" stroke="${GREY}" stroke-width="1" opacity="0.35">
  <line x1="34" y1="106" x2="156" y2="106"/>
  <line x1="34" y1="146" x2="156" y2="146"/>
  <line x1="34" y1="186" x2="156" y2="186"/></g>
<g class="panel-row" fill="${DARK}" opacity="0.65">
  <rect x="46" y="120" width="12" height="7" rx="1"/>
  <rect x="66" y="120" width="12" height="7" rx="1"/>
  <rect x="86" y="120" width="12" height="7" rx="1"/>
  <rect x="106" y="120" width="12" height="7" rx="1"/>
  <rect x="126" y="120" width="12" height="7" rx="1"/></g>
<g class="seam" stroke="${GREY}" stroke-width="1" opacity="0.4">
  <line x1="95" y1="66" x2="95" y2="242"/></g>
${stars([[24, 92], [172, 108], [30, 224]])}`,
  },

  /* QUASAR - a galaxy's heart, seen edge on.

     The one thing that distinguishes a quasar is how bright it is and how small
     the source of it is. So the jets are long and faint and the thing making
     them is a dot. The disc is edge-on because that is the only angle from which
     a quasar is seen to be this far away. */
  quasar: {
    ...PORTRAIT,
    draw: () =>
      `<g class="jets" fill="${MID}" opacity="0.5">
  <polygon points="95,148 89,54 101,54"/>
  <polygon points="95,162 89,256 101,256"/></g>
<g class="jets-core" fill="${BONE}" opacity="0.65">
  <polygon points="95,152 91,96 99,96"/>
  <polygon points="95,158 91,214 99,214"/></g>
<g class="disc" transform="rotate(-12 95 155)">
  <ellipse cx="95" cy="155" rx="86" ry="17" fill="${MID_DK}" opacity="0.55"/>
  <ellipse cx="95" cy="155" rx="60" ry="10" fill="${GREY}" opacity="0.6"/>
  <ellipse cx="95" cy="155" rx="32" ry="4.5" fill="${MID}" opacity="0.5"/></g>
<g class="core">
  <circle cx="95" cy="155" r="13" fill="${BONE_HI}"/>
  <circle cx="95" cy="155" r="6" fill="${WARM}"/></g>
${stars([[34, 76], [158, 84], [30, 240], [166, 236]])}`,
  },

  /* SUPERNOVA - a star that has already happened.

     The explosion is not a flash drawn as a starburst; it is a shell that has
     left the star and is still going. So the centre is empty and pale, and the
     brightness has moved outward, with the knots of ejected material riding on
     the outermost front.

     The shells are three CIRCLES and they are nearly concentric, which is the
     one thing that could have made this a target - and they still did. Offsetting
     them and brightening one side of each was not enough, because concentric
     curves around a bright centre stay a dartboard however lopsided they get.

     So there are no shells. The ejecta is a CLOUD: eight overlapping pale discs
     at slightly different radii that merge into one lumpy mass, with a brighter
     front of smaller discs riding on the outside of it. No circle is ever
     visible as a circle, which is what a shock front of real gas looks like and
     is the opposite of what three drawn rings look like.

     The eight cloud discs overlap HEAVILY, at nearly their own diameter apart,
     and the brighter front is only three discs. Drawn smaller and further apart
     they stopped being a front and became petals, and the whole thing read as a
     flower - which is the second failure mode of this drawing, and the reason
     the front is weighted to one side rather than spaced evenly all round. */
  supernova: {
    ...PORTRAIT,
    draw: () =>
      `<g class="shell-cloud" fill="${HALO_LO}">
  <circle cx="86" cy="96" r="38"/><circle cx="128" cy="110" r="40"/>
  <circle cx="150" cy="146" r="38"/><circle cx="134" cy="186" r="40"/>
  <circle cx="92" cy="196" r="36"/><circle cx="54" cy="176" r="38"/>
  <circle cx="46" cy="132" r="36"/><circle cx="66" cy="98" r="34"/></g>
<g class="shell-front" fill="${MID}" opacity="0.38">
  <circle cx="140" cy="172" r="28"/><circle cx="122" cy="192" r="26"/>
  <circle cx="158" cy="146" r="24"/></g>
<g class="streaks" stroke="${MID_DK}" stroke-width="1.4" opacity="0.35" stroke-linecap="round">
  <line x1="172" y1="104" x2="188" y2="94"/><line x1="178" y1="170" x2="192" y2="180"/>
  <line x1="128" y1="212" x2="132" y2="228"/><line x1="34" y1="170" x2="22" y2="178"/>
  <line x1="52" y1="94" x2="42" y2="84"/></g>
<g class="ejecta" fill="${MID_DK}" opacity="0.9">
  <polygon points="22,116 31,110 35,121 26,125"/>
  <polygon points="148,86 159,82 162,94 151,96"/>
  <polygon points="170,170 179,175 172,185 164,179"/>
  <polygon points="44,208 53,202 58,212 48,216"/>
  <polygon points="126,214 133,207 139,215 131,220"/></g>
<g class="afterglow">
  <circle cx="95" cy="152" r="28" fill="${HALO_LO}"/>
  <circle cx="95" cy="152" r="17" fill="${BONE_HI}"/>
  <circle cx="95" cy="152" r="7" fill="${WARM}"/></g>
${stars([[40, 96], [154, 92], [172, 240], [28, 246]])}`,
  },

  /* SAGITTARIUM A* - a black mass in the middle of our own galaxy.

     The only thing here is an absence, and it is found by radio rather than
     seen. So it is drawn the way it is actually known: a dark centre, the
     emission the gas around it gives out either side, and the thin bright ring
     that is the lensing of what is behind it. It is the last square before the
     circuit closes, and it is drawn as the quietest thing on the board.

     The one warm ring is drawn AROUND the mass, arcing over the top of it, and
     it is there because the accretion flow is real even though nobody has seen
     it - it is inferred from the orbits of the stars going round. An elliptical
     arc was tried first and whichever way the sweep flag went it bulged down,
     where the black disc hides it and only two stubs either side survive. It is
     an explicit curve now, so where the glow sits is stated rather than
     inferred from an arc's geometry. */
  "sagittarius-a-star": {
    ...PORTRAIT,
    draw: () =>
      `<g class="glow" fill="${HALO_HI}" opacity="0.85">
  <circle cx="95" cy="156" r="62"/></g>
<g class="glow-ring" fill="none" stroke="${EMBER}" stroke-width="1.6" opacity="0.85">
  <path d="M46,150 C46,116 68,92 95,92 C122,92 144,116 144,150"/></g>
<g class="emission" fill="none" stroke="${GREY}" stroke-linecap="round">
  <path d="M33,168 Q95,190 157,168" stroke-width="2.4" opacity="0.75"/>
  <path d="M41,186 Q95,206 149,186" stroke-width="1.6" opacity="0.55"/>
  <path d="M33,142 Q95,120 157,142" stroke-width="1.2" opacity="0.4"/></g>
<g class="lensing" fill="none" stroke="${MID_DK}" stroke-width="1.6" opacity="0.9">
  <ellipse cx="95" cy="156" rx="56" ry="50"/></g>
<g class="mass">
  <circle cx="95" cy="156" r="38" fill="${NEAR_BLACK}"/>
  <circle cx="95" cy="156" r="38" fill="none" stroke="${DARK}" stroke-width="1.4" opacity="0.8"/></g>
${stars([[38, 74], [156, 82], [26, 236], [166, 244]])}`,
  },
});

/** The ids this module draws, in board order. */
export const ART_IDS = Object.freeze(Object.keys(ART));

/** Hands each drawing its own clip id, so two of the same never share one. */
let drawn = 0;

/**
 * One property's drawing, as a standalone SVG, or null.
 *
 * Each drawing is given a unique id to build its clip from, for the same reason
 * `cardArt` does: JUPITER clips its bands to its own circle, and DYSON SPHERE
 * clips its shading to its own limb, and two of the same card on one page must
 * not point at the first one's clip.
 */
export function propertyArt(id) {
  const art = ART[String(id ?? "")];
  if (!art) return null;

  const { w, h } = art;
  drawn += 1;
  const body = art.draw(`pa${drawn}`);

  // The same wrapper cardArt uses: ivory ground, and slice rather than meet so a
  // tall drawing fills a square instead of floating in the middle of one with
  // most of the box empty.
  return (
    `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" ` +
    `aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice" ` +
    `class="property-card__art-svg" data-art="${id}">` +
    `<rect width="${w}" height="${h}" fill="${IVORY}"/>` +
    body +
    `</svg>`
  );
}

/** Does the board have a drawing for this property? */
export function hasPropertyArt(id) {
  return Boolean(ART[String(id ?? "")]);
}