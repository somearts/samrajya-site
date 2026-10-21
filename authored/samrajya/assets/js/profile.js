/* ==========================================================================
   SAMRAJYA - A PLAYER, OPENED

   The middle of the board, turned into one player's record: who they are, what
   they hold, what they carry and what they have done.

   It reads the game and writes the DOM. It decides nothing and fetches
   nothing, and every figure is derived at the moment it is written from the
   same ledger both devices already share - so the two profiles in a room can
   never tell two different stories about the same turn.

   The ledger is newest first because that is how it is kept, and because the
   last thing that happened is the thing a player opens this to check. Money is
   written by `rupees` and nowhere else.
   ========================================================================== */

import { el } from "./dom.js";
import { civById, coinColor } from "./shared/civilizations.js";
import {
  MAX_UPGRADE,
  hasMonopoly,
  levelOf,
  moneyOf,
  nameOfSeat,
  ownerOf,
  rentAt,
  setMembers,
} from "./shared/ledger.js";
import { priceOf, rupees, upgradeAt } from "./shared/economy.js";
import { propertyFor } from "./shared/properties.js";
import { CELLS, SETS } from "./shared/spaces.js";
import { emblem, weaponColor } from "./chest-card.js";
import { weaponById } from "./shared/weapons.js";
import { signed } from "./shared/announcements.js";

/** The properties in the order the board walks them. */
const PROPERTIES = CELLS.filter((cell) => cell.type === "property");

/** One of the three dots under a colony's name. */
function pips(level) {
  return el(
    "span",
    { class: "profile-pips", "aria-label": `${level} of ${MAX_UPGRADE} upgrades` },
    Array.from({ length: MAX_UPGRADE }, (_, n) =>
      el("span", {
        class: "profile-pip",
        "data-on": n < level ? "true" : "false",
      }),
    ),
  );
}

/** What a player has put into their holdings, for the net worth line. */
function invested(ledger, seat) {
  let total = 0;
  for (const cell of PROPERTIES) {
    if (ownerOf(ledger, cell.id) !== seat) continue;
    total += priceOf(cell.id) || 0;
    const level = levelOf(ledger, cell.id);
    for (let n = 0; n < level; n += 1) total += upgradeAt(cell.id, n)?.cost || 0;
  }
  return total;
}

/* ------------------------------------------------------------------ header */

function header(ledger, player, seat, onClose) {
  const civ = civById(player.civ);
  return el("header", { class: "profile__head" }, [
    el("span", {
      class: "profile__coin",
      "aria-hidden": "true",
      style: { "--coin": coinColor(player.civ) || "var(--ink)" },
    }),
    el("div", { class: "profile__who" }, [
      el("h2", { class: "profile__name", text: player.name || nameOfSeat(ledger, seat) }),
      el("p", { class: "profile__civ", text: civ?.name || "Unchosen" }),
    ]),
    el("button", {
      type: "button",
      class: "profile__close",
      "aria-label": "Close profile",
      title: "Close profile",
      text: "\u00d7",
      onclick: () => onClose?.(),
    }),
  ]);
}

/* -------------------------------------------------------------- properties */

function propertyRow(ledger, cell, seat) {
  const level = levelOf(ledger, cell.id);
  return el("div", { class: "profile-colony", "data-property": cell.id }, [
    el("span", {
      class: "profile-colony__pill",
      "aria-hidden": "true",
      style: { background: cell.color },
    }),
    el("span", { class: "profile-colony__name", text: propertyFor(cell.id)?.name || cell.name }),
    pips(level),
    el("span", { class: "profile-colony__rent", text: rupees(rentAt(ledger, cell.id)) }),
  ]);
}

function propertiesSection(ledger, seat) {
  const owned = PROPERTIES.filter((cell) => ownerOf(ledger, cell.id) === seat);

  const body = [];
  if (owned.length === 0) {
    body.push(el("p", { class: "profile__empty", text: "No colonies yet." }));
  } else {
    for (const cell of CELLS) {
      if (cell.type !== "property" || !cell.set) continue;
      const members = setMembers(ledger, cell.id);
      if (members[0] !== cell.id) continue;
      const held = members.filter((id) => ownerOf(ledger, id) === seat);
      if (held.length === 0) continue;
      const full = held.length === members.length;
      const setNumber = String(cell.set).replace(/^s/, "");
      body.push(
        el("div", { class: "profile-set", "data-set": cell.set }, [
          el("div", { class: "profile-set__head" }, [
            el("span", {
              class: "profile-set__pill",
              "aria-hidden": "true",
              style: { background: SETS[cell.set]?.color || "var(--ink)" },
            }),
            el("span", { class: "profile-set__label", text: `Set ${setNumber}` }),
            el("span", {
              class: `profile-set__badge${full ? " profile-set__badge--full" : ""}`,
              text: full ? "Full set" : `${held.length} of ${members.length}`,
            }),
          ]),
          ...CELLS.filter((c) => c.type === "property" && c.set === cell.set).map((c) =>
            propertyRow(ledger, c, seat),
          ),
        ]),
      );
    }
  }

  return el("section", { class: "profile__section", "data-section": "properties" }, [
    el("div", { class: "profile__section-head" }, [
      el("h3", { class: "profile__label", text: "PROPERTIES" }),
      el("p", { class: "profile__count", text: `Owns ${owned.length} of ${PROPERTIES.length} colonies` }),
    ]),
    ...body,
  ]);
}

/* ----------------------------------------------------------------- weapons */

function weaponCard(id) {
  const weapon = weaponById(id);
  if (!weapon) return null;
  return el("article", {
    class: "profile-weapon",
    "data-weapon": weapon.id,
    style: { "--weapon": weaponColor(weapon.id) },
  }, [
    el("div", { class: "profile-weapon__face" }, [
      el("div", { class: "profile-weapon__emblem", html: emblem(weapon) }),
    ]),
    el("span", { class: "profile-weapon__pill", "aria-hidden": "true" }),
    el("h4", { class: "profile-weapon__name", text: weapon.name }),
    el("p", { class: "profile-weapon__reach", text: "Reaches" }),
    el("div", { class: "profile-weapon__targets" },
      (weapon.targets || []).map((target) =>
        el("span", {
          class: "profile-weapon__target",
          text: propertyFor(target)?.name || target,
        }),
      )),
  ]);
}

function weaponsSection(piece) {
  const weapons = (piece?.weapons || []).map(weaponCard).filter(Boolean);
  return el("section", { class: "profile__section", "data-section": "weapons" }, [
    el("h3", { class: "profile__label", text: "WEAPONS" }),
    weapons.length
      ? el("div", { class: "profile-weapons" }, weapons)
      : el("p", { class: "profile__empty", text: "No weapons yet. Draw at Ragnarok." }),
  ]);
}

/* ------------------------------------------------------------------ ledger */

function ledgerRow(entry) {
  const turn = Number.isInteger(entry.turn) ? `T${entry.turn + 1}` : "T\u2014";
  const amount = Math.trunc(Number(entry.amount) || 0);
  return el("div", { class: "profile-ledger__row", "data-kind": entry.kind || "" }, [
    el("span", { class: "profile-ledger__turn", text: turn }),
    el("p", { class: "profile-ledger__text", text: entry.text || "" }),
    el("div", { class: "profile-ledger__money" }, [
      el("span", {
        class: `profile-ledger__amount profile-ledger__amount--${amount < 0 ? "spend" : amount > 0 ? "earn" : "even"}`,
        text: amount === 0 ? "\u2014" : signed(amount),
      }),
      el("span", { class: "profile-ledger__balance", text: rupees(entry.balance || 0) }),
    ]),
  ]);
}

function ledgerSection(ledger, seat) {
  const entries = (ledger.history || []).filter((entry) => entry.seat === seat);
  return el("section", { class: "profile__section", "data-section": "ledger" }, [
    el("h3", { class: "profile__label", text: "LEDGER" }),
    entries.length
      ? el("div", { class: "profile-ledger" }, entries.map(ledgerRow))
      : el("p", { class: "profile__empty", text: "No activity yet." }),
  ]);
}

/* ------------------------------------------------------------------- panel */

/**
 * One player's profile, as the whole middle of the board.
 *
 * `onClose` is the chip's own second tap as well as the x: the panel itself has
 * no idea how it was opened, and both ways out are the same way out.
 */
export function profilePanel({ ledger, game, players = [], seat, onClose = null } = {}) {
  const player =
    ledger?.players?.find((p) => p.seat === Number(seat)) ||
    players.find((p, n) => n === Number(seat)) ||
    { name: "", civ: "" };
  const piece = game?.pieces?.find((p) => p.seat === Number(seat)) || null;
  const cash = moneyOf(ledger, Number(seat));
  const worth = cash + invested(ledger, Number(seat));

  return el("section", {
    class: "board__profile",
    "data-profile-seat": String(seat),
    "aria-label": `${player.name || "Player"}'s profile`,
  }, [
    header(ledger, player, Number(seat), onClose),
    el("div", { class: "profile__money" }, [
      el("p", { class: "profile__cash", text: rupees(cash) }),
      el("p", { class: "profile__worth", text: `Net worth ${rupees(worth)}` }),
    ]),
    propertiesSection(ledger, Number(seat)),
    weaponsSection(piece),
    ledgerSection(ledger, Number(seat)),
  ]);
}
