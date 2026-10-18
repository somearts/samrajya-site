/* ==========================================================================
   SAMRAJYA - THE CIVILIZATIONS

   What a player *is*, rather than what they are represented by. Four to
   begin with, and four only.

   This file replaces the token list the entry stage used. Nothing was carried
   across from it: a tiger and a lotus are pieces, and a civilisation is a
   people, and the two do not belong in the same field of the same record.

   The picker draws from this list and the server validates against it, so a
   civilisation can never be offered on screen and then refused at the other end.
   ========================================================================== */

/**
 * Frozen all the way down, not just the array.
 *
 * `Object.freeze` on the list alone leaves the records inside it mutable, and
 * `choices()` is a shallow copy - so a caller that renamed a civilisation would
 * have renamed it for the picker, for the server and for everyone else. That is
 * the one thing this file exists to make impossible: a civilisation cannot be
 * offered on screen and then be something else at the other end.
 */
export const CIVILIZATIONS = Object.freeze(
  [
    { id: "indus-valley", name: "Indus Valley" },
    { id: "mesopotamian", name: "Mesopotamian" },
    { id: "ancient-egyptian", name: "Ancient Egyptian" },
    { id: "aztec", name: "Aztec" },
  ].map((civilization) => Object.freeze(civilization)),
);

const BY_ID = new Map(CIVILIZATIONS.map((c) => [c.id, c]));

/**
 * The civilisation with this id, or null.
 *
 * `null` is never a fallback and never a guess. A caller that gets null has to
 * deal with it, which is the point: a player who has not chosen has not chosen.
 */
export function civById(id) {
  return BY_ID.get(String(id ?? "").trim().toLowerCase()) || null;
}

/** Is this one of ours? Used to refuse anything else at the door. */
export function isCiv(id) {
  return BY_ID.has(String(id ?? "").trim().toLowerCase());
}

/** Ids only - what the picker needs, and all the server sends back. */
export function civIds() {
  return CIVILIZATIONS.map((c) => c.id);
}

/**
 * The civilisation's name, or a phrase that reads in a sentence.
 *
 * Used by the server to say "Ancient Egyptian is already taken" in a refusal,
 * so the message can never drift from the list the player was shown.
 */
export function nameOf(id) {
  return BY_ID.get(String(id ?? "").trim().toLowerCase())?.name || "That civilisation";
}

/**
 * The four, in the order they are offered.
 *
 * Fixed deliberately: a picker whose contents move between sessions is a picker
 * nobody can learn, and this is a board with four corners on it.
 */
export function choices() {
  return [...CIVILIZATIONS];
}