/* ==========================================================================
   SAMRAJYA - THE BLACK HOLE

   A SHARED screen, drawn from the state - the same way the chests, the
   fight and Epoch are. `game.hole` is the whole truth about it: which seat
   the singularity holds, how much entropy that seat has gathered, and what
   its next roll has been made to mean. Every client draws the middle from
   that fact, so a device that reconnects, joined late, or missed a message
   shows exactly the same confinement.

   TWO SCREENS IN ONE FILE

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

   THE TILE'S OWN INSPECTION PANEL (a tap on the corner while nobody is
   held) is not drawn here: it is the shared `cornerCard` panel - the same
   design system as START, OUTER SPACE and FIGHT - and the board draws it
   from `square-card.js`. Everything about the tile's look lives in one
   place, so this file only renders the screen the game actually plays.

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

/* --------------------------------------------------- the active popup copy

   THREE ZONES, ONE SCREEN, NO SCROLL - so every word here is budgeted
   against the smallest board the game draws: the design baseline of a
   360x640 phone, where the popup is four cells wide and eight cells tall.
   What survives is the whole of what a player needs: the epithet, the best
   line of the myth, the Protocol and its meter, the vessel and its price.
   These lines also carry the tile's ESSENTIAL gameplay facts for its
   inspection panel (drawn from `square-card.js` as the shared corner
   panel), so there is exactly one copy of each fact in the game. */

const ACTIVE_SUBTITLE = "The Wound of Kaalchakra";

const ACTIVE_LORE =
  "Born from a fracture in the cosmic cycle, the Black Hole devours light, matter, and time itself. Astronomers called it the Wound of Kaalchakra. Those caught within must bend entropy to escape - or pay for passage beyond the event horizon.";

const ACTIVE_PROTOCOL =
  "Your turn ends now. On your next turn your roll becomes entropy, not movement. Build enough to breach the singularity, then commit and escape on your next turn.";

const ACTIVE_VESSEL =
  "Rare radioactive fuel forces a passage through the event horizon. Pay \u20b9500 to escape without building entropy - you move again next turn.";

/* The notice under the presses: what the LEFT press costs, said before the
   press. It must agree with the server, word for word. */
const NOTICE_BUILD =
  "BUILD ENTROPY ends your current turn. You begin building entropy on your next turn.";
const NOTICE_ESCAPE =
  "ESCAPE NEXT TURN commits you: your next roll moves you, and the singularity lets you go.";

/* THE EMBLEM: a singularity as a mark, not an illustration - the dark
   core, the fine event-horizon ring, and one restrained orbit crossing
   behind it. Three elements, one deliberate stroke, sized to sit under the
   title like a logo rather than float beneath it. The ink follows the
   card's own text colour; the orbit takes the panel's gold. */
const EMBLEM_SVG =
  '<svg viewBox="0 0 56 34" class="hole-card__emblem-svg" xmlns="http://www.w3.org/2000/svg" focusable="false">' +
  '<ellipse cx="28" cy="17" rx="24" ry="9" transform="rotate(-12 28 17)" fill="none" stroke="var(--accent, #c9a24a)" stroke-width="1.2" stroke-linecap="round" opacity="0.85"/>' +
  '<circle cx="28" cy="17" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
  '<circle cx="28" cy="17" r="4.2" fill="currentColor"/>' +
  "</svg>";

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

/** A titled block of gameplay writing: heading, then its items - strings
    become lore paragraphs, and nodes (captions, meters) pass through as
    themselves. */
function section(name, items) {
  return el("section", { class: "hole-card__section" }, [
    el("h4", { class: "hole-card__section-name", text: name }),
    ...items.map((item) =>
      typeof item === "string"
        ? el("p", { class: "hole-card__prose", text: item })
        : item,
    ),
  ]);
}

/**
 * The confinement panel, drawn from the state.
 *
 * THREE FIXED ZONES, ONE SCREEN, NO SCROLL: a header (title left, close
 * right), a centre that says everything (epithet, the best of the myth, the
 * Protocol with its meter, the vessel with its price), and a footer that
 * holds the two presses side by side with what the left one costs written
 * beneath them. The content is budgeted to the smallest board the game
 * draws - the 360x640 baseline - so nothing is clipped, nothing scrolls,
 * and nothing essential is hidden. The close button closes the SCREEN
 * only: the confinement is the server's fact and does not notice.
 */
export function drawHoleStage(board, hole, {
  mine = false,
  ledger = null,
  handlers = {},
  playerName = "",
  onClose = null,
} = {}) {
  const holder = board.querySelector(".board__card");
  if (!holder || !hole) return null;

  resetHolder(holder);
  holder.dataset.cardKind = "hole";
  holder.dataset.property = "black-hole";
  board.dataset.property = "black-hole";

  const entropy = Math.max(0, Number(hole.entropy) || 0);
  const threshold = holeThreshold(ledger, hole.playerId);
  /* THE METER READS FULL PAST THE THRESHOLD. A roll can carry the stored
     figure beyond the escape number (8 + 6 = 14); the bar and the figure
     cap at the threshold - 10 / 10 - while `entropy` itself stays true for
     the escape check, the chip and the server. */
  const shown = Math.min(entropy, threshold);
  const held = ownerOf(ledger, EVENT_HORIZON) === hole.playerId;
  const atEase = entropy >= threshold;
  const committed = Boolean(hole.escape);
  const armed = Boolean(hole.entropyRoll);
  const released = hole.phase === "released";

  /* THE FOOTER: the presses, and what the left one costs. The states that
     have no press to offer (committed, armed, released) say their line in
     the same slot, so the footer never changes the card's height. */
  const footerRow = released
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
        : el("div", { class: "hole-card__footer-row" }, [
            el("button", {
              type: "button",
              class: "hole-card__action hole-card__action--primary",
              "data-action": atEase ? "escape" : "build",
              disabled: !mine,
              "aria-disabled": String(!mine),
            }, [
              /* TWO LINES IN THE PILL: the label, and beneath it a small
                 quiet tagline saying when the press takes effect - the cost
                 read before the press, inside the button itself. */
              el("span", { class: "hole-card__action-label", text: atEase ? "Escape next turn" : "Build entropy" }),
              el("span", {
                class: "hole-card__action-tag",
                text: atEase ? "Roll and move next turn" : "Start in next turn",
              }),
            ]),
            el("button", {
              type: "button",
              class: "hole-card__action hole-card__action--vessel",
              "data-action": "vessel",
              disabled: !mine,
              "aria-disabled": String(!mine),
            }, [
              el("span", { class: "hole-card__action-label", text: "Acquire vessel" }),
              el("span", { class: "hole-card__action-tag", text: "\u20b9500" }),
            ]),
          ]);

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
    /* ZONE 1 - the header: the title on the left, the close on the right. */
    el("div", { class: "property-card__head" }, [
      el("div", { class: "property-card__title" }, [
        el("span", { class: "property-card__pill", "aria-hidden": "true" }),
        el("h3", { class: "property-card__name", text: "Black Hole" }),
      ]),
    ]),
    el("button", {
      type: "button",
      class: "property-card__close",
      "aria-label": "Close",
      title: "Close",
      "data-action": "close",
      text: "\u00d7",
    }),

    /* ZONE 2 - the centre: ONE introduction (title's emblem, epithet, myth),
       then the Protocol with its caption and meter inside it, then the
       vessel with its price - three groups, spaced as sections rather than
       as six separate blocks. */
    el("div", { class: "hole-card__body" }, [
      /* THE INTRODUCTION, AS ONE UNIFIED SECTION: the emblem sits close
         under the title, the epithet right beneath the emblem, the myth
         right beneath that - four elements that read as a single opening
         rather than four floating parts. */
      el("div", { class: "hole-card__intro" }, [
        /* THE EMBLEM: a singularity as its own mark - the dark core, the
           fine event-horizon ring, and one restrained orbit crossing
           behind. Drawn in one stroke weight, the width of the title: a
           logo, not an illustration. */
        el("div", { class: "hole-card__emblem", "aria-hidden": "true", html: EMBLEM_SVG }),
        el("p", { class: "hole-lore__subtitle", text: ACTIVE_SUBTITLE }),
        el("p", { class: "hole-card__prose", text: ACTIVE_LORE }),
      ]),
      section("Entropy protocol", [
        ACTIVE_PROTOCOL,
        /* THE CAPTION UNDER THE EXPLANATION: the quiet line that says what
           the meter below is for. */
        el("p", {
          class: "hole-card__caption",
          text: "Track your entropy as you gather the energy to escape.",
        }),
        /* The figure and the hold's note on ONE line: the live amount
           against the live threshold, and - when the ledger halves it -
           the reason beside the number it changed. */
        el("div", { class: "hole-card__meter-head" }, [
          el("p", { class: "hole-card__figure" }, [
            el("span", { class: "hole-card__figure-label", text: "Entropy\u00a0" }),
            el("span", { class: "hole-card__entropy", text: String(shown) }),
            el("span", { class: "hole-card__of", text: " / " }),
            el("span", { class: "hole-card__threshold", text: String(threshold) }),
          ]),
          held
            ? el("p", { class: "hole-card__held", text: "Event Horizon: 5" })
            : null,
        ].filter(Boolean)),
        /* The bar, directly under its number - a track with real height and
           rounded ends, so it reads as a progress bar at a glance. */
        el("div", {
          class: "hole-card__meter",
          role: "progressbar",
          "aria-valuemin": "0",
          "aria-valuemax": String(threshold),
          "aria-valuenow": String(shown),
          "aria-label": "Entropy toward escape",
        }, [
          el("span", {
            class: "hole-card__meter-fill",
            style: { width: `${fillOf(entropy, threshold)}%` },
          }),
        ]),
      ]),
      section("Relativistic escape vessel \u00b7 \u20b9500", [ACTIVE_VESSEL]),
    ]),

    /* ZONE 3 - the footer: both presses side by side, the consequence of
       the left one beneath them, and the watcher's line when the panel is
       read. */
    el("div", { class: "hole-card__footer" }, [
      footerRow,
      released || committed || armed || !mine
        ? null
        : el("p", {
            class: "hole-card__notice",
            text: atEase ? NOTICE_ESCAPE : NOTICE_BUILD,
          }),
      !mine && !released
        ? el("p", { class: "hole-card__watcher", text: `Waiting for ${playerName}` })
        : null,
    ].filter(Boolean)),
  ]);

  /* THE CLOSE BUTTON CLOSES THE SCREEN AND NOTHING ELSE: no action, no
     state, no turn - the confinement is the server's fact and goes on
     regardless of whether this card is showing it. The board remembers the
     dismissal by stage so the next repaint does not put the card straight
     back up; tapping the tile brings the SAME live state again. */
  const close = card.querySelector('[data-action="close"]');
  if (close) {
    close.addEventListener("click", () => {
      if (typeof onClose === "function") onClose();
    });
  }

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
