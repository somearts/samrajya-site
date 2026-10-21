/* ==========================================================================
   SAMRAJYA - THE BIG ANNOUNCEMENT

   One thing at a time, across the whole middle of the board: a small label, the
   amount or the name, and a line beneath it. It is driven by an event that has
   already happened - the state moved before this started - and it never holds
   the game up for longer than its own 1.8 seconds.

   A tap skips it. A reader who has asked for less motion gets the same words in
   a plain fade, and nothing travels.

   The queue is here rather than in board.js so that two events arriving close
   together can never paint over each other: the second waits for the first to
   leave, which is the only thing "one at a time" can mean.
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

  let chain = Promise.resolve();
  let skipping = null;

  node.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    skipping?.();
  });

  async function play(spec) {
    if (!spec) return;
    const board = centre.closest(".board");
    // While a profile is open the middle belongs to the profile. The game is
    // still moving; the announcement is simply not shown on top of it.
    if (board?.dataset.profile === "true") return;

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

    node.dataset.state = "hold";
    const pause = held(HOLD_MS);
    skipping = pause.skip;
    await pause.promise;
    skipping = null;

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

  return {
    node,
    show(spec) {
      if (!spec) return Promise.resolve();
      chain = chain.then(() => play(spec), () => play(spec));
      return chain;
    },
    /** Take the layer away with the board, without leaving a timer behind. */
    hide() {
      skipping?.();
      node.hidden = true;
      node.replaceChildren();
    },
  };
}
