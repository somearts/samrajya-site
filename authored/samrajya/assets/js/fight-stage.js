/* ==========================================================================
   SAMRAJYA - THE FIGHT SCREEN

   A SHARED screen, drawn from the state.

   The Fight lives in the game's state as `fight`, exactly the way the two
   chests live there as `chest`: the server decides what stage it is in, and
   every client draws the middle from that fact. The player who landed gets
   the buttons; the other player sees the same screen read-only - the same
   weapons, the same selected face, the same glowing and blinking tiles. A
   device that reconnects or arrives late draws the same screen, and nobody
   has to refresh.

   THE TWO HALVES ARE VIEWER-RELATIVE

   The screen splits into two halves and the BOTTOM half is always the
   viewer's own player. Each half names its player - the coin disc, the name
   and the civilization - and shows their weapons at the Ragnarok face, three
   to a row, with the live line that says what is within reach.

   THE RULES ARE NOT HERE

   What is in reach is shared/fight.js's one answer, read from the ledger the
   whole game sees. This file only draws it: a weapon that cannot reach
   anything says so, and its Attack pill is disabled - the client never
   decides a strike on its own.
   ========================================================================== */

import { el } from "./dom.js";
import { resetHolder } from "./board-fx.js";
import { validTargets } from "./shared/fight.js";
import { CELLS } from "./shared/spaces.js";
import { coinColor, civById } from "./shared/civilizations.js";
import { emblem, shieldColor, weaponColor } from "./chest-card.js";
import { shieldById, weaponById } from "./shared/weapons.js";

/* ------------------------------------------------------------------ names */

/** The name and civilization a seat goes by, read from the ledger. */
function personaOf(ledger, seat) {
  const player = ledger?.players?.find((p) => p.seat === Number(seat)) || null;
  if (!player) return null;
  return {
    seat: player.seat,
    name: player.name || "Your opponent",
    civ: civById(player.civ)?.name || "Unchosen",
    coin: coinColor(player.civ) || "var(--ink)",
  };
}

/** The seat this player is fighting - the other seat in the roster. */
function opponentOf(seat, ledger) {
  const roster = ledger?.players || [];
  const mine = roster.find((p) => p.seat === Number(seat));
  const other = roster.find((p) => p.seat !== Number(seat));
  return mine ? other : null;
}

/** How many opponents' colonies this weapon reaches, as a live sentence. */
function reachLine(ledger, weaponId, seat) {
  const count = validTargets(ledger, weaponId, seat).length;
  if (count === 0) return "No colony in range";
  return count === 1 ? "1 in range" : `${count} in range`;
}

/* ------------------------------------------------------------- the header */

/** The head of one half: the coin disc, the name, and the civilization. */
function halfHead(persona) {
  return el("header", { class: "fight-half__head" }, [
    el("span", {
      class: "fight-half__disc",
      "aria-hidden": "true",
      style: { "--coin": persona.coin },
    }),
    el("div", { class: "fight-half__who" }, [
      el("span", { class: "fight-half__name", text: persona.name }),
      el("span", { class: "fight-half__civ", text: persona.civ }),
    ]),
  ]);
}

/* ------------------------------------------------------------ the weapons */

/**
 * One weapon at the Ragnarok face, its live range line, and - for the
 * acting player only - the calm red Attack pill.
 */
function weaponFace({ weapon, ledger, seat, mine, fight }) {
  const selected = fight.selectedWeaponId === weapon.id;
  const line = reachLine(ledger, weapon.id, seat);
  const noRange = line === "No colony in range";

  const slot = el("div", {
    class: "fight-card__slot",
    "data-slot-weapon": weapon.id,
  }, [
    el("button", {
      type: "button",
      class: "fight-card__face",
      "data-action": "face",
      "data-weapon": weapon.id,
      style: { "--weapon": weaponColor(weapon.id) },
      "aria-pressed": String(selected),
      disabled: !mine || fight.phase === "resolving",
      title: weapon.blurb,
    }, [
      el("span", { class: "fight-card__emblem", "aria-hidden": "true", html: emblem(weapon) }),
      el("span", { class: "fight-card__weapon-name", text: weapon.name }),
      el("span", { class: "fight-card__pillmark", "aria-hidden": "true" }),
    ]),
    el("p", { class: "fight-card__range", text: line }),
    mine && fight.phase !== "resolving"
      ? el("button", {
          type: "button",
          class: "fight-card__attack",
          "data-action": "attack",
          "data-weapon": weapon.id,
          disabled: noRange,
          "aria-disabled": String(noRange),
          title: noRange ? "No colony in range" : "Arm this weapon",
          text: "Attack",
        })
      : null,
  ]);

  if (selected) slot.classList.add("is-selected");
  slot.dataset.weapon = weapon.id;
  return slot;
}

/**
 * One half of the screen: whose it is, and what they carry.
 *
 * The BOTTOM half is always the viewer's. A half whose player carries
 * nothing says so plainly, and a half with more cards than fit scrolls
 * inside itself rather than pushing the other half off the screen.
 */
function fightHalf({ ledger, pieces, seat, viewerSeat, mine, fight }) {
  const persona = personaOf(ledger, seat);
  if (!persona) return null;
  const inventory =
    (pieces || []).find((piece) => piece.seat === Number(seat))?.weapons || [];
  const side = Number(seat) === Number(viewerSeat) ? "bottom" : "top";
  const legion = Boolean(mine && Number(seat) === Number(viewerSeat));

  /* The children are the nodes THEMSELVES, not a single array slot holding
     them: `el` concatenates one level, so wrapping the map's result in an
     extra array hands it a non-Node child, and `String(child)` writes
     "[object HTMLDivElement],[object HTMLDivElement]" into the box as TEXT
     instead of appending the cards as elements. */
  const slots = inventory.length
    ? inventory.map((id) => {
        const weapon = weaponById(id);
        return weapon
          ? weaponFace({ weapon, ledger, seat, mine: legion, fight })
          : null;
      })
    : [el("p", { class: "fight-half__empty", text: "No weapons detected." })];

  const weapons = el("div", { class: "fight-half__weapons" }, slots);

  const half = el("section", {
    class: `fight-half fight-half--${side}`,
    "data-seat": String(persona.seat),
    "data-fighter": String(Number(seat) === Number(fight.playerId)),
  }, [halfHead(persona), weapons]);
  return half;
}

/* ------------------------------------------------------------------ the card */

/**
 * The Fight, drawn from the state, whole.
 *
 * `fight` is the state's fight. `mine` says whether the VIEWER is the player
 * whose turn it is - the player who landed and acts. The other viewer is
 * shown the same screen, read-only, with a muted line naming who they are
 * waiting for.
 */
export function drawFightStage(
  board,
  fight,
  { mine = false, ledger = null, pieces = [], viewerSeat = null, playerName = "" } = {},
) {
  const holder = board.querySelector(".board__card");
  if (!holder || !fight) return null;

  /* THE HOLDER IS PUT RIGHT before the card is drawn, so that no card is ever
     drawn inside a box the last one left transparent. Straighten, then set
     what kind of card this holder is carrying. */
  resetHolder(holder);
  holder.dataset.cardKind = "fight";
  holder.dataset.property = "fight";
  board.dataset.property = "fight";

  const viewer = viewerSeat === null || viewerSeat === undefined
    ? (mine ? fight.playerId : opponentSeatOf(ledger, fight.playerId))
    : Number(viewerSeat);

  const topSeat = Number(fight.playerId) === Number(viewer)
    ? opponentSeatOf(ledger, fight.playerId)
    : fight.playerId;

  const heading = el("header", { class: "fight-card__head" }, [
    el("h3", { class: "fight-card__title", text: "Welcome to the Fight" }),
    el("p", {
      class: "fight-card__explain",
      text:
        "Fight is where weapons are used. Choose a weapon, pick a colony within its range, and take it from your opponent with everything built on it. Each weapon works once.",
    }),
  ]);

  const field = el("div", { class: "fight-card__field" }, [
    topSeat === null || topSeat === undefined ? null : fightHalf({
      ledger,
      pieces,
      seat: topSeat,
      viewerSeat: viewer,
      mine: false,
      fight,
    }),
    fightHalf({
      ledger,
      pieces,
      seat: viewer,
      viewerSeat: viewer,
      mine: mine && Number(fight.playerId) === Number(viewer),
      fight,
    }),
  ]);

  /* THE FOOT: one muted line - what the screen is asking for while the
     strike is armed, who is at the Fight otherwise, and - once a strike has
     been spent against a shield - the name of the shield that stopped it.
     The acting player's Cancel sits beside it, and the Leave pill is always
     theirs.

     THE BLOCKED LINE IS THE WHOLE OF THE BLOCK'S VISIBLE ANSWER inside the
     card. It is drawn from the fight's own result, which lives in the shared
     state, so both screens print the same sentence at the same moment; the
     shield's own colour carries it, and no second screen is opened to say
     what the card can say in five words. */
  const armed = fight.phase === "armed";
  const blocked = Boolean(fight.result?.blocked);
  const shield = blocked ? shieldById(fight.result?.shield) : null;
  const foot = el("footer", { class: "fight-card__foot" }, [
    el("p", {
      class: `fight-card__waiting${blocked ? " fight-card__waiting--blocked" : ""}`,
      style: blocked ? { "--shield": shieldColor(shield?.id) } : {},
      text: blocked
        ? `Stopped by ${shield?.name || "a shield"}`
        : armed
          ? "Tap a blinking colony"
          : `${playerName} is at the Fight`,
    }),
    mine && armed
      ? el("button", {
          type: "button",
          class: "fight-card__cancel",
          "data-action": "cancel",
          text: "Cancel",
        })
      : null,
  ]);

  const card = el("article", {
    class: "property-card fight-card",
    "data-property": "fight",
    "data-fight": "fight",
    "data-phase": fight.phase,
    style: { "--accent": "var(--ink)" },
    "aria-live": "polite",
  }, [heading, field, foot]);

  if (mine) {
    card.append(el("button", {
      type: "button",
      class: "fight-card__leave",
      "data-action": "leave",
      text: "Leave the fight",
    }));
  } else {
    card.append(el("p", { class: "fight-card__waiting-line", text: `Waiting for ${playerName}` }));
  }

  /* REPLACING, NOT PATCHING: the stage is drawn fresh from the state every
     time it changes, so an old stage's live buttons are never left under a
     new stage's face. There is no animation inside the card to protect - the
     blink and the glow live on the TILES. */
  holder.replaceChildren(card);
  holder.hidden = false;
  return card;
}

/** The seat the viewer is not - for a two-seat roster. */
function opponentSeatOf(ledger, seat) {
  const other = (ledger?.players || []).find((p) => p.seat !== Number(seat));
  return other ? other.seat : null;
}

/* ------------------------------------------------------------------ marks */

/**
 * What the tiles say while somebody is choosing.

   `selected` gets the soft static glow on every tile in reach; `armed` gets
   the slow blink on the same tiles. The glow is part of the state - it is
   drawn from the same ledger both players read - so both screens light the
   same tiles, and a tile that is lit on one is lit on the other.
 */
function markTargets(board, fight, ledger, className) {
  let marked = 0;
  for (const id of validTargets(ledger, fight.selectedWeaponId, fight.playerId)) {
    const cell = board.querySelector(`.board__cell[data-id="${id}"]`);
    if (cell) {
      cell.classList.add(className);
      marked += 1;
    }
  }
  return marked;
}

/** Clear every mark this stage can have drawn, before drawing any. */
export function clearFightMarks(board) {
  const arm = board.querySelector(".board--fight-armed");
  for (const cell of board.querySelectorAll(".is-fight-glow, .is-fight-blink")) {
    cell.classList.remove("is-fight-glow", "is-fight-blink");
  }
  if (arm) arm.classList.remove("board--fight-armed");
}

/**
 * Paint the tiles the strike is looking at, from the state.
 *
 * Selected: a soft glow, and no wake. Armed: a slow red blink, and the board
 * knows it is armed so the strike can be asked of the tile itself.
 */
export function drawFightMarks(board, fight, ledger) {
  clearFightMarks(board);
  if (!fight || !ledger) return;
  if (fight.phase === "selected") {
    markTargets(board, fight, ledger, "is-fight-glow");
  } else if (fight.phase === "armed") {
    board.classList.add("board--fight-armed");
    markTargets(board, fight, ledger, "is-fight-blink");
  }
}

/* The name of the colony a strike is asking about, for the caption. Kept
   beside the marks so the live line and the tiles cannot disagree. */
export function colonyName(id) {
  const cell = CELLS.find((entry) => entry.id === id);
  return cell?.name || null;
}
