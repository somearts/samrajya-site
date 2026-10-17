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
   * A second player may be named and given a civilization at this moment. That is
   * a reservation, not a claim: the seat stays open until somebody actually
   * joins with the code, and the person who does may change the name.
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

    if (this.room) {
      const sameAttempt = createKey !== "" && this.room.createKey === createKey;
      if (sameAttempt && this.#seatOf(identity) !== -1) {
        // The same attempt, seen twice. Report the room; change nothing.
        this.#broadcast();
        return json(this.#view(identity));
      }
      refuse(
        "A game already exists at this address. Start a new one instead.",
        "ROOM_TAKEN",
        409,
      );
    }

    const host = validateSeat(body?.name, body?.civ, "player 1");
    const reserved = hasReservedPair(body) ? validateSeat(body?.guestName, body?.guestCiv, "player 2") : null;

    if (reserved && host.civ === reserved.civ) {
      refuse("The two players cannot share a civilization.", "CIV_TAKEN");
    }

    const now = Date.now();
    this.room = {
      roomId: this.code,
      createKey,
      createdAt: now,
      updatedAt: now,
      status: "LOBBY",
      players: [
        seatFor(identity, host, "HOST", true),
        reserved ? seatFor("", reserved, "GUEST", false) : emptySeat(),
      ],
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

    // A civilization the host reserved but nobody claimed is still free, so
    // taking a different one is allowed - the reservation is a default, not a
    // lock.
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
        socket.send(JSON.stringify({ type: "state", room: this.#view(SOCKET) }));
      } catch {
        // A socket that closed between the list and the send. Nothing to do:
        // it is already gone, which is all that matters.
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
    this.room = (await this.state.storage.get("room")) || null;
    // Rooms made before this phase carry `token` where a `civ` is now expected.
    // The old field is dropped rather than translated: a tiger is not a
    // civilisation, and pretending otherwise would show a player somebody
    // else's idea of who they are. Such a room simply reads as unchosen, and
    // starting a new one is a button away.
    if (this.room) {
      this.room = { ...this.room, players: this.room.players.map((p) => ({ ...p, civ: p.civ ?? null })) };
    }
    return this.room;
  }

  async #persist() {
    await this.state.storage.put("room", this.room);
  }

  /** What one caller is allowed to see, and nothing more. */
  #view(identity) {
    const seat = this.#seatOf(identity);
    return {
      roomId: this.room.roomId,
      status: this.room.status,
      seat: seat === -1 ? null : seat,
      // The board game attaches its own state here. It is not written yet, and
      // the client is written so that its absence is expected, not a failure.
      board: null,
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

function hasReservedPair(body) {
  return (
    typeof body?.guestName === "string" &&
    body.guestName.trim() !== "" &&
    typeof body?.guestCiv === "string" &&
    body.guestCiv.trim() !== ""
  );
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
