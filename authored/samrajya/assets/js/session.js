/* ==========================================================================
   SAMRAJYA - THE SESSION BOUNDARY

   Everything the browser asks of the server goes through this file, and
   nothing else in the client talks to the network. That is deliberate: when
   the board game arrives it becomes a second method on this class and a second
   case on the server's room, and nothing in the screens has to learn about
   either.

     identity   this browser's secret, kept locally, granting nothing on its own
     create     open a room and take seat 1
     join       take seat 2 of an existing room, as yourself
     room       read the current room state
     start      the host begins the game
     forget     there is no room here any more

   A refusal comes back as a plain object with a message meant for a person.
   The screens show it; they never guess at it.
   ========================================================================== */

import {
  PLAYER_HEADER,
  isCreateKey,
  isIdentity,
  newCreateKey,
  newIdentity,
} from "./shared/identity.js";

const API = "/samrajya/api";
const STORAGE_KEY = "samrajya.identity";
const CREATE_KEY = "samrajya.create-key";

/**
 * How long a request may go unanswered.
 *
 * The server answers a move in milliseconds, so a request still outstanding
 * after this is not slow, it is lost. It matters because a move holds the
 * board's lock while it waits: without a limit, a connection that goes quiet
 * mid-request leaves the board locked forever - a game that never moves again
 * and never says why. Bounded, it becomes a sentence the player can act on.
 */
const PATIENCE = 15000;

/** A result is either `{ ok: true, data }` or `{ ok: false, error }`. */
const ok = (data) => ({ ok: true, data });
const fail = (error, code) => ({ ok: false, error, code });

export class Session {
  constructor() {
    this.identity = loadIdentity();
    this.roomId = null;
  }

  /**
   * Open a game, or get back the one this browser already opened.
   *
   * The create key makes that second case free. It is minted once per attempt,
   * kept until the server answers, and thrown away after: so a retry - a
   * double-tap, a response that never arrived - carries the same key, derives
   * the same address, and lands on the room that is already there rather than
   * opening a second one.
   */
  async create({ name, civ }) {
    const createKey = takeCreateKey();
    const body = await this.#post("/rooms", { createKey, name, civ });
    if (!body.ok) return body;
    this.roomId = body.data.roomId;
    dropCreateKey();
    return body;
  }

  async join({ code, name, civ }) {
    const body = await this.#post(`/rooms/${encodeURIComponent(code)}/join`, { name, civ });
    if (!body.ok) return body;
    this.roomId = body.data.roomId;
    return body;
  }

  /**
   * Forget the room this browser was last in.
   *
   * Called when someone leaves. Without it, a call with no code still means
   * "the room we were in", and the next thing that asks is handed a table
   * nobody is sitting at.
   */
  forget() {
    this.roomId = null;
  }

  async room(code = this.roomId) {
    if (!code) return fail("There is no game open.");
    const response = await this.#send(`/rooms/${encodeURIComponent(code)}`, "GET");
    if (!response.ok) return response;
    return ok(response.body);
  }

  /**
   * One move, decided by the server.
   *
   * The browser sends what it wants to do and the server answers with the new
   * state, its number and the events that caused it - or a refusal with a
   * sentence. The client never applies a rule itself.
   */
  async action(code, action) {
    return this.#post(`/rooms/${encodeURIComponent(code)}/action`, action);
  }

  /** Start the game. Only the host may, and only when both seats are taken. */
  async start(code) {
    return this.#post(`/rooms/${encodeURIComponent(code)}/action`, { type: "start" });
  }

  /**
   * Watch a room, and be told when it changes.
   *
   * Returns a function that stops watching. `onChange` is called with the room
   * on arrival and on every change after; `onStatus` is called with "open",
   * "closed" or "retrying" so a screen can say so if it wants to.
   *
   * Reconnects on its own, backing off to fifteen seconds. A dropped socket is
   * a fact of networks, not a reason for a player to be left staring at a lobby
   * that is quietly out of date.
   */
  subscribe(code, { onChange, onSnapshot, onStatus } = {}) {
    if (!code) return () => {};
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${scheme}//${location.host}${API}/rooms/${encodeURIComponent(code)}/live`;

    let socket = null;
    let attempt = 0;
    let timer = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      try {
        socket = new WebSocket(url);
      } catch {
        schedule();
        return;
      }

      socket.addEventListener("open", () => {
        attempt = 0;
        onStatus?.("open");
      });

      socket.addEventListener("message", (event) => {
        let message = null;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        // Two kinds of message. `state` is the room (seats, status) and arrives
        // when somebody joins. `snapshot` is the game and arrives after every
        // accepted action; it carries the events the board animates from.
        if (message?.type === "state" && message.room) onChange?.(message.room);
        else if (message?.type === "snapshot" && message.state) onSnapshot?.(message);
      });

      socket.addEventListener("close", () => {
        // An unsubscribe closes this socket on purpose. Reporting that as the
        // line dropping would paint "reconnecting" over a screen that is
        // deliberately leaving the room.
        if (stopped) return;
        onStatus?.("closed");
        schedule();
      });

      socket.addEventListener("error", () => {
        try {
          socket.close();
        } catch {
          /* already closing */
        }
      });
    };

    const schedule = () => {
      if (stopped) return;
      onStatus?.("retrying");
      attempt += 1;
      const wait = Math.min(1000 * 2 ** (attempt - 1), 15000);
      clearTimeout(timer);
      timer = setTimeout(connect, wait);
    };

    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        /* nothing to close */
      }
    };
  }

  /* ------------------------------------------------------------------ plumbing */

  async #post(path, body) {
    const response = await this.#send(path, "POST", body);
    if (!response.ok) return response;
    return ok(response.body);
  }

  async #send(path, method = "GET", body) {
    // One clock for the whole exchange. The wait for the answer and the reading
    // of it are the same silence, and the second one is the one that hangs.
    const abort = new AbortController();
    const patience = setTimeout(() => abort.abort(), PATIENCE);
    const tooLong = () =>
      fail("The server is taking too long. Check your network and try again.");
    try {
      let response;
      try {
        response = await fetch(`${API}${path}`, {
          method,
          headers: {
            [PLAYER_HEADER]: this.identity,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
          signal: abort.signal,
        });
      } catch {
        return abort.signal.aborted
          ? tooLong()
          : fail("No connection to the server. Check your network and try again.");
      }

      let parsed = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      // A body cut short by the clock is no body at all, whatever the status
      // line said before it.
      if (abort.signal.aborted) return tooLong();

      if (!response.ok) {
        return fail(
          parsed?.error || "Something went wrong at our end. Please try again.",
          parsed?.code,
        );
      }
      return { ok: true, body: parsed };
    } finally {
      clearTimeout(patience);
    }
  }
}

/**
 * This browser's identity, minted once and kept.
 *
 * It is not an account. There is no password and nothing to sign in to: it
 * only ever proves "I am the browser that was given that seat", so a refresh
 * lands the player back in their own game.
 */
function loadIdentity() {
  let value = null;
  try {
    value = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* private mode: this tab keeps an identity for itself and no longer */
  }
  if (isIdentity(value)) return value;

  const fresh = newIdentity();
  try {
    localStorage.setItem(STORAGE_KEY, fresh);
  } catch {
    /* nothing to do; the session still works for the life of the page */
  }
  return fresh;
}

/**
 * The key for this attempt to create a game.
 *
 * Kept in sessionStorage rather than held in a variable, so a refresh in the
 * middle of a create retries the same attempt instead of opening a second
 * game. That is the whole mechanism: same key, same address, same room.
 */
function takeCreateKey() {
  let value = null;
  try {
    value = sessionStorage.getItem(CREATE_KEY);
  } catch {
    /* private mode: the key lives for this page only, which still works */
  }
  if (isCreateKey(value)) return value;

  const fresh = newCreateKey();
  try {
    sessionStorage.setItem(CREATE_KEY, fresh);
  } catch {
    /* as above */
  }
  return fresh;
}

/** The game exists, so the next attempt should be a different game. */
function dropCreateKey() {
  try {
    sessionStorage.removeItem(CREATE_KEY);
  } catch {
    /* nothing to do */
  }
}
