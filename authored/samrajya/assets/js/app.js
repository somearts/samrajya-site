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

const REMEMBERED_ROOM = "samrajya.room";

const state = {
  screen: "welcome",
  step: 0,
  busy: false,
  error: null,
  errors: {},
  room: null,
  // The game's money and holdings. Made when the board first opens and kept
  // afterwards, so leaving the board and coming back is the same game. See
  // shared/ledger.js - none of this is persisted anywhere yet.
  ledger: null,
  draft: {
    name: "",
    civ: "",
    guestName: "",
    guestCiv: "",
    rawCode: "",
    code: "",
  },
  inviteLink: "",
};

const session = new Session();
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
      render();
    },

    startJoin: () => {
      state.screen = "join";
      state.step = 0;
      state.error = null;
      state.errors = {};
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
    setGuestName: (value) => {
      state.draft.guestName = value;
      state.errors.guestName = null;
    },
    setGuestCiv: (id) => {
      state.draft.guestCiv = id;
      state.errors.guestCiv = null;
    },
    setCode: (value) => {
      state.draft.rawCode = value;
      state.errors.code = null;
      state.error = null;
    },

    /* --- create flow --- */

    createNext: () => {
      if (state.step === 0) {
        const name = cleanName(state.draft.name);
        if (!name.ok) return fail("name", name.reason);
        if (!isCiv(state.draft.civ)) return fail("civ", "Choose a civilization.");
        state.draft.name = name.value;
        state.step = 1;
        render();
        return;
      }
      const guest = cleanName(state.draft.guestName);
      if (!guest.ok) return fail("guestName", guest.reason);
      if (!isCiv(state.draft.guestCiv)) return fail("guestCiv", "Choose a civilization for them.");
      if (state.draft.guestCiv === state.draft.civ) {
        return fail("guestCiv", "That is yours. Pick a different one for them.");
      }
      state.draft.guestName = guest.value;
      state.step = 2;
      render();
    },

    createBack: () => {
      state.step = Math.max(0, state.step - 1);
      state.error = null;
      state.errors = {};
      render();
    },

    createConfirm: () => {
      if (state.busy) return;
      state.busy = true;
      state.error = null;
      render();

      session
        .create({
          name: state.draft.name,
          civ: state.draft.civ,
          guestName: state.draft.guestName,
          guestCiv: state.draft.guestCiv,
        })
        .then((result) => {
          state.busy = false;
          if (!result.ok) {
            state.error = result.error;
            render();
            return;
          }
          adoptRoom(result.data);
        });
    },

    /* --- join flow --- */

    joinLookup: async () => {
      if (state.busy) return;
      const code = parseRoomCode(state.draft.rawCode);
      if (!code) {
        state.errors.code = "That does not look like a game code.";
        render();
        return;
      }
      state.busy = true;
      state.error = null;
      render();

      const result = await session.room(code);
      state.busy = false;
      if (!result.ok) {
        state.errors.code = result.error;
        render();
        return;
      }
      if (result.data.seat !== null && result.data.seat !== undefined) {
        // Already in this game: the browser is simply being put back.
        state.draft.code = code;
        adoptRoom(result.data);
        return;
      }
      if (result.data.status !== "LOBBY") {
        state.errors.code = "That game has already started.";
        render();
        return;
      }
      state.draft.code = code;
      // Keep the room. The join screen reads it to say who is being joined and
      // to grey out the civilizations that are already gone - both of which are the
      // difference between a join that works first time and one that fails at
      // the last step with "Tiger is already taken".
      state.room = result.data;
      // Offer the seat the host reserved, if there is one.
      const reserved = (result.data.players || [])[1];
      if (reserved && !reserved.joined) {
        state.draft.name = state.draft.name || reserved.name;
        state.draft.civ = state.draft.civ || reserved.civ;
      }
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

    /* --- lobby --- */

    /* --- the board --- */

    enterBoard: () => {
      state.screen = "board";
      state.error = null;
      render();
    },

    /**
     * Leave the board, keeping the room.
     *
     * Going back to the lobby rather than to the welcome screen, because the
     * room is still there and the other player may still arrive. "Start over"
     * is on the lobby for anyone who really does want to end it.
     */
    leaveBoard: () => {
      state.screen = "lobby";
      state.error = null;
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

function adoptRoom(data) {
  state.room = data;
  state.screen = "lobby";
  state.error = null;
  state.errors = {};
  state.draft.code = data.roomId;
  state.inviteLink = inviteLink(data.roomId);
  rememberRoom(data.roomId);
  render();
  startWatching();
}

function toWelcome() {
  state.screen = "welcome";
  state.step = 0;
  state.room = null;
  state.error = null;
  state.errors = {};
  state.draft = {
    name: "",
    civ: "",
    guestName: "",
    guestCiv: "",
    rawCode: "",
    code: "",
  };
  state.inviteLink = "";
  forgetRoom();
  stopWatching();
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

/* ------------------------------------------------------------------ watching

   The lobby is told when the room changes, rather than asking every few
   seconds. The socket carries the change the moment it happens, so arriving
   is arriving and not the next tick of a timer. `refreshRoom` still exists for
   the two moments a socket cannot cover: the first paint, and a tab that has
   been asleep. */

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
      state.room = { ...room, seat: room.seat ?? mine };
      if (before !== fingerprint(state.room) && state.screen === "lobby") render();
    },
  });
}

function stopWatching() {
  unsubscribe?.();
  unsubscribe = null;
}

/** What the lobby actually draws, so an unchanged room does not repaint. */
function fingerprint(room) {
  if (!room) return "";
  return JSON.stringify([room.status, room.players, room.board]);
}

async function refreshRoom() {
  if (state.screen !== "lobby" || !state.draft.code) return;
  const result = await session.room(state.draft.code);
  if (!result.ok) return;
  const before = fingerprint(state.room);
  state.room = result.data;
  if (before !== fingerprint(state.room)) render();
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
   already in a room. Both are the same situation: there is a game, show it. */

async function boot() {
  const fromQuery = parseRoomCode(new URLSearchParams(location.search).get("room"));
  // The whole pathname, not its last segment. On /samrajya/ that segment is
  // "samrajya", which is eight letters from the code alphabet and would send
  // every single page load looking for a room that cannot exist. parseRoomCode
  // reads a code out of a path only where a path actually puts one.
  const fromPath = parseRoomCode(location.pathname);
  const wanted = fromQuery || fromPath;

  if (fromQuery) {
    // Coming in on a shared link: the join form is already half answered.
    state.draft.rawCode = fromQuery;
    state.screen = "join";
  }

  const remembered = wanted || rememberedRoom();
  if (remembered) {
    const result = await session.room(remembered);
    if (result.ok && result.data.seat !== null && result.data.seat !== undefined) {
      state.draft.code = remembered;
      adoptRoom(result.data);
      return;
    }
  }

  render();
}

boot();

/* Keep the tab honest when it comes back to the front. */
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.screen === "lobby") refreshRoom();
});
