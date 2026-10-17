/* ==========================================================================
   SAMRAJYA - THE BOARD'S CELLS

   Twenty-eight cells in a six-by-ten grid, and nothing else. This is the whole
   of the board's data: what sits in each cell, where it sits, what it is
   called, and which set it belongs to.

   TRANSCRIBED, NOT AUTHORED
   -------------------------
   The twenty-eight entries below are copied from board-cells.json without
   alteration - same grid positions, same order, same ids, same names, same
   label lines, same set colours, same chest purposes. Nothing here has been
   renamed, reordered or "improved". If the board and that file ever disagree,
   that file is right and this one is the bug.

   THE GRID
   --------
   Six columns and ten rows. The ring is the outer border of that grid; the
   middle four columns by eight rows is the centre, which is not a cell.

       cols 1        2  3  4  5        6
   row  1   [ 9 ][10][11][12][13 ][14]
        2   [ 8 ]  .  .  .  .  [15]
        3   [ 7 ]  .  .  .  .  [16]
        4   [ 6 ]  .  .  .  .  [17]
        5   [ 5 ]  .  .  .  .  [18]
        6   [ 4 ]  .  .  .  .  [19]
        7   [ 3 ]  .  .  .  .  [20]
        8   [ 2 ]  .  .  .  .  [21]
        9   [ 1 ]  .  .  .  .  [22]
       10   [ 0 ][27][26][25][24 ][23]

   Every one of the twenty-eight is the same square. The corners are not larger
   than the others; that was the whole point of the change.

   THE ORDER
   ---------
   The index is the order a game travels them, and it is the same fact as the
   position on the board: 0 is START at the bottom-left, then up the left
   column, across the top left to right, down the right column, and back along
   the bottom right to left. A cell's index and its coordinates can never
   disagree, because both are written down here together.

   THREE KINDS OF CELL
   ------------------
      corner     a place the game names rather than owns. Start, Omega,
                 Akash Core, Marketplace.

      property   a place you can own, with a price and a colour it shares with
                 its set-mates.

      chest      a card rather than a place. Ragnarok draws from weapons,
                 Nexus from currency, and Epoch and Kronos have no purpose
                 decided yet - which the tile says by saying nothing.

   PRICES
   ------
   None of them are set. Inventing a price scale would put numbers on the board
   that nobody chose, so a null here means "not decided yet" and nothing else.
   ========================================================================== */

function deepFreeze(o) {
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) deepFreeze(o[k]);
    Object.freeze(o);
  }
  return o;
}

/** ? is U+20B9, outside the Latin subset every Google font ships by default, so
    it is worth saying that the board's Jost does carry it. */
export const CURRENCY = "₹";

/** The grid the cells sit in. The board's own geometry, in numbers. */
export const GRID = deepFreeze({ cols: 6, rows: 10 });

/**
 * The eight sets, and the colour each pill is drawn in.
 *
 * s1 to s4 are the four colours the card artwork already uses, so those cards
 * and the tiles they sit on cannot drift apart. s5 to s8 are new to the board.
 */
export const SETS = deepFreeze({
  /* Crayon purple */
  s1: { color: "#7B68B0" },

  /* Terracotta orange */
  s2: { color: "#CF7A4B" },

  /* Teal */
  s3: { color: "#3F8F96" },

  /* Rose */
  s4: { color: "#B8557A" },

  /* Sage */
  s5: { color: "#6F9A7B" },

  /* Gold */
  s6: { color: "#C9A24A" },

  /* Indigo */
  s7: { color: "#5B6FA6" },

  /* Brick */
  s8: { color: "#A8564C" },
});

/**
 * The four colours the supplied card artwork is drawn with.
 *
 * Kept alongside SETS rather than folded into it because the artwork is a
 * separate thing with its own tokens: these four are what twelve drawn cards
 * carry, and changing a set colour must not silently repaint a piece of
 * artwork.
 */
export const GROUPS = deepFreeze({
  purple: "#7B68B0",
  terracotta: "#CF7A4B",
  teal: "#3F8F96",
  rose: "#B8557A",
});

/**
 * The twenty-eight cells, in the order a game travels them.
 *
 * Index and coordinates are written side by side on purpose. They are the same
 * fact stated twice - where the cell is, and when you meet it - and keeping them
 * adjacent is what makes it obvious when one of them has been changed and the
 * other has not.
 */
export const CELLS = deepFreeze([
  /*  0  col 1, row 10  corner   START */
  {
    index: 0,
    col: 1,
    row: 10,
    type: "corner",
    id: "start",
    name: "Start",
    lines: ["START"],
    set: null,
    color: null,
    art: null,
    chest: null,
  },

  /*  1  col 1, row  9  property MOON */
  {
    index: 1,
    col: 1,
    row: 9,
    type: "property",
    id: "moon",
    name: "Moon",
    lines: ["MOON"],
    set: "s1",
    color: "#7B68B0",
    art: "cards/horizontal/moon.svg",
    chest: null,
  },

  /*  2  col 1, row  8  property LAGRANGE / POINT L2 */
  {
    index: 2,
    col: 1,
    row: 8,
    type: "property",
    id: "lagrange-l2",
    name: "Lagrange Point L2",
    lines: ["LAGRANGE", "POINT L2"],
    set: "s1",
    color: "#7B68B0",
    art: "cards/horizontal/lagrange-l2.svg",
    chest: null,
  },

  /*  3  col 1, row  7  chest    RAGNAROK */
  {
    index: 3,
    col: 1,
    row: 7,
    type: "chest",
    id: "ragnarok",
    name: "Ragnarok",
    lines: ["RAGNAROK"],
    set: null,
    color: null,
    art: "cards/horizontal/ragnarok.svg",
    chest: "weapons",
  },

  /*  4  col 1, row  6  property ASTEROID / BELT */
  {
    index: 4,
    col: 1,
    row: 6,
    type: "property",
    id: "asteroid-belt",
    name: "Asteroid Belt",
    lines: ["ASTEROID", "BELT"],
    set: "s2",
    color: "#CF7A4B",
    art: "cards/horizontal/asteroid-belt.svg",
    chest: null,
  },

  /*  5  col 1, row  5  property JUPITER */
  {
    index: 5,
    col: 1,
    row: 5,
    type: "property",
    id: "jupiter",
    name: "Jupiter",
    lines: ["JUPITER"],
    set: "s2",
    color: "#CF7A4B",
    art: "cards/horizontal/jupiter.svg",
    chest: null,
  },

  /*  6  col 1, row  4  property PLUTO */
  {
    index: 6,
    col: 1,
    row: 4,
    type: "property",
    id: "pluto",
    name: "Pluto",
    lines: ["PLUTO"],
    set: "s2",
    color: "#CF7A4B",
    art: "cards/horizontal/pluto.svg",
    chest: null,
  },

  /*  7  col 1, row  3  property KUIPER / BELT */
  {
    index: 7,
    col: 1,
    row: 3,
    type: "property",
    id: "kuiper-belt",
    name: "Kuiper Belt",
    lines: ["KUIPER", "BELT"],
    set: "s3",
    color: "#3F8F96",
    art: "cards/vertical/kuiper-belt.svg",
    chest: null,
  },

  /*  8  col 1, row  2  property HALLEY'S / COMET */
  {
    index: 8,
    col: 1,
    row: 2,
    type: "property",
    id: "halleys-comet",
    name: "Halley's Comet",
    lines: ["HALLEY'S", "COMET"],
    set: "s3",
    color: "#3F8F96",
    art: "cards/vertical/halleys-comet.svg",
    chest: null,
  },

  /*  9  col 1, row  1  corner   OMEGA */
  {
    index: 9,
    col: 1,
    row: 1,
    type: "corner",
    id: "omega",
    name: "Omega",
    lines: ["OMEGA"],
    set: null,
    color: null,
    art: null,
    chest: null,
  },

  /* 10  col 2, row  1  chest    NEXUS */
  {
    index: 10,
    col: 2,
    row: 1,
    type: "chest",
    id: "nexus",
    name: "Nexus",
    lines: ["NEXUS"],
    set: null,
    color: null,
    art: "cards/vertical/nexus.svg",
    chest: "currency",
  },

  /* 11  col 3, row  1  property VOYAGER / 1 */
  {
    index: 11,
    col: 3,
    row: 1,
    type: "property",
    id: "voyager-1",
    name: "Voyager 1",
    lines: ["VOYAGER", "1"],
    set: "s4",
    color: "#B8557A",
    art: "cards/vertical/voyager-1.svg",
    chest: null,
  },

  /* 12  col 4, row  1  property PROXIMA / CENTAURI */
  {
    index: 12,
    col: 4,
    row: 1,
    type: "property",
    id: "proxima-centauri",
    name: "Proxima Centauri",
    lines: ["PROXIMA", "CENTAURI"],
    set: "s4",
    color: "#B8557A",
    art: "cards/vertical/proxima-centauri.svg",
    chest: null,
  },

  /* 13  col 5, row  1  property EVENT / HORIZON */
  {
    index: 13,
    col: 5,
    row: 1,
    type: "property",
    id: "event-horizon",
    name: "Event Horizon",
    lines: ["EVENT", "HORIZON"],
    set: "s4",
    color: "#B8557A",
    art: "cards/vertical/event-horizon.svg",
    chest: null,
  },

  /* 14  col 6, row  1  corner   AKASH / CORE */
  {
    index: 14,
    col: 6,
    row: 1,
    type: "corner",
    id: "akash-core",
    name: "Akash Core",
    lines: ["AKASH", "CORE"],
    set: null,
    color: null,
    art: null,
    chest: null,
  },

  /* 15  col 6, row  2  property EARTH / 137 */
  {
    index: 15,
    col: 6,
    row: 2,
    type: "property",
    id: "earth-137",
    name: "Earth 137",
    lines: ["EARTH", "137"],
    set: "s5",
    color: "#6F9A7B",
    art: null,
    chest: null,
  },

  /* 16  col 6, row  3  property ORION'S / BELT */
  {
    index: 16,
    col: 6,
    row: 3,
    type: "property",
    id: "orions-belt",
    name: "Orion's Belt",
    lines: ["ORION'S", "BELT"],
    set: "s5",
    color: "#6F9A7B",
    art: null,
    chest: null,
  },

  /* 17  col 6, row  4  chest    EPOCH */
  {
    index: 17,
    col: 6,
    row: 4,
    type: "chest",
    id: "epoch",
    name: "Epoch",
    lines: ["EPOCH"],
    set: null,
    color: null,
    art: null,
    chest: "undecided",
  },

  /* 18  col 6, row  5  property WOW! / SIGNAL */
  {
    index: 18,
    col: 6,
    row: 5,
    type: "property",
    id: "wow-signal",
    name: "Wow! Signal",
    lines: ["WOW!", "SIGNAL"],
    set: "s6",
    color: "#C9A24A",
    art: null,
    chest: null,
  },

  /* 19  col 6, row  6  property DYSON / SPHERE */
  {
    index: 19,
    col: 6,
    row: 6,
    type: "property",
    id: "dyson-sphere",
    name: "Dyson Sphere",
    lines: ["DYSON", "SPHERE"],
    set: "s6",
    color: "#C9A24A",
    art: null,
    chest: null,
  },

  /* 20  col 6, row  7  property WORMHOLE */
  {
    index: 20,
    col: 6,
    row: 7,
    type: "property",
    id: "wormhole",
    name: "Wormhole",
    lines: ["WORMHOLE"],
    set: "s6",
    color: "#C9A24A",
    art: null,
    chest: null,
  },

  /* 21  col 6, row  8  property MILKY / WAY */
  {
    index: 21,
    col: 6,
    row: 8,
    type: "property",
    id: "milky-way",
    name: "Milky Way",
    lines: ["MILKY", "WAY"],
    set: "s7",
    color: "#5B6FA6",
    art: null,
    chest: null,
  },

  /* 22  col 6, row  9  property RAMA */
  {
    index: 22,
    col: 6,
    row: 9,
    type: "property",
    id: "rama",
    name: "Rama",
    lines: ["RAMA"],
    set: "s7",
    color: "#5B6FA6",
    art: null,
    chest: null,
  },

  /* 23  col 6, row 10  corner   MARKET- / PLACE */
  {
    index: 23,
    col: 6,
    row: 10,
    type: "corner",
    id: "marketplace",
    name: "Marketplace",
    lines: ["MARKET-", "PLACE"],
    set: null,
    color: null,
    art: null,
    chest: null,
  },

  /* 24  col 5, row 10  chest    KRONOS */
  {
    index: 24,
    col: 5,
    row: 10,
    type: "chest",
    id: "kronos",
    name: "Kronos",
    lines: ["KRONOS"],
    set: null,
    color: null,
    art: null,
    chest: "undecided",
  },

  /* 25  col 4, row 10  property SUPER- / NOVA */
  {
    index: 25,
    col: 4,
    row: 10,
    type: "property",
    id: "supernova",
    name: "Supernova",
    lines: ["SUPER-", "NOVA"],
    set: "s8",
    color: "#A8564C",
    art: null,
    chest: null,
  },

  /* 26  col 3, row 10  property QUASAR */
  {
    index: 26,
    col: 3,
    row: 10,
    type: "property",
    id: "quasar",
    name: "Quasar",
    lines: ["QUASAR"],
    set: "s8",
    color: "#A8564C",
    art: null,
    chest: null,
  },

  /* 27  col 2, row 10  property SGR A* */
  {
    index: 27,
    col: 2,
    row: 10,
    type: "property",
    id: "sagittarius-a-star",
    name: "Sagittarius A*",
    lines: ["SGR A*"],
    set: "s8",
    color: "#A8564C",
    art: null,
    chest: null,
  },
]);

/** The four corners, by id. */
export const CORNER_IDS = Object.freeze(["start", "omega", "akash-core", "marketplace"]);

/** A cell by its place on the grid, or null where there is none - the centre. */
export function cellAt(col, row) {
  return CELLS.find((c) => c.col === col && c.row === row) || null;
}

/** A cell by its position in the walk. */
export function cellByIndex(index) {
  return CELLS[index] || null;
}

/** A cell by its id. */
export function cellById(id) {
  return CELLS.find((c) => c.id === id) || null;
}

/** Whether this cell is one of the four corners. */
export function isCorner(cell) {
  return cell?.type === "corner";
}

/**
 * The rupee amount, or null where no price has been decided yet.
 *
 * Nothing on the board has one. The function stays because the rules will want
 * it, and a null answer is the correct answer today rather than a missing one.
 */
export function price(cell) {
  return cell?.price == null ? null : `${CURRENCY}${cell.price}`;
}

/** How many cells there are, and how many of each kind. Used by the geometry check. */
export function census() {
  return {
    total: CELLS.length,
    corners: CELLS.filter((c) => c.type === "corner").length,
    properties: CELLS.filter((c) => c.type === "property").length,
    chests: CELLS.filter((c) => c.type === "chest").length,
    grouped: CELLS.filter((c) => c.set).length,
    sets: new Set(CELLS.map((c) => c.set).filter(Boolean)).size,
  };
}
