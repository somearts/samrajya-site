/* ==========================================================================
   SAMRAJYA - THE BIG ANNOUNCEMENT

   One thing at a time, across the whole middle of the board: a small label, the
   amount or the name, and a line beneath it. It is driven by an event that has
   already happened - the state moved before this started - and it never holds
   the game up for longer than its own 1.8 seconds.

   A tap skips it. A reader who has asked for less motion gets the same words in
   a plain fade, and nothing travels.

   THE QUEUE

   Two things want the middle of the board: this announcement and a player's
   record. They cannot both have it, so the announcement waits - it is queued,
   never dropped - and it is said the moment the record closes, in the order
   things happened.

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

const ENTER_MS = 250;
const HOLD_MS = 1300;
const EXIT_MS = 250;

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
 * Mount the announcement layer in the middle and hand back `show`.
 *
 * `show(spec)` takes `{ label, big, sub, color, tone }` and resolves when the
 * announcement has left the screen. A null spec resolves at once, which is how
 * an event with nothing to announce stays quiet.
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

  /** Is a profile holding the middle right now? */
  const profileOpen = () =>
    centre.closest(".board")?.dataset.profile === "true";

  node.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    // The handle is the one on screen: the skip belongs to the announcement
    // being read, not to the queue.
    current?.token?.skip?.();
  });

  /** Put one announcement on the screen and take it off again. */
  async function playNow(spec, token) {
    node.className = `board__announce board__announce--${spec.tone || "plain"}`;
    node.style.setProperty("--motif", spec.color || "var(--ink)");
    node.replaceChildren(
      el("span", { class: "announce__motif", "aria-hidden": "true" }),
      el("p", { class: "announce__label", text: spec.label || "" }),
      el("p", { class: "announce__big", text: spec.big || "" }),
      el("p", { class: "announce__sub", text: spec.sub || "" }),
    );
    node.hidden = false;
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
    const pause = held(HOLD_MS);
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
    node.hidden = true;
    node.replaceChildren();
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
     * Take the announcement on screen off, and say it again afterwards.
     *
     * A record opened while an announcement was being read: the record is the
     * middle of the board now, so the announcement steps aside and goes back
     * to the front of the queue. It is said again when the record closes, so
     * nothing is read over the record and nothing is lost.
     */
    defer() {
      if (!current) return;
      const { item, token } = current;
      token.stopped = true;
      token.skip?.();
      node.hidden = true;
      node.replaceChildren();
      current = null;
      queue.unshift(item);
    },
    /** Say everything that was waiting for the middle to be free. */
    flush() {
      if (profileOpen()) return Promise.resolve();
      return pump();
    },
    /** Take the layer away with the board, without leaving a timer behind. */
    hide() {
      if (current) {
        current.token.stopped = true;
        current.token.skip?.();
        current = null;
      }
      queue.length = 0;
      node.hidden = true;
      node.replaceChildren();
    },
  };
}
