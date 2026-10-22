/* ==========================================================================
   SAMRAJYA - THE APPLICATION

   One page, four screens, one object. The whole of Samrajya so far is this
   file plus views.js, and that is the point: when the board game arrives it
   is a fifth screen and a few more fields on `state`, not a rewrite.

   There is no router and no page load between screens. The welcome screen is
   swapped for a panel in the same document, the browser's back button is left
   alone, and anything a player has typed survives every move in both
   directions - going back to change a civilization must not cost them a name.

   A refresh is not a navigation. If this browser is sitting in a room, it is
   put back in that room; otherwise it is put back on the welcome screen.
   ========================================================================== */

import { $, el } from "./dom.js";
import { Session } from "./session.js";
import { welcomeView, createView, joinView, lobbyView, boardView } from "./views.js";
import { cleanName, parseRoomCode } from "./shared/identity.js";
import { isCiv } from "./shared/civilizations.js";
import { restoreGame } from "./shared/game.js";

const REMEMBERED_ROOM = "samrajya.room";

const state = {
  screen: "welcome",
  step: 0,
  busy: false,
  error: null,
  errors: {},
  room: null,
  // The game's state, owned by the server and kept here as a restored snapshot.
  // Null until the game starts. The session is here so the board screen can send
  // actions without a second path to the network.
  game: null,
  session: null,
  // The board registers this so a live snapshot can be handed straight to it.
  applySnapshot: null,
  // "connecting", "open", "retrying" or "closed" - the live channel's own
  // weather. The lobby says so when it has lost the line, rather than letting
  // a silent screen look like a quiet room.
  socket: "connecting",
  draft: {
    name: "",
    civ: "",
    rawCode: "",
    code: "",
  },
  inviteLink: "",
};

const session = new Session();
state.session = session;
let copyTimer = null;

/* ------------------------------------------------------------------- render */

const stage = $("#stage");
const body = $("#stage-body");
const foot = $("#stage-foot");

function render() {
  const actions = buildActions();
  const view =
    state.screen === "welcome"
      ? welcomeView(state, actions)
      : state.screen === "create"
        ? createView(state, actions)
        : state.screen === "join"
          ? joinView(state, actions)
          : state.screen === "board"
            ? boardView(state, actions)
            : lobbyView(state, actions);

  // The board screen is the only one that is not the composition, so it is the
  // only one that gets a class on the shell. Everything else shares the
  // welcome screen's padding and its share of the viewport.
  stage.classList.toggle("stage--board", state.screen === "board");

  // The nodes are moved, never serialised: a view's foot button carries a
  // click handler, and round-tripping it through innerHTML would silently drop
  // it - which is exactly how a Back button ends up dead.
  body.replaceChildren(view.body);
  foot.replaceChildren();
  if (view.foot) foot.append(view.foot);

  document.title = titleFor();
  view.onMount?.();
}

function titleFor() {
  switch (state.screen) {
    case "create":
      return "Create Game — Samrajya Kalchakra";
    case "join":
      return "Join Game — Samrajya Kalchakra";
    case "lobby":
      return "Waiting — Samrajya Kalchakra";
    case "board":
      return "The Board — Samrajya Kalchakra";
    default:
      return "Samrajya Kalchakra — Empires rise. Time turns.";
  }
}

/* ------------------------------------------------------------------ actions */

function buildActions() {
  return {
    startCreate: () => {
      state.screen = "create";
      state.step = 0;
      state.error = null;
      state.errors = {};
      state.draft.name = "";
      state.draft.civ = "";
      render();
    },

    startJoin: () => {
      state.screen = "join";
      state.step = 0;
      state.error = null;
      state.errors = {};
      state.draft.name = "";
      state.draft.civ = "";
      state.draft.rawCode = "";
      render();
    },

    cancel: () => toWelcome(),

    /* --- typing, remembered across every move --- */

    setName: (value) => {
      state.draft.name = value;
      state.errors.name = null;
    },
    setCiv: (id) => {
      state.draft.civ = id;
      state.errors.civ = null;
    },
    setCode: (value) => {
      state.draft.rawCode = value;
      state.errors.code = null;
      state.error = null;
    },

    /* --- create: one form, one player -------------------------------------- */

    createConfirm: async () => {
      if (state.busy) return;
      const name = cleanName(state.draft.name);
      if (!name.ok) return fail("name", name.reason);
      if (!isCiv(state.draft.civ)) return fail("civ", "Choose a civilization.");

      state.draft.name = name.value;
      state.busy = true;
      state.error = null;
      state.errors = {};
      render();

      const result = await session.create({ name: name.value, civ: state.draft.civ });
      state.busy = false;
      if (!result.ok) {
        state.error = result.error;
        render();
        return;
      }
      adoptRoom(result.data);
    },

    /* --- join --------------------------------------------------------------- */

    joinLookup: async () => {
      if (state.busy) return;
      const code = parseRoomCode(state.draft.rawCode);
      if (!code) {
        state.errors.code = "Enter the four-digit code you were sent.";
        render();
        return;
      }
      state.busy = true;
      state.error = null;
      render();

      const found = await findRoom(code);
      state.busy = false;
      if (!found.ok) {
        state.errors.code = found.error;
        render();
        return;
      }
      if (state.screen === "lobby" || state.screen === "board") return;
      state.step = 1;
      state.error = null;
      render();
    },

    joinBack: () => {
      state.step = 0;
      state.error = null;
      state.errors = {};
      render();
    },

    joinConfirm: async () => {
      if (state.busy) return;
      const name = cleanName(state.draft.name);
      if (!name.ok) return fail("name", name.reason);
      if (!isCiv(state.draft.civ)) return fail("civ", "Choose a civilization.");

      state.busy = true;
      state.error = null;
      state.errors = {};
      render();

      const result = await session.join({
        code: state.draft.code,
        name: name.value,
        civ: state.draft.civ,
      });
      state.busy = false;
      if (!result.ok) {
        state.error = result.error;
        render();
        return;
      }
      state.draft.name = name.value;
      adoptRoom(result.data);
    },

    /* --- the lobby ---------------------------------------------------------- */

    /* The host's one decisive action. The server starts the game and pushes the
       new room to both sockets; this screen does not guess that it worked. */
    startGame: async () => {
      const room = state.room;
      if (!room || room.seat !== 0 || state.busy) return;
      if (room.status === "PLAYING") return toBoard(room);

      state.busy = true;
      state.error = null;
      render();

      const result = await session.start(room.roomId);
      state.busy = false;
      if (!result.ok) {
        state.error = result.error;
        render();
        return;
      }
      toBoard(result.data.room);
    },

    /* --- the board --- */

    /* A game already in progress: back to it, as it stands. */
    enterBoard: async () => {
      const room = state.room;
      if (!room) return;
      if (room.board) return toBoard(room);

      state.busy = true;
      const result = await session.room(room.roomId);
      state.busy = false;
      if (result.ok) toBoard(result.data);
      else {
        state.error = result.error;
        render();
      }
    },

    /**
     * Leave the board, keeping the room.
     *
     * Going back to the lobby rather than to the welcome screen, because the
     * room is still there and the other player may still be in it.
     */
    leaveBoard: () => {
      state.screen = "lobby";
      state.error = null;
      // The board node is about to be thrown away; nothing should keep painting
      // into it when a snapshot arrives.
      state.applySnapshot = null;
      render();
    },

    copy: (text, message) => copyText(text, message),
  };
}

/** Record a field error and repaint, so the message lands under its input. */
function fail(field, reason) {
  state.errors = { [field]: reason };
  state.error = null;
  render();
}

/* --------------------------------------------------------------------- flow */

/**
 * The room was found, joined or created: sit in it.
 *
 * The address bar is cleaned here, and that is not cosmetic. A player who
 * arrived on a shared link has `?room=7889` in the address bar, and if that
 * stayed there a refresh would send them back to the table they came from -
 * which is the "old code" bug: the host starts over, sends a second link, and a
 * reload quietly reopens the first game. The code is read once and taken out
 * of the address; from then on this tab knows its room from its own storage.
 */
function adoptRoom(data) {
  state.room = data;
  state.screen = data.status === "PLAYING" && data.board ? "board" : "lobby";
  state.game = state.screen === "board" && data.board ? restoreGame(data.board) : null;
  state.error = null;
  state.errors = {};
  state.draft.code = data.roomId;
  state.inviteLink = inviteLink(data.roomId);
  rememberRoom(data.roomId);
  dropUrlCode();
  render();
  startWatching();
}

/**
 * Look a room up by its code.
 *
 * Three answers, and they are all the join screen needs: a room this browser
 * is already seated in (walk back in), a lobby with a free second seat (ask for
 * a name), or a refusal to show under the code.
 */
async function findRoom(code) {
  const result = await session.room(code);
  if (!result.ok) {
    // Four digits are typed by hand. A number nobody is sitting at is a typo,
    // not a fault, and the message should sound like one.
    if (result.code === "NO_ROOM") {
      return { ok: false, error: "No game has that code. Check the four digits." };
    }
    return result;
  }

  const room = result.data;
  state.draft.code = code;

  if (room.seat !== null && room.seat !== undefined) {
    // This browser already holds a seat: a refresh, or a link to a game it is
    // in. Walk back in rather than being asked who it is again.
    adoptRoom(room);
    return { ok: true, data: room };
  }

  if (room.status !== "LOBBY") return { ok: false, error: "That game has already started." };
  if (room.players?.[1]?.joined) return { ok: false, error: "That game already has two players." };

  // Kept so the second step can say who is being joined and grey out the
  // civilizations that are already gone.
  state.room = room;
  return { ok: true, data: room };
}

function toBoard(room) {
  if (!room) return;
  state.room = { ...room, seat: room.seat ?? state.room?.seat ?? null };
  state.busy = false;
  state.error = null;
  state.errors = {};

  if (state.screen === "board") {
    // Already there: hand the snapshot to the board it is painting from rather
    // than replacing the board underneath a running animation.
    if (room.board) state.applySnapshot?.({ state: room.board, events: [] });
    return;
  }

  state.game = room.board ? restoreGame(room.board) : null;
  state.screen = "board";
  rememberRoom(room.roomId);
  render();
}

function toWelcome() {
  state.screen = "welcome";
  state.step = 0;
  state.room = null;
  state.game = null;
  state.error = null;
  state.errors = {};
  state.draft = { name: "", civ: "", rawCode: "", code: "" };
  state.inviteLink = "";
  forgetRoom();
  // The session remembers the last room it opened so a call with no code can
  // mean "the one we are in". Leaving means there is no such room, and a stale
  // one here is exactly how a player ends up back in the game they left.
  session.forget();
  stopWatching();
  dropUrlCode();
  render();
}

/** The link a player sends. Deep, plain, and it survives a refresh. */
function inviteLink(code) {
  const url = new URL(location.href);
  url.pathname = "/samrajya/";
  url.search = `?room=${code}`;
  url.hash = "";
  return url.toString();
}

/** Take a room code out of the address bar once it has been acted on. */
function dropUrlCode() {
  try {
    const url = new URL(location.href);
    // Two shapes of link, one rule: a code in the address is a way in, not
    // somewhere this browser lives. The query form is `?room=7889`; the path
    // form is `/samrajya/7889`.
    const cleaned = url.pathname.replace(/\/[1-9][0-9]{3}\/?$/, "/");
    const hadCode = url.searchParams.has("room") || cleaned !== url.pathname;
    if (!hadCode) return;
    url.searchParams.delete("room");
    history.replaceState(null, "", `${cleaned || "/"}${url.search}${url.hash}`);
  } catch {
    /* The page still works; this is only the address bar. */
  }
}

/* ------------------------------------------------------------------ watching

   The lobby is told when the room changes, rather than asking every few
   seconds. The socket carries the change the moment it happens, so arriving is
   arriving and not the next tick of a timer.

   Two things come down it. `state` is the room - who has joined, and whether
   the game has started. `snapshot` is the game itself, after every accepted
   action. A start arrives as the first of those, and it is the one that moves
   BOTH screens to the board: neither player presses anything twice, and nobody
   refreshes. */

let unsubscribe = null;

function startWatching() {
  stopWatching();
  if (!state.draft.code) return;
  unsubscribe = session.subscribe(state.draft.code, {
    onChange: (room) => {
      // The socket cannot identify us - a browser cannot put a header on a
      // WebSocket, and the identity in a query string would end up in a log -
      // so it carries no seat. Keep the one this browser already knows rather
      // than letting a push quietly unseat us.
      const mine = state.room?.seat ?? null;
      const before = fingerprint(state.room);
      // Whether this screen already knew the game was on. A game that was
      // already in play is not a game that just started: somebody who pressed
      // "Leave the board" stays in the lobby.
      const wasPlaying = state.room?.status === "PLAYING";
      state.room = { ...room, seat: room.seat ?? mine };

      // The host has started. This is the whole of "both players arrive at the
      // board": the board is in the room the server just pushed, and a player
      // holding a seat walks onto it here, without a second request.
      if (room.status === "PLAYING" && room.board && state.room.seat !== null) {
        state.game = restoreGame(room.board);
        if (state.screen === "board") {
          state.applySnapshot?.({ state: room.board, events: [] });
          return;
        }
        if (!wasPlaying) {
          toBoard(state.room);
          return;
        }
      }

      if (room.board) state.game = restoreGame(room.board);
      if (state.screen === "lobby" && before !== fingerprint(state.room)) render();
    },
    onSnapshot: (snapshot) => {
      if (!snapshot?.state) return;
      state.game = restoreGame(snapshot.state);
      state.applySnapshot?.(snapshot);
    },
    onStatus: (status) => {
      const was = state.socket;
      state.socket = status;
      // A channel that has just come back has missed whatever happened while it
      // was down. One read of the room catches the screen up.
      if (status === "open" && was !== "open") catchUp();
      if (status !== was && state.screen === "lobby") render();
    },
  });
}

function stopWatching() {
  unsubscribe?.();
  unsubscribe = null;
  state.socket = "closed";
}

/** What the lobby actually draws, so an unchanged room does not repaint. */
function fingerprint(room) {
  if (!room) return "";
  return JSON.stringify([room.status, room.roomId, room.players, room.seq ?? 0]);
}

/**
 * Read the room again, and take it as it stands.
 *
 * The socket carries every change, so this is not the normal path - it is for
 * the two moments a socket cannot cover: a tab that was asleep, and a channel
 * that has just come back after dropping. Either way the screen has missed
 * something, and asking once is cheaper than a client that is quietly a move
 * behind. A lobby redraws if the room changed; a board takes the snapshot it
 * has, without animating a move it did not watch.
 */
async function catchUp() {
  const code = state.draft.code;
  if (!code) return;
  const result = await session.room(code);
  if (!result.ok) return;

  const seat = result.data.seat ?? state.room?.seat ?? null;
  const room = { ...result.data, seat };

  if (state.screen === "board") {
    if (room.status !== "PLAYING" || !room.board) return;
    state.room = room;
    state.game = restoreGame(room.board);
    state.applySnapshot?.({ state: room.board, events: [] });
    return;
  }

  if (state.screen !== "lobby") return;
  const before = fingerprint(state.room);
  state.room = room;
  if (before === fingerprint(state.room)) return;
  if (room.status === "PLAYING" && room.board && room.seat !== null) {
    toBoard(room);
    return;
  }
  render();
}

/* ------------------------------------------------------------------ helpers */

function rememberRoom(code) {
  try {
    sessionStorage.setItem(REMEMBERED_ROOM, code);
  } catch {
    /* nothing to do */
  }
}

function forgetRoom() {
  try {
    sessionStorage.removeItem(REMEMBERED_ROOM);
  } catch {
    /* nothing to do */
  }
}

function rememberedRoom() {
  try {
    return sessionStorage.getItem(REMEMBERED_ROOM);
  } catch {
    return null;
  }
}

async function copyText(text, message) {
  if (!text) return;
  let done = false;
  try {
    await navigator.clipboard.writeText(text);
    done = true;
  } catch {
    // Clipboard permission can be refused. The field is selectable and the
    // value is on screen, so say so rather than failing silently.
    const field = $("#invite");
    if (field) {
      field.focus();
      field.select();
    }
  }
  if (!done) return;
  clearTimeout(copyTimer);
  const note = el("p", { class: "field__hint", text: message });
  foot.append(note);
  copyTimer = setTimeout(() => note.remove(), 2200);
}

/* -------------------------------------------------------------------- boot

   A link may arrive with a room on it, and a refresh may find this browser
   already in a room. Both are the same situation: there is a game, show it.
   A shared link is not a code to retype - it is already the answer - so it is
   looked up at once and the join form opens on the name. */

async function boot() {
  const fromQuery = parseRoomCode(new URLSearchParams(location.search).get("room"));
  // The whole pathname, not its last segment, and only where a path actually
  // puts a code: `/samrajya/7889` is a room, `/samrajya/` is not.
  const fromPath = parseRoomCode(location.pathname);
  const wanted = fromQuery || fromPath;

  if (wanted) {
    state.draft.rawCode = wanted;
    state.screen = "join";
    const found = await findRoom(wanted);
    // A browser that already holds a seat has been walked straight in.
    if (state.screen === "lobby" || state.screen === "board") return;
    if (found.ok) state.step = 1;
    else state.errors.code = found.error;
    render();
    return;
  }

  const remembered = rememberedRoom();
  if (remembered) {
    const result = await session.room(remembered);
    if (result.ok && result.data.seat !== null && result.data.seat !== undefined) {
      adoptRoom(result.data);
      return;
    }
    // The room is gone, or this browser never had a seat in it. Either way the
    // note is stale, and leaving it would send the next refresh after it again.
    forgetRoom();
  }

  render();
}

boot();

/* Keep the tab honest when it comes back to the front: a phone that was put
   down has missed whatever the other player did while it was away. */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (state.screen === "lobby" || state.screen === "board") catchUp();
});
