/* ==========================================================================
   SAMRAJYA - THE BLACK HOLE

   A SHARED screen, drawn from the state - the same way the chests, the
   fight and Epoch are. `game.hole` is the whole truth about it: which seat
   the singularity holds, how much entropy that seat has gathered, and what
   its next roll has been made to mean. Every client draws the middle from
   that fact, so a device that reconnects, joined late, or missed a message
   shows exactly the same confinement.

   THREE SCREENS IN ONE FILE

   1. THE CINEMATIC - a full-screen veil that takes the whole interface to
      absolute black, holds the singularity's line for five seconds, and
      restores the board. It is played ONCE per capture, keyed by the
      capture's own `startedAt`, so repaints and re-entries cannot replay
      it; it carries no game effect at all - it is a held breath, not an
      action. Its message names its OWN paper token (`--veil-paper`),
      because the veil lives at the body where the board's tokens are not
      in scope - the mistake that once printed the message in ink on black.

   2. THE ACTIVE PANEL - the card the held seat acts from: the mythology,
      the Entropy Protocol, the meter, the Relativistic Escape Vessel, and
      the two presses with what each one costs written beneath it. The
      buttons are the held seat's alone; the other player reads the same
      card with the buttons dead.

   3. THE INSPECTION CARD - the lore-only peek a tap on the tile opens when
      NOBODY is held: pure explanation, no meter, no presses, no state. It
      is a reading card, the way every other tile's card is.

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

/* ------------------------------------------------------------- the lore */

/* THE WRITING, IN ONE PLACE, SO BOTH CARDS CANNOT DRIFT.

   Ancient, cosmic, and specific to Kaalchakra: what the Black Hole is,
   where it came from, and what it does to whoever enters - told in short
   paragraphs with room to breathe, never one enormous block. The gameplay
   sections beneath say exactly what the server does and nothing else. */

const LORE = [
  "Before the first star was born, before the celestial kingdoms claimed their territories, Kaalchakra was already turning. Its cycles governed creation, destruction, and rebirth. But there was one moment the cycle could not contain: the instant in which creation and oblivion touched.",
  "From that collision came the Black Hole.",
  "Ancient astronomers called it the Wound in Kaalchakra. The oldest legends claim it was not born from a dying star, but from a fracture in the fabric of existence itself. Matter fell into its depths. Light surrendered. And time, stripped of its authority, began to fold back upon itself.",
  "Nothing that enters emerges unchanged. Distance loses meaning. Memories become fragments. A moment may stretch into an eternity, while centuries collapse into a single heartbeat.",
  "The Black Hole does not simply imprison its victims. It severs their connection to the ordinary flow of time. Those caught within cannot advance through the cosmos by ordinary means - they must force a breach in the temporal prison, or buy passage aboard a vessel built to survive the impossible.",
  "You may enter by chance. You will leave only by paying the price of escape.",
];

const PROTOCOL_HEADING = "The Entropy Protocol";

const PROTOCOL = [
  "Inside the singularity, the laws that govern the outer universe no longer hold. To escape, a prisoner must create an imbalance powerful enough to tear open a temporary passage through the event horizon. That imbalance is called entropy.",
  "By invoking the Protocol you surrender your current turn to the singularity. On your next turn your dice roll is converted into entropy rather than movement - every point contributes to the energy needed to breach the temporal prison. You remain trapped while the accumulated energy falls short.",
  "Once the threshold is reached you must commit to your escape, and it completes on your next turn: you roll, you move, and you are free.",
];

const VESSEL_HEADING = "Relativistic Escape Vessel";

const VESSEL_MYTH = [
  "There is another way out, though few can afford it. Beyond the outer colonies the last surviving vesselwrights craft vessels able to navigate the tidal forces around the singularity, their engines fed by a rare interstellar radioactive substance harvested from unstable celestial remnants.",
  "The fuel decays almost as quickly as it is produced, and every launch consumes an irreplaceable charge. The vessel does not defeat the Black Hole - it forces a narrow corridor through the event horizon and carries its passenger out before the corridor collapses.",
];

/* The two presses, with what each one costs - visible BEFORE the choice. */
const BUILD_NOTE =
  "Free passage. Costs your current turn: your next turn converts your roll into escape energy instead of movement. You stay trapped until the threshold is reached.";
const VESSEL_NOTE =
  "Pay \u20b9500 for a fuel-powered breach of the event horizon. Escape immediately, with no entropy required; you move again on your next eligible turn. The \u20b9500 is the whole of the price - no further charge.";

/* ------------------------------------------------------------- the veil */

/**
 * The capture itself: the interface falls to black, the singularity speaks
 * for five held seconds, and the board comes back.
 *
 * It is one element with one keyframe sequence, so the timing lives in the
 * stylesheet beside the rest of the board's motion and cannot drift from
 * it. The message is a child of the blackout - painted ON the black, in the
 * veil's own paper token - so it sits above the overlay by construction.
 * A reader who asked for less motion gets the same five seconds with the
 * message plainly shown and no fades.
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
      el("span", { class: "hole-veil__sub", text: "Even time has abandoned you." }),
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

/** One lore paragraph, on the measure the card gives it. */
function prose(text) {
  return el("p", { class: "hole-card__prose", text });
}

/** A titled block of gameplay writing: heading, then its paragraphs. */
function section(name, paragraphs) {
  return el("section", { class: "hole-card__section" }, [
    el("h4", { class: "hole-card__section-name", text: name }),
    ...paragraphs.map((text) => el("p", { class: "hole-card__prose", text })),
  ]);
}

/**
 * The confinement panel, drawn from the state.
 *
 * The board's OWN card, on the board's own paper: the property card's
 * ivory ground, the same ink, the same pill and head - only the meter, the
 * gold accent and the two presses are the confinement's own. It is full of
 * what the place IS and what each choice costs, because a player must
 * understand the singularity, the Protocol and the vessel before they
 * press anything, not learn the price afterwards.
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
    /* THE MIDDLE, AS ONE REGION: everything that is said rather than
       pressed. It takes whatever height is left and scrolls inside itself,
       so the presses at the foot stay pinned at every screen size. */
    el("div", { class: "hole-card__body" }, [
      el("p", {
        class: "hole-card__tag",
        text: released
          ? "The vessel breaks the hold."
          : "Gravitational confinement active",
      }),
      ...LORE.map((text) => el("p", { class: "hole-card__prose", text })),
      section(PROTOCOL_HEADING, [
        ...PROTOCOL,
        "Normal threshold: 10 entropy - halved to 5 while you hold Event Horizon.",
      ]),
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
        /* The figure says the whole thing in one line: what is held against
           what is needed, at whatever threshold the ledger gives. */
        el("p", { class: "hole-card__figure" }, [
          el("span", { class: "hole-card__figure-label", text: "Entropy: " }),
          el("span", { class: "hole-card__entropy", text: String(entropy) }),
          el("span", { class: "hole-card__of", text: " / " }),
          el("span", { class: "hole-card__threshold", text: String(threshold) }),
        ]),
        /* THE HOLD'S OWN NOTE. The threshold is halved while this seat holds
           Event Horizon, and the card says so where the number is - the same
           fact the meter is drawn from, never a second count. */
        held
          ? el("p", { class: "hole-card__held", text: "Event Horizon held \u2014 threshold halved to 5." })
          : null,
        el("p", {
          class: "hole-card__compact",
          text: "Your next roll fuels the breach. Movement is suspended while you generate entropy.",
        }),
      ].filter(Boolean)),
      section(VESSEL_HEADING, VESSEL_MYTH),
      el("p", {
        class: "hole-card__prose hole-card__prose--facts",
        text: "Cost \u20b9500 - the whole of the price, with no further charge. It releases you immediately, without the Protocol; you roll and move again on your next eligible turn.",
      }),
      !mine && !released
        ? el("p", { class: "hole-card__watcher", text: `Waiting for ${playerName}` })
        : null,
    ].filter(Boolean)),
    /* THE TWO PRESSES, EACH WITH ITS PRICE NAMED BENEATH IT - visible
       before the player commits, not discovered after. */
    el("div", { class: "hole-card__actions" }, [
      released
        ? el("p", { class: "hole-card__released", text: "Released" })
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
            : [
                el("button", {
                  type: "button",
                  class: "hole-card__action hole-card__action--primary",
                  "data-action": atEase ? "escape" : "build",
                  disabled: !mine,
                  "aria-disabled": String(!mine),
                  text: atEase ? "Escape next turn" : "Build entropy",
                }),
                el("p", { class: "hole-card__action-note", text: atEase
                  ? "Free passage. Your escape completes on your next turn: roll, move, and leave the singularity behind."
                  : BUILD_NOTE }),
              ],
      released || committed
        ? null
        : [
            el("button", {
              type: "button",
              class: "hole-card__action hole-card__action--vessel",
              "data-action": "vessel",
              disabled: !mine,
              "aria-disabled": String(!mine),
            }, [
              el("span", { class: "hole-card__action-name", text: "Acquire escape vessel" }),
              el("span", { class: "hole-card__action-price", text: "\u20b9500" }),
            ]),
            el("p", { class: "hole-card__action-note", text: VESSEL_NOTE }),
          ],
    ].flat(Infinity).filter(Boolean)),
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

/* --------------------------------------------------- the inspection card */

/**
 * BLACK HOLE, READ ONLY - what the tile opens when nobody is held.
 *
 * A reading card in the square card's own style: the title, the subtitle,
 * the creation myth, why escape costs entropy or a vessel, both thresholds,
 * the vessel's price and its fuel - and the warning that landing here traps
 * you. No meter, no presses, no state: it explains the tile, it does not
 * play it. The close button takes it away exactly as every other reading
 * card does.
 */
export function drawHoleLoreCard({ onClose = null } = {}) {
  const card = el("article", {
    class: "property-card hole-card hole-lore",
    "data-property": "black-hole",
    "data-square": "black-hole",
    style: { "--accent": "var(--ink)" },
    "aria-live": "polite",
  }, [
    el("button", {
      type: "button",
      class: "property-card__close",
      "aria-label": "Close",
      title: "Close",
      "data-action": "close",
      text: "\u00d7",
    }),
    el("div", { class: "property-card__head" }, [
      el("div", { class: "property-card__title" }, [
        el("span", { class: "property-card__pill", "aria-hidden": "true" }),
        el("h3", {
          class: "property-card__name",
          html: "<span>BLACK</span><span>HOLE</span>",
        }),
      ]),
    ]),
    el("div", { class: "hole-card__body" }, [
      el("p", { class: "hole-lore__subtitle", text: "The Wound in Kaalchakra" }),
      ...LORE.map((text) => el("p", { class: "hole-card__prose", text })),
      section(PROTOCOL_HEADING, [
        PROTOCOL[0],
        "The singularity's hold can be broken two ways: entropy, generated over your turns, or a Relativistic Escape Vessel bought outright.",
        `Normal escape threshold: 10 entropy. While you hold Event Horizon: 5 entropy.`,
      ]),
      section(VESSEL_HEADING, [
        ...VESSEL_MYTH,
        "The price of passage is \u20b9500. The fuel is consumed. The singularity is left behind.",
      ]),
      section("If you fall into the singularity", [
        "You cannot move normally while trapped. You may sacrifice your current turn to begin building entropy, then use subsequent turns to gather enough energy to breach the singularity. Alternatively, you may acquire a Relativistic Escape Vessel for \u20b9500 and escape according to the vessel's turn rules.",
      ]),
      el("p", {
        class: "hole-lore__warning",
        text: "Warning: landing on Black Hole traps you. Your movement stops and you must pay the price of escape - entropy, or \u20b9500.",
      }),
    ]),
  ]);

  const close = card.querySelector('[data-action="close"]');
  if (close) {
    close.addEventListener("click", () => {
      if (typeof onClose === "function") onClose();
    });
  }

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
