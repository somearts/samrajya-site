/* ==========================================================================
   SAMRAJYA - THE EPOCH SCREEN

   A SHARED screen, drawn from the state - the same way the two chests and the
   fight are. `game.epoch` is the whole truth about it: which player is there,
   which stage it is in, which Time Card was drawn and what it produced. Every
   client draws the middle from that fact, so a device that reconnects, that
   joined late, or that missed a message shows exactly the same screen. Nobody
   has to refresh.

   THE DESIGN LANGUAGE IS NEXUS'S
   ------------------------------
   Epoch is built from the same parts as the Nexus card: a figure at the top,
   a title, a short tagline, a scrollable mythology, and one action pinned to
   the bottom. The proportions, spacing, borders and typography follow Nexus so
   Epoch belongs to the same game. What is Epoch's own is its symbol, its name,
   its mythology and its cards - not its layout.

   ONE ACTION, THEN ONE CARD
   -------------------------
   The player presses DRAW; a single Time Card is revealed in the same card
   (there is no second screen and no shuffle to sit through); its outcome is
   shown; and a CONTINUE pill ends the visit. Alternate Timeline pauses for a
   choice of two futures before it resolves.

   THE RULES ARE NOT HERE
   ----------------------
   What a card does is decided by shared/game.js, which owns the state, the
   ledger and the turn. This file only draws it.
   ========================================================================== */

import { el } from "./dom.js";
import { resetHolder } from "./board-fx.js";
import { timeCardById } from "./shared/epoch-cards.js";
import { CELLS } from "./shared/spaces.js";
import { coinColor, civById } from "./shared/civilizations.js";

/* -------------------------------------------------------------- the symbol */

/**
 * The Epoch mark: a celestial ring, deliberately opened, with the present
 * held at its centre.
 *
 * A circle of time with one break in it - the threshold where the Kaalchakra
 * changes direction - and a single point at the middle for the moment that is
 * now. A small bead sits on the ring for a cycle in motion. One stroke weight,
 * no fill beyond the centre point, and legible at the size the card gives it.
 * It is drawn here rather than fetched, so it costs no request and cannot fail
 * to load. `currentColor` keeps it in the card's own ink.
 */
export function epochMark(size = 96) {
  const r = 34;          // the ring's radius
  const gap = 30;        // degrees of opening, centred on the top
  const start = (gap / 2 - 90) * (Math.PI / 180);
  const end = (360 - gap / 2 - 90) * (Math.PI / 180);
  const x1 = 50 + r * Math.cos(start);
  const y1 = 50 + r * Math.sin(start);
  const x2 = 50 + r * Math.cos(end);
  const y2 = 50 + r * Math.sin(end);
  // A bead on the ring, at the lower right: a cycle caught mid-turn.
  const beadA = 120 * (Math.PI / 180);
  const bx = 50 + r * Math.cos(beadA);
  const by = 50 + r * Math.sin(beadA);
  return (
    `<svg class="epoch-card__mark" width="${size}" height="${size}" viewBox="0 0 100 100" ` +
    `xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">` +
    `<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">` +
    // The opened ring: one arc from just after the gap, all the way round.
    `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 1 1 ${x2.toFixed(2)} ${y2.toFixed(2)}"/>` +
    // A short inner arc, a second epoch turning within the first.
    `<path d="M 50 24 A 26 26 0 0 1 71 37" opacity="0.5"/>` +
    `</g>` +
    // The present: a filled point at the centre.
    `<circle cx="50" cy="50" r="4.4" fill="currentColor"/>` +
    // The cycle in motion: a bead on the ring.
    `<circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="3.2" fill="currentColor"/>` +
    `</svg>`
  );
}

/* --------------------------------------------------------------- the names */

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

/** The name a square goes by, or its index if it somehow has none. */
function squareName(index) {
  const cell = CELLS.find((c) => c.index === Number(index));
  return cell?.name || String(index ?? "");
}

/* ------------------------------------------------------------------ the card */

/**
 * The Epoch card, drawn from the state, whole.
 *
 * `epoch` is the state's epoch. `mine` says whether the VIEWER is the player
 * whose turn it is - the one who landed and acts. The other viewer sees the
 * same screen read-only, with a muted line naming who they are waiting for.
 */
export function drawEpochStage(
  board,
  epoch,
  { mine = false, ledger = null, pieces = [], viewerSeat = null, playerName = "" } = {},
) {
  const holder = board.querySelector(".board__card");
  if (!holder || !epoch) return null;

  resetHolder(holder);
  holder.dataset.cardKind = "epoch";
  holder.dataset.property = "epoch";
  board.dataset.property = "epoch";

  const revealed = epoch.phase === "revealed" || epoch.phase === "choosing";
  const card = epoch.cardId ? timeCardById(epoch.cardId) : null;
  const result = epoch.result || null;

  /* The figure and the introduction. These stand down once the card is out, so
     the revealed Time Card has the room to be read - the same way the Nexus
     mythology gives way to the deck. */
  const figure = el("div", { class: "epoch-card__figure-wrap" }, [
    el("span", { class: "epoch-card__figure", "aria-hidden": "true", html: epochMark(104) }),
  ]);

  const heading = el("h3", { class: "epoch-card__title", text: "EPOCH" });
  const tagline = el("p", {
    class: "epoch-card__tagline",
    text: "The present is only one of time's possibilities.",
  });

  /* A few short paragraphs, not a wall. The full mythology folds open beneath
     the concise opening, so the card stays readable and the action stays
     within reach. */
  const mythology = el("div", { class: "epoch-card__mythology" }, [
    el("span", {
      text:
        "Before the first empire rose, the Kaalchakra was already turning. At its heart lies Epoch: the threshold between what has happened and what has not yet come to pass.",
    }),
    el("span", {
      text:
        "Time does not reward virtue or obey ambition. It merely opens a door. A forgotten moment may return; the future may reveal a fragment of itself; an opponent's advantage may become yours - not because the past has changed, but because the present has been rearranged.",
    }),
  ]);

  const more = el("details", { class: "epoch-card__more" }, [
    el("summary", { class: "epoch-card__more-summary", text: "The deeper myth" }),
    el("div", { class: "epoch-card__mythology epoch-card__mythology--deep" }, [
      el("span", {
        text:
          "Epoch is not the beginning or the end of time. It is the instant in which time changes direction, pauses, fractures into possibilities, or reveals a future hidden from the present. Every moment holds countless outcomes, but only one becomes history; the rest remain suspended in the unseen architecture of the Kaalchakra.",
      }),
      el("span", {
        text:
          "Those who arrive here are offered no promise of good fortune. Power is not only the ability to acquire or destroy - it is the ability to influence when things happen, which possibilities survive.",
      }),
      el("span", {
        text:
          "Every ruler believes they are moving through time. Epoch asks whether time is moving through them.",
      }),
    ]),
  ]);

  const explain = el("p", {
    class: "epoch-card__explain",
    text: "Draw a Time Card to invite a temporal effect.",
  });

  /* The revealed card, and whatever it produced. */
  const outcome = el("div", { class: "epoch-card__result", hidden: !revealed }, [
    card
      ? el("div", { class: "epoch-card__face", "data-card": card.id }, [
          el("span", { class: "epoch-card__face-name", text: card.name }),
          el("p", { class: "epoch-card__face-text", text: card.text }),
          result?.sight
            ? el("p", {
                class: "epoch-card__sight",
                text: `Your next throw: ${result.sight}`,
              })
            : null,
          result?.outcome
            ? el("p", { class: "epoch-card__outcome", text: result.outcome })
            : null,
        ])
      : null,
  ]);

  /* The actions, pinned to the bottom exactly as Nexus's are. */
  const actions = [];
  if (mine && epoch.phase === "open") {
    actions.push(
      el("button", {
        type: "button",
        class: "epoch-card__draw",
        "data-action": "draw",
        text: "DRAW",
      }),
    );
  }
  if (mine && epoch.phase === "choosing") {
    /* Two compact futures. The destination is named so the choice is clear
       before it is confirmed; the unselected one has no effect at all. */
    const from = positionOf(pieces, epoch.playerId);
    actions.push(
      el("p", { class: "epoch-card__prompt", text: "The moment splits. Choose a future." }),
      el("div", { class: "epoch-card__choices" }, [
        el("button", {
          type: "button",
          class: "epoch-card__choice",
          "data-action": "choice",
          "data-option": "forward",
          title: `Advance 2 to ${squareName((from + 2) % CELLS.length)}`,
        }, [
          el("span", { class: "epoch-card__choice-name", text: "FORWARD 2" }),
          el("span", { class: "epoch-card__choice-to", text: `→ ${squareName((from + 2) % CELLS.length)}` }),
        ]),
        el("button", {
          type: "button",
          class: "epoch-card__choice",
          "data-action": "choice",
          "data-option": "backward",
          title: `Fall back 2 to ${squareName((from - 2 + CELLS.length * 2) % CELLS.length)}`,
        }, [
          el("span", { class: "epoch-card__choice-name", text: "BACKWARD 2" }),
          el("span", { class: "epoch-card__choice-to", text: `← ${squareName((from - 2 + CELLS.length * 2) % CELLS.length)}` }),
        ]),
      ]),
    );
  }
  if (mine && epoch.phase === "revealed") {
    actions.push(
      el("button", {
        type: "button",
        class: "epoch-card__continue",
        "data-action": "continue",
        text: "CONTINUE",
      }),
    );
  }

  /* THE PROSE IS ONE SCROLL REGION. The symbol, heading and tagline stay put
     at the top; everything the player reads - the opening mythology, the
     fold-out deeper myth and the line that invites the draw - scrolls together
     inside the space between them and the action. That is what keeps DRAW
     pinned at the bottom no matter how long the text grows, and what lets the
     deeper myth open without shoving the button off the card. */
  const prose = revealed
    ? null
    : el("div", { class: "epoch-card__scroll" }, [mythology, more, explain]);

  const card_ = el("article", {
    class: "property-card epoch-card",
    "data-property": "epoch",
    "data-epoch": "epoch",
    "data-phase": epoch.phase,
    style: { "--accent": "var(--ink)" },
    "aria-live": "polite",
  }, [
    revealed ? null : figure,
    revealed ? null : heading,
    revealed ? null : tagline,
    prose,
    outcome,
    actions.length ? el("div", { class: "epoch-card__actions" }, actions) : null,
  ]);

  if (!mine) {
    card_.append(el("p", { class: "epoch-card__waiting", text: `Waiting for ${playerName}` }));
  }

  /* REPLACING, NOT PATCHING: the stage is drawn fresh from the state every
     time it changes, so no stale button from an earlier stage is ever left
     under a new one. There is no animation inside the card to protect. */
  holder.replaceChildren(card_);
  holder.hidden = false;
  return card_;
}

/** Where a seat's coin stands, read from the pieces. */
function positionOf(pieces, seat) {
  const piece = (pieces || []).find((p) => p.seat === Number(seat));
  return Number.isInteger(piece?.position) ? piece.position : 0;
}
