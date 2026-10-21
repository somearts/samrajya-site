/* ==========================================================================
   SAMRAJYA - THE ECONOMY

   What every place is worth, what it can be built up into, and what that costs.

   ONE FILE
   --------
   The pricing table, the three upgrades on every property, and the rules that
   read them live here and nowhere else. Everything else asks this module what a
   thing costs and what rent it carries; no price, no upgrade name and no rent
   figure is written a second time anywhere in the project.

   THAT MATTERS BECAUSE THESE NUMBERS ARE WRITTEN DOWN, NOT DERIVED
   ---------------------------------------------------------------
   The board used to price its twenty properties as 200 plus 44 for each step
   along, which was arithmetically tidy and meant the twenty numbers on the
   board could never disagree with each other. That scale has gone: a game's
   economy is designed, not extrapolated, and a step of 44 cannot produce a
   rent of 1300 or a jump from 600 to 700. So the numbers are written out, and
   in exchange they are checked - see test/economy.test.js, which asks that
   every price and every cost is a round number, that rent rises at every
   upgrade, that the twenty entries are the twenty properties and no others,
   and that no two are priced the same.

   THE TABLE IS IN PRICE ORDER, AND SO IS THE BOARD
   ------------------------------------------------
   These twenty run cheapest to most expensive, and they are written in that
   order rather than in the order the board is walked. The two orders happen to
   be the same, which is a property of this table and not something to rely on:
   a price is read by its NAME here, never by where the square sits, so moving a
   property along the board can never move its price with it.

   SAGITTARIUS A* IS THE MOST EXPENSIVE PLACE ON THE BOARD
   ------------------------------------------------------
   1400, with Supernova at 1300 and Quasar at 1200. Sagittarius A* and Quasar
   started the other way round in the first draft of this table, and moving
   Sagittarius A* to the top meant swapping their WHOLE economic columns rather
   than just the headline number.

   Swapping only the price would have been arithmetically possible and would
   have made the board lie: a Quasar at 1200 charging a base rent of 140 while
   the SGR A* that costs 200 more charged 120. Rent has to follow price, so the
   upgrade costs and the rent at each level go with it.

   That leaves the scale perfectly regular, which is worth saying because it is
   the best evidence that the swap is the right one: for all twenty properties
   the base rent is exactly one tenth of the price. 200 and 20. 1400 and 140.

   THE THREE UPGRADES
   -----------------
   Every property has exactly three, in order, each one a level above the last.
   `rentAfter` is the rent the property carries once that upgrade is on it, and
   `cost` is what it takes to put it there. Neither is derived from the other,
   because a designed economy is not a formula: Halley's Comet jumps from 220 to
   700 and Orion's Belt from 80 to 420, and both of those are the number the
   place is worth rather than a multiple of anything.
   ========================================================================== */

/** What every player is given to start with. */
export const STARTING_MONEY = 2000;

/** How many times a property can be built up. Three, for all twenty. */
export const MAX_UPGRADE = 3;

const u = (name, description, cost, rentAfter) =>
  Object.freeze({ name, description, cost, rentAfter });

/**
 * Every buyable square, by the id the board knows it by.
 *
 * `price` is what it costs to take. `baseRent` is what it charges unbuilt.
 * `upgrades` is three entries, cheapest first.
 */
export const PRICING = Object.freeze({
  moon: {
    price: 200, baseRent: 20,
    upgrades: [
      u("Lunar Outpost", "A small research station on the dark side. First foothold on Earth's oldest companion.", 100, 80),
      u("Lunar Colony", "Domes, tunnels and hydroponics. A permanent human presence under the Earthlight.", 150, 240),
      u("Lunar Dominion", "The entire Moon is now under your banner. No ship passes without paying tribute.", 200, 500),
    ],
  },
  "lagrange-l2": {
    price: 250, baseRent: 25,
    upgrades: [
      u("Relay Station", "A lonely beacon hanging in perfect balance between Earth and Sun.", 120, 100),
      u("Navigation Hub", "Every deep-space vessel recalibrates here. You control the crossroads.", 180, 300),
      u("Gateway Network", "The first permanent jump gate. Travel beyond the solar system starts with you.", 250, 650),
    ],
  },
  "asteroid-belt": {
    price: 300, baseRent: 30,
    upgrades: [
      u("Prospecting", "Scouts and claim beacons mark the richest rocks.", 150, 120),
      u("Mining Fleet", "Swarms of automated drills harvest ice and metals day and night.", 200, 360),
      u("Extraction Empire", "The Belt answers only to you. Ore freighters form endless convoys.", 300, 800),
    ],
  },
  jupiter: {
    price: 350, baseRent: 35,
    upgrades: [
      u("Orbital Station", "A spinning wheel above the gas giant's storms.", 180, 150),
      u("Moon Network", "Io, Europa, Ganymede and Callisto linked under one command.", 250, 450),
      u("Jovian Dominion", "The King of Planets and all its moons fly your colours.", 350, 950),
    ],
  },
  pluto: {
    price: 400, baseRent: 40,
    upgrades: [
      u("Research Base", "A lonely outpost on the edge of the known system.", 200, 180),
      u("Charon Station", "Twin worlds bound together, now both under your control.", 300, 540),
      u("Frontier Citadel", "The last fortress before interstellar space. None pass without leave.", 400, 1100),
    ],
  },
  "kuiper-belt": {
    price: 450, baseRent: 45,
    upgrades: [
      u("Deep-Space Survey", "Long-range probes map the frozen wilderness.", 220, 200),
      u("Resource Network", "Ice mines and fuel depots stretch across the outer dark.", 350, 600),
      u("Outer Frontier", "You own the edge of the solar system. Everything beyond is yours to claim.", 450, 1300),
    ],
  },
  "halleys-comet": {
    price: 500, baseRent: 50,
    upgrades: [
      u("Tracking Array", "Sensors lock onto the famous visitor every seventy-six years.", 250, 220),
      u("Comet Observatory", "A permanent platform rides the comet's tail, harvesting its secrets.", 400, 700),
      u("Intercept Network", "No comet enters the inner system without first answering to you.", 500, 1500),
    ],
  },
  "voyager-1": {
    price: 550, baseRent: 55,
    upgrades: [
      u("Deep-Space Signal", "You strengthen the lonely probe's fading voice.", 280, 250),
      u("Communications Network", "A chain of relays keeps humanity in touch with its farthest child.", 450, 800),
      u("Interstellar Beacon", "Voyager becomes a permanent lighthouse for all who follow.", 550, 1700),
    ],
  },
  "proxima-centauri": {
    price: 600, baseRent: 60,
    upgrades: [
      u("Stellar Observatory", "The first permanent eyes on our nearest stellar neighbour.", 300, 280),
      u("Orbital Colony", "Habitats circle the red dwarf, harvesting its thin light.", 500, 900),
      u("Proxima Settlement", "Humanity's first true extrasolar home flies your flag.", 600, 2000),
    ],
  },
  "event-horizon": {
    price: 700, baseRent: 70,
    upgrades: [
      u("Gravity Observatory", "Instruments peer into the abyss without falling.", 350, 350),
      u("Singularity Research", "You study the point of no return and harvest its power.", 600, 1100),
      u("Horizon Control", "Even black holes answer to you. Nothing escapes without permission.", 700, 2500),
    ],
  },
  "earth-137": {
    price: 750, baseRent: 75,
    upgrades: [
      u("Terraforming Hub", "The first engines begin rewriting an entire world.", 380, 380),
      u("Planetary Grid", "Cities, farms and power grids cover the new Earth.", 650, 1200),
      u("Earth Dominion", "A second homeworld, fully under your rule.", 750, 2800),
    ],
  },
  "orions-belt": {
    price: 800, baseRent: 80,
    upgrades: [
      u("Stellar Array", "Three bright stars become your observation posts.", 400, 420),
      u("Constellation Network", "The famous belt is now a single coordinated system.", 700, 1400),
      u("Orion Empire", "The hunter of the night sky belongs to you alone.", 800, 3200),
    ],
  },
  "wow-signal": {
    price: 850, baseRent: 85,
    upgrades: [
      u("Signal Array", "You lock onto the mysterious 1977 signal and amplify it.", 420, 450),
      u("Listening Network", "A vast array of dishes waits for the next message from the stars.", 750, 1500),
      u("Cosmic Relay", "You become the first to answer. The conversation with the unknown begins under your control.", 850, 3500),
    ],
  },
  "dyson-sphere": {
    price: 900, baseRent: 90,
    upgrades: [
      u("Energy Collector", "The first panels begin drinking a star's light.", 450, 500),
      u("Power Lattice", "A growing shell of collectors feeds your entire empire.", 800, 1600),
      u("Stellar Forge", "An almost complete Dyson Sphere. You own the energy of a sun.", 900, 3800),
    ],
  },
  wormhole: {
    price: 950, baseRent: 95,
    upgrades: [
      u("Stabiliser Gate", "The first controlled opening of a stable wormhole.", 480, 550),
      u("Transit Corridor", "Ships now travel through the fold in space under your protection.", 850, 1800),
      u("Wormhole Nexus", "You control the fastest routes across the galaxy.", 950, 4200),
    ],
  },
  "milky-way": {
    price: 1000, baseRent: 100,
    upgrades: [
      u("Galactic Outpost", "A single foothold in the vast spiral.", 500, 600),
      u("Spiral Network", "Trade routes and colonies weave through the arms.", 900, 2000),
      u("Galactic Dominion", "The entire Milky Way acknowledges only one ruler: you.", 1000, 4500),
    ],
  },
  rama: {
    price: 1100, baseRent: 110,
    upgrades: [
      u("Raman Survey", "The first expedition inside the mysterious cylindrical worldship.", 550, 700),
      u("Habitation Ring", "You colonise the interior of the ancient vessel.", 1000, 2200),
      u("Rama Command", "The worldship itself now answers to you.", 1100, 5000),
    ],
  },
  quasar: {
    price: 1200, baseRent: 120,
    upgrades: [
      u("Distant Beacon", "You lock onto one of the brightest objects in the universe.", 600, 750),
      u("Jet Harvester", "You begin drawing power from the quasar's relativistic jets.", 1100, 2500),
      u("Quasar Dominion", "One of the most powerful engines in the cosmos is now yours.", 1200, 5500),
    ],
  },
  supernova: {
    price: 1300, baseRent: 130,
    upgrades: [
      u("Stellar Observatory", "You study the dying star from a safe distance.", 650, 850),
      u("Shockwave Harvest", "You capture the immense energy of the explosion.", 1200, 2800),
      u("Nova Throne", "The power of a dying star now fuels your empire.", 1300, 6000),
    ],
  },
  "sagittarius-a-star": {
    price: 1400, baseRent: 140,
    upgrades: [
      u("Event Horizon Array", "Sensors circle the supermassive black hole at the centre of the galaxy.", 700, 950),
      u("Accretion Throne", "You harvest the energy of matter falling into the abyss.", 1300, 3200),
      u("Galactic Core Dominion", "The heart of the Milky Way itself flies your flag. Nothing in the galaxy is beyond your reach.", 1400, 7000),
    ],
  },
});

/** Every buyable square's id, in the order the table is written. */
export const PRICED_IDS = Object.freeze(Object.keys(PRICING));

/** What a square costs to take, or null where it is not something anybody buys. */
export function priceOf(id) {
  return PRICING[String(id ?? "")]?.price ?? null;
}

/** The rent a square charges with nothing built on it. */
export function baseRentOf(id) {
  return PRICING[String(id ?? "")]?.baseRent ?? null;
}

/** One of a square's three upgrades, by index. Null past the third. */
export function upgradeAt(id, n) {
  return PRICING[String(id ?? "")]?.upgrades[n] ?? null;
}

/**
 * The rent a square charges at a given build level.
 *
 * Level 0 is the bare square, and each level takes the rent of the upgrade that
 * brought it there. A level outside 0 to 3 is a caller being wrong, and is
 * clamped rather than answered with something that would quietly be wrong on the
 * card.
 */
export function rentFor(id, level = 0) {
  const entry = PRICING[String(id ?? "")];
  if (!entry) return null;
  const built = Math.max(0, Math.min(MAX_UPGRADE, Math.trunc(Number(level) || 0)));
  if (built === 0) return entry.baseRent;
  return entry.upgrades[built - 1].rentAfter;
}

/** Is this square something a player can buy? */
export function isPriced(id) {
  return Object.hasOwn(PRICING, String(id ?? ""));
}

/** The three upgrades, as a fresh array so a caller cannot change the table. */
export function upgradesOf(id) {
  return PRICING[String(id ?? "")] ? [...PRICING[String(id ?? "")].upgrades] : [];
}

/* ------------------------------------------------------------------ printing */

/**
 * How a sum of money is written on the board.
 *
 * Indian grouping, because this is an Indian game: 2000 is two thousand and
 * never 2,000, and 125000 is 1,25,000. A number a player has to read twice is a
 * number they will misread.
 *
 * The rupee sign is written here rather than imported from spaces.js, and that
 * is not an oversight. spaces.js is where CURRENCY lives, but properties.js
 * imports spaces.js and imports this file, so importing the other way would
 * close a cycle. One character is a cheaper way to break it than a second
 * source of truth for the currency.
 */
const GROUPING = new Intl.NumberFormat("en-IN");

export function rupees(amount) {
  const value = Math.trunc(Number(amount));
  return `₹${GROUPING.format(Number.isFinite(value) ? value : 0)}`;
}

/** The same formatter, for callers that used to ask for a bare number. */
export function rupeesBare(amount) {
  return rupees(amount);
}