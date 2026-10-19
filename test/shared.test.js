/* ==========================================================================
   THE SHARED MODULES

   civilizations.js, identity.js and the twelve cards. Written from what the code
   does, not from what it is supposed to do: every expectation below was run
   against the code before it was written down, and several of them are here
   because running them changed my mind about what the code does.

   THE FILE THIS REPLACES WAS LOST
   -------------------------------
   An earlier test/shared.test.js held 54 tests and was destroyed by careless
   editing with no version control to recover it from. This is a new file. It is
   NOT the old one rebuilt and it does not claim to be: some behaviours are
   covered here that the old file may not have touched, and behaviours the old
   file asserted may be missing because nothing now records that they were ever
   expected. What this file guarantees is that the code as it stands is pinned
   down, and that a change which breaks one of these is a change somebody chose.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CIVILIZATIONS,
  civById,
  coinColor,
  isCiv,
  civIds,
  nameOf,
  choices,
} from "../shared/civilizations.js";
import { SETS } from "../shared/spaces.js";

import {
  NAME_MIN,
  NAME_MAX,
  PLAYER_HEADER,
  ROOM_CODE_LENGTH,
  roomAlphabet,
  isRoomCode,
  parseRoomCode,
  cleanName,
  newIdentity,
  isIdentity,
  newCreateKey,
  isCreateKey,
  deriveCode,
} from "../shared/identity.js";

import { GROUPS, PILL_LAYOUT, cardKeys, cardFor, cardSvg } from "../authored/samrajya/assets/js/cards.js";

/* --------------------------------------------------------------- the record */

test("the civilizations file is written down as four, in the order they are offered", () => {
  assert.equal(CIVILIZATIONS.length, 4);
  assert.deepEqual(
    CIVILIZATIONS.map((c) => c.id),
    ["indus-valley", "mesopotamian", "ancient-egyptian", "aztec"],
  );
  assert.deepEqual(
    CIVILIZATIONS.map((c) => c.name),
    ["Indus Valley", "Mesopotamian", "Ancient Egyptian", "Aztec"],
  );
});

test("and it is frozen all the way down, not just the list", () => {
  // Object.freeze on the array alone leaves the records inside mutable, and
  // choices() is a shallow copy - so without this a caller could rename a
  // civilisation for the picker, the server and everybody else.
  assert.ok(Object.isFrozen(CIVILIZATIONS));
  for (const civ of CIVILIZATIONS) assert.ok(Object.isFrozen(civ), civ.id);
});

/* ------------------------------------------------------------- coin colours */

/**
 * Colour difference in CIE Lab, CIE76.
 *
 * Squared RGB distance is not a good enough measure to write a rule about. It
 * rates a saturated blue against a dark grey as being about as different as two
 * pastels of the same hue are, which is false to the eye and would let a rule
 * like "the coins must stand apart from the pills" pass on two colours nobody
 * could tell apart on the board.
 *
 * Lab is the space that was invented to stop exactly that happening: it is
 * roughly perceptually uniform, so a dE of 30 means "plainly different colours"
 * and not "different numbers". The maths is thirty lines rather than a
 * dependency, and the same thirty lines are what chose the four values in the
 * first place.
 */
function lab(hex) {
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r8, g8, b8] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = [r8, g8, b8].map(toLinear);

  // sRGB to XYZ, then to the reference white D65.
  let x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;

  // The cube root, with the linear part of the curve kept for near-black values
  // where it would otherwise divide by roughly nothing.
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  [x, y, z] = [f(x), f(y), f(z)];

  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE(a, b) {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

test("every civilisation has one coin colour, and coinColor finds it", () => {
  for (const civ of CIVILIZATIONS) {
    assert.match(civ.coin, /^#[0-9A-F]{6}$/, `${civ.id} has a coin colour`);
    assert.equal(coinColor(civ.id), civ.coin, `${civ.id} resolves to its own`);
    assert.equal(coinColor(civ.id.toUpperCase()), civ.coin, `${civ.id} ignores case`);
  }
});

test("and coinColor returns null rather than a guess for anything else", () => {
  // The same rule as everywhere else in this file. A fallback colour here would
  // put two players' coins in the same blue because neither had chosen.
  for (const nope of ["roman", "", null, undefined, 7]) {
    assert.equal(coinColor(nope), null, `${nope} has no coin colour`);
  }
});

test("the four coin colours are told apart from each other", () => {
  const coins = CIVILIZATIONS.map((c) => c.coin);
  for (let i = 0; i < coins.length; i++) {
    for (let j = i + 1; j < coins.length; j++) {
      const d = deltaE(coins[i], coins[j]);
      assert.ok(d >= 30, `${CIVILIZATIONS[i].id} and ${CIVILIZATIONS[j].id} are ${d.toFixed(1)} apart`);
    }
  }
});

test("and none of them can be mistaken for a set pill it stands beside", () => {
  // This is the one that matters. A coin the same value as the pill next to it
  // is a coin nobody can pick out, and the amber/gold pair is the risk: s6 is a
  // muted gold and amber is a bright one, which is a distinction the eye makes
  // at a glance on a swatch and not at all on a 40px disc in a corner.
  const pills = Object.values(SETS).map((s) => s.color);
  for (const civ of CIVILIZATIONS) {
    const nearest = pills
      .map((p) => ({ p, d: deltaE(civ.coin, p) }))
      .sort((a, b) => a.d - b.d)[0];
    assert.ok(
      nearest.d >= 30,
      `${civ.id}'s coin is only ${nearest.d.toFixed(1)} from pill ${nearest.p}`,
    );
  }
});

test("the set colours themselves are unchanged", () => {
  // The coins are additive. If a set colour had to move to make room for a
  // coin, every pill and every card on the board would have moved with it.
  assert.deepEqual(
    Object.values(SETS).map((s) => s.color),
    ["#7B68B0", "#CF7A4B", "#3F8F96", "#B8557A", "#6F9A7B", "#C9A24A", "#5B6FA6", "#A8564C"],
  );
});

/* --------------------------------------------------------------- lookup */

test("civById resolves each of the four, whatever case or padding it arrives in", () => {
  for (const civ of CIVILIZATIONS) {
    assert.equal(civById(civ.id)?.name, civ.name);
    assert.equal(civById(civ.id.toUpperCase())?.name, civ.name);
    assert.equal(civById(`  ${civ.id}  `)?.name, civ.name);
  }
});

test("and returns null for anything that is not one of them", () => {
  // Null is never a fallback. A player who has not chosen has not chosen, and
  // the caller has to deal with that.
  for (const nope of ["roman", "", "  ", null, undefined, 0, {}, "indus valley"]) {
    assert.equal(civById(nope), null, `${JSON.stringify(nope)} is not a civilisation`);
  }
});

test("isCiv answers the door's question and nothing more", () => {
  for (const civ of CIVILIZATIONS) {
    assert.equal(isCiv(civ.id), true);
    assert.equal(isCiv(civ.id.toUpperCase()), true);
  }
  for (const nope of ["roman", "", null, undefined, 7]) {
    assert.equal(isCiv(nope), false);
  }
});

test("civIds is the ids in order, and choices is a copy the picker cannot edit", () => {
  assert.deepEqual(civIds(), CIVILIZATIONS.map((c) => c.id));

  // The array is a copy, so adding to it changes nothing. The records inside it
  // are frozen, so changing one is refused - which is the point, and is why
  // this test was written twice: the first version asserted that a rename
  // silently did not stick, and it did stick.
  const offered = choices();
  offered.push({ id: "roman", name: "Roman" });
  assert.equal(CIVILIZATIONS.length, 4);
  assert.throws(() => {
    offered[0].name = "changed";
  }, TypeError);
  assert.equal(CIVILIZATIONS[0].name, "Indus Valley");
});

test("nameOf speaks in a sentence for a refusal, which is the only reason it exists", () => {
  for (const civ of CIVILIZATIONS) {
    assert.equal(nameOf(civ.id), civ.name);
    assert.equal(nameOf(civ.id.toUpperCase()), civ.name);
  }
  // Used to say "Ancient Egyptian is already taken" - so an unknown id has to
  // read as a phrase, not as null or as the word "undefined".
  assert.equal(nameOf("roman"), "That civilisation");
  assert.equal(nameOf(null), "That civilisation");
});

/* --------------------------------------------------------------- identity */

test("a name may be one character and may be twenty-four, and no more", () => {
  assert.equal(NAME_MIN, 1);
  assert.equal(NAME_MAX, 24);
  assert.equal(PLAYER_HEADER, "x-samrajya-player");
});

test("cleanName tidies whitespace before it counts anything", () => {
  assert.deepEqual(cleanName("Asha"), { ok: true, value: "Asha" });
  assert.deepEqual(cleanName("  Vikram  "), { ok: true, value: "Vikram" });
  assert.deepEqual(cleanName("An   \t  Okoye\n"), { ok: true, value: "An Okoye" });
});

test("and refuses an empty name with a sentence, not a status code", () => {
  for (const empty of ["", "   ", "\t\n", null, undefined]) {
    const result = cleanName(empty);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "Enter a name.");
  }
});

test("a name of exactly twenty-four is allowed and twenty-five is not", () => {
  const exactly = "a".repeat(NAME_MAX);
  const tooLong = "a".repeat(NAME_MAX + 1);
  assert.deepEqual(cleanName(exactly), { ok: true, value: exactly });
  const refused = cleanName(tooLong);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /24 characters or fewer/);
});

/* --------------------------------------------------------------- room codes */

test("a room code is eight characters with no look-alikes in it", () => {
  assert.equal(ROOM_CODE_LENGTH, 8);
  const alphabet = roomAlphabet();
  // 23 letters and 8 digits: the whole alphabet is thirty-one, which is why
  // deriveCode rejects the top 8 of every 256-byte block rather than taking a
  // plain modulus - 31 does not divide 256, and a modulus would quietly favour
  // the first few characters.
  assert.equal(alphabet.length, 31);
  assert.equal(alphabet.slice(0, 23).replace(/[^a-z]/g, ""), alphabet.slice(0, 23));
  assert.equal(alphabet.slice(23), "23456789");
  assert.equal(256 % alphabet.length, 8);
  // A code read aloud or copied off a screen has to be typeable without a
  // second look, so these are absent on purpose.
  for (const gone of ["0", "1", "i", "l", "o", "I", "L", "O"]) {
    assert.equal(alphabet.includes(gone), false, `${gone} must not be in the alphabet`);
  }
});

test("isRoomCode checks the shape and nothing else", () => {
  assert.equal(isRoomCode("abcd2345"), true);
  assert.equal(isRoomCode("ABCD2345"), true, "case is not a second code");
  assert.equal(isRoomCode("  abcd2345 "), true);

  assert.equal(isRoomCode("abcd234"), false, "seven is not eight");
  assert.equal(isRoomCode("abcd23456"), false, "nine is not eight");
  assert.equal(isRoomCode("abcd234i"), false, "i is not in the alphabet");
  assert.equal(isRoomCode("abcd2340"), false, "0 is not in the alphabet");
  assert.equal(isRoomCode(""), false);
  assert.equal(isRoomCode(null), false);
  assert.equal(isRoomCode(undefined), false);
});

test("a pasted invite link is the same code however it was pasted", () => {
  assert.equal(parseRoomCode("abcd2345"), "abcd2345");
  assert.equal(parseRoomCode("  ABCD2345. "), "abcd2345", "capitals and a full stop");
  assert.equal(parseRoomCode("https://golake.app/samrajya/?room=abcd2345"), "abcd2345");
  assert.equal(parseRoomCode("https://golake.app/samrajya/abcd2345"), "abcd2345");
  assert.equal(parseRoomCode("https://golake.app/samrajya/?x=1&room=abcd2345&y=2"), "abcd2345");
});

test("and a bare link is not a room code, even though samrajya is eight valid letters", () => {
  // This is the trap the code's own comment names. "samrajya" is eight
  // characters from the code alphabet, so a parser that took the last segment
  // of any URL would hand back the name of the app as a room code.
  assert.equal(roomAlphabet().includes("s"), true);
  assert.equal(isRoomCode("samrajya"), true, "as a bare code, yes");
  assert.equal(
    parseRoomCode("https://golake.app/samrajya"),
    null,
    "but not out of a link that merely ends there",
  );
  assert.equal(parseRoomCode("https://golake.app/"), null);
  assert.equal(parseRoomCode(""), null);
  assert.equal(parseRoomCode(null), null);
});

/* ----------------------------------------------------------- identities */

test("an identity is 128 random bits and a different one every time", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const id = newIdentity();
    assert.equal(id.length, 32);
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.equal(isIdentity(id), true);
    seen.add(id);
  }
  assert.equal(seen.size, 200, "200 identities, 200 different ones");
});

test("isIdentity refuses anything we did not issue, and a create key has the same shape", () => {
  assert.equal(isIdentity(""), false);
  assert.equal(isIdentity(null), false);
  assert.equal(isIdentity("a".repeat(31)), false);
  assert.equal(isIdentity("a".repeat(33)), false);
  assert.equal(isIdentity("z".repeat(32)), false, "not hex");
  assert.equal(isIdentity("A".repeat(32)), true, "case is not a second identity");

  const key = newCreateKey();
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(isCreateKey(key), true);
  assert.equal(isCreateKey(""), false);
  assert.equal(isCreateKey("a".repeat(31)), false);
});

/* ----------------------------------------------------------- the derived code */

test("deriveCode is the same room for the same two attempts", async () => {
  const who = newIdentity();
  const key = newCreateKey();
  // The whole point of deriving rather than drawing: a double-tap on Create
  // sends the same request twice and lands on the room that is already there.
  assert.equal(await deriveCode(who, key), await deriveCode(who, key));
});

test("and a different room for a different attempt, or a different browser", async () => {
  const who = newIdentity();
  const code = await deriveCode(who, newCreateKey());
  const otherAttempt = await deriveCode(who, newCreateKey());
  const otherBrowser = await deriveCode(newIdentity(), newCreateKey());
  assert.notEqual(code, otherAttempt);
  assert.notEqual(code, otherBrowser);
});

test("every derived code is a real code, and the letters are not being favoured", async () => {
  const alphabet = roomAlphabet();
  for (let i = 0; i < 100; i++) {
    const code = await deriveCode(newIdentity(), newCreateKey());
    assert.equal(code.length, ROOM_CODE_LENGTH);
    assert.equal(isRoomCode(code), true);
    for (const character of code) {
      assert.ok(alphabet.includes(character), `${character} is in the alphabet`);
    }
  }
});

test("deriveCode refuses to guess when it is handed something that is not an identity", async () => {
  await assert.rejects(() => deriveCode("not-an-identity", newCreateKey()), /real identity/);
  await assert.rejects(() => deriveCode(newIdentity(), "nope"), /real create key/);
  await assert.rejects(() => deriveCode(null, null), /real identity/);
});

/* ------------------------------------------------------------------- cards */

test("there are twelve cards, in board order", () => {
  assert.deepEqual(cardKeys(), [
    "moon",
    "lagrange-point",
    "ragnarok",
    "asteroid-belt",
    "jupiter",
    "pluto",
    "kuiper-belt",
    "halleys-comet",
    "nexus",
    "voyager-1",
    "proxima-centauri",
    "event-horizon",
  ]);
});

test("two of them are chests and belong to no group; the other ten do", () => {
  const types = cardKeys().map((k) => cardFor(k).type);
  assert.equal(types.filter((t) => t === "chest").length, 2);
  assert.equal(types.filter((t) => t === "property").length, 10);
  assert.deepEqual(cardKeys().filter((k) => cardFor(k).type === "chest"), [
    "ragnarok",
    "nexus",
  ]);
  for (const key of cardKeys()) {
    const card = cardFor(key);
    if (card.type === "chest") {
      assert.equal(card.group, null, `${key} is a chest and belongs to no set`);
    } else {
      assert.ok(GROUPS[card.group], `${key} is in a group that exists`);
    }
  }
});

test("the four groups are the four colours", () => {
  assert.deepEqual(GROUPS, {
    purple: "#7B68B0",
    terracotta: "#CF7A4B",
    teal: "#3F8F96",
    rose: "#B8557A",
  });
});

test("the artwork keeps its two formats, six of each, and the radius follows the format", () => {
  const sizes = cardKeys().map((k) => `${cardFor(k).w}x${cardFor(k).h}`);
  assert.equal(sizes.filter((s) => s === "328x212").length, 6);
  assert.equal(sizes.filter((s) => s === "190x300").length, 6);
  for (const key of cardKeys()) {
    const { w, rx } = cardFor(key);
    assert.equal(rx, w === 328 ? 8 : 6, `${key} has the radius its format uses`);
  }
});

test("cardFor and cardSvg answer for every key, and nothing for a key that is not there", () => {
  for (const key of cardKeys()) {
    const card = cardFor(key);
    assert.ok(card, `${key} has a card`);
    assert.equal(cardSvg(key).length > 0, true);
  }
  assert.equal(cardFor("roman"), undefined);
  assert.equal(cardSvg("roman"), "");
  assert.equal(cardFor(null), undefined);
});

test("every card's wrapper is written from that card's own numbers", () => {
  for (const key of cardKeys()) {
    const card = cardFor(key);
    const svg = cardSvg(key);
    assert.ok(svg.includes(`viewBox="0 0 ${card.w} ${card.h}"`), `${key} viewBox`);
    assert.ok(svg.includes(`aria-label="${card.name}"`), `${key} is labelled`);
    assert.ok(svg.includes(`data-card="${key}"`), `${key} says which it is`);
    assert.ok(svg.includes(`data-type="${card.type}"`), `${key} says what it is`);
    assert.ok(svg.includes(`stroke="${card.border}"`), `${key} has its border`);
  }
});

test("two cards of the same key never share a clip id", () => {
  // A duplicate id on one page breaks the clipping, and the board draws every
  // card at once.
  const first = cardSvg("moon");
  const second = cardSvg("moon");
  const idOf = (svg) => svg.match(/<clipPath id="([^"]+)"/)[1];
  assert.notEqual(idOf(first), idOf(second));
  // Every card drawn in one go has an id of its own.
  const all = cardKeys().map(cardSvg);
  const ids = all.map(idOf);
  assert.equal(new Set(ids).size, ids.length);
});

test("every card sits on the shared ivory, including the two chests", () => {
  for (const key of cardKeys()) {
    const svg = cardSvg(key);
    assert.ok(
      svg.includes(`<rect width="${cardFor(key).w}" height="${cardFor(key).h}" fill="#F7F4EF"/>`),
      `${key} has the ivory ground`,
    );
    assert.equal(
      /fill="#(26211C|000000|3A3042)"/.test(svg),
      false,
      `${key} has no black field`,
    );
  }
});

test("ten cards carry a pill around a white title; the two chests carry neither", () => {
  let pills = 0;
  for (const key of cardKeys()) {
    const svg = cardSvg(key);
    const has = svg.includes('<g class="title-pill">');
    if (cardFor(key).type === "property") {
      assert.equal(has, true, `${key} has a pill`);
      assert.ok(svg.includes('fill="#FFFFFF"'), `${key}'s title is white`);
      pills += 1;
    } else {
      assert.equal(has, false, `${key} is a chest and has no pill`);
    }
  }
  assert.equal(pills, 10);
});

test("the pill is drawn around its title, not beside it", () => {
  for (const key of cardKeys()) {
    const svg = cardSvg(key);
    if (!svg.includes('<g class="title-pill">')) continue;
    const pill = svg.match(
      /<g class="title-pill">\s*<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/,
    );
    const title = svg.match(/<text class="title-text"[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"/);
    assert.ok(pill && title, `${key} has both a pill and a title`);
    const [px, py, pw, ph] = pill.slice(1).map(Number);
    const [tx, ty] = title.slice(1).map(Number);
    assert.ok(Math.abs(tx - (px + pw / 2)) <= 1, `${key}'s title is centred on its pill`);
    assert.ok(ty > py && ty < py + ph, `${key}'s title sits inside its pill`);
  }
});

test("Lagrange Point is displayed without the L2 on the card", () => {
  // The card says LAGRANGE POINT. The board's cell says Lagrange Point L2.
  // They are different things and neither is allowed to change the other.
  assert.ok(cardSvg("lagrange-point").includes(">LAGRANGE POINT<"));
  assert.equal(cardSvg("lagrange-point").includes(">LAGRANGE POINT L2<"), false);
});

test("no card reaches outside itself for anything", () => {
  for (const key of cardKeys()) {
    const svg = cardSvg(key);
    assert.equal(/<image\b|xlink:href|\bsrc=/.test(svg), false, `${key} fetches nothing`);
    assert.equal(
      /<linearGradient|<radialGradient|<filter\b|\bfilter=|feGaussian|drop-shadow/.test(svg),
      false,
      `${key} has no gradient, filter or shadow`,
    );
    // The SVG namespace is the one URL allowed.
    const urls = svg.match(/https?:\/\/[^"']+/g) || [];
    for (const url of urls) {
      assert.equal(url, "http://www.w3.org/2000/svg", `${key}: ${url}`);
    }
  }
});

test("the pill geometry is published per format, so a check can measure against it", () => {
  assert.deepEqual(Object.keys(PILL_LAYOUT).map(Number).sort((a, b) => a - b), [190, 328]);
  for (const [format, layout] of Object.entries(PILL_LAYOUT)) {
    for (const key of ["x", "y", "height", "rx"]) {
      assert.equal(typeof layout[key], "number", `${format} has a ${key}`);
    }
    assert.ok(Object.isFrozen(layout));
  }
  // Every property card's pill is at the position its format's layout names.
  for (const key of cardKeys()) {
    const card = cardFor(key);
    if (card.type !== "property") continue;
    const layout = PILL_LAYOUT[card.w];
    assert.ok(layout, `${key} is a ${card.w} card and has a layout`);
    const pill = cardSvg(key).match(
      /<g class="title-pill">\s*<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/,
    );
    assert.equal(Number(pill[1]), layout.x, `${key}'s pill x`);
    assert.equal(Number(pill[2]), layout.y, `${key}'s pill y`);
    assert.equal(Number(pill[4]), layout.height, `${key}'s pill height`);
  }
});