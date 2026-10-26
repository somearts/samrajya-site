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
 * Every game has one id, and every key this browser keeps says which game it
 * belongs to.
 *
 * The old keys were flat: `samrajya.room`, `samrajya.create-key`. A browser
 * that had been in one game and then went into another could read the first
 * game's leftovers as if they were the second game's - a purse, a position, a
 * set of weapons, a queue of announcements. So the game id is in the key:
 * `samrajya.game.<id>.<what>`.
 *
 * Even the note of WHICH game this tab is in carries the id, so a key is
 * never just "the room": it is "the room of game 7889". Finding it means
 * looking for the one that says so, which is a handful of keys at most.
 */
const gameKey = (gameId, what) => `samrajya.game.${gameId}.${what}`;

/** The one key that says which game this tab is in. */
const CURRENT_KEY = "samrajya.game.current";

/** Every stored key that belongs to one game. */
function gameKeys(gameId) {
  const prefix = `samrajya.game.${gameId}.`;
  const found = [];
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(prefix)) found.push(key);
    }
  } catch {
    /* private mode: there is nothing stored to find */
  }
  return found;
}

/** Remove a stored key, quietly. */
function dropKey(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

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

  /* ------------------------------------------------------------- the storage

     Everything this browser keeps about a game is kept under a key that says
     which game it is. A key for another game is never read, and a game that
     is left has its keys deleted rather than kept. */

  /** Remember something about the game this tab is in. */
  remember(what, value) {
    if (!this.roomId) return;
    try {
      sessionStorage.setItem(gameKey(this.roomId, what), value);
    } catch {
      /* private mode: the tab keeps it for itself and no longer */
    }
  }

  /** Read something about the game this tab is in. Null if it is not here. */
  recall(what) {
    if (!this.roomId) return null;
    try {
      return sessionStorage.getItem(gameKey(this.roomId, what));
    } catch {
      return null;
    }
  }

  /** The game this tab is in, and nothing else. */
  currentRoom() {
    try {
      return sessionStorage.getItem(CURRENT_KEY);
    } catch {
      return null;
    }
  }

  /** Remember which game this tab is in. */
  setRoom(code) {
    try {
      if (code) sessionStorage.setItem(CURRENT_KEY, code);
      else sessionStorage.removeItem(CURRENT_KEY);
    } catch {
      /* nothing to do */
    }
  }

  /**
   * Leave a game, and take every trace of it with us.
   *
   * The socket is closed, every key that belonged to that game is deleted,
   * and the in-memory stores are emptied. What is left is a browser that has
   * never been in a game, which is what a new game must start from.
   */
  async leave(code = this.roomId) {
    const gameId = code || this.roomId;
    if (!gameId) return;
    this.clearGameKeys(gameId);
    this.roomId = null;
    this.setRoom(null);
    /* The create key belongs to an attempt, not to a game, and a new game must
       not open on the attempt that made the old one. */
    dropCreateKey();
  }

  /**
   * Delete every stored key that belonged to one game, and nothing else.
   *
   * The keys of other games are left alone: a browser may have more than one
   * tab open on more than one game, and one tab leaving must not take the
   * other tab's game with it.
   */
  clearGameKeys(gameId) {
    if (!gameId) return;
    for (const key of gameKeys(gameId)) dropKey(key);
  }

  /**
   * Check that a stored game is still a game this browser may walk into.
   *
   * A remembered room is a note, not a fact: the room may be gone, the game
   * may have ended, or the seat may no longer be this browser's. Any of those
   * means the note is stale, and a stale note must never put a player back
   * into a game they are not in.
   */
  async validate(code) {
    if (!code) return { ok: false, code: "NO_ROOM" };
    const result = await this.room(code);
    if (!result.ok) return { ok: false, code: result.code || "NO_ROOM" };

    const room = result.data;
    /* The seat has to be this browser's. A room with a free seat is a room
       this browser has not joined. */
    if (room.seat === null || room.seat === undefined) {
      return { ok: false, code: "NOT_SEATED" };
    }
    /* A game that has ended is not a game to walk into. */
    if (room.status && room.status !== "LOBBY" && room.status !== "PLAYING") {
      return { ok: false, code: "ENDED" };
    }
    return { ok: true, data: room };
  }

  /* ---------------------------------------------------------- the version

     A NEW DEPLOY, SEEN FROM THE PAGE.

     The page is served with the number of the build it belongs to. When a new
     build goes out, the server's number changes and the browser's does not -
     which means this browser is holding a version of the game that is not the
     one on the server.

     The client then reloads itself, on the landing page or in the lobby. It
     NEVER reloads in the middle of a game: a game in progress is the one
     thing a reload would spoil, and a player who is watching a chest being
     drawn must not have it taken away from them by a deploy.

     The check is made when the page is on the landing page or in the lobby,
     and on every room change, which is often enough and never in the middle
     of a turn. */
  async version() {
    try {
      const response = await fetch(`${API}/version`, { cache: "no-store" });
      if (!response.ok) return null;
      const body = await response.json();
      return body?.version || null;
    } catch {
      return null;
    }
  }

  /**
   * Is the browser holding the version the server is serving?
   *
   * The served page says which build it is. The server says which build it
   * has. They are the same when nothing has been deployed since.
   */
  async checkVersion() {
    const mine = document.querySelector('meta[name="samrajya-version"]')?.content || "";
    const theirs = await this.version();
    if (!mine || !theirs) return { ok: true, same: true };
    return { ok: true, same: mine === theirs, mine, theirs };
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
    this.setRoom(this.roomId);
    /* The game's own note, under the game's own id. */
    this.remember("name", String(name || ""));
    this.remember("civ", String(civ || ""));
    dropCreateKey();
    return body;
  }

  async join({ code, name, civ }) {
    const body = await this.#post(`/rooms/${encodeURIComponent(code)}/join`, { name, civ });
    if (!body.ok) return body;
    this.roomId = body.data.roomId;
    this.setRoom(this.roomId);
    this.remember("name", String(name || ""));
    this.remember("civ", String(civ || ""));
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
    this.setRoom(null);
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
        /* A MESSAGE ABOUT ANOTHER GAME IS NOT OURS.

           Every message says which game it is about. A browser that is
           watching more than one game, or that has just left one, throws away
           anything that is not the game it is watching - so a snapshot from a
           game this tab has left can never be painted into the middle of
           another one. */
        if (message?.gameId && code && message.gameId !== code) return;

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
