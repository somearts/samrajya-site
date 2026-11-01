/* ==========================================================================
   THE GAME ON A PHONE - mobile layout, touch, and resilience

   Every stage of the board is driven through the real client at three phone
   sizes with touch emulation, screenshotted, and measured against the rules a
   phone imposes: a 34px target, 8px between targets, 10px type, nothing off
   the bottom of the screen, nothing clipped, nothing scrolling sideways - and,
   for the card, that it is a popup on the board rather than a sheet over the
   glass: centred on the board, inside it, leaving it visible round the edges,
   with no dark wash anywhere behind it. The 44px/14px scale it used to assert
   belongs to a full-screen sheet; the card is the board's own hole now, and
   the primary presses inside it are still 44px.

   It also does the things a phone does to a page - refresh in the middle of a
   turn, sit in the background, lose the network, tap twice - and checks that
   the board comes back with the same card and that one tap is one action.

     npx wrangler dev --env preview --port 8791     (one terminal)
     node scripts/e2e-mobile.mjs                   (another)

   PHASE=before writes the screenshots the fixes are measured against;
   PHASE=after (the default) also asserts that the rules hold. SHOTS=<dir>
   changes the output root. VIEWPORTS=360x640,390x844 runs a subset.
   ========================================================================== */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { CELLS } from "../shared/spaces.js";
import { SUITS } from "../shared/suits.js";
import {
  audit,
  probe,
  summarise,
  tap,
  tapControl,
  tapText,
  tapWhenFree,
  waitFor,
} from "./lib/mobile.mjs";

const BASE = process.env.MOBILE_URL || "http://127.0.0.1:8791";
const URL_ = `${BASE}/samrajya/?test=1`;
const PHASE = process.env.PHASE || "after";
const SHOTS = process.env.SHOTS || `mobile-shots/${PHASE}`;
const OUTER = CELLS.findIndex((cell) => cell.id === "outer-space");

const VIEWPORTS = (process.env.VIEWPORTS || "360x640,390x844,412x915")
  .split(",")
  .map((pair) => {
    const [w, h] = pair.split("x").map(Number);
    return { name: pair, w, h };
  });

/* The safe areas a modern phone claims: a notch at the top and a home
   indicator at the bottom. A 640px-tall phone is the pre-notch Android size,
   so it is tested without them; the two modern sizes are where they bite. */
const insetsFor = (viewport) =>
  viewport.h >= 700 ? { top: 44, bottom: 34 } : { top: 0, bottom: 0 };

const results = [];
const failures = [];

/* --------------------------------------------------------------- utilities */

async function setPhone(page, viewport) {
  await page.setViewport(viewport.w, viewport.h, 3, true);
  await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
}

async function simulateSafeArea(page, insets) {
  await page.json(`
    document.documentElement.style.setProperty("--safe-top", "${insets.top}px");
    document.documentElement.style.setProperty("--safe-bottom", "${insets.bottom}px");
    return true;
  `);
}

/* Re-applied on every navigation: a reload is a new document, and the phone's
   safe areas and the request log have to survive it or the refresh tests would
   be measuring a page that is not the page a player gets. */
async function installSafeArea(page, insets) {
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      (() => {
        const apply = () => {
          if (!document.documentElement) return false;
          document.documentElement.style.setProperty("--safe-top", ${JSON.stringify(`${insets.top}px`)});
          document.documentElement.style.setProperty("--safe-bottom", ${JSON.stringify(`${insets.bottom}px`)});
          return true;
        };
        if (!apply()) {
          const watch = new MutationObserver(() => { if (apply()) watch.disconnect(); });
          watch.observe(document, { childList: true, subtree: true });
        }
      })();
    `,
  });
}

async function installInstrument(page) {
  await page.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      (() => {
        window.__sent = [];
        const real = window.fetch;
        window.fetch = (...args) => {
          try {
            const url = String(args[0]);
            const body = args[1] && args[1].body;
            if (url.includes("/action") && body) window.__sent.push(JSON.parse(body));
          } catch { /* not ours */ }
          return real(...args);
        };
      })();
    `,
  });
}

/** A reload with everything the test injected put back. */
async function reload(page) {
  await page.goto(URL_);
  await simulateSafeArea(page, page.__insets || { top: 0, bottom: 0 });
  await sleep(150);
}

const actionsSent = (page) => page.eval(`(window.__sent || []).map((a) => a.type).join(",")`);

/* A visible heartbeat. The long waits in this file are measured in tens of
   seconds, and when one of them goes quiet the only useful question is which
   line went quiet - so each phase says when it starts. */
const mark = (label) => console.log(`  .. ${label}`);

/* The fault the draw-failure stage throws on purpose. The board reports it on
   the console just as it would report a real one, so the page-error check has
   to be told which single error was asked for. */
const INJECTED_FAULT = /test: the decision draw threw/;

/* In the before pass the same checks are still measured and printed - they are
   the defects the fixes are measured against - but a failure there is evidence,
   not a gate: the run carries on so the rest of the screens can be recorded. */
function assert(condition, message) {
  if (condition) return;
  if (PHASE === "before") {
    console.log(`  (before) ${message}`);
    return;
  }
  throw new Error(message);
}

async function settle(page, ms = 450) {
  await sleep(ms);
  await waitFor(page, "board free", (s) => s.busy === "false", 20000).catch(() => {});
}

/** Fill a form field the way the page's own input event would. */
async function typeInto(page, selector, value) {
  await page.json(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    write.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  `);
}

async function waitForFree(page, timeout = 20000) {
  await waitFor(page, "board free", (s) => s.busy === "false", timeout);
}

/** Play a deterministic test move, exactly as the previous board e2e did. */
async function play(page, action) {
  const result = await page.json(`
    const b = document.querySelector(".board");
    if (!b || !b.play) return "no-board";
    b.play(${JSON.stringify(action)});
    return "ok";
  `);
  if (result !== "ok") throw new Error(`play ${action.type}: ${result}`);
}

function propertyStepsFrom(position) {
  for (let face = 1; face <= 6; face += 1) {
    if (CELLS[(position + face) % 28].type === "property") return face;
  }
  return 1;
}

/* ------------------------------------------------------------------ setup */

let gameNumber = 0;

async function setup(viewport) {
  gameNumber += 1;
  const portA = 9940 + gameNumber * 4;
  const chromeA = await launch({ port: portA });
  const chromeB = await launch({ port: portA + 1 });
  const A = await chromeA.newPage();
  const B = await chromeB.newPage();
  const insets = insetsFor(viewport);
  A.__insets = insets;
  B.__insets = insets;
  await setPhone(A, viewport);
  await setPhone(B, viewport);
  await installSafeArea(A, insets);
  await installSafeArea(B, insets);
  await installInstrument(A);
  await installInstrument(B);
  await A.goto(URL_);
  await B.goto(URL_);
  await simulateSafeArea(A, insets);
  await simulateSafeArea(B, insets);

  await tapText(A, "create game");
  await typeInto(A, "input.field__input", "Aster");
  await tap(A, '.civ[data-civ="indus-valley"]');
  await tapText(A, "create game");
  await sleep(1200);

  let code = "";
  for (let i = 0; i < 80 && !code; i += 1) {
    const invite = await A.eval(`(document.querySelector("#invite") || {}).value || ""`);
    code = (invite.match(/room=([0-9]+)/) || [])[1] || "";
    if (!code) await sleep(200);
  }
  if (!code) throw new Error("no room code: " + A.errors());

  await tapText(B, "join game");
  await typeInto(B, 'input[name="code"]', code);
  await tapText(B, "next");
  await sleep(500);
  await typeInto(B, "input.field__input", "Vega");
  await tap(B, '.civ[data-civ="aztec"]');
  await tapText(B, "join game");
  await sleep(1200);

  await waitFor(A, "start offered", async () => {
    const can = await A.eval(`(() => {
      const b = document.querySelector(".panel .btn--primary");
      return !!b && !b.disabled && /start/i.test(b.textContent);
    })()`);
    return can;
  });
  await tapText(A, "start game");
  await waitFor(A, "board up", (s) => s.board && s.phase === "AWAITING_ROLL" && s.active === 0);
  await waitFor(B, "watcher board up", (s) => s.board && s.phase !== null);
  await settle(A);
  await settle(B);
  return { A, B, chromeA, chromeB, code };
}

/* --------------------------------------------------------------- recording */

async function capture(page, viewport, name, extra = {}) {
  await settle(page);
  const report = await audit(page);
  const dir = join(SHOTS, viewport.name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${name}.png`), await page.screenshot());
  /* The record keeps the honest error list: everything the page threw, minus
     the one fault the draw-failure stage injected on purpose - and it says
     when it took one out, so a reader of the JSON is not asked to trust that
     a blank list means a clean page. */
  const pageErrors = page.errors(INJECTED_FAULT) || "";
  const injectedFault = pageErrors !== (page.errors() || "");
  await writeFile(
    join(dir, `${name}.json`),
    JSON.stringify({ ...report, extra, pageErrors, injectedFault }, null, 2),
  );
  const line = summarise(`${viewport.name} ${name}`, report);
  console.log(line);
  results.push({ viewport: viewport.name, stage: name, report, extra });
  return report;
}

/** A rule failure, collected rather than thrown so one stage cannot hide the rest. */
function expectClean(label, report, { allowText = false, allowScroll = false } = {}) {
  const bad = [];
  if (report.darkOverlays?.length) bad.push(`${report.darkOverlays.length} dark overlay(s) over the board`);
  if (report.smallTargets.length) bad.push(`${report.smallTargets.length} target(s) under 34px`);
  if (report.offscreen.length) bad.push(`${report.offscreen.length} control(s) off screen`);
  if (report.adjacent.length) bad.push(`${report.adjacent.length} pair(s) closer than 8px`);
  if (!allowText && report.smallText.length) bad.push(`${report.smallText.length} text run(s) under 10px`);
  if (report.clipped.length) bad.push(`${report.clipped.length} clipped element(s)`);
  if (report.scroll.overflowX) bad.push("the page scrolls sideways");
  if (report.horizontalScrollers.length) bad.push("a box scrolls sideways");
  if (report.emptyCard) bad.push("the card is empty");
  if (!allowScroll && report.card?.clipped) bad.push("the card clips its content");
  /* The card is a popup on the board, not a sheet over the glass. These three
     are the promise the whole change exists for, so they are rules, not
     notes: it is centred on the board, it stays inside the board, and it
     leaves the board visible round it. */
  const g = report.card?.geometry;
  if (g) {
    if (g.position === "fixed") bad.push("the card is pinned to the glass");
    if (g.centre.dx > 2 || g.centre.dy > 2) {
      bad.push(`the card is off-centre (${g.centre.dx}px across, ${g.centre.dy}px down)`);
    }
    if (!g.insideBoard) bad.push("the card spills outside the board");
    if (g.coverage > 0.7) bad.push(`the card covers ${Math.round(g.coverage * 100)}% of the board`);
  }
  if (bad.length) {
    failures.push({ label, bad, report });
    console.log(`  !! ${label}: ${bad.join("; ")}`);
  }
}

/* ------------------------------------------------------------------ stages */

async function opponentTurn(B) {
  await waitForFree(B);
  const at = await probe(B);
  const steps = propertyStepsFrom(at.position ?? 0);
  await play(B, { type: "testRoll", steps });
  const state = await waitFor(B, "opponent decides", (s) =>
    (s.phase === "DECISION" && s.landing === "buy") ||
    (s.active === 0 && s.phase === "AWAITING_ROLL"));
  if (state.phase === "DECISION") {
    await tapWhenFree(B, ".property-card__next");
  }
  await waitFor(B, "turn back", (s) => s.active === 0 && s.phase === "AWAITING_ROLL");
  await settle(B);
}

/** Double-tap a control and prove the action ran once.
 *
 *  Two numbers are read, because they answer two different questions.
 *  `presses` is how many times the board accepted a press of that action, and
 *  it is the direct measure of the double-tap guard. `sent` is what went on the
 *  wire. They agree for every action except `continue`: a continue that ends a
 *  turn makes the board settle itself, and the settle sends a continue of its
 *  own. That one is the state machine talking, not the thumb - so the cascade
 *  is allowed for on the wire and never for the press. */
async function doubleTap(page, label, target, actionType, { options, cascades = false } = {}) {
  await waitForFree(page);
  const wire = (page2, type) =>
    page2.eval(`(window.__sent || []).filter((a) => a.type === ${JSON.stringify(type)}).length`);
  const pressesBefore = await page.eval(`(document.querySelector(".board")?.presses || []).length`);
  const before = await wire(page, actionType);

  /* THE BEFORE PASS PRESSES ONCE.

     A double-tap is a resilience test, and the client it is a test of is the
     one in the after pass. At HEAD a second press of Pass leaves the turn
     sitting on the same decision - the defect the guard fixes - so pressing
     twice here ends the before run at that card and loses every screenshot
     after it. The before pass is a layout baseline; it presses once, records
     what one press sends, and leaves the double-tap rule to the pass that can
     still walk to the end. */
  if (PHASE === "before") {
    const box = await tapControl(page, target, options);
    await sleep(900);
    const sent = (await wire(page, actionType)) - before;
    console.log(`  single tap ${label} (before): ${actionType} requests=${sent}`);
    return { presses: null, sent };
  }

  const first = await tapControl(page, target, options);
  await sleep(45);
  await tapControl(page, target, options).catch(() => null);
  await sleep(900);
  const after = await wire(page, actionType);
  const presses = await page.eval(
    `(document.querySelector(".board")?.presses || []).slice(${pressesBefore}).filter((a) => a === ${JSON.stringify(actionType)}).length`,
  );
  const sent = after - before;
  console.log(
    `  double-tap ${label}: ${actionType} presses=${presses} requests=${sent}` +
      `${cascades ? " (the turn's own settle continues once)" : ""}` +
      `${first.scrolled ? " (needed scrolling)" : ""}`,
  );
  assert(presses === 1, `double-tap ${label} accepted ${presses} presses, expected 1`);
  if (cascades) assert(sent >= 1 && sent <= 2, `double-tap ${label} sent ${sent} ${actionType} requests, expected 1 or 2`);
  else assert(sent === 1, `double-tap ${label} sent ${sent} ${actionType} requests, expected 1`);
  return { presses, sent };
}

async function runViewport(viewport) {
  console.log(`\n=== ${viewport.name} (${PHASE}) ===`);
  const { A, B, chromeA, chromeB } = await setup(viewport);
  try {
    /* The screen the player starts on: the board, their turn. */
    const yourTurn = await capture(A, viewport, "your-turn");
    expectClean(`${viewport.name} your-turn`, yourTurn);

    /* 1. Outer Space: a forced draw failure first, because a card that cannot
       be drawn must say so and offer a way back rather than leave an empty
       middle. Then the real selection. (The fault hook only exists in the
       fixed client, so the before pass records the selection alone.) */
    await waitForFree(A);
    if (PHASE === "after") {
      await A.json(`document.querySelector(".board").dataset.failDraw = "1"; return true;`);
    }
    await play(A, { type: "testRoll", steps: OUTER });
    if (PHASE === "after") {
      await waitFor(A, "draw fallback", (s) => s.cardKind === "fallback" && !s.cardHidden);
      await settle(A);
      const fallback = await capture(A, viewport, "draw-failure");
      expectClean(`${viewport.name} draw-failure`, fallback);

      await tapWhenFree(A, ".draw-failure__retry");
    }
    await waitFor(A, "space selection", (s) =>
      s.phase === "DECISION" && s.landing === "space" && s.cardKind === "space" && !s.cardHidden);
    await settle(A);
    const selection = await capture(A, viewport, "space-selection", { suits: SUITS.map((s) => s.id) });
    expectClean(`${viewport.name} space-selection`, selection);

    await waitFor(B, "watcher sees space", (s) =>
      s.phase === "DECISION" && s.cardKind === "space" && !s.cardHidden);
    await settle(B);
    const watcher = await capture(B, viewport, "space-watcher", { readOnly: true });
    expectClean(`${viewport.name} space-watcher`, watcher);

    /* The watcher must not be able to act on it. */
    const watcherLive = await B.eval(`(() => {
      const b = document.querySelector('button[data-action="acquire"]');
      return b ? !b.disabled : null;
    })()`);
    assert(watcherLive === false, "the watcher's acquire button is live");

    /* Refresh mid-turn: the same counter must be drawn again from the state. */
    await reload(A);
    await waitFor(A, "space survives refresh", (s) =>
      s.phase === "DECISION" && s.cardKind === "space" && !s.cardHidden, 40000);
    await capture(A, viewport, "space-selection-refresh");
    const refreshed = await probe(A);
    assert(refreshed.cardFull.trim().length > 0, "the refreshed counter is empty");

    /* 2. Buy a suit. Double-tapping the acquisition must send one action. */
    await doubleTap(A, "acquire suit", null, "acquireSuit", {
      options: { selector: 'button[data-action="acquire"]', text: "acquire suit" },
    });
    await waitFor(A, "acquisition popup", (s) => /ACQUIRED/i.test(s.cardFull));
    await settle(A);
    const acquired = await capture(A, viewport, "space-acquired");
    expectClean(`${viewport.name} space-acquired`, acquired);

    await waitFor(B, "watcher sees acquisition", (s) => /ACQUIRED/i.test(s.cardFull));
    await capture(B, viewport, "space-acquired-watcher", { readOnly: true });

    await reload(A);
    await waitFor(A, "popup survives refresh", (s) =>
      s.cardKind === "space" && /ACQUIRED/i.test(s.cardFull), 40000);
    await capture(A, viewport, "space-acquired-refresh");

    /* Continue, twice on the glass, one request. */
    await doubleTap(A, "continue journey", null, "continue", {
      options: { selector: 'button[data-action="continue"]', text: "continue journey" },
      cascades: true,
    });
    await waitFor(A, "purchase ends turn", (s) => s.active === 1 && s.phase === "AWAITING_ROLL");

    /* 3. The hand-over and the next player's turn. */
    await capture(A, viewport, "handover", { active: 1 });
    await capture(B, viewport, "your-turn-watcher", { active: 1 });
    await opponentTurn(B);

    /* 4. A property decision - the card that asks to buy. A does not buy, so
       the suit stays unspent for the expiry notice later. */
    const at = await probe(A);
    await waitForFree(A);
    await play(A, { type: "testRoll", steps: propertyStepsFrom(at.position) });
    await waitFor(A, "buy decision", (s) => s.phase === "DECISION" && s.landing === "buy");
    await settle(A);
    const decision = await capture(A, viewport, "decision");
    expectClean(`${viewport.name} decision`, decision);

    await reload(A);
    await waitFor(A, "decision survives refresh", (s) =>
      s.cardKind === "property" && s.phase === "DECISION" && !s.cardHidden, 40000);
    await capture(A, viewport, "decision-refresh");

    /* Pass, twice on the glass, one request. */
    await doubleTap(A, "pass", ".property-card__next", "pass");
    await waitFor(A, "decision answered", (s) => s.active === 1 && s.phase === "AWAITING_ROLL");
    await capture(A, viewport, "turn-end", { active: 1 });
    await capture(B, viewport, "turn-received", { active: 1 });

    await opponentTurn(B);

    /* 5. The full circuit back to Outer Space: the expired suit's notice. */
    const now = await probe(A);
    const back = (OUTER - now.position + 28) % 28 || 28;
    await waitForFree(A);
    await play(A, { type: "testRoll", steps: back });
    await waitFor(A, "space notice", (s) =>
      s.phase === "DECISION" && s.landing === "space" && s.cardKind === "space" && !s.cardHidden);
    await settle(A);
    const notice = await capture(A, viewport, "space-notice", { expired: true });
    expectClean(`${viewport.name} space-notice`, notice);

    await waitFor(B, "watcher sees notice", (s) => s.cardKind === "space" && !s.cardHidden);
    await capture(B, viewport, "space-notice-watcher", { readOnly: true });

    await reload(A);
    await waitFor(A, "notice survives refresh", (s) =>
      s.cardKind === "space" && !s.cardHidden && /expired/i.test(s.cardFull), 40000);
    await capture(A, viewport, "space-notice-refresh");

    /* The notice's local continue uncovers the counter underneath. */
    await tapWhenFree(A, 'button[data-action="notice-continue"]');
    await waitFor(A, "notice dismissed", (s) => /outer space|suit|acquire/i.test(s.cardFull));
    await capture(A, viewport, "space-return-counter");

    /* The counter's own X, twice, one request. */
    await doubleTap(A, "leave the counter", 'button[data-action="continue"]', "continue", {
      cascades: true,
    });
    await waitFor(A, "counter closes", (s) => s.active === 1 && s.phase === "AWAITING_ROLL");
    await capture(A, viewport, "final-handover", { active: 1 });

    /* 6. The tab goes away for thirty seconds while the opponent moves. */
    mark("background: freezing A");
    const beforeSleep = await probe(A);
    await A.send("Page.setWebLifecycleState", { state: "frozen" }).catch(async () => {
      await A.json(`document.dispatchEvent(new Event("visibilitychange")); return true;`);
    });
    const bAt = await probe(B);
    await play(B, { type: "testRoll", steps: propertyStepsFrom(bAt.position ?? 0) });
    const bState = await waitFor(B, "opponent moves while A sleeps", (s) =>
      (s.phase === "DECISION" && s.landing === "buy") || s.active === 0);
    if (bState.phase === "DECISION") await tapWhenFree(B, ".property-card__next");
    await waitFor(B, "turn back after sleep", (s) => s.active === 0 && s.phase === "AWAITING_ROLL");
    mark("background: A is asleep, B has moved; sleeping 30s");
    await sleep(30000);
    mark("background: waking A");
    await A.send("Page.setWebLifecycleState", { state: "active" }).catch(async () => {
      await A.json(`document.dispatchEvent(new Event("visibilitychange")); return true;`);
    });
    /* A WOKEN PAGE IS NOT A FOCUSED PAGE.

       On this Chrome, a page that has been through frozen/active answers
       Runtime.evaluate normally - the state is there, the board repaints - but
       a synthetic touch sent to it is never answered at all: the renderer
       takes the event and the protocol waits forever. It is not the app
       ignoring the tap (an event listener would still run); the event is not
       delivered. Emulation.setFocusEmulationEnabled is what puts the tab back
       in the state input dispatch requires, and it is the only thing that does
       - Page.bringToFront does not. A real phone wakes to a focused tab, so
       this is the harness restoring what the freeze took away, not a
       correction to the game. */
    await A.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    await sleep(1200);
    const woke = await waitFor(A, "A catches up after 30s", (s) =>
      s.seq > beforeSleep.seq && s.active === 0 && s.phase === "AWAITING_ROLL", 30000);
    console.log(
      `  background 30s: seq ${beforeSleep.seq} -> ${woke.seq}, active=${woke.active}, ` +
        `middle="${woke.status}" / "${woke.sub}"`,
    );
    assert(
      woke.active === 0 && /your turn/i.test(woke.status || ""),
      `A did not resume on its own turn (middle said "${woke.status}")`,
    );

    /* 7. The network goes away, then comes back. A tap while offline must not
       be retried behind the player's back; the next single tap is the action. */
    mark("network: going offline");
    await A.send("Network.enable");
    await A.send("Network.emulateNetworkConditions", {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    const beforeOffline = await probe(A);
    /* The wire log is the page's whole life, not this one moment: two
       continues from the counter's close are already in it. What matters here
       is what this tap added. */
    const sentBeforeOffline = (await actionsSent(A)).split(",").filter(Boolean);
    mark("network: tapping the die while offline");
    await tap(A, ".board__dice");
    await sleep(1500);
    const offline = await probe(A);
    const offlineNew = (await actionsSent(A)).split(",").filter(Boolean).slice(sentBeforeOffline.length);
    console.log(`  offline tap: seq ${beforeOffline.seq} -> ${offline.seq}, sent=${offlineNew.join(",") || "(nothing)"}`);
    assert(offline.seq === beforeOffline.seq, "an offline tap changed the game");
    assert(offlineNew.join(",") === "roll", `the offline tap sent ${offlineNew.join(",") || "nothing"}, expected one attempted roll`);

    /* ...and when it comes back, the die is pressed twice on the glass and
       throws once. That is both halves of the rule: the offline attempt was not
       retried behind the player's back, and the double-tap is one throw. */
    await A.send("Network.emulateNetworkConditions", {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
    await sleep(1500);
    mark("network: back online, double-tapping the die");
    await waitForFree(A);
    const beforeOnline = await probe(A);
    const sentBeforeOnline = (await actionsSent(A)).split(",").filter(Boolean);
    await doubleTap(A, "throw the die", ".board__dice", "roll");
    await waitFor(A, "online roll resolves", (s) => s.seq > beforeOnline.seq, 30000);
    const onlineNew = (await actionsSent(A)).split(",").filter(Boolean).slice(sentBeforeOnline.length);
    const rolls = onlineNew.filter((type) => type === "roll").length;
    console.log(`  online: one double-tap added ${rolls} roll request(s) (the offline attempt was not retried)`);
    assert(rolls === 1, `expected one accepted throw after reconnecting, saw ${rolls}`);

    console.log(`  page errors: A=${A.errors(INJECTED_FAULT) || "(none)"} B=${B.errors() || "(none)"}`);
    assert(!A.errors(INJECTED_FAULT), `A threw: ${A.errors(INJECTED_FAULT)}`);
    assert(!B.errors(), `B threw: ${B.errors()}`);
  } finally {
    mark("closing the browsers");
    await chromeA.close().catch(() => {});
    await chromeB.close().catch(() => {});
    mark("browsers closed");
  }
}

/* -------------------------------------------------------------------- run */

for (const viewport of VIEWPORTS) {
  try {
    await runViewport(viewport);
  } catch (error) {
    failures.push({ label: viewport.name, bad: [String(error && error.message)] });
    console.log(`=== ${viewport.name}: FAILED ===\n${error && error.message}`);
  }
}

await mkdir(SHOTS, { recursive: true });
await writeFile(join(SHOTS, "summary.json"), JSON.stringify(results, null, 2));

console.log(`\n${failures.length === 0 ? "ALL MOBILE CHECKS PASSED" : `${failures.length} MOBILE CHECK(S) FAILED`}`);
if (failures.length) {
  console.log("\nFailures:");
  for (const failure of failures) console.log(`- ${failure.label}: ${failure.bad.join("; ")}`);
  process.exitCode = 1;
}
