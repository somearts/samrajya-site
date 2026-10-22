/* ==========================================================================
   SAMRAJYA - THE WORKER ENTRY

   Two jobs and nothing else:

     1. Serve the site from the asset store. `/samrajya` resolves to
        `/samrajya/` and `/samrajya/` to index.html, and a file that is not
        there is a real 404 - it must never fall through to GoLake, which
        would answer under a path that looks like ours.

     2. Send the handful of API calls to the Durable Object that owns the
        room. The Worker holds no game state and makes no decisions; it only
        knows which room an address refers to, and mints a code nobody can
        guess when a new one is asked for.

   This is a separate Worker from GoLake (odd-snow-0a72, which holds
   golake.app as a custom domain) and from Strand (golake-strand). It owns
   only golake.app/samrajya and golake.app/samrajya/*, so nothing else on the
   domain can reach it - and, for the same reason, the API lives under
   /samrajya/api, inside the prefix this Worker is actually routed for.
   ========================================================================== */

import { GameRoom } from "./room.js";
import {
  ROOM_CODE_TRIES,
  deriveCode,
  isCreateKey,
  isIdentity,
} from "../shared/identity.js";

export { GameRoom };

/** Every path the API answers on. Anything else is a static asset. */
const API_PREFIX = "/samrajya/api/";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith(API_PREFIX)) return serveAsset(request, env);

    try {
      return await route(request, url, env);
    } catch (error) {
      // A thrown error here is a bug in the Worker, not a rule rejection. The
      // room returns a refusal with a message instead of throwing, so anything
      // arriving here is unexpected and should be visible in the logs.
      console.error("samrajya api error", error);
      return json({ error: "Something went wrong at our end.", code: "INTERNAL" }, 500);
    }
  },
};

async function route(request, url, env) {
  const rest = url.pathname.slice(API_PREFIX.length);

  // The body is read here, once, for every call that has one, and handed to the
  // room as a value. Reading it in two places means either cloning the request
  // or handing on a stream that has already been consumed, and both have bitten
  // this before.
  let body;
  if (request.method === "POST") {
    const raw = await request.text();
    try {
      body = JSON.parse(raw);
    } catch {
      // Left undefined. The room refuses it with a message a person can act
      // on, which beats this Worker inventing one.
      body = undefined;
    }
  }

  /* --- POST /samrajya/api/rooms  ->  a brand new room --------------------- */
  if (rest === "rooms") {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405);

    const identity = request.headers.get("x-samrajya-player") || "";
    if (!isIdentity(identity)) {
      return json(
        { error: "This browser has no identity. Reload the page and try again.", code: "NO_IDENTITY" },
        400,
      );
    }

    const createKey = String(body?.createKey ?? "").trim().toLowerCase();
    if (!isCreateKey(createKey)) {
      return json({ error: "This attempt to create a game has no key.", code: "NO_CREATE_KEY" }, 400);
    }

    /* The address is derived, not drawn - see shared/identity.js. It is four
       digits, so two tables can want the same number at the same moment. The
       next attempt is the next address; a code already in use is the only thing
       that moves on, because any other refusal is about the game itself and
       asking again under a different number would only hide it. */
    for (let attempt = 0; attempt < ROOM_CODE_TRIES; attempt += 1) {
      const code = await deriveCode(identity, createKey, attempt);
      const response = await toRoom(env, code, "create", request.method, request.headers, body);

      if (response.status !== 409) return response;

      const text = await response.text();
      let refusal = null;
      try {
        refusal = JSON.parse(text)?.code ?? null;
      } catch {
        refusal = null;
      }
      if (refusal !== "ROOM_TAKEN") {
        return new Response(text, { status: response.status, headers: response.headers });
      }
    }

    return json(
      {
        error: "Every game code is in use right now. Try again in a moment.",
        code: "NO_CODE_FREE",
      },
      503,
    );
  }

  /* --- /samrajya/api/rooms/:code/(join|state|live|action) ----------------- */
  const match = rest.match(/^rooms\/([1-9][0-9]{3})(?:\/(join|state|live|action))?$/);
  if (!match) return json({ error: "No such game." }, 404);

  const [, code, action = "state"] = match;
  return toRoom(env, code, action, request.method, request.headers, body);
}

/**
 * Hand a request to the Durable Object that owns this room.
 *
 * The Request is rebuilt rather than wrapped. `new Request(request, …)` inherits
 * a body that the first read has already consumed, and the WebSocket upgrade
 * for /live has to survive the hop intact, so the method, headers and body are
 * each passed explicitly and the URL is the room's own.
 */
async function toRoom(env, code, action, method, headers, body) {
  const stub = env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));

  const forwarded = new Headers(headers);
  forwarded.set("x-samrajya-room", code);

  const init = { method, headers: forwarded };
  if (body !== undefined) init.body = JSON.stringify(body);

  return stub.fetch(`https://room/${action}`, new Request(`https://room/${action}`, init));
}

/* -------------------------------------------------------------------- assets */

/**
 * Serve the site.
 *
 * `not_found_handling = "none"` means a request for a file that does not
 * exist is forwarded here rather than answered by the asset store. That is
 * deliberate: a missing file under /samrajya must be a real 404 from this
 * Worker and must not fall through to GoLake, which would serve the wrong
 * site under a link that looks like ours.
 */
async function serveAsset(request, env) {
  // A four-digit path is the other shape of a share link - golake.app/samrajya/7889
  // - and it should serve the game, not a 404. The address is left alone: the
  // page reads the number out of it, and then takes it out again, so a refresh
  // goes to the room this tab remembers rather than to an old link.
  const url = new URL(request.url);
  const sharedPath = /^\/samrajya\/[1-9][0-9]{3}\/?$/.test(url.pathname);
  const target =
    sharedPath && (request.method === "GET" || request.method === "HEAD")
      ? new Request(new URL("/samrajya/", url), request)
      : request;

  try {
    return await env.ASSETS.fetch(target);
  } catch {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
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
