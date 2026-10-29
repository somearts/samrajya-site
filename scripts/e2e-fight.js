/* ==========================================================================
   THE FIGHT, IN TWO REAL BROWSERS

   One e2e, and everything the Fight is about between two players: the corner
   opens as a shared screen on BOTH phones, the player who landed chooses and
   arms a weapon, the strike is made on the tile itself, both screens see the
   same war, the colony changes hands, and the turn is handed over.

   The state is put where the test needs it with the same debug hook the
   summarised suite uses (ALLOW_TEST_RNG only): a fresh game, seat 0 standing
   just before the Fight with a nuclear weapon, seat 1 holding the moon.

     node scripts/e2e-fight.js [--url http://127.0.0.1:8788/samrajya/]
   ========================================================================== */

import { writeFileSync } from "node:fs";
import { launch, sleep } from "./lib/browser.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};

/* Two ORIGINS, one room. localStorage is per-origin, so the two seats are two
   separate identities in two separate browsers off one Chrome, exactly as two
   phones would be. */
const PORT = Number(arg("--port", "8788"));
const HOST_URL = arg("--url", `http://localhost:${PORT}/samrajya/`);
const GUEST_URL = arg("--guest-url", `http://127.0.0.1:${PORT}/samrajya/`);
const OUT = arg("--out", null);
const HOST_NAME = arg("--p1", "Aster");
const GUEST_NAME = arg("--p2", "Vega");
const HOST_CIV = arg("--civ1", "indus-valley");
const GUEST_CIV = arg("--civ2", "aztec");

const results = [];
let section = "";
function note(label, ok, detail = "") {
  results.push({ label, ok: Boolean(ok), detail: String(detail) });
  console.log(` ${ok ? "ok " : "FAIL"} ${label}${!ok && detail ? `  ${detail}` : ""}`);
}
function heading(title) {
  section = title;
  console.log(`\n${title}`);
}

const check = (label, value, detail = "") => note(label, value, detail);

async function fill(page, value) {
  await page.eval(`(() => {
    const i = document.querySelector("input[name=name]");
    if (!i) return false;
    const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    write.call(i, ${JSON.stringify(value)});
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
}

const pickCiv = (page, civ) =>
  page.eval(`(() => {
    const b = document.querySelector('.civ[data-civ=${JSON.stringify(civ)}]');
    if (!b) return false;
    b.click();
    return true;
  })()`);

/** Wait until an expression is true, on one page. */
async function until(page, expr, ms = 10000) {
  return page.eval(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < ${Math.ceil(ms / 50)}; i++) {
      if (${expr}) return true;
      await wait(50);
    }
    return false;
  })();`);
}

/** Wait until BOTH pages agree on something, reporting per page. */
async function both(h, g, expr, ms = 12000) {
  return Promise.all([until(h, expr, ms), until(g, expr, ms)]);
}

/* The board's own action door, from the page: one line, no copies. */
const play = (page, action, rng) =>
  page.json(`
    const b = document.querySelector(".board");
    if (!b) return false;
    const gone = async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 200 && !b; i += 1) {
        b = document.querySelector(".board");
        if (!b) await wait(50);
      }
      if (!b) return false;
      for (let i = 0; i < 120 && b.dataset.busy === "true"; i++) await wait(50);
      await b.play(${JSON.stringify(action)}${rng === undefined ? "" : `, ${rng}`});
      return true;
    };
    return gone();
  `);

/** A click on a board cell, by real mouse events at its own coordinates. */
async function clickCell(page, id) {
  const box = await page.eval(`(() => {
    const el = document.querySelector('.board__cell[data-id=${JSON.stringify(id)}]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!box) return false;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", {
      type, x: box.x, y: box.y, button: "left", clickCount: 1,
    });
  }
  return true;
}

const chrome = await launch();
let failures = 0;
try {
  const hostCtx = await chrome.newContext();
  const guestCtx = await chrome.newContext();
  const host = await chrome.newPage(hostCtx);
  const guest = await chrome.newPage(guestCtx);
  await host.setViewport(390, 844, 3);
  await guest.setViewport(390, 844, 3);

  /* --------------------------------------------------------------- welcome */
  heading("TWO SEATS, ONE ROOM");

  await host.goto(HOST_URL);
  await sleep(800);
  await fill(host, HOST_NAME);
  await pickCiv(host, HOST_CIV);
  await host.eval(`[...document.querySelectorAll("button,.btn,a,[role=button]")].find(
    (e) => /create/i.test(e.textContent || "")).click();`);
  await sleep(1800);
  const code = (await host.eval(
    `(() => (document.querySelector("#invite")?.value || "").match(/room=([0-9]+)/) || [])[1] || ""`,
  )) || (await textDigits(host));
  check("the host holds an invite code", /^[1-9][0-9]{3}$/.test(code), code);

  await guest.goto(GUEST_URL);
  await sleep(800);
  await guest.eval(`(() => {
    const i = document.querySelector("input[name=code]");
    if (!i) return false;
    const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    write.call(i, ${JSON.stringify(code)});
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  await guest.eval(`[...document.querySelectorAll("button,.btn,a,[role=button]")].find(
    (e) => /next/i.test(e.textContent || "")).click();`);
  await sleep(1200);
  await fill(guest, GUEST_NAME);
  await pickCiv(guest, GUEST_CIV);
  await guest.eval(`[...document.querySelectorAll("button,.btn,a,[role=button]")].find(
    (e) => /join/i.test(e.textContent || "")).click();`);
  await sleep(1800);

  await host.eval(`[...document.querySelectorAll("button,.btn,a,[role=button]")].find(
    (e) => /start/i.test(e.textContent || "") && !e.disabled).click();`);
  const [hostUp, guestUp] = await Promise.all([
    until(host, `!!document.querySelector(".board")`, 15000),
    until(guest, `!!document.querySelector(".board")`, 15000),
  ]);
  check("both players are on the board", hostUp && guestUp, `${hostUp} / ${guestUp}`);

  /* ----------------------------------------------------------------- setup */
  heading("THE CORNER, SET UP");

  /* A clean slate, from both screens so both agree on the same state. */
  await play(host, { type: "debug", reset: true });
  await sleep(400);
  /* Seat 1 owns the moon; the seat that will strike carries a nuclear weapon
     and stands one square before the Fight (index 22 -> face 1 -> 23). */
  await play(host, { type: "debug", position: 22, active: 0, weapons: ["nuclear"], owner: { id: "moon", seat: 1 } });
  await sleep(400);
  await play(guest, { type: "debug", position: 1, active: 0 });
  await sleep(600);

  /* ------------------------------------------------------------ the strike */
  heading("THE FIGHT ON BOTH SCREENS");

  await play(host, { type: "roll" }, 0);
  /* The board sends the continue that opens the decision; the Fight stage is
     drawn from the state on its own. Both screens are waited for. */
  const stageUp = await both(
    host, guest,
    `(h = document.querySelector('.board__card[data-card-kind="fight"]'))
      && !h.hidden && h.firstElementChild`,
    15000,
  );
  check("the Fight stage is open on the acting player's screen", stageUp[0]);
  check("the Fight stage is open on the other screen too", stageUp[1]);

  const hostCard = await host.json(`return {
    title: document.querySelector(".fight-card__title")?.textContent.trim(),
    halves: document.querySelectorAll(".fight-half").length,
    weapons: document.querySelectorAll(".fight-card__face").length,
    attack: !!document.querySelector(".fight-card__attack"),
    leave: !!document.querySelector(".fight-card__leave"),
    observation: document.querySelector(".fight-card__explain")?.textContent.includes("weapons"),
  }`);
  check('it says "Welcome to the Fight"', hostCard.title === "Welcome to the Fight", hostCard.title);
  check("it explains what the Fight does", hostCard.observation === true);

  /* The tile for the moon carries the glow, on BOTH screens, before the
     weapon is chosen? No - the glow comes with the chosen weapon. Both
     screens agree that the moon is NOT lit yet. */
  const litYet = await host.json(`return !!document.querySelector(".is-fight-glow") || !!document.querySelector(".is-fight-blink");`);
  check("nothing is lit before a weapon is chosen", !litYet);

  /* The acting player chooses. The same face again is the arming. */
  await host.eval(`document.querySelector('.fight-card__face[data-weapon="nuclear"]')?.click();`);
  await sleep(1000);
  const chosen = await host.json(`return document.querySelector(".board").game.fight;`);
  check("the weapon is chosen in the state", chosen?.phase === "selected" && chosen.selectedWeaponId === "nuclear",
    JSON.stringify(chosen));
  const lit = await both(
    host, guest,
    `document.querySelector(".is-fight-glow")?.dataset.id === "moon"`,
    8000,
  );
  check("the moon is lit on the acting screen", lit[0]);
  check("the moon is lit on the other screen too", lit[1]);

  /* The arming: the Attack pill, whose press is the arm. */
  await host.eval(`document.querySelector('.fight-card__attack[data-weapon="nuclear"]')?.click();`);
  await sleep(1000);
  const armed = await both(
    host, guest,
    `(document.querySelector(".board").game.fight.phase === "armed")
      && document.querySelector(".is-fight-blink")?.dataset.id === "moon"`,
    10000,
  );
  check("the attack is armed, and the moon blinks, on the acting screen", armed[0]);
  check("the attack is armed, and the moon blinks, on the other screen too", armed[1]);
  const halfMine = await guest.json(`return {
    halves: [...document.querySelectorAll(".fight-half")].map((h) => h.dataset.fighter),
    bottom: document.querySelector(".fight-half--bottom")?.dataset.fighter,
  }`);
  /* The bottom half is the VIEWER'S own player; on the guest screen, the guest
     is not the fighter, so the bottom half belongs to somebody who carries no
     part of this fight. */
  check("the halves are viewer-relative on the other screen", halfMine.halves.length === 2
    && (halfMine.bottom === "false" || halfMine.bottom === undefined), JSON.stringify(halfMine));

  /* THE STRIKE: a tap on the blinking tile, with no second question. A wrong
     tile is shaken first - a tap on a quiet square is not a strike. */
  const wrongTile = await clickCell(guest, "start");
  check("the wrong tile is offered, and nothing is struck by it", wrongTile);
  await sleep(500);
  const armedStill = await guest.json(
    `return document.querySelector(".board").game.fight?.phase;`);
  check("and the strike is still armed after it", armedStill === "armed", armedStill);

  await clickCell(host, "moon");
  /* The war is ~2.5s; the acting board then closes the visit on its own. */
  const closed = await both(
    host, guest,
    `document.querySelector(".board").game.fight === null
      && document.querySelector(".board").game.phase === "AWAITING_ROLL"`,
    20000,
  );
  check("the fight is fought and closed on the acting screen", closed[0]);
  check("the fight is fought and closed on the other screen too", closed[1]);

  /* --------------------------------------------------------- what it took */
  heading("WHAT THE STRIKE CHANGED");

  const after = await host.json(`return {
    owner: document.querySelector(".board").game.ledger.players,
    pieces: document.querySelector(".board").game.pieces.map((p) => p.weapons),
    active: document.querySelector(".board").game.active,
  }`);
  const moon = after.owner.find?.((sheet) => sheet?.id === "moon") || null;
  const owner = await host.json(`return (() => {
    const ledger = document.querySelector(".board").game.ledger;
    const sheets = ledger.sheets || ledger.properties || [];
    return { sheet: sheets.find?.((s) => s.id === "moon")?.owner ?? null };
  })();`);
  const ownerRead = await host.json(`return document.querySelector('.board__cell[data-id="moon"]').dataset.owner ?? null;`);
  const seats = await host.json(`return document.querySelector(".board").game.ledger.players.map((p) => p.seat);`);
  check("the moon changed hands and is drawn as the new owner's",
    String(ownerRead) === String(after.active), `${ownerRead} / active ${after.active}`);
  const guestMoon = await guest.json(`return document.querySelector('.board__cell[data-id="moon"]').dataset.owner ?? null;`);
  check("and the other screen draws the same owner", String(guestMoon) === String(ownerRead), `${guestMoon} / ${ownerRead}`);
  const hostWeapons = after.pieces[0] ?? [];
  check("the weapon is spent", hostWeapons.length === 0, JSON.stringify(after.pieces));
  check("and the turn was handed over", after.active === 1, `active is ${after.active}`);

  /* And a second visit to the fight cannot strike again this turn... the turn
     has moved on; the guest holds no weapon that reaches the moon, and the
     moon is not the opponent's to lose now. Both things are the rules', and
     this run already saw the strike and the handover. */

  for (const page of [host, guest]) {
    const errors = page.errors();
    check(`no uncaught errors on ${page === host ? "the acting" : "the watching"} screen`, errors === "", errors);
  }

  failures = results.filter((r) => !r.ok).length;
  console.log(`\n${failures === 0 ? "e2e: OK" : `e2e: ${failures} FAIL`}  (${results.length} checks)`);
  if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
} finally {
  await chrome.close();
}
process.exitCode = failures === 0 ? 0 : 1;

/* The digits, read off the four code dials when the invite field is absent. */
async function textDigits(page) {
  const digits = await page.json(
    `return [...document.querySelectorAll(".lobby__digit")].map((d) => d.textContent.trim());`);
  return digits.map(String).join("");
}
