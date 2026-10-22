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
 * A room code: four digits, read off one screen and typed into another.
 *
 * Four digits is short enough to say out loud across a room and to type with a
 * thumb, which is the whole point of a code. It is not a secret: the code only
 * names a table, and a seat is still only ever claimed by the identity that
 * holds it.
 *
 * Leading zeroes are never issued and are not accepted. `0789` is what somebody
 * types when they misremember `789`, and quietly treating it as a fourth-digit
 * code would be a guess - so the range is 1000-9999 and every code is exactly
 * the four digits that were shown.
 */
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_MIN = 1000;
export const ROOM_CODE_MAX = 9999;
export const ROOM_CODE_SPAN = ROOM_CODE_MAX - ROOM_CODE_MIN + 1;

/**
 * How many addresses one create may try before giving up.
 *
 * A four-digit space is small on purpose; two tables opening at once can land
 * on the same number. Every attempt is a different address derived from the
 * same attempt, so a clash costs one round trip and never a second room. With
 * nine thousand codes, forty tries failing means the shop is genuinely full.
 */
export const ROOM_CODE_TRIES = 40;

/** Shape check, used on the way in and on the way back out. */
export function isRoomCode(value) {
  return /^[1-9][0-9]{3}$/.test(String(value ?? "").trim());
}

/**
 * Pull a room code out of whatever the player pasted.
 *
 * People paste the whole invite link, or the code with a stray space, or type
 * it with a gap between the digits. All of those are the same code, so all of
 * them are accepted. The link is only read where a link actually puts the code:
 * the `?room=` value this app hands out, or a final segment under `/samrajya/` -
 * reading the last segment of any URL would find the year in a date and call it
 * a table.
 */
export function parseRoomCode(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  // "7889", "7 8 8 9", "788-9" - the same four digits, however they were typed.
  const typed = raw.replace(/[\s\-–—]/g, "");
  if (isRoomCode(typed)) return typed;

  // ?room=7889, in any order, with anything else around it.
  const query = raw.match(/[?&]room=([0-9]{4})(?![0-9])/);
  if (query && isRoomCode(query[1])) return query[1];

  // .../samrajya/7889
  const path = raw.match(/\/samrajya\/([0-9]{4})(?![0-9])/);
  if (path && isRoomCode(path[1])) return path[1];

  // A bare code that picked up sentence punctuation: "7889."
  const bare = typed.replace(/[,.;:!?)\]}"']+$/, "");
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
 * instead by `H(identity, createKey, attempt)` fixes that without an index, a
 * lock or a table of recent requests: **two identical requests are the same
 * room**. The second one arrives at the object that is already there, finds the
 * key it was created with, and returns that room untouched.
 *
 * Four digits means collisions are possible, and they are handled by asking
 * again: attempt 0, 1, 2 ... are different addresses, and the Worker walks them
 * until one is free. Idempotency survives that, because a retry starts at
 * attempt 0 - which is the room the first try already made.
 *
 * Nothing is given up by deriving instead of drawing. The code is short, but it
 * is a table number rather than a password: a seat is only ever claimed by the
 * identity that already holds it.
 */
export async function deriveCode(identity, createKey, attempt = 0) {
  const who = String(identity ?? "").trim().toLowerCase();
  const key = String(createKey ?? "").trim().toLowerCase();
  if (!isIdentity(who)) throw new Error("deriveCode needs a real identity");
  if (!isCreateKey(key)) throw new Error("deriveCode needs a real create key");

  const tries = Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
  const seed = new TextEncoder().encode(`samrajya/room/v2|${who}|${key}|${tries}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", seed));

  // The first four bytes, as one unsigned number. The bias of a plain modulo
  // against 2^32 is a fraction of one part in ten million across nine thousand
  // codes, which is not worth a rejection loop.
  const n = ((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0;
  return String(ROOM_CODE_MIN + (n % ROOM_CODE_SPAN));
}
