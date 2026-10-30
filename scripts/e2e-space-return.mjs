/* ==========================================================================
   SECOND LANDING ON OUTER SPACE - automated reproduction

   The reported production sequence, driven end to end through the REAL
   client (create/join/start, real mouse clicks, real action pipeline):

     land at Outer Space -> buy a suit -> (used mode: spend the discount on
     a purchase) -> walk a full circuit -> land at Outer Space again ->
     the counter must appear AND its buttons must actually finish the turn.

   Run against a local wrangler dev with the preview env (?test=1 rooms,
   Test engine throws) - the same way scripts/e2e.js is run:

     npx wrangler dev --env preview --port 8791   (one terminal)
     npm run test:space                            (another)
     REPRO_URL=http://host npm run test:space      (or any base URL)

   Exits non-zero on the freeze, dumping the state, the card on screen,
   and every page error. REPRO_ONLY=buy-unused limits the run to one
   scenario; REPRO_WATCH=1 prints a per-frame DOM/state trace.
   ========================================================================== */
import { launch, sleep } from "./lib/browser.mjs";
import { CELLS } from "../shared/spaces.js";

const BASE = process.env.REPRO_URL || "http://127.0.0.1:8791";
const URL_ = `${BASE}/samrajya/?test=1`;
const OUTER = CELLS.findIndex((c) => c.id === "outer-space");

/* ------------------------------------------------------------------ state */

const probe = (page) =>
  page.json(`
    const b = document.querySelector(".board");
    const g = b?.game;
    const card = document.querySelector(".board__card");
    return {
      board: !!b,
      phase: g?.phase ?? null,
      active: g?.active ?? null,
      landing: g?.landing ? g.landing.kind : null,
      space: g?.space
        ? { phase: g.space.phase, expired: g.space.expired || null, notice: !!g.space.expiredNotice }
        : null,
      suits: g?.suits ? JSON.stringify(g.suits) : null,
      position: g?.pieces ? g.pieces.find((p) => p.seat === 0)?.position ?? null : null,
      cardKind: card ? card.dataset.cardKind || "" : "",
      cardHidden: card ? !!card.hidden : true,
      cardText: card && !card.hidden
        ? (card.innerText || "").replace(/\\n+/g, " | ").slice(0, 160)
        : "",
      /* The FULL text, untruncated: a stage that stacks its redraw under the
         original (the pre-fix space card) puts the popup's words beyond the
         first 160 characters, and a wait that only reads the head would hang
         on a popup that is physically on the page. */
      cardFull: card && !card.hidden ? (card.innerText || "").replace(/\\n+/g, " | ") : "",
    };
  `);

async function waitFor(page, label, fn, ms = 30000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await probe(page).catch(() => null);
    if (last && (await fn(last))) return last;
    await sleep(250);
  }
  throw new Error(
    `TIMEOUT ${label}\n  state=${JSON.stringify(last)}\n  pageErrors=${page.errors() || "(none)"}`,
  );
}

/* Real mouse events, the way the repo's e2e clicks: coordinates, not .click(). */
const tap = async (page, selector, label) => {
  /* THE BOARD REFUSES EVERYTHING WHILE BUSY - during the walk, the card's
     entrance, the announcements. A tap inside that window is swallowed with
     no error and no action, exactly as a too-fast human tap is. So every
     press waits for the board's own gate to lift first. */
  await waitFor(page, `board free (${label || selector})`, async (s) => {
    const busy = await page.eval(`document.querySelector(".board")?.dataset.busy || "true"`);
    return busy === "false";
  }, 20000);
  const box = await page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!box) throw new Error(`tap ${label || selector}: element not found`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", {
      type, x: box.x, y: box.y, button: "left", clickCount: 1,
    });
  }
};

const tapText = (page, text, tag) => page.clickText(text, tag);

/** A text press on the board: waits for the busy gate first (see `tap`). */
const press = async (page, text, tag, label) => {
  await waitFor(page, `board free (${label || text})`, async () => {
    const busy = await page.eval(`document.querySelector(".board")?.dataset.busy || "true"`);
    return busy === "false";
  }, 20000);
  if (!(await page.clickText(text, tag))) {
    const inventory = await page.json(`
      const card = document.querySelector(".board__card");
      const g = document.querySelector(".board")?.game;
      return {
        phase: g?.phase ?? null,
        space: g?.space ? JSON.stringify(g.space) : null,
        holderChildren: card ? card.children.length : -1,
        cardKinds: card ? [...card.children].map((c) => c.className).join(" + ") : "",
        buttons: card ? [...card.querySelectorAll("button")].map((b) =>
          (b.dataset.action || "?") + ":" + (b.textContent || "").trim().slice(0, 12)).join(", ") : "",
        html: card ? card.innerHTML.slice(0, 300) : "",
      };
    `);
    throw new Error(
      `press ${label || text}: no such button\n  ${JSON.stringify(inventory)}\n` +
      `  pageErrors=${page.errors() || "(none)"}`,
    );
  }
};

const play = async (page, action) => {
  const res = await page.json(`
    const b = document.querySelector(".board");
    if (!b || !b.play) return "no-board";
    b.play(${JSON.stringify(action)});
    return "ok";
  `);
  if (res !== "ok") throw new Error(`play ${action.type}: ${res}`);
};

/** The smallest die face that lands on a property from `pos`. */
function propertyStepsFrom(pos) {
  for (let f = 1; f <= 6; f += 1) {
    if (CELLS[(pos + f) % 28].type === "property") return f;
  }
  return 1;
}

/* ------------------------------------------------------------------ setup */

async function setup() {
  /* One port pair per scenario: two launches that race the previous
     scenario's shutdown on the SAME ports fail to open the debugging port. */
  setup.n = (setup.n || 0) + 1;
  const portA = 9831 + setup.n * 2;
  const chromeA = await launch({ port: portA });
  const chromeB = await launch({ port: portA + 1 });
  const A = await chromeA.newPage();
  await A.setViewport(390, 844, 2, true);
  await A.goto(URL_);
  const B = await chromeB.newPage();
  await B.setViewport(390, 844, 2, true);
  await B.goto(URL_);

  /* The host creates a TEST room, exactly as scripts/e2e.js does. */
  if (!(await tapText(A, "create"))) throw new Error("no create button: " + A.errors());
  await sleep(600);
  await A.json(`
    const input = document.querySelector("input.field__input");
    const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    write.call(input, "Aster");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `);
  await sleep(200);
  if (!(await A.json(`const c = document.querySelector('.civ[data-civ="indus-valley"]'); if (c) c.click(); return !!c;`)))
    throw new Error("no civilization button");
  await sleep(200);
  await tapText(A, "create");
  await sleep(1500);

  let code = "";
  for (let i = 0; i < 60 && !code; i += 1) {
    const invite = await A.eval(`(document.querySelector("#invite") || {}).value || ""`);
    code = (invite.match(/room=([0-9]+)/) || [])[1] || "";
    if (!code) await sleep(250);
  }
  if (!code) throw new Error("no room code: " + A.errors());

  /* The guest joins by code, as a person with the code would. */
  if (!(await tapText(B, "join"))) throw new Error("no join button: " + B.errors());
  await sleep(700);
  await B.json(`
    const i = document.querySelector("input[name=code]");
    const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    write.call(i, ${JSON.stringify(code)});
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  `);
  await sleep(250);
  await tapText(B, "next");
  await sleep(900);
  await B.json(`
    const input = document.querySelector("input.field__input");
    const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    write.call(input, "Vega");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `);
  await sleep(200);
  await B.json(`const c = document.querySelector('.civ[data-civ="aztec"]'); if (c) c.click(); return !!c;`);
  await sleep(200);
  await tapText(B, "join");
  await sleep(1500);

  await waitFor(A, "start offered", async () =>
    A.eval(`(() => { const b = document.querySelector(".panel .btn--primary"); return !!b && !b.disabled && /start/i.test(b.textContent); })()`));
  await tapText(A, "start");
  await waitFor(A, "board up", (s) => s.board && s.phase === "AWAITING_ROLL" && s.active === 0);
  await waitFor(B, "board up (watcher)", (s) => s.board && s.phase !== null);
  return { A, B, chromeA, chromeB, code };
}

/* ------------------------------------------------------------------ turns */

/** The opponent's turn: one small throw onto a property, then the pass pill. */
async function opponentTurn(B) {
  await play(B, { type: "testRoll", steps: 1 });
  await waitFor(B, "opponent decides", (s) =>
    s.phase === "DECISION" || (s.active === 0 && s.phase === "AWAITING_ROLL"));
  const s = await probe(B);
  if (s.phase === "DECISION") {
    await tap(B, ".property-card__next", "pass pill");
  }
  await waitFor(B, "turn back to the host", (s2) => s2.active === 0 && s2.phase === "AWAITING_ROLL");
}

/* --------------------------------------------------------------- scenarios */

async function runScenario(mode, { withRefresh }) {
  const { A, B, chromeA, chromeB } = await setup();
  const tag = `${mode}${withRefresh ? " +refresh" : ""}`;
  const log = [`=== ${tag} ===`];
  try {
    /* 1. First landing at Outer Space. */
    await play(A, { type: "testRoll", steps: OUTER });
    const first = await waitFor(A, "first counter", (s) =>
      s.phase === "DECISION" && s.landing === "space" && s.cardKind === "space" && !s.cardHidden);
    log.push(`first landing: card="${first.cardText}"`);

    /* The watcher must see the same screen, read-only. */
    const watcher = await waitFor(B, "watcher sees counter", (s) => s.cardKind === "space" && !s.cardHidden);
    const disabled = await B.eval(`(() => {
      const b = document.querySelector('button[data-action="acquire"]');
      return b ? String(b.disabled) : "missing";
    })()`);
    log.push(`watcher: acquire disabled=${disabled} card="${watcher.cardText.slice(0, 60)}"`);
    if (disabled !== "true") throw new Error("a watcher can press the counter - it must be read-only");

    if (mode === "never") {
      /* Decline: the X must finish the visit. */
      await press(A, "\u00d7", 'button[data-action="continue"]', "decline X");
      await waitFor(A, "decline ends the turn", (s) => s.active === 1 && s.phase === "AWAITING_ROLL");
      log.push("declined the counter: the turn ended");
      await opponentTurn(B);
    } else {
      /* 2. Buy the suit - the purchase the report says always worked. */
      await press(A, "Acquire suit", 'button[data-action="acquire"]', "acquire");
      if (process.env.REPRO_WATCH) {
        for (let i = 0; i < 16; i += 1) {
          const s = await A.json(`
            const b = document.querySelector(".board");
            const g = b?.game;
            const card = document.querySelector(".board__card");
            const ann = document.querySelector(".announce");
            return {
              phase: g?.phase ?? null,
              busy: b?.dataset.busy ?? "",
              space: g?.space ? JSON.stringify(g.space) : null,
              cardKind: card ? card.dataset.cardKind : "",
              stageKey: card ? card.dataset.stageKey || "" : "",
              hidden: card ? !!card.hidden : true,
              head: card && !card.hidden ? (card.querySelector("h3")?.innerText || "").slice(0, 40) : "",
              btns: card && !card.hidden
                ? [...card.querySelectorAll("button")].map((x) => (x.dataset.action || "?")).join(",")
                : "",
              announcing: ann ? ann.className : "",
            };
          `);
          console.log(`  watch t+${(i * 0.5).toFixed(1)}s ${JSON.stringify(s)}`);
          await sleep(500);
        }
      }
      const acquired = await waitFor(A, "acquisition popup", (s) => /ACQUIRED/i.test(s.cardFull));
      log.push(`suit acquired: "${acquired.cardText.slice(0, 80)}" suits=${acquired.suits}`);
      /* THE POPUP'S CTA, OR THE X THAT DOES THE SAME JOB. Post-fix the popup
         REPLACES the card and its CTA is the only continue. Pre-fix (the
         stacking build) the popup is appended below the fold, and the
         visible selection X is the press that actually ends the visit -
         the same `continue` to the server either way. */
      const ctaVisible = await A.eval(`(() => {
        const b = [...document.querySelectorAll('button[data-action="continue"]')]
          .find((x) => /continue journey/i.test(x.textContent || ""));
        if (!b) return false;
        const r = b.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      })()`);
      if (ctaVisible) {
        await press(A, "Continue journey", 'button[data-action="continue"]', "popup CTA");
      } else {
        await press(A, "\u00d7", 'button[data-action="continue"]', "X (popup below the fold)");
      }
      await waitFor(A, "turn ends after the purchase", (s) => s.active === 1 && s.phase === "AWAITING_ROLL");
      log.push("suit purchased, turn handed over");
      await opponentTurn(B);

      if (mode === "buy-used") {
        /* Spend the discount for real: buy a property on the way. */
        const at = await probe(A);
        const steps = propertyStepsFrom(at.position);
        await play(A, { type: "testRoll", steps });
        await waitFor(A, "buy decision", (s) => s.phase === "DECISION" && s.landing === "buy");
        await press(A, "Buy", ".property-card__buy", "buy pill");
        await waitFor(A, "bought, turn over", (s) => s.active === 1 && s.phase === "AWAITING_ROLL");
        const suits = await A.eval(`JSON.stringify(document.querySelector(".board").game.suits)`);
        log.push(`discount consumed by a real purchase: suits=${suits}`);
        await opponentTurn(B);
      }
    }

    /* 3. The full circuit back to Outer Space - computed from where the
       player actually stands (the buy-used detour moved them off the
       start-relative position a plain 28 would assume). */
    const atNow = await probe(A);
    const back = (OUTER - atNow.position + 28) % 28 || 28;
    await play(A, { type: "testRoll", steps: back });
    const second = await waitFor(A, "second counter", (s) =>
      s.phase === "DECISION" && s.landing === "space" && s.cardKind === "space" && !s.cardHidden);
    log.push(`SECOND LANDING: ${JSON.stringify({ space: second.space, suits: second.suits })}`);
    log.push(`second card: "${second.cardText}"`);
    if (process.env.REPRO_WATCH) {
      for (let i = 0; i < 24; i += 1) {
        const s = await A.json(`
          const card = document.querySelector(".board__card");
          const g = document.querySelector(".board")?.game;
          const b = document.querySelector(".board");
          return {
            busy: b?.dataset.busy || "",
            space: g?.space ? JSON.stringify(g.space) : null,
            kids: card ? card.children.length : -1,
            kidClasses: card ? [...card.children].map((c) => c.className).join("+") : "",
            buttons: card ? [...card.querySelectorAll("button")].map((x) =>
              (x.dataset.action || "?") + ":" + (x.textContent || "").trim().slice(0, 10)).join(", ") : "",
            head: card ? (card.querySelector("h3")?.innerText || "").slice(0, 44) : "",
          };
        `);
        console.log(`  2nd t+${(i * 0.3).toFixed(1)}s ${JSON.stringify(s)}`);
        await sleep(300);
      }
    }

    if (withRefresh) {
      await A.goto(URL_);
      const back = await waitFor(A, "counter after refresh", (s) =>
        s.phase === "DECISION" && s.landing === "space" && s.cardKind === "space" && !s.cardHidden, 40000);
      log.push(`refresh: the counter came back ("${back.cardText.slice(0, 70)}")`);
    }

    /* 4. THE CRITICAL SEQUENCE: every face this card can wear must lead to a
       press that finishes the visit. The expiry notice (local) first, when
       this visit has one; then the counter's own X - THE press the production
       bug left dead. */
    if (await A.eval(`!!document.querySelector('button[data-action="notice-continue"]')`)) {
      await press(A, "Continue", 'button[data-action="notice-continue"]', "notice continue");
      if (process.env.REPRO_WATCH) {
        for (let i = 0; i < 20; i += 1) {
          const s = await A.json(`
            const card = document.querySelector(".board__card");
            const g = document.querySelector(".board")?.game;
            return {
              space: g?.space ? JSON.stringify(g.space) : null,
              kids: card ? card.children.length : -1,
              kidClasses: card ? [...card.children].map((c) => c.className).join("+") : "",
              buttons: card ? [...card.querySelectorAll("button")].map((b) =>
                (b.dataset.action || "?") + ":" + (b.textContent || "").trim().slice(0, 10)).join(", ") : "",
              head: card ? (card.querySelector("h3")?.innerText || "").slice(0, 40) : "",
            };
          `);
          console.log(`  2nd t+${(i * 0.3).toFixed(1)}s ${JSON.stringify(s)}`);
          await sleep(300);
        }
      }
      await waitFor(A, "notice yields to the counter", (s) =>
        /outer space|suit|acquire/i.test(s.cardFull) && !s.cardHidden);
      log.push("expiry notice dismissed -> the counter is underneath");
    }

    const before = await probe(A);
    await press(A, "\u00d7", 'button[data-action="continue"]', "THE counter X");
    const after = await waitFor(
      A,
      "the X finishes the visit and hands the turn over",
      (s) => s.active === 1 && s.phase === "AWAITING_ROLL",
      25000,
    ).catch(async (err) => {
      const now = await probe(A).catch(() => null);
      throw new Error(
        `${err.message}\n  BEFORE=${JSON.stringify(before)}\n  NOW=${JSON.stringify(now)}\n` +
        `  pageErrors=${A.errors() || "(none)"}`,
      );
    });
    log.push(`THE VISIT RESOLVED: active=${after.active} phase=${after.phase}`);
    log.push(`page errors: ${A.errors() || "(none)"}`);
    return { ok: true, tag, log };
  } finally {
    await chromeA.close().catch(() => {});
    await chromeB.close().catch(() => {});
  }
}

const ALL = [
  { mode: "buy-unused", withRefresh: false },
  { mode: "buy-unused", withRefresh: true },
  { mode: "buy-used", withRefresh: false },
  { mode: "never", withRefresh: false },
];
const SCENARIOS = process.env.REPRO_ONLY
  ? ALL.filter((s) => s.mode === process.env.REPRO_ONLY)
  : ALL;

let failed = 0;
for (const s of SCENARIOS) {
  try {
    const { log } = await runScenario(s.mode, { withRefresh: s.withRefresh });
    for (const line of log) console.log(line);
  } catch (err) {
    failed += 1;
    console.log(`=== ${s.mode}${s.withRefresh ? " +refresh" : ""}: FAILED ===`);
    console.log(String(err && err.message));
  }
}
console.log(failed === 0 ? "ALL SCENARIOS PASSED" : `${failed} SCENARIO(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
