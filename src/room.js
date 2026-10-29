/* ==========================================================================
   SAMRAJYA - THE ROOM

   One Durable Object per game, holding the two seats and nothing else. This
   is the whole of the backend for the entry stage: enough to open a game,
   hand out a code, let a second person take the second seat, and say so
   accurately when either of those is not possible.

   The board game goes in here later, and it goes in *here* - behind the same
   door, in the same single-threaded object, so that when a move changes a
   balance it is still one object deciding it. The shape below is the seam: a
   room is a small record with a status, a seat list and a clock.

   Two naming rules this file obeys, both learned the hard way:

     - `this.state` is the Durable Object's own state. It is not ours to
       reassign. The game record is `this.room`, and it is written to storage
       under the key "room". Shadowing the built-in leaves an object with a
       `.storage` that is no longer the storage, and it fails in ways that
       look like nothing at all.
     - the request body is read before any rule is applied, even a rule that
       is about to refuse. An undrained body is still open when the response
       goes out, and the runtime complains about exactly that.

   Authority is the point of this file. The server decides who may sit where,
   which names are acceptable, which civilizations are taken, and what the room says.
   The browser is a renderer with an opinion about nothing.
   ========================================================================== */

import { isIdentity, cleanName } from "../shared/identity.js";
import { isCiv, nameOf } from "../shared/civilizations.js";
import { applyAction, createGame, restoreGame, serializeGame } from "../shared/game.js";
import { sheetFor } from "../shared/ledger.js";

/** A refusal the caller can show a person. */
class Refusal extends Error {
  constructor(message, code = "REFUSED", status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const refuse = (message, code, status) => {
  throw new Refusal(message, code, status);
};

/**
 * The identity a socket view is built with: nobody.
 *
 * A browser cannot set a header on a WebSocket, and the only thing that could
 * stand in for one - the identity, in the query string - would end up in a URL
 * and then in an access log. So a socket is shown the room the way anyone
 * holding the code already sees it: names, civilizations, who has joined - and no
 * seat. Seats stay on the HTTPS endpoints, which do carry the header. The
 * client keeps the seat it already knows it holds. See #broadcast.
 */
const SOCKET = "";

/**
 * When a code may be given to a different table.
 *
 * A lobby nobody started is abandoned after two hours; a game that was actually
 * played keeps its number for a week, so a phone that was put down mid-match
 * finds its table again. Until then the number belongs to that room, and a
 * create that wants it is sent to the next one.
 */
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const ROOM_TTL_LIVE_MS = 7 * 24 * 60 * 60 * 1000;

export class GameRoom {
  constructor(state, env) {
    // `state` here is the Durable Object's own state object. Do not reassign it.
    this.state = state;
    this.env = env;

    // The hibernation API - acceptWebSocket, getWebSockets and the auto
    // response - lives on the DurableObjectContext. How that reaches a
    // constructor differs between runtimes: on Cloudflare's it is a `.ctx`
    // property of the state object, and in workerd locally the state object
    // *is* the context. Taking whichever is present means this file works in
    // both, and there is exactly one line that has to change if either moves.
    this.ctx = state.ctx ?? state;

    /** The game record, once loaded or created. Null until then. */
    this.room = null;
    /** The code the Worker derived, handed over in a header. */
    this.code = null;
  }

  /* --------------------------------------------------------------- requests */

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    this.code = request.headers.get("x-samrajya-room") || this.code;

    // Read the body first, whatever happens next. See the header comment.
    const body = method === "POST" ? await readJson(request) : null;

    try {
      // `return await`, not `return`. A bare `return somePromise()` leaves the
      // try block immediately, so a refusal thrown inside it escapes the catch
      // below and is reported as an internal error instead of as the rule it
      // is. This is the third time that has cost an hour; it is written this
      // way on purpose.
      switch (url.pathname) {
        case "/create":
          return await this.#create(method, body, request);
        case "/join":
          return await this.#join(method, body, request);
        case "/state":
          return await this.#state(method, request);
        case "/live":
          return await this.#live(method, request);
        case "/action":
          return await this.#action(method, body, request);
        default:
          return json({ error: "Not found.", code: "NOT_FOUND" }, 404);
      }
    } catch (error) {
      if (error instanceof Refusal) {
        return json({ error: error.message, code: error.code }, error.status);
      }
      // A thrown error here is a bug in this Worker, not a rule rejection, and
      // it should be visible rather than dressed up as a rule.
      console.error("samrajya room error", error);
      return json({ error: "Something went wrong at our end.", code: "INTERNAL" }, 500);
    }
  }

  /* ------------------------------------------------------------------ create */

  /**
   * Open the room and take the first seat.
   *
   * Only the first seat. Each player fills in their own name and civilization
   * on their own device, so there is nothing for the creator to reserve here:
   * the second seat is empty until somebody arrives with the code and says who
   * they are.
   *
   * Asking twice is not asking twice. The Worker derives this room's address
   * from the caller's identity and the create key in the body, so a duplicate
   * submission - a double-tapped button, a retry after a dropped response -
   * arrives here carrying the same key and finds the room already built. It is
   * returned exactly as it is, with nothing overwritten. A different key from
   * the same browser is a different address, and so is a different room.
   */
  async #create(method, body, request) {
    if (method !== "POST") return json({ error: "Use POST." }, 405);
    if (!this.code) refuse("The server did not name this game.", "NO_ROOM_ID", 500);

    const identity = requireIdentity(request);
    const createKey = String(body?.createKey ?? "").trim().toLowerCase();
    await this.#load();

    const now = Date.now();

    if (this.room) {
      const sameAttempt = createKey !== "" && this.room.createKey === createKey;
      if (sameAttempt && this.#seatOf(identity) !== -1) {
        // The same attempt, seen twice. Report the room; change nothing.
        this.#broadcast();
        return json(this.#view(identity));
      }

      /* A code is reused only when its room is genuinely gone. Four digits is
         a small shopfront: a lobby nobody started is abandoned after two hours,
         and even a game that was played gives its number up after a week.
         Anything fresher is a real room, and the caller is sent to try the next
         number instead. */
      const idleFor = now - Number(this.room.updatedAt || this.room.createdAt || 0);
      const abandoned =
        idleFor > ROOM_TTL_MS && this.room.status === "LOBBY" ? true : idleFor > ROOM_TTL_LIVE_MS;
      if (!abandoned) {
        refuse(
          "That code is in use. Try again in a moment.",
          "ROOM_TAKEN",
          409,
        );
      }
    }

    const host = validateSeat(body?.name, body?.civ, "player 1");
    const testMode = body?.testMode === true;

    this.room = {
      roomId: this.code,
      createKey,
      createdAt: now,
      updatedAt: now,
      status: "LOBBY",
      testMode,
      players: [seatFor(identity, host, "HOST", true), emptySeat()],
    };
    await this.#persist();
    this.#broadcast();

    return json(this.#view(identity));
  }

  /* -------------------------------------------------------------------- join */

  /** Take the second seat. Only the second seat: this game is for two. */
  async #join(method, body, request) {
    if (method !== "POST") return json({ error: "Use POST." }, 405);
    await this.#load();

    // A four-digit code is typed by hand, so a code that names no room is an
    // ordinary mistake rather than an error. Say so in the same voice as the
    // rest of the refusals.
    if (!this.room) return json({ error: "No such game.", code: "NO_ROOM" }, 404);

    // A browser that already holds a seat is simply being put back in it. This
    // is checked before the room is full, so a refresh is never an error.
    const identity = requireIdentity(request);
    const mine = this.#seatOf(identity);
    if (mine !== -1) return json(this.#view(identity));

    if (this.room.status !== "LOBBY") {
      refuse("That game has already started.", "ALREADY_STARTED", 409);
    }
    if (this.room.players[1].joined) {
      refuse("That game already has two players.", "ROOM_FULL", 409);
    }

    // A civilization the host holds is taken. The second seat is otherwise
    // free: the joiner chooses their own name and civilization here, on their
    // own device.
    const wanted = validateSeat(body?.name, body?.civ, "you");
    if (this.room.players[0].civ === wanted.civ) {
      refuse(
        `${nameOf(this.room.players[0].civ)} is already taken. Choose another.`,
        "CIV_TAKEN",
      );
    }

    this.room.players[1] = seatFor(identity, wanted, "GUEST", true);
    this.room.updatedAt = Date.now();
    await this.#persist();
    // This is the moment the host has been waiting for, and it is the whole
    // reason the live channel exists.
    this.#broadcast();

    return json(this.#view(identity));
  }

  /* ------------------------------------------------------------------- state */

  async #state(method, request) {
    if (method !== "GET") return json({ error: "Use GET." }, 405);
    await this.#load();
    if (!this.room) return json({ error: "No such game.", code: "NO_ROOM" }, 404);

    // A room's state is public to anyone holding the code: there is nothing
    // secret in who has taken which seat, and the join screen has to be able
    // to show which civilizations are gone. Seats are only ever *claimed* by an
    // identity, never by knowing the code.
    return json(this.#view(identityOf(request)));
  }

  /* ----------------------------------------------------------------- action */

  /**
   * One move, decided here.
   *
   * The browser is a renderer. It sends an action and the seat it is acting for
   * (from the identity header), and this object applies the SAME `applyAction`
   * the client uses, persists the result, and tells everyone. A refusal is a
   * sentence, not a state change.
   *
   * The die is rolled here. A browser cannot be trusted to roll its own die, so
   * the server supplies the random source - except in the preview, where a test
   * action may hand one over so the end-to-end suite is deterministic.
   */
  async #action(method, body, request) {
    if (method !== "POST") return json({ error: "Use POST." }, 405);
    const identity = requireIdentity(request);
    await this.#load();
    if (!this.room) return json({ error: "No such game.", code: "NO_ROOM" }, 404);

    /* --- start: the one action allowed before the game exists ---------------- */

    if (body?.type === "start") {
      if (this.room.players[0].id !== identity) {
        return json({ error: "Only the first player can start the game.", code: "NOT_HOST" }, 409);
      }
      if (this.room.status !== "LOBBY") {
        return json({ error: "That game has already started.", code: "ALREADY_STARTED" }, 409);
      }
      if (!this.room.players[1].joined) {
        return json({ error: "Waiting for the second player.", code: "WAITING" }, 409);
      }
      this.room.game = createGame(this.room.players, { testMode: this.room.testMode });
      this.room.status = "PLAYING";
      this.room.updatedAt = Date.now();
      await this.#persist();
      this.#broadcast();
      return json({ ok: true, room: this.#view(identity) });
    }

    const seat = this.#seatOf(identity);
    if (seat === -1) {
      return json({ error: "You are not seated in this game.", code: "NOT_SEATED" }, 409);
    }
    if (this.room.status !== "PLAYING" || !this.room.game) {
      return json({ error: "That game has not started.", code: "NOT_STARTED" }, 409);
    }

    /* --- the test hook -------------------------------------------------------

       The preview may be handed a position or a purse so the end-to-end suite is
       deterministic. It is refused unless the environment says so, and it is not
       an action a player can use in production. */
    if (body?.type === "debug") {
      if (this.env?.ALLOW_TEST_RNG !== "1") {
        return json({ error: "That is not something the game can do.", code: "REFUSED" }, 409);
      }
      const game = this.room.game;
      if (body.reset) {
        // A clean slate for a test: a fresh ledger and every piece back on Start.
        this.room.game = createGame(this.room.players);
        this.room.updatedAt = Date.now();
        await this.#persist();
        this.#broadcastGame([]);
        return json({
          ok: true,
          seq: this.room.game.seq,
          state: serializeGame(this.room.game),
          events: [],
        });
      }
      const piece = game.pieces.find((p) => p.seat === seat);
      if (Number.isInteger(body.position) && piece) piece.position = body.position;
      if (Number.isInteger(body.active)) {
        game.active = body.active;
        game.phase = "AWAITING_ROLL";
      }
      if (Number.isFinite(body.money)) {
        const player = game.ledger.players.find((p) => p.seat === seat);
        if (player) player.money = Math.max(0, Math.trunc(body.money));
      }
      if (body.owner && typeof body.owner === "object") {
        const sheet = sheetFor(game.ledger, String(body.owner.id));
        if (sheet) {
          sheet.owner = body.owner.seat ?? null;
          sheet.upgradeLevel = Number.isInteger(body.owner.level) ? body.owner.level : 0;
        }
      }
      /* A known set of weapons, so a check about what a chip or a profile shows
         does not depend on the odds. Refused unless the test hook is on. */
      if (Array.isArray(body.weapons) && piece) {
        piece.weapons = body.weapons
          .filter((id) => typeof id === "string")
          .slice(0, 6);
      }
      this.room.updatedAt = Date.now();
      await this.#persist();
      this.#broadcastGame([]);
      return json({ ok: true, seq: game.seq, state: serializeGame(game), events: [] });
    }

    /* --- a real action ------------------------------------------------------- */
    const action = { ...body, seat };
    // The die and the chest draw are the two things that need a number. Both
    // come from the server, except in the preview, where the end-to-end suite
    // may hand one over so a branch can be seen rather than waited for.
    const rng =
      (action.type === "roll" || action.type === "drawWeapon" || action.type === "drawTimeCard") &&
      this.env?.ALLOW_TEST_RNG === "1" &&
      typeof action.rng === "number"
        ? () => action.rng
        : Math.random;

    const result = applyAction(this.room.game, action, rng);
    const no = result.events.find((event) => event.type === "refused");
    if (no) {
      return json({ error: no.why, code: "REFUSED" }, 409);
    }

    this.room.game = result.state;
    this.room.updatedAt = Date.now();
    await this.#persist();
    this.#broadcastGame(result.events);
    return json({
      ok: true,
      seq: result.state.seq,
      state: serializeGame(result.state),
      events: result.events,
    });
  }

  /* ------------------------------------------------------------------- live */

  /**
   * The live channel: a WebSocket that is told when the room changes.
   *
   * This is what replaced the lobby polling every three seconds. Two people
   * waiting for each other should not have the *arrival* of one of them
   * rounded to the nearest three seconds, and once a move can change a balance
   * a three-second gap is a bug rather than a wait.
   *
   * Hibernation, deliberately: the socket is accepted through the Durable
   * Objects API rather than kept in an in-memory set, so a room nobody is
   * looking at lets this object be evicted and costs nothing. That is the only
   * reason a lobby someone is sitting in does not pin a machine awake.
   */
  async #live(method, request) {
    if (method !== "GET") return json({ error: "Use GET." }, 405);

    // Room first, then the socket check. "Is that room even there" is the more
    // useful answer for someone with a stale link, and answering 426 to a room
    // that does not exist would send them looking for a protocol problem they
    // do not have.
    await this.#load();
    if (!this.room) return json({ error: "No such game.", code: "NO_ROOM" }, 404);

    if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
      return json({ error: "That is not a live connection.", code: "NOT_WEBSOCKET" }, 426);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);
    // Answers the client's keepalive without waking this object, which is the
    // whole point of accepting it hibernating in the first place.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));

    server.send(JSON.stringify({ type: "state", room: this.#view(SOCKET) }));

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Tell everyone watching that something changed.
   *
   * One message, the same to everybody: this channel carries *what the room
   * looks like*, and a room's contents are already public to anyone holding the
   * code. It carries no seat, because a browser cannot put a header on a
   * WebSocket and the one thing that could stand in for one - the identity, in
   * the query string - would end up in a URL and a log. Seats stay where they
   * belong, on the HTTPS endpoints that do carry the header. The client keeps
   * the seat it already knows it has.
   */
  #broadcast() {
    if (!this.room) return;
    let sockets = [];
    try {
      sockets = this.ctx.getWebSockets();
    } catch {
      return;
    }
    for (const socket of sockets) {
      try {
        socket.send(
          JSON.stringify({
            type: "state",
            /* The game this message is about, so a browser that is watching
               more than one game can tell them apart. */
            gameId: this.room.roomId,
            room: this.#view(SOCKET),
          }),
        );
      } catch {
        // A socket that closed between the list and the send. Nothing to do:
        // it is already gone, which is all that matters.
      }
    }
  }

  /**
   * Tell everyone watching that the GAME changed, with the events that changed it.
   *
   * This is the message the board animates from: it carries the new state, its
   * number, and the events in order. A board that is the one that acted already
   * has this state (its own response arrived first), and recognises the number
   * and ignores it; a board that is watching animates the events and then paints
   * the state. That is how the two screens agree without either asking.
   */
  #broadcastGame(events = []) {
    if (!this.room) return;
    let sockets = [];
    try {
      sockets = this.ctx.getWebSockets();
    } catch {
      return;
    }
    for (const socket of sockets) {
      try {
        socket.send(
          JSON.stringify({
            type: "snapshot",
            /* The game this message is about. A browser that is watching more
               than one game - or that is watching a game it has left - reads
               the id and throws away anything that is not its game. */
            gameId: this.room.roomId,
            seq: this.room.game?.seq ?? 0,
            state: this.room.game ? serializeGame(this.room.game) : null,
            events,
          }),
        );
      } catch {
        // A socket that closed between the list and the send. Nothing to do.
      }
    }
  }

  /* --------------------------------------------------------------- the socket */

  /**
   * The client sends nothing that means anything.
   *
   * Everything it says is either the keepalive, which the runtime answers
   * without getting here, or noise. A room is changed by POSTing to /create or
   * /join - never by something arriving down a socket - so that a room cannot
   * be moved by whoever happens to be holding a connection to it.
   */
  async webSocketMessage() {}

  async webSocketClose() {}

  async webSocketError() {}

  /* ---------------------------------------------------------------- internals */

  #seatOf(identity) {
    if (!this.room || !identity) return -1;
    return this.room.players.findIndex((p) => p.joined && p.id === identity);
  }

  async #load() {
    const raw = (await this.state.storage.get("room")) || null;
    if (!raw) {
      this.room = null;
      return null;
    }
    // Rooms made before this phase carry `token` where a `civ` is now expected.
    // The old field is dropped rather than translated: a tiger is not a
    // civilisation, and pretending otherwise would show a player somebody
    // else's idea of who they are. Such a room simply reads as unchosen, and
    // starting a new one is a button away.
    this.room = {
      ...raw,
      testMode: raw.testMode === true,
      players: raw.players.map((p) => ({ ...p, civ: p.civ ?? null })),
      // The game is stored in its wire form (the ledger's Map as entries) so
      // what is persisted is exactly what a socket would have been sent.
      game: raw.game ? restoreGame(raw.game) : null,
    };
    return this.room;
  }

  async #persist() {
    await this.state.storage.put("room", {
      ...this.room,
      game: this.room.game ? serializeGame(this.room.game) : null,
    });
  }

  /** What one caller is allowed to see, and nothing more. */
  #view(identity) {
    const seat = this.#seatOf(identity);
    return {
      roomId: this.room.roomId,
      status: this.room.status,
      seat: seat === -1 ? null : seat,
      testMode: this.room.testMode === true,
      // The game, in its wire form, and the number of the last accepted action.
      // Null until the game has started; the client treats that as "waiting",
      // not as a failure.
      seq: this.room.game?.seq ?? 0,
      board: this.room.game ? serializeGame(this.room.game) : null,
      players: this.room.players.map((p) => ({
        name: p.name,
        civ: p.civ,
        joined: p.joined,
        role: p.role,
      })),
    };
  }
}

/* ------------------------------------------------------------- small helpers */

function seatFor(id, { name, civ }, role, joined) {
  return { id, name, civ, role, joined, lastSeen: Date.now() };
}

function emptySeat() {
  return { id: "", name: null, civ: null, role: "GUEST", joined: false, lastSeen: null };
}

function validateSeat(name, civ, who) {
  const clean = cleanName(name);
  if (!clean.ok) refuse(`That ${who} needs a name.`, "NAME_REQUIRED");
  if (!isCiv(civ)) refuse(`Choose a civilization for ${who}.`, "CIV_REQUIRED");
  return { name: clean.value, civ: String(civ).trim().toLowerCase() };
}

function identityOf(request) {
  const raw = request.headers.get("x-samrajya-player");
  return isIdentity(raw) ? String(raw).trim().toLowerCase() : "";
}

function requireIdentity(request) {
  const identity = identityOf(request);
  if (!identity) {
    refuse("This browser has no identity. Reload the page and try again.", "NO_IDENTITY", 400);
  }
  return identity;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
