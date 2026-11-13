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
 *
 * `coin` is the colour that civilisation's piece is drawn in. It lives on the
 * token rather than in a second list beside this one, because a colour that
 * could disagree with the civilisation it belongs to is two sources of truth
 * wearing one name - and the piece is how a player finds themselves on a board
 * of twenty-eight otherwise identical squares.
 *
 * The four are BRIGHT on purpose. Every other colour on the board is a set's,
 * and a coin the same value as the pill it is standing next to is a coin nobody
 * can pick out. Each is at least 30 CIE dE away from all eight set colours,
 * which is measured in test/shared.test.js rather than asserted here: the amber
 * coin and the gold pill are the pair most likely to be mistaken, and they are
 * also the pair the arithmetic says are furthest apart of the four.
 */
export const CIVILIZATIONS = Object.freeze(
  [
    {
      id: "indus-valley",
      name: "Indus Valley",
      coin: "#0A84FF",
      title: "THE KEEPERS OF ABUNDANCE",
      ability:
        "The universe favours those who claim their first territory. The gods return ₹50 to your treasury as a blessing upon your first acquisition.",
    },
    {
      id: "mesopotamian",
      name: "Mesopotamian",
      coin: "#D42D1F",
      title: "THE CHILDREN OF WAR",
      ability:
        "When you first land on Ragnarok, the heavens grant you two weapons instead of one. Let your enemies learn that your arrival was no coincidence.",
    },
    {
      id: "ancient-greek",
      name: "Ancient Greek",
      coin: "#15A34A",
      title: "THE HEIRS OF OLYMPUS",
      ability:
        "Should your first journey bring you to Jupiter, the celestial throne shall be yours without tribute. The king of gods recognises his own.",
    },
    {
      id: "ancient-roman",
      name: "Ancient Roman",
      coin: "#FF9500",
      title: "THE CONQUERORS OF ETERNITY",
      ability:
        "The cosmos has chosen your first destination: your first throw is six, carrying you directly to Pluto. Claim it at its usual price.",
    },
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

/**
 * The colour a civilisation's piece is drawn in, or null.
 *
 * Null is never a fallback colour. A player who has not chosen has not chosen,
 * and the same rule holds here as everywhere else in this file: a caller that
 * gets null has to decide what to do about it rather than being handed a guess
 * that would put two players' coins in the same blue by accident.
 */
export function coinColor(id) {
  return BY_ID.get(String(id ?? "").trim().toLowerCase())?.coin ?? null;
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