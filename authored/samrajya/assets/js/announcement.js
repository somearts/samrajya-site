/* ==========================================================================
   SAMRAJYA - THE MIDDLE OF THE BOARD

   One surface, one voice. Everything the board has to say is said here: whose
   turn it is while the board is waiting, and one sentence at a time when
   something has actually happened. There is no second bar, no toast and no
   banner; a player never has to decide which of two messages to read.

   TWO MODES, ONE LAYER

   `status(spec)` is the resting state: a compact line in the upper middle that
   says whose turn it is and stays there until the game changes. It leaves the
   die alone below it, and it takes no taps.

   `show(spec)` is a fact that has just happened: a full-middle announcement
   that enters, holds long enough to be read, and leaves. While it is up the
   status steps aside; when it goes, the status comes back.

   A tap skips the announcement on screen. A reader who has asked for less
   motion gets the same words in a plain fade, and nothing travels.

   THE QUEUE

   Two things want the middle at once: an announcement and a player's record.
   The record wins for as long as it is open; announcements wait - queued, never
   dropped - and are said in the order things happened the moment it closes.

   The queue is an explicit list rather than a chain of promises, because three
   things have to be true at once and a chain makes them hard to see: an
   announcement is said exactly once, in the order it was queued, and an
   announcement that arrives while the queue is being said joins the end of it
   rather than the middle of it.

   Nothing waits on a queued announcement. The action that caused it has
   already happened, and the game does not stand still for the middle.
   ========================================================================== */

import { el } from "./dom.js";
import { prefersStill } from "./dice.js";

const ENTER_MS = 220;
const HOLD_MS = 2100;
const EXIT_MS = 240;

const wait = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    // A timer is not a handle anybody else needs; it is returned so a skip can
    // clear it through the closure below.
    timer?.unref?.();
  });

/** A promise that settles on its own or when `skip` is called. */
function held(ms) {
  let timer = null;
  let done = null;
  const promise = new Promise((resolve) => {
    done = resolve;
    timer = setTimeout(resolve, ms);
  });
  return {
    promise,
    skip() {
      if (timer) clearTimeout(timer);
      timer = null;
      done?.();
    },
  };
}

/**
 * Mount the one middle layer and hand back its two ways of speaking.
 *
 * `show(spec)` takes `{ label, big, sub, color, tone, hold }` and resolves when
 * the announcement has left the screen. `status(spec)` takes the same shape and
 * holds it until it is replaced. A null spec resolves at once, which is how an
 * event with nothing to announce stays quiet.
 */
export function announcementLayer(centre) {
  const node = el("div", {
    class: "board__announce",
    hidden: true,
    role: "status",
    "aria-live": "polite",
  });
  centre.append(node);

  /* The things to say, in the order they happened. Each one remembers whether
     anybody is waiting for it to finish - a queued announcement has nobody
     waiting, because the game does not wait for the middle. */
  const queue = [];
  let pumping = false;
  /* The announcement on screen right now, and the handle that can stop it. */
  let current = null;
  /* What the middle says when nothing is being announced. */
  let resting = null;
  let restingKey = null;

  /** Is a profile holding the middle right now? */
  const profileOpen = () =>
    centre.closest(".board")?.dataset.profile === "true";

  node.addEventListener("pointerdown", (event) => {
    // The status is not a control; only an announcement can be skipped.
    if (node.dataset.mode !== "announce") return;
    event.preventDefault();
    // The handle is the one on screen: the skip belongs to the announcement
    // being read, not to the queue.
    current?.token?.skip?.();
  });

  /** Write one spec into the layer, in whichever mode it is. */
  function paint(spec, mode) {
    node.className =
      `board__announce board__announce--${mode} ` +
      `board__announce--${spec.tone || "plain"}`;
    node.dataset.mode = mode;
    node.dataset.label = spec.label || "";
    node.dataset.big = spec.big || "";
    node.style.setProperty("--motif", spec.color || "var(--ink)");
    if (spec.seat !== undefined && spec.seat !== null) {
      node.dataset.turn = String(spec.seat);
    } else {
      delete node.dataset.turn;
    }
    node.replaceChildren(
      el("span", { class: "announce__motif", "aria-hidden": "true" }),
      el("p", { class: "announce__label", text: spec.label || "" }),
      el("p", { class: "announce__big", text: spec.big || "" }),
      el("p", { class: "announce__sub", text: spec.sub || "" }),
    );
    node.hidden = false;
  }

  /** Take the middle down, leaving no text behind. */
  function clear() {
    node.hidden = true;
    node.replaceChildren();
    delete node.dataset.mode;
    delete node.dataset.label;
    delete node.dataset.big;
    delete node.dataset.turn;
  }

  /** Put the resting status back, if there is one and the middle is free. */
  function paintStatus() {
    if (current || pumping || profileOpen()) return;
    if (!resting) {
      restingKey = null;
      clear();
      return;
    }
    const key = [resting.label, resting.big, resting.sub, resting.seat, resting.tone].join("|");
    if (!node.hidden && node.dataset.mode === "status" && key === restingKey) return;
    restingKey = key;
    paint(resting, "status");
    node.dataset.state = "rest";
    if (prefersStill()) {
      node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: "both" });
      return;
    }
    node.animate(
      [
        { opacity: 0, transform: "translateY(4px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 160, easing: "cubic-bezier(.22,.7,.3,1)", fill: "both" },
    );
  }

  /** Put one announcement on the screen and take it off again. */
  async function playNow(spec, token) {
    paint(spec, "announce");
    node.dataset.state = "in";

    const quiet = prefersStill();
    const enter = quiet
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: "scale(.96)" },
          { opacity: 1, transform: "scale(1)" },
        ];
    node.animate(enter, { duration: ENTER_MS, easing: "cubic-bezier(.22,.7,.3,1)", fill: "both" });
    await wait(ENTER_MS);
    // A record opened over this one: it is taken off the screen and said
    // again afterwards, rather than being read over or lost.
    if (token.stopped) return;

    node.dataset.state = "hold";
    const pause = held(Math.max(1200, Number(spec.hold) || HOLD_MS));
    token.skip = pause.skip;
    await pause.promise;
    token.skip = null;
    if (token.stopped) return;

    node.dataset.state = "out";
    const exit = quiet
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(.985)" },
        ];
    node.animate(exit, { duration: EXIT_MS, easing: "ease-in", fill: "both" });
    await wait(EXIT_MS);
    clear();
  }

  /** Say everything queued, one after another, until there is nothing left. */
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        // A record is holding the middle. The queue waits for it, in order.
        if (profileOpen()) break;
        const item = queue.shift();
        const token = { stopped: false, skip: null };
        current = { item, token };
        await playNow(item.spec, token);
        if (current?.token === token) current = null;
        // An announcement that was taken off the screen to make room for a
        // record is said again by the queue, so it is not resolved here.
        if (!token.stopped) item.resolve?.();
      }
    } finally {
      pumping = false;
      // The last fact has been said: the middle goes back to saying whose turn
      // it is. This is the only hand-back, so the queue and the status cannot
      // both claim the middle.
      paintStatus();
    }
  }

  return {
    node,
    /**
     * Say this, now if the middle is free and after everything already said
     * if it is not.
     *
     * The promise resolves when the announcement has left the screen. A queued
     * announcement resolves at once: the game has already moved on, and it does
     * not wait for the middle.
     */
    show(spec) {
      if (!spec) return Promise.resolve();
      if (profileOpen()) {
        queue.push({ spec, resolve: null });
        return Promise.resolve();
      }
      const promise = new Promise((resolve) => {
        queue.push({ spec, resolve });
        pump();
      });
      return promise;
    },
    /**
     * Say this until it is replaced.
     *
     * A status arriving while an announcement is on screen is remembered, not
     * painted: the fact being read has the middle until it is finished, and
     * the status takes over afterwards.
     */
    status(spec) {
      resting = spec || null;
      if (!pumping && !current) paintStatus();
    },
    /**
     * Take the announcement on screen off, and say it again afterwards.
     *
     * A record opened while an announcement was being read: the record is the
     * middle of the board now, so the announcement steps aside and goes back
     * to the front of the queue. It is said again when the record closes, so
     * nothing is read over the record and nothing is lost.
     */
    defer() {
      if (current) {
        const { item, token } = current;
        token.stopped = true;
        token.skip?.();
        current = null;
        queue.unshift(item);
      }
      clear();
    },
    /** Say everything that was waiting for the middle to be free. */
    flush() {
      if (profileOpen()) return Promise.resolve();
      if (queue.length) return pump();
      paintStatus();
      return Promise.resolve();
    },
    /** Is a transient announcement covering the middle right now? */
    covering() {
      return !node.hidden && node.dataset.mode === "announce";
    },
    /** Take the layer away with the board, without leaving a timer behind. */
    hide() {
      if (current) {
        current.token.stopped = true;
        current.token.skip?.();
        current = null;
      }
      queue.length = 0;
      resting = null;
      restingKey = null;
      clear();
    },
  };
}
