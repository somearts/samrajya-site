/* ==========================================================================
   SAMRAJYA - THE BLACK HOLE

   A SHARED screen, drawn from the state - the same way the chests, the
   fight and Epoch are. `game.hole` is the whole truth about it: which seat
   the singularity holds, how much entropy that seat has gathered, and what
   its next roll has been made to mean. Every client draws the middle from
   that fact, so a device that reconnects, joined late, or missed a message
   shows exactly the same confinement.

   TWO SCREENS IN ONE FILE

   The visit has two moments and they live together:

   1. THE CINEMATIC - a full-screen veil that takes the whole interface to
      absolute black, holds the singularity's line for a beat, and restores
      the board. It is played ONCE per capture, keyed by the capture's own
      `startedAt`, so repaints and re-entries cannot replay it; it carries
      no game effect at all - it is a held breath, not an action.

   2. THE PANEL - the dark control card the held seat acts from. Entropy
      against the escape threshold, the two routes out, and the price of
      the third. The buttons are the held seat's alone; the other player
      reads the same card with the buttons dead, the same way every shared
   screen does.

   NOTHING HERE DECIDES ANYTHING

   The entropy arithmetic, the thresholds, the price and the release all
   live in shared/game.js. This file only shows them: the meter is a
   fraction, the labels are the state's own, and a button press is an
   action the server answers.
   ========================================================================== */

import { el } from "./dom.js";
import { resetHolder } from "./board-fx.js";
import { prefersStill } from "./dice.js";
import { EVENT_HORIZON, holeThreshold } from "./shared/game.js";
import { ownerOf } from "./shared/ledger.js";

/** How long the cinematic runs: the fade in, five seconds of black, the fade out. */
export const CINEMATIC_MS = 5500;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/* ------------------------------------------------------------- the veil */

/**
 * The capture itself: the interface falls to black, the singularity speaks
 * for five held seconds, and the board comes back.
 *
 * It is one element with one keyframe sequence, so the timing lives in the
 * stylesheet beside the rest of the board's motion and cannot drift from
 * it. The message is a child of the blackout - painted ON the black, in the
 * paper colour, dead centre - so it sits above the overlay by construction
 * and nothing can slip between them. A reader who asked for less motion
 * gets the same five seconds with the message plainly shown and no fades.
 *
 * The veil covers the whole document, because the whole document is what
 * the singularity takes: board, header, die and every control. It also
 * swallows every pointer event, so no press can reach anything beneath it;
 * the board adds its own gate on top (see `cinematic` in board.js).
 */
export async function playHoleCinematic(hole) {
  if (!hole) return;
  const veil = el("div", { class: "hole-veil", role: "status" }, [
    el("p", { class: "hole-veil__line" }, [
      el("span", { class: "hole-veil__title", text: "CAUGHT IN THE SINGULARITY" }),
      el("span", { class: "hole-veil__sub", text: "Escape velocity required." }),
    ]),
  ]);
  document.body.append(veil);

  if (prefersStill()) {
    // The line, plainly, for the same five seconds, and then the board.
    veil.classList.add("hole-veil--still");
    await wait(5000);
  } else {
    /* Two frames are needed for the transition to run: the element is laid
       out at zero, and the class that takes it to full black is what the
       animation is written against. */
    void veil.offsetHeight;
    veil.classList.add("is-live");
    await wait(CINEMATIC_MS);
  }
  veil.remove();
}

/* ------------------------------------------------------------- the panel */

/** The heart of the meter, as a whole percentage of the threshold. */
function fillOf(entropy, threshold) {
  if (!threshold) return 0;
  return Math.max(0, Math.min(100, Math.round((entropy / threshold) * 100)));
}

/**
 * The confinement panel, drawn from the state.
 *
 * The board's own card, on the board's own paper: the same ivory ground,
 * the same ink, the same pill and head as every other card - only the
 * meter, the gold accent and the two presses are the confinement's own.
 * What it says, in order: where the seat is, what the meter holds, and
 * what the seat may press.
 */
export function drawHoleStage(board, hole, { mine = false, ledger = null, handlers = {}, playerName = "" } = {}) {
  const holder = board.querySelector(".board__card");
  if (!holder || !hole) return null;

  resetHolder(holder);
  holder.dataset.cardKind = "hole";
  holder.dataset.property = "black-hole";
  board.dataset.property = "black-hole";

  const entropy = Math.max(0, Number(hole.entropy) || 0);
  const threshold = holeThreshold(ledger, hole.playerId);
  const held = ownerOf(ledger, EVENT_HORIZON) === hole.playerId;
  const atEase = entropy >= threshold;
  const committed = Boolean(hole.escape);
  const armed = Boolean(hole.entropyRoll);
  const released = hole.phase === "released";

  const card = el("article", {
    class: "property-card hole-card",
    "data-property": "black-hole",
    "data-hole": "hole",
    "data-phase": hole.phase || "confined",
    /* The accent is the board's own gold - the s6 set colour - so the meter
       and the edge belong to the same palette the board prints in. */
    style: { "--accent": "#C9A24A" },
    "aria-live": "polite",
  }, [
    el("div", { class: "property-card__head" }, [
      el("div", { class: "property-card__title" }, [
        el("span", { class: "property-card__pill", "aria-hidden": "true" }),
        el("h3", { class: "property-card__name", text: "Black Hole" }),
      ]),
    ]),
    /* THE MIDDLE, AS ONE REGION. The card is the property card's three rows -
       head, body, actions - so whatever the confinement has to say (the
       meter, the hold's note, the seat's waiting line, the release) lives in
       the one row that may scroll, and the presses stay pinned at the foot
       however small the screen gets. */
    el("div", { class: "hole-card__body" }, [
      el("p", {
        class: "hole-card__tag",
        text: released
          ? "The vessel breaks the hold."
          : "Gravitational confinement active",
      }),
      el("div", { class: "hole-card__meter-block" }, [
        el("p", { class: "hole-card__label", text: "Entropy accumulation" }),
        el("div", {
          class: "hole-card__meter",
          role: "progressbar",
          "aria-valuemin": "0",
          "aria-valuemax": String(threshold),
          "aria-valuenow": String(entropy),
          "aria-label": "Entropy toward escape",
        }, [
          el("span", {
            class: "hole-card__meter-fill",
            style: { width: `${fillOf(entropy, threshold)}%` },
          }),
        ]),
        el("p", { class: "hole-card__figure" }, [
          el("span", { class: "hole-card__entropy", text: String(entropy) }),
          el("span", { class: "hole-card__of", text: " / " }),
          el("span", { class: "hole-card__threshold", text: String(threshold) }),
        ]),
        /* THE HOLD'S OWN NOTE. The threshold is halved while this seat holds
           Event Horizon, and the card says so where the number is - the same
           fact the meter is drawn from, never a second count. */
        held
          ? el("p", { class: "hole-card__held", text: "Event Horizon held \u2014 threshold halved." })
          : null,
      ].filter(Boolean)),
      released
        ? null
        : committed
          ? el("p", {
              class: "hole-card__waiting",
              "data-role": "waiting",
              text: "Escape committed. The next roll sets you free.",
            })
          : armed
            ? el("p", {
                class: "hole-card__waiting",
                "data-role": "waiting",
                text: "Entropy roll ready. Throw the die.",
              })
            : null,
      !mine && !released
        ? el("p", { class: "hole-card__watcher", text: `Waiting for ${playerName}` })
        : null,
    ].filter(Boolean)),
    el("div", { class: "hole-card__actions" }, [
      released
        ? el("p", { class: "hole-card__released", text: "Released" })
        : committed || armed
          ? null
          : atEase
            ? el("button", {
                type: "button",
                class: "hole-card__action hole-card__action--primary",
                "data-action": "escape",
                disabled: !mine,
                "aria-disabled": String(!mine),
                text: "Escape next turn",
              })
            : el("button", {
                type: "button",
                class: "hole-card__action hole-card__action--primary",
                "data-action": "build",
                disabled: !mine,
                "aria-disabled": String(!mine),
                text: "Build entropy",
              }),
      released || committed
        ? null
        : el("button", {
            type: "button",
            class: "hole-card__action hole-card__action--vessel",
            "data-action": "vessel",
            disabled: !mine,
            "aria-disabled": String(!mine),
          }, [
            el("span", { class: "hole-card__action-name", text: "Acquire escape vessel" }),
            el("span", { class: "hole-card__action-price", text: "\u20b9500" }),
          ]),
    ].filter(Boolean)),
  ]);

  if (mine) {
    for (const [selector, handler] of Object.entries(handlers)) {
      const button = card.querySelector(selector);
      if (button && typeof handler === "function") {
        button.addEventListener("click", handler, { once: true });
      }
    }
  }

  holder.replaceChildren(card);
  holder.hidden = false;
  return card;
}

/* ----------------------------------------------------------- the chip mark */

/**
 * The confinement, on the held seat's name chip.
 *
 * The panel belongs to the held seat's own turns; between them the middle
 * is the opponent's. The chip is what stays: a dark dot and the entropy
 * number, beside the weapons and shields, so both screens can see who the
 * hole holds and how close that seat is to energy enough - the same
 * smallest-space status the shields use.
 */
export function renderHole(root, seat, hole) {
  const chip = root.querySelectorAll(".who")[seat];
  if (!chip) return null;

  for (const stale of chip.querySelectorAll(".who__hole")) stale.remove();
  if (!hole || hole.playerId !== seat || hole.phase === "released") return null;

  const host = chip.querySelector(".who__weapons") || chip;
  const entropy = Math.max(0, Number(hole.entropy) || 0);
  host.append(
    el("span", {
      class: "who__hole",
      title: hole.escape
        ? `Held in the Black Hole - escape committed (${entropy} entropy)`
        : `Held in the Black Hole - ${entropy} entropy`,
      "aria-hidden": "true",
    }, [
      el("span", { class: "who__hole-dot" }),
      el("span", { class: "who__hole-entropy", text: String(entropy) }),
    ]),
  );
  return host;
}
