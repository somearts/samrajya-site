/* ==========================================================================
   SAMRAJYA - PRODUCTION CHECK

   Runs against a real URL after a deploy. It takes a base URL so the same
   script checks a preview deployment and the live site.

   It checks five things, in order of how badly they would hurt:

     1. the game is reachable at /samrajya, by direct navigation and on refresh
     2. every asset it references resolves at that exact path
     3. a room can actually be opened, joined and refused - the API is the game
     4. GoLake and Strand are untouched
     5. the welcome screen is still the one that was approved

     node scripts/verify-live.js [base-url]
   ========================================================================== */

import { authorContent } from "./author-content.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const arg = process.argv[2] || "https://golake.app";
const BASE = arg.replace(/\/$/, "");
const GAME = `${BASE}/samrajya`;
const API = `${GAME}/api`;
const REAL_DOMAIN = /\bgolake\.app$/.test(new URL(BASE).hostname);

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` - ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}\n`);
}

async function get(path, options = {}) {
  return fetch(path, {
    headers: { "user-agent": "samrajya-verify/1.0", "cache-control": "no-cache" },
    ...options,
  });
}

const identity = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** An API call, with the body kept so a failure can say what it actually said. */
async function api(id, path, method = "GET", body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      "user-agent": "samrajya-verify/1.0",
      "cache-control": "no-cache",
      "x-samrajya-player": id,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON - reported as-is */
  }
  return { status: response.status, body: parsed, text };
}

/** "409 CIV_TAKEN" - short enough to read, long enough to diagnose. */
const said = (r) => `${r.status} ${r.body?.code || JSON.stringify(r.body || r.text).slice(0, 80)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open a socket to a room and get at its messages.
 *
 * Note there is no identity: a browser cannot set a header on a WebSocket, and
 * the app does not put one in the query string. The socket is a notification
 * channel for the room's contents; seats stay on the HTTPS endpoints.
 *
 * `first()` resolves with the next state pushed down it, which for a room
 * nobody has touched is the one sent on connect. Used to prove the live
 * channel actually carries a change rather than only answering when asked.
 */
async function openSocket(path) {
  // GAME is an absolute URL, so the socket URL is built from it and not from
  // BASE - concatenating the two produces something that looks like a URL and
  // is not one.
  const url = `${GAME.replace(/^http/, "ws")}/api${path}`;
  const socket = new WebSocket(url);
  const queue = [];
  let waiter = null;
  let why = "no open event";

  socket.addEventListener("error", () => {
    why = "error";
  });
  socket.addEventListener("close", (event) => {
    why = `closed ${event.code}${event.reason ? ` (${event.reason})` : ""}`;
  });
  socket.addEventListener("open", () => {
    why = "open";
  });

  socket.addEventListener("message", (event) => {
    let parsed = null;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    if (waiter) {
      const next = waiter;
      waiter = null;
      next(parsed);
    } else {
      queue.push(parsed);
    }
  });

  await Promise.race([
    new Promise((resolve) => socket.addEventListener("open", resolve, { once: true })),
    sleep(5000).then(() => socket.close()),
  ]);

  return {
    socket,
    reason: () => why,
    first: () =>
      new Promise((resolve) => {
        if (queue.length) return resolve(queue.shift());
        waiter = resolve;
        setTimeout(() => {
          if (waiter === resolve) {
            waiter = null;
            resolve({ timedOut: true });
          }
        }, 5000);
      }),
    close: () => socket.close(),
  };
}

async function main() {
  console.log(`\nSamrajya production check against ${BASE}\n${"=".repeat(46)}`);

  /* ------------------------------------------------------------ the site */
  section("The page");

  const bare = await get(GAME, { redirect: "manual" });
  check(
    "/samrajya answers directly",
    bare.status === 200 || bare.status === 308 || bare.status === 307,
    `status ${bare.status}`,
  );
  if (bare.status === 308 || bare.status === 307) {
    check(
      "/samrajya points at /samrajya/",
      bare.headers.get("location")?.endsWith("/samrajya/"),
      bare.headers.get("location"),
    );
  }

  const page = await get(`${GAME}/`);
  const html = authorContent(await page.text());
  check("/samrajya/ is the game", page.ok, `status ${page.status}`);
  check("it is Samrajya", html.includes("Samrajya Kalchakra"));
  check("the tagline is right there", html.includes("Empires rise"));
  check("it loads a module", /<script type="module"/.test(html));
  check("it says something without scripting", html.includes("<noscript>"));

  // A refresh is the same request, so this is the same answer. Cloudflare's
  // per-request challenge token is stripped first - see author-content.js - or
  // every refresh would look like a change to the page.
  const again = await get(`${GAME}/`);
  const againHtml = authorContent(await again.text());
  check("a refresh returns the same page", again.ok && againHtml === html, `status ${again.status}`);

  /* ----------------------------------------------------------- the assets */
  section("Every asset");

  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (!/^(https?:|data:|\/)/.test(m[1])) refs.add(m[1]);
  }
  const base = `${GAME}/`;
  for (const ref of refs) {
    const target = new URL(ref, base).toString();
    const response = await get(target);
    check(`${ref}`, response.ok, `status ${response.status}`);
  }

  for (const asset of [
    "assets/js/app.js",
    "assets/js/views.js",
    "assets/js/wordmark.js",
    "assets/js/board.js",
    "assets/js/corner-art.js",
    "assets/css/board.css",
    "assets/js/session.js",
    "assets/js/shared/civilizations.js",
    "assets/js/shared/identity.js",
    "assets/fonts/jost-300.woff2",
    "assets/img/mark.svg",
  ]) {
    const response = await get(`${GAME}/${asset}`);
    check(`${asset} is served`, response.ok, `status ${response.status}`);
  }

  check(
    "the token picker is gone and the civilizations are in",
    (await get(`${GAME}/assets/js/shared/tokens.js`)).status === 404,
    "the four tokens were replaced, not kept alongside",
  );
  {
    const civs = await (await get(`${GAME}/assets/js/shared/civilizations.js`)).text();
    check(
      "and the four are the four",
      ["indus-valley", "mesopotamian", "ancient-egyptian", "aztec"].every((id) =>
        civs.includes(`"${id}"`),
      ),
      civs.includes("ancient-egyptian") ? "" : "not all four present",
    );
  }

  const missing = await get(`${GAME}/assets/js/does-not-exist.js`);
  check(
    "a missing file under /samrajya is a 404",
    missing.status === 404,
    `status ${missing.status}`,
  );

  /* ------------------------------------------------------------- the API */
  section("The room service");

  const host = identity();
  const guest = identity();
  const stranger = identity();

  /* --- a create that is asked for more than once ---------------------------
     The hard case, and the one the old build got wrong: five requests, all in
     flight together, all saying the same thing. A browser can disable its own
     button; that is not what stops a second room being made. The stop is that
     the room's address is derived from the identity and the create key, so
     every one of these is asking for the same room by construction. */

  const createKey = identity();
  const attempts = await Promise.all(
    Array.from({ length: 5 }, () =>
      api(host, "/rooms", "POST", {
        createKey,
        name: "Asha",
        civ: "indus-valley",
      }),
    ),
  );
  const codes = [...new Set(attempts.map((a) => a.body?.roomId).filter(Boolean))];
  check(
    "five simultaneous creates make exactly one room",
    codes.length === 1,
    `${codes.length} distinct: ${codes.join(", ") || "(none returned)"}`,
  );
  check(
    "and every one of them succeeded",
    attempts.every((a) => a.status === 200),
    attempts.map(said).join(" | "),
  );
  check(
    "the room has exactly one player seated",
    attempts.every((a) => a.body?.players?.filter((p) => p.joined).length === 1),
    attempts.map((a) => JSON.stringify(a.body?.players?.filter((p) => p.joined).length)).join(","),
  );

  /* --- but a new game is still a new game --------------------------------
     The key is thrown away once a game exists, so "Start over" and create
     again has to land somewhere else. If this did not, nobody could ever play
     twice. */

  const second = await api(host, "/rooms", "POST", {
    createKey: identity(),
    name: "Asha",
    civ: "aztec",
  });
  check(
    "the same browser can still start a second game",
    second.status === 200 && second.body?.roomId && second.body.roomId !== codes[0],
    said(second),
  );
  check("and it is a different room", second.body?.roomId !== codes[0], `${codes[0]} vs ${second.body?.roomId}`);

  const missingRoom = await api(host, "/rooms/0000");
  check(
    "a room that does not exist is refused",
    missingRoom.status === 404,
    said(missingRoom),
  );

  const keyless = await api(host, "/rooms", "POST", { name: "Asha", civ: "aztec" });
  check("a create with no key is refused", keyless.status === 400, said(keyless));

  const created = attempts[0];
  const body = created.body;
  if (body?.roomId) {
    const code = body.roomId;
    check("the room id is four digits", /^[1-9][0-9]{3}$/.test(code), code);
    check("the creator holds seat 1", body.seat === 0, `seat ${body.seat}`);
    check(
    "the second player is reserved, not seated",
    body.players?.[1]?.joined === false,
    said(created),
  );
  check(
    "and the lobby seats nobody in it, because they fill it in themselves",
    body.players?.[1]?.name === null && body.players?.[1]?.civ === null,
    JSON.stringify(body.players?.[1]),
  );
    check("no board is invented", body.board === null, JSON.stringify(body.board));

    const readBack = await api(host, `/rooms/${code}`);
    check("the room reads back", readBack.status === 200 && readBack.body?.roomId === code, said(readBack));

    const link = await get(`${GAME}/?room=${code}`);
    const linkHtml = authorContent(await link.text());
    check(
      "a share link serves the game",
      link.ok && linkHtml.includes("Samrajya Kalchakra"),
      `status ${link.status}`,
    );

    // The same link in its other shape. A number in the path is read out of the
    // address by the page, so the Worker has to serve the game for it rather
    // than answer with a 404.
    const path = await get(`${GAME}/${code}`);
    const pathHtml = authorContent(await path.text());
    check(
      "and so does the same number in the path",
      path.ok && pathHtml.includes("Samrajya Kalchakra"),
      `status ${path.status}`,
    );

    // The rules the two setup screens lean on, tried in the order a player
    // meets them.
    const noName = await api(guest, `/rooms/${code}/join`, "POST", { name: "", civ: "aztec" });
    check("an empty name is refused", noName.status === 409 && noName.body?.code === "NAME_REQUIRED", said(noName));

    const badCiv = await api(guest, `/rooms/${code}/join`, "POST", { name: "Vikram", civ: "roman-empire" });
    check("an unknown civilization is refused", badCiv.status === 409 && badCiv.body?.code === "CIV_REQUIRED", said(badCiv));

    // No identity header at all - a caller who has not got one.
    const noIdentity = await fetch(`${API}/rooms/${code}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "samrajya-verify/1.0" },
      body: JSON.stringify({ name: "Vikram", civ: "aztec" }),
    });
    check(
      "a seat cannot be claimed without an identity",
      noIdentity.status === 400,
      `status ${noIdentity.status} ${(await noIdentity.text()).slice(0, 80)}`,
    );

    const taken = await api(guest, `/rooms/${code}/join`, "POST", { name: "Vikram", civ: "indus-valley" });
    check("a civilization already held is refused", taken.status === 409 && taken.body?.code === "CIV_TAKEN", said(taken));

    const joined = await api(guest, `/rooms/${code}/join`, "POST", { name: "Vikram", civ: "mesopotamian" });
    check("the second player can join", joined.status === 200 && joined.body?.seat === 1, said(joined));
    check("both players are now seated", joined.body?.players?.every((p) => p.joined) === true, said(joined));

    // What a refresh does: the same browser, again. It must get its seat back,
    // not a refusal and certainly not a second one.
    const rejoin = await api(guest, `/rooms/${code}/join`, "POST", { name: "Vikram", civ: "mesopotamian" });
    check(
      "a refresh does not take a second seat",
      rejoin.status === 200 && rejoin.body?.players?.length === 2 && rejoin.body?.seat === 1,
      said(rejoin),
    );

    const third = await api(stranger, `/rooms/${code}/join`, "POST", { name: "Third", civ: "aztec" });
    check("a third player is refused", third.status === 409 && third.body?.code === "ROOM_FULL", said(third));

    // Four digits are typed by hand, so a number nobody is sitting at is an
    // ordinary mistake. It must say so, not fail at the far end. A few
    // candidates, because any one of them could in principle be a live table.
    let nowhere = null;
    for (const empty of ["1000", "2000", "3000"]) {
      const attempt = await api(stranger, `/rooms/${empty}/join`, "POST", {
        name: "Third",
        civ: "aztec",
      });
      if (attempt.status === 404) {
        nowhere = attempt;
        break;
      }
    }
    check(
      "a number nobody is sitting at says so",
      nowhere?.status === 404 && nowhere?.body?.code === "NO_ROOM",
      said(nowhere || {}),
    );

    const peek = await api(stranger, `/rooms/${code}`);
    check(
      "a stranger can read the room but holds no seat",
      peek.status === 200 && peek.body?.seat === null,
      said(peek),
    );
  }

  /* --- the live channel ---------------------------------------------------- */

  section("The live channel");

  check(
    "the live endpoint refuses anything that is not a socket",
    (await api(identity(), `/rooms/${codes[0]}/live`)).status === 426,
    "a plain GET must not be answered as a socket",
  );
  check(
    "the live endpoint refuses a room that does not exist",
    (await api(identity(), "/rooms/0000/live")).status === 404,
    "not a socket to begin with, but the room is gone either way",
  );

  let liveCode = null;
  if (codes[0]) {
    // A room of its own. The room above has two players in it by now, and
    // asking a full room to prove it can push is asking the wrong thing.
    const live = await api(identity(), "/rooms", "POST", {
      createKey: identity(),
      name: "Watcher",
      civ: "indus-valley",
    });
    liveCode = live.body?.roomId || null;
    check("a fresh room for the live channel", live.status === 200 && !!liveCode, said(live));
  }

  if (liveCode) {
    // One socket, one room. The second player joins by HTTPS and the watcher
    // must be handed the new state without anybody asking for it.
    const watcher = await openSocket(`/rooms/${liveCode}/live`);
    const arriving = watcher.first();
    const onConnect = await arriving;

    check("a socket is accepted and sent the room", onConnect?.type === "state", JSON.stringify(onConnect)?.slice(0, 120));
    check(
      "and it is this room",
      onConnect?.room?.roomId === liveCode,
      onConnect?.room?.roomId,
    );
    check(
      "and no seat, because a socket cannot identify itself",
      onConnect?.room?.seat === null,
      `seat ${onConnect?.room?.seat}`,
    );
    check(
      "and the second seat is still an empty chair",
      onConnect?.room?.players?.[1]?.joined === false,
      JSON.stringify(onConnect?.room?.players?.[1]),
    );

    const latecomer = await api(identity(), `/rooms/${liveCode}/join`, "POST", {
      name: "Joiner",
      civ: "ancient-egyptian",
    });
    check("the join went over HTTPS", latecomer.status === 200, said(latecomer));

    const push = await Promise.race([watcher.first(), sleep(5000).then(() => ({ timedOut: true }))]);
    check(
      "and the join is pushed down the socket",
      !push?.timedOut && push?.room?.players?.[1]?.joined === true,
      push?.timedOut ? `nothing arrived in 5s (${watcher.reason()})` : JSON.stringify(push?.room?.players).slice(0, 140),
    );

    watcher.close();
  }

  /* ----------------------------------------------- the rest of the domain */
  if (!REAL_DOMAIN) {
    section("The rest of the site");
    console.log("  --    skipped: this is a preview host, not golake.app");
    console.log("         (run against https://golake.app to check them)\n");
  } else {
    await theRestOfTheSite();
  }

  await theWelcomeScreen();

  report();
}

/**
 * The welcome screen, against the capture that was approved.
 *
 * Checked here rather than left as a hash written in the README, because this
 * phase changed the same client that draws the board on the same page, and a
 * hash nobody recomputes is a memory rather than a guarantee. The three-way
 * comparison - authored source, stored capture, live page - lives in
 * welcome-baseline.js so it can also be run on its own.
 */
async function theWelcomeScreen() {
  section("The welcome screen");

  let baseline;
  try {
    baseline = JSON.parse(await readFile(join(PROJECT, "welcome-baseline.json"), "utf8"));
  } catch {
    check("there is an approved capture to compare against", false, "run save first");
    return;
  }

  const sha = (s) => createHash("sha256").update(s).digest("hex").toUpperCase();
  const source = authorContent(await readFile(join(PROJECT, "authored", "samrajya", "index.html"), "utf8"));
  const live = authorContent(await (await get(`${BASE}/samrajya/`)).text());

  check(
    "the welcome screen is still the one that was approved",
    sha(source) === baseline.approved,
    `source ${sha(source).slice(0, 16)}`,
  );
  check(
    "and it is what was deployed",
    sha(live) === baseline.approved,
    `live ${sha(live).slice(0, 16)}`,
  );
}

/** Only the real domain hosts GoLake and Strand, so only it can be checked. */
async function theRestOfTheSite() {
  console.log("\nThe rest of the site\n");

  const root = await get(`${BASE}/`);
  const rootHtml = authorContent(await root.text());
  check("the GoLake home page still loads", root.ok, `status ${root.status}`);
  check("it is still The Lake Foundation", rootHtml.includes("The Lake Foundation"));
  check("Strand is still linked", rootHtml.includes("/strand"));

  // The Samrajya card must now be a link, and must point at the game.
  const card = rootHtml.match(/<h2 class="card__title">([\s\S]*?)<\/h2>/g) || [];
  const samrajyaCard = card.find((c) => /Samrajya/.test(c));
  check("the Samrajya card is a link", /<a class="card__link" href="\/samrajya\/">/.test(samrajyaCard || ""), (samrajyaCard || "").replace(/\s+/g, " ").trim());

  const strand = await get(`${BASE}/strand/`);
  check("Strand is still there", strand.ok, `status ${strand.status}`);

  const css = await get(`${BASE}/assets/css/site.css`);
  check("the GoLake stylesheet is still served", css.ok);

  const water = await get(`${BASE}/water/`);
  check("Water is still unlinked, as it was", water.status === 404, `status ${water.status}`);
}

function report() {
  console.log(`\n${"=".repeat(46)}`);
  if (failed === 0) {
    console.log(`all ${passed} checks passed\n`);
    process.exit(0);
  }
  console.log(`${passed} passed, ${failed} failed\n`);
  for (const line of failures) console.log(`  - ${line}`);
  console.log("");
  process.exit(1);
}

main().catch((error) => {
  console.error("\nthe check itself failed:", error);
  process.exit(1);
});
