/* ==========================================================================
   SAMRAJYA - PLAYER NAMES AND IDENTITIES

   The rules for what a player may be called and how long, in one place, so
   the setup form and the server agree without either inventing a limit.
   ========================================================================== */

/** Long enough for "Chandrashekhar", short enough to sit on a tile. */
export const NAME_MIN = 1;
export const NAME_MAX = 24;

/** The header the identity travels in, and the field the server reads. */
export const PLAYER_HEADER = "x-samrajya-player";

/**
 * A room code: eight characters, no look-alikes, so a code read aloud or
 * copied off a screen can be typed without a second look. `0`/`1`, `i`/`l`
 * and `o` are all absent on purpose.
 */
export const ROOM_CODE_LENGTH = 8;
const ROOM_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function roomAlphabet() {
  return ROOM_ALPHABET;
}

/** Shape check, used on the way in and on the way back out. */
export function isRoomCode(value) {
  return new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(
    String(value ?? "").trim().toLowerCase(),
  );
}

/**
 * Pull a room code out of whatever the player pasted.
 *
 * People paste the whole invite link, or the code with a stray space, or it in
 * capitals with a full stop after it. All of those are the same code, so all of
 * them are accepted.
 *
 * A link is only read where a link actually puts the code: the `?room=` value
 * this app hands out, or a final segment under `/samrajya/`. Taking the last
 * segment of any URL is not good enough, because "samrajya" is eight letters
 * from the code alphabet and would be indistinguishable from a real room.
 */
export function parseRoomCode(input) {
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (isRoomCode(raw)) return raw;

  // ?room=abcd2345, in any order, with anything else around it.
  const query = raw.match(/[?&]room=([a-z0-9]+)/);
  if (query && isRoomCode(query[1])) return query[1];

  // .../samrajya/abcd2345
  const path = raw.match(/\/samrajya\/([a-z0-9]+)/);
  if (path && isRoomCode(path[1])) return path[1];

  // A bare code that picked up sentence punctuation: "abcd2345."
  const bare = raw.replace(/[,.;:!?)\]}]+$/, "");
  return isRoomCode(bare) ? bare : null;
}

/**
 * Clean a typed name, or say why it will not do.
 *
 * Returns `{ ok: true, value }` or `{ ok: false, reason }` - the same shape
 * everywhere, so the form and the server report the same problem the same way.
 */
export function cleanName(input) {
  const value = String(input ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return { ok: false, reason: "Enter a name." };
  if (value.length < NAME_MIN) return { ok: false, reason: "Enter a name." };
  if (value.length > NAME_MAX) {
    return { ok: false, reason: `Keep it to ${NAME_MAX} characters or fewer.` };
  }
  return { ok: true, value };
}

/**
 * A random identity for this browser.
 *
 * 128 bits of nothing guessable. It is not an account, there is no password,
 * and it grants nothing on its own: the room hands out seats, and only the
 * player holding the matching secret can return to the one they were given.
 */
export function newIdentity() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Is this shaped like an identity we issued? */
export function isIdentity(value) {
  return /^[0-9a-f]{32}$/.test(String(value ?? "").trim().toLowerCase());
}

/* ---------------------------------------------------------------- create keys */

/**
 * A key for one attempt to create a game.
 *
 * Same shape as an identity - 128 random bits - but a different thing and a
 * different lifetime. It is kept until the create succeeds, then thrown away,
 * so the next game gets a different one. What it buys is on the next lines.
 */
export function newCreateKey() {
  return newIdentity();
}

/** Is this shaped like a create key? */
export function isCreateKey(value) {
  return /^[0-9a-f]{32}$/.test(String(value ?? "").trim().toLowerCase());
}

/**
 * The address of a room, derived from who is making it and which attempt.
 *
 * The room used to be named by a random code the Worker minted, which meant a
 * double-tap on Create made two rooms and quietly lost one. Naming the room
 * instead by `H(identity, createKey)` fixes that without an index, a lock or a
 * table of recent requests: **two identical requests are the same room**. The
 * second one arrives at the object that is already there, finds the key it was
 * created with, and returns that room untouched.
 *
 * Nothing is given up by deriving instead of drawing. The code is still
 * unguessable - both inputs are 128 random bits that never leave the browser -
 * so it carries the same ~39 bits of entropy a drawn eight-character code did.
 *
 * Rejection sampling rather than a plain modulus, so every character of the
 * alphabet is equally likely instead of the first few being slightly favoured.
 */
export async function deriveCode(identity, createKey) {
  const who = String(identity ?? "").trim().toLowerCase();
  const key = String(createKey ?? "").trim().toLowerCase();
  if (!isIdentity(who)) throw new Error("deriveCode needs a real identity");
  if (!isCreateKey(key)) throw new Error("deriveCode needs a real create key");

  const seed = new TextEncoder().encode(`samrajya/room/v1|${who}|${key}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", seed));

  const limit = 256 - (256 % ROOM_ALPHABET.length);
  let out = "";
  for (const byte of digest) {
    if (byte >= limit) continue;
    out += ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
    if (out.length === ROOM_CODE_LENGTH) return out;
  }

  // 32 bytes against a 248-of-256 acceptance rate is an expected 31 usable
  // bytes for 8 characters. Reaching here means something is wrong upstream,
  // and returning a short or empty code would quietly break the room.
  throw new Error("deriveCode: not enough entropy in the digest");
}
