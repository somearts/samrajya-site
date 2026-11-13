/* ==========================================================================
   SAMRAJYA - THE MIDDLE OF THE BOARD

   One surface, one voice. Everything the board has to say is said here: whose
   turn it is while the board is waiting, and one sentence at a time when
   something has happened. There is no second bar, no toast and no
   banner; a player never has to decide which of two messages to read.

   A SINGLE PILL, TWO MODES

   The single notification pill in the middle of the board has two modes:

   1. TURN MODE - shows whose turn it is.
      "Your Turn" in green when it is this player's turn.
      "Opponent's Turn" in red when it is the other player's turn.
      This is the default: the pill always returns to turn mode after any
      event message finishes.

   2. EVENT MODE - shows a one-sentence game event.
      Rent received, rent paid, property acquired, etc.
      The pill takes on a neutral background for ordinary events.
      Reserve red for the opponent's turn and green for the current
      player's turn. Event messages must not leave the pill permanently
      red or green simply because the previous message was a turn
      notification.

   Only one message may be displayed at any moment. If a game event occurs,
   its message is shown in the pill rather than creating a new notification.
   When an event message finishes, the pill returns to the correct turn
   status. Duplicate notifications caused by repeated rendering, network
   updates, or multiplayer state synchronization are prevented.

   TWO MODES, ONE LAYER

   The pill's `mode` property is either "turn" or "event". In turn mode it
   displays whose turn it is. In event mode it displays a single game sentence.

   A tap skips the current message. A reader who has asked for less motion
   gets the same words in a plain fade, and nothing travels.

   ONE OWNER OF THE MIDDLE
   -----------------------
   The middle is one place, and only one thing can own it at a time: the pill
   (in turn or event mode), a card, or a player's record. While the pill is
   in event mode, a card or record can own the middle above it; when the
   card goes, the pill returns to turn mode.

   THE QUEUE
   ---------
   Two things want the middle at once: the pill and a player's record.
   The record wins for as long as it is open; the pill waits - queued, never
   dropped - and is said in the order things happened the moment it closes.

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
 * The pill has two modes: "turn" and "event".
 *
 * In "turn" mode the pill shows whose turn it is:
 *   - the active player: green "Your Turn"
 *   - the waiting player: red "Opponent's Turn"
 *
 * In "event" mode the pill shows one game sentence:
 *   - Rent received: ₹100
 *   - Rent paid: ₹100
 *   - Property acquired: Pluto
 * etc. The pill returns to turn mode when the event finishes.
 *
 * `show(spec)` displays an event message if mode is "event", or sets the turn
 * status if mode is "turn". It resolves when the message has left the screen.
 *
 * `status(spec)` sets the turn status and holds it until replaced.
 * The spec should have the shape returned by statusFor(): { label, big, sub, seat, tone }.
 *
 * `onChange` is called whenever the middle changes hands - the pill mode changes,
 * a card goes, a record closes, etc. The board keeps the die's visibility in
 * step with the middle, and the middle changes without the board being told
 * unless it is.
 */
export function announcementLayer(centre, { onChange = null } = {}) {
  const node = el("div", {
    class: "board__announce",
    hidden: true,
    role: "status",
    "aria-live": "polite",
  });
  centre.append(node);

  /* The pill's current mode: "turn" or "event". */
  let mode = "turn";
  /* The things to say, in the order they happened. Each one remembers whether
     anybody is waiting for it to finish - a queued announcement has nobody
     waiting, because the game does not wait for the middle. */
  const queue = [];
  let pumping = false;
  /* The announcement on screen right now, and the handle that can stop it. */
  let current = null;
  /* WHICH TURN THE QUEUE BELONGS TO.

     Every sentence is raised inside a turn, and a sentence from a turn that
     has ended is no longer true news. A notice that was queued while a card
     held the middle - and then sat there through the turn change - must not
     be said again over the next turn's business, which is what let a previous
     turn's "ACQUIRED" reappear when an unrelated card (a repayment, say)
     finally freed the middle. `setTurn` is the board telling the layer whose
     turn it is now; anything queued for another turn is dropped. */
  let turnNo = null;
  /* What the middle says when nothing is being announced (turn mode). */
  let restingTurn = null;
  let restingTurnKey = null;
  /* What has the middle instead of the pill: a card, a record, or both. */
  const blockers = new Set();

  /* The shape of the layer as it was last seen. */
  let lastShape = "true|";
  const changed = () => {
    const shape = `${node.hidden}|${node.dataset.mode || ""}`;
    if (shape === lastShape) return;
    lastShape = shape;
    if (typeof onChange === "function") onChange();
  };

  /** Is the middle somebody else's right now? */
  const taken = () => blockers.size > 0;

  /** End whatever event is on screen and hand the middle back.
   *
   * One exit for every way an event ends - finished, skipped, or stopped by a
   * card taking the middle. The animations it leaves behind are held by
   * `fill: both` at their final frame, so a pill repainted underneath one is
   * a pill nobody can see: they are cancelled here, and the turn status is
   * painted fresh. Called after an event finishes, and by the wake-up repair
   * below. It is the ONE place that turns an event back into a turn, so the
   * pill can never be left speaking yesterday's words.
   */
  function handBack() {
    node.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    mode = "turn";
    paintTurn();
  }

  /**
   * WHICH TURN A SENTENCE BELONGS TO.
   *
   * A spec may name its turn, and the board does; anything else is taken to
   * belong to the turn the layer was last told about. A null means "no turn
   * known" - the sentence is never stale, because there is no turn for it to
   * be stale against.
   */
  const turnFor = (spec) =>
    spec.turn === undefined || spec.turn === null ? turnNo : Number(spec.turn);

  /**
   * Tell the layer whose turn the board is on.
   *
   * A change of turn is the end of every queued sentence that belonged to the
   * old one: dropping the queue is what stops a notice from a finished turn
   * being said again when some later card frees the middle. A sentence that
   * is playing at the instant the turn changes is allowed to finish its exit
   * animation naturally - it will call handBack() which restores the correct
   * turn status. Only the queue is cleared immediately.
   *
   * Repeating the same turn is a no-op, so the board may call this on every
   * repaint.
   */
  function setTurn(n) {
    const next = n === null || n === undefined ? null : Number(n);
    if (next === turnNo) return;
    turnNo = next;
    if (queue.length) {
      /* Every waiter is let go: the game does not stand still for a notice
         that will never be said. */
      for (const item of queue) item.resolve?.();
      queue.length = 0;
    }
    /* DO NOT stop the current event here. Let it finish its exit animation
       and call handBack(), which will paint the new turn status. Stopping it
       mid-animation leaves the pill in event mode with stale content and no
       turn indicator. The pump() loop will drop any newly-queued items from
       the old turn. */
  }

  /** The repair for a page that was frozen in the background.
   *
   * A browser parks a tab it cannot see: every timer stops, and an
   * announcement caught between its stages stays there for ever, with last
   * morning's copy on the screen and nothing that can replace it. When the
   * page is looked at again the machine may still be dead: a promise waiting
   * on a timer that fired while nothing was running to receive it.
   *
   * So the layer watches for the page coming back, and if it finds the pill
   * mid-event with nothing playing - the frozen shape - it hands the middle
   * straight back. The turn status is a fact about the game, not a memory of
   * what the pill was saying, so restoring it needs no bookkeeping about what
   * came before.
   */
  const wake = () => {
    /* Animations from the frozen run are parked mid-frame and hide anything
       painted under them, event or turn: clear them whatever the mode. */
    const stuck = mode === "event" && !pumping;
    node.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    if (!stuck) return;
    if (current) {
      current.token.stopped = true;
      current.token.skip?.();
      current = null;
    }
    handBack();
    if (queue.length) pump();
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wake();
  });
  window.addEventListener("focus", wake);
  window.addEventListener("pageshow", wake);

  node.addEventListener("pointerdown", (event) => {
    // Skip the current message (turn or event).
    if (mode === "turn") {
      // Tap on turn pill: no-op, turn stays.
      return;
    }
    if (mode === "event") {
      event.preventDefault();
      current?.token?.skip?.();
    }
  });

  /** Write one spec into the layer, in either mode. */
  function paint(spec, modeName) {
    mode = modeName;
    node.className =
      `board__announce board__announce--${modeName} ` +
      `board__announce--${spec.tone || "plain"}`;
    node.dataset.mode = modeName;
    node.dataset.label = spec.label || "";
    node.dataset.big = spec.big || "";
    /* The line under the figure is a third piece of copy, and it is written
       on the layer beside the other two so that it can be read from outside
       the page - by a check, and by anything that wants to know what the
       middle is saying without reading the DOM's text. */
    node.dataset.sub = spec.sub || "";
    node.style.setProperty("--motif", spec.color || "var(--ink)");
    if (spec.seat !== undefined && spec.seat !== null) {
      node.dataset.turn = String(spec.seat);
    } else {
      delete node.dataset.turn;
    }
    node.replaceChildren(
      el("span", { class: "announce__motif", "aria-hidden": "true" }),
      /* In turn mode the pill says ONE thing - "Your Turn" or "Opponent's
         Turn". The event label ("RENT RECEIVED" ...) is suppressed here, so
         the resting pill never reads the same words twice. */
      ...(modeName === "event" && spec.label
        ? [el("p", { class: "announce__label", text: spec.label })]
        : []),
      el("p", { class: "announce__big", text: spec.big || "" }),
      el("p", { class: "announce__sub", text: spec.sub || "" }),
    );
    node.hidden = false;
    changed();
  }

  /** Clear the layer, resetting to turn mode. */
  function clear() {
    node.hidden = true;
    node.replaceChildren();
    delete node.dataset.mode;
    delete node.dataset.label;
    delete node.dataset.big;
    delete node.dataset.sub;
    delete node.dataset.turn;
    mode = "turn";
    changed();
  }

  /** Show the turn status in the pill.
   *  Called by status() and restored after every event.
   *  The spec should have the shape from statusFor(): { label, big, sub, seat, tone }.
   *  Or from show(mode: "turn"): same shape.
   */
  function paintTurn() {
    if (mode === "event") {
      // An event is on screen; the turn will be restored when it ends.
      // But remember the turn state so we can restore it exactly.
      return;
    }
    if (taken()) {
      // The middle is blocked; the pill yields until it frees. The turn spec
      // itself is KEPT - nulling it here is what left the middle empty for
      // good after a card had closed.
      clear();
      return;
    }
    // If we have a stored turn spec, use it.
    if (restingTurn) {
      paint(restingTurn, "turn");
      /* The event's exit is still on this layer, held by `fill: both` at its
         final opacity of zero: a pill repainted under that cloak is a pill
         nobody can see. The old animations are cancelled and the turn text
         comes back with a small fade of its own. */
      node.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      node.dataset.state = "rest";
      if (!prefersStill()) {
        node.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 200,
          easing: "ease-out",
          fill: "both",
        });
      }
    } else {
      // No turn spec: clear the pill. The board will set it again when needed.
      clear();
    }
  }

  /** Put one announcement on the screen and take it off again. */
  async function playNow(spec, token) {
    paint(spec, "event");
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
    if (token.stopped) {
      /* A card took the middle while the entrance was still playing. The
         stopper has its own plans for the screen; leaving the stalled
         entrance animation behind under it would dim whatever it paints. */
      node.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      return;
    }

    node.dataset.state = "hold";
    const pause = held(Math.max(1200, Number(spec.hold) || HOLD_MS));
    token.skip = pause.skip;
    await pause.promise;
    token.skip = null;
    if (token.stopped) {
      node.getAnimations({ subtree: true }).forEach((a) => a.cancel());
      return;
    }

    node.dataset.state = "out";
    const exit = quiet
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(.985)" },
        ];
    node.animate(exit, { duration: EXIT_MS, easing: "ease-in", fill: "both" });
    await wait(EXIT_MS);

    /* THE EVENT IS OVER, AND THE MIDDLE GOES BACK - whatever happened before
       it, and whoever is waiting after it. The turn status is the resting
       fact about the game; re-reading it here is what keeps the pill from
       ever having to remember what it was saying. */
    handBack();

    /* Process any queued events now that the pill is free.
       Nothing is cleared here: the hand-back above - or pump's own hand-back
       when the queue empties - is the last word. An unconditional clear at
       this point is what wiped a freshly restored turn status. */
    if (queue.length) pump();
  }

  /** Say everything queued, one after another, until there is nothing left. */
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length) {
        // Something else has the middle. The queue waits for it, in order.
        if (taken()) break;
        const item = queue.shift();
        /* A SENTENCE FROM A TURN THAT HAS ENDED IS NOT SAID. The turn may have
           changed while the queue waited for the middle; the notice is no
           longer news, and saying it would put yesterday's business over
           today's. It is discarded, and its waiter let go. */
        if (item.turn !== null && item.turn !== turnNo) {
          item.resolve?.();
          continue;
        }
        const token = { stopped: false, skip: null };
        current = { item, token };
        await playNow(item.spec, token);
        if (current?.token === token) current = null;
        if (!token.stopped) item.resolve?.();
      }
    } finally {
      pumping = false;
      // The last fact has been said: the middle goes back to saying whose turn
      // it is. This is the only hand-back, so the queue and the status cannot
      // both claim the middle.
      paintTurn();
    }
  }

  return {
    node,
    /**
     * Tell the layer whose turn the board is on.
     *
     * See `setTurn` above: a change of turn drops every queued sentence that
     * belonged to the old one. Repeating the same turn is a no-op.
     */
    setTurn,
    /**
     * Display an event message or set the turn status.
     *
     * If spec.mode is "event" (or unspecified), shows a game sentence and
     * returns to turn mode when done.
     * If spec.mode is "turn", sets the turn status and holds it until replaced.
     *
     * The promise resolves when the message has left the screen.
     */
    show(spec) {
      if (!spec) return Promise.resolve();
      // Determine mode from the spec.
      const mode = spec.mode || "event";
      if (mode === "turn") {
        // Set turn status and hold it.
        const promise = new Promise((resolve) => {
          restingTurn = spec;
          restingTurnKey = [String(spec.seat), String(spec.big)].join("|");
          paintTurn();
          resolve();
        });
        return promise;
      }
      // Event mode: show the event message.
      if (taken()) {
        queue.push({ spec, resolve: null, turn: turnFor(spec) });
        return Promise.resolve();
      }
      const promise = new Promise((resolve) => {
        queue.push({ spec, resolve, turn: turnFor(spec) });
        pump();
      });
      return promise;
    },
    /**
     * Say this until it is replaced.
     *
     * A turn status arriving while an event is on screen is remembered, not
     * painted: the turn takes over when the event finishes.
     * A turn status arriving while no event is on screen is painted immediately.
     * The spec should have the shape from statusFor(): { label, big, sub, seat, tone }.
     */
    status(spec) {
      if (!spec) {
        /* NO TURN IS TRUE RIGHT NOW - the game is between turns, or the
           middle belongs to something else. Forget the last one: a stored
           "Your Turn" is a spec the next event's hand-back would repaint,
           which is how the payer briefly regained a stale turn after rent.
           The pill goes back up the moment the board says whose turn it is. */
        restingTurn = null;
        restingTurnKey = null;
        if (!pumping && !current && mode !== "event") {
          paintTurn();
        }
        return;
      }
      const key = [String(spec.seat), String(spec.big)].join("|");
      const unchanged = key === restingTurnKey;
      restingTurn = spec;
      restingTurnKey = key;
      /* A repeat of the spec already on the pill is not a repaint. Every
         repaint re-runs the pill's fade-in, and several paintPhases in quick
         succession - as after a rent - strobed the pill for a second. */
      if (!pumping && !current && mode !== "event" && !unchanged) {
        paintTurn();
      }
    },
    /**
     * Something else has taken the middle: a card, or a player's record.
     *
     * The pill on screen is taken off it and goes back to the front of the
     * queue, so it is said again when the middle is free - never read over
     * a card, and never lost. The resting turn status is not painted at all
     * while the middle is somebody else's.
     */
    block(reason = "card") {
      const first = blockers.size === 0;
      blockers.add(reason);
      if (!first) return;
      if (current) {
        const { item, token } = current;
        token.stopped = true;
        token.skip?.();
        current = null;
        /* The caller is let go. The sentence goes back to the front of the
           queue and is said again when the middle is free, but the action
           that caused it is not held up waiting for a second reading of it. */
        item.resolve?.();
        queue.unshift(item);
      }
      // If we were in event mode, switching to a card means the event stops.
      if (mode === "event") {
        // The event is interrupted; it will be said again when the middle frees.
        // For now, just clear and let the queue handle it.
        clear();
      }
    },
    /**
     * The card is gone, or the record is closed: the middle is free again.
     */
    unblock(reason = "card") {
      blockers.delete(reason);
      if (taken()) return;
      if (queue.length) {
        pump();
        return;
      }
      paintTurn();
    },
    /** Is a transient announcement covering the middle right now? */
    covering() {
      return !node.hidden && mode === "event";
    },
    /** Take the layer away with the board, without leaving a timer behind. */
    hide() {
      if (current) {
        current.token.stopped = true;
        current.token.skip?.();
        current = null;
      }
      /* Everything that was waiting is let go. A promise that is never
         settled is a caller that waits for ever, and a caller waiting for
         ever is a board that never finishes an action. */
      for (const item of queue) item.resolve?.();
      queue.length = 0;
      restingTurn = null;
      restingTurnKey = null;
      turnNo = null;
      mode = "turn";
      blockers.clear();
      clear();
    },
  };
}