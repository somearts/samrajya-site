/* ==========================================================================
   SAMRAJYA - THE NEXUS CARDS

   Thirty cards drawn at the Nexus. Exactly half take money from the player and
   half give money back; every amount is between fifty and a hundred and fifty
   rupees. The deck is fixed and the draw is uniform, so the expected value is
   zero over many visits.

   A card is a name, a single sentence of flavour, and a signed amount. Nothing
   here knows about the DOM or the turn; the game rule applies the amount.
   ========================================================================== */

/** The fixed cost of the Pray action. */
export const NEXUS_PRAY_COST = 50;

/** The Nexus tile id. */
export const NEXUS = Object.freeze({ id: "nexus" });

/** The thirty cards, in no special order. */
export const NEXUS_CARDS = Object.freeze([
  /* --- fifteen cards that take from the player --- */
  {
    id: "t1",
    name: "Temple Upkeep",
    text: "The shrines require new lamps and fresh incense.",
    amount: -50,
  },
  {
    id: "t2",
    name: "Priest's Tithe",
    text: "A silent hand accepts your offering.",
    amount: -60,
  },
  {
    id: "t3",
    name: "Sacred Repair",
    text: "A crack in the observatory dome must be sealed.",
    amount: -70,
  },
  {
    id: "t4",
    name: "Ritual Debt",
    text: "An old vow comes due under the new moon.",
    amount: -80,
  },
  {
    id: "t5",
    name: "Charity",
    text: "A pilgrim asks, and custom forbids refusal.",
    amount: -90,
  },
  {
    id: "t6",
    name: "Oracle's Fee",
    text: "She speaks only after the coins are counted.",
    amount: -100,
  },
  {
    id: "t7",
    name: "Festival Tax",
    text: "The procession cannot pass without your share.",
    amount: -110,
  },
  {
    id: "t8",
    name: "Scroll Binding",
    text: "The archives hunger for parchment and ink.",
    amount: -120,
  },
  {
    id: "t9",
    name: "Candle Duty",
    text: "Every flame in the sanctuary is counted.",
    amount: -130,
  },
  {
    id: "t10",
    name: "Pilgrim's Gift",
    text: "You lay your wealth at the threshold.",
    amount: -140,
  },
  {
    id: "t11",
    name: "Sanctuary Fine",
    text: "A whispered rule, freshly enforced.",
    amount: -150,
  },
  {
    id: "t12",
    name: "Renewal Rite",
    text: "The old year must be paid for in silver.",
    amount: -100,
  },
  {
    id: "t13",
    name: "Bell Metal",
    text: "The great bell needs casting anew.",
    amount: -80,
  },
  {
    id: "t14",
    name: "Incense Debt",
    text: "The air itself is owed.",
    amount: -70,
  },
  {
    id: "t15",
    name: "Keeper's Due",
    text: "The guardian of the gate expects his share.",
    amount: -60,
  },

  /* --- fifteen cards that give to the player --- */
  {
    id: "g1",
    name: "Divine Favour",
    text: "The silence breaks in your direction.",
    amount: 50,
  },
  {
    id: "g2",
    name: "Forgotten Cache",
    text: "A donor remembered you in a dream.",
    amount: 60,
  },
  {
    id: "g3",
    name: "Blessed Harvest",
    text: "The temples share their surplus.",
    amount: 70,
  },
  {
    id: "g4",
    name: "Mercy's Bounty",
    text: "A debt you did not know you had is forgiven.",
    amount: 80,
  },
  {
    id: "g5",
    name: "Sacred Lottery",
    text: "Your token is drawn from the urn.",
    amount: 90,
  },
  {
    id: "g6",
    name: "Alms Returned",
    text: "What you gave returns threefold.",
    amount: 100,
  },
  {
    id: "g7",
    name: "Star Tithe",
    text: "A distant colony sends tribute.",
    amount: 110,
  },
  {
    id: "g8",
    name: "Ancestor's Gift",
    text: "The past pays what the present cannot.",
    amount: 120,
  },
  {
    id: "g9",
    name: "Pilgrim's Blessing",
    text: "Gratitude arrives in a sealed purse.",
    amount: 130,
  },
  {
    id: "g10",
    name: "Temple Reward",
    text: "Your devotion is noted in the ledger.",
    amount: 140,
  },
  {
    id: "g11",
    name: "Providence",
    text: "The board tilts toward balance.",
    amount: 150,
  },
  {
    id: "g12",
    name: "Silent Patron",
    text: "An unnamed hand fills your cup.",
    amount: 100,
  },
  {
    id: "g13",
    name: "Renewed Fortune",
    text: "The wheel turns once in your favour.",
    amount: 80,
  },
  {
    id: "g14",
    name: "Offering Returned",
    text: "The flames reject nothing; the smoke brings gold.",
    amount: 70,
  },
  {
    id: "g15",
    name: "Guardian's Gratitude",
    text: "The keeper bows and presses coins into your palm.",
    amount: 60,
  },
]);

/** Draw one card uniformly from the thirty. */
export function drawNexusCard(rng = Math.random) {
  const roll = Number(rng());
  const index = Math.min(NEXUS_CARDS.length - 1, Math.floor(Math.abs(roll) * NEXUS_CARDS.length));
  return NEXUS_CARDS[index];
}
