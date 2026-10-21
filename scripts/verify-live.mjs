/* ==========================================================================
   SAMRAJYA - LIVE VERIFICATION

   A script that plays the deployed game on two screens, with no test hook and
   no stubbed numbers, and watches what the announcement layer does while a
   player's record is open.

   Usage:
     node scripts/verify-live.mjs [url]
   ========================================================================== */

import { launch, sleep } from "./lib/browser.mjs";

const URL_ = process.argv[2] || "https://golake.app/samrajya/";

const chrome = await launch();
const host = await chrome.newPage(await chrome.newContext());
const guest = await chrome.newPage(await chrome.newContext());
await host.setViewport(390, 850, 2);
await guest.setViewport(390, 850, 2);

const click = async (page, text) => {
  const ok = await page.clickText(text);
  await sleep(450);
  return ok;
};
const fill = async (page, value) =>
  page.eval(`(() => {
    const input = document.querySelector("input.field__input");
    if (!input) return false;
    input.focus();
    const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    write.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
const pickCiv = async (page, civ) =>
  page.eval(`(() => {
    const el = document.querySelector('.civ[data-civ=${JSON.stringify(civ)}]');
    if (!el) return false;
    el.click();
    return true;
  })()`);

/* The announcement log, taken from the layer's own changes. */
const ANN_LOG = `
  window.__annLog = async (ms) => {
    const b = document.querySelector(".board");
    const n = b.querySelector(".board__announce");
    const out = [];
    const start = performance.now();
    let lastVisible = null;
    let lastKey = null;
    const record = () => {
      const visible = Boolean(n && !n.hidden);
      const pick = (s) => (visible ? n.querySelector(s)?.textContent || "" : "");
      const key = visible
        ? [pick(".announce__label"), pick(".announce__big"), pick(".announce__sub")].join("|")
        : "";
      if (visible === lastVisible && key === lastKey) return;
      lastVisible = visible;
      lastKey = key;
      out.push({ t: Math.round(performance.now() - start), visible,
        label: pick(".announce__label"), big: pick(".announce__big"), sub: pick(".announce__sub"),
        profile: b.dataset.profile === "true" });
    };
    const mo = new MutationObserver(record);
    mo.observe(b, {
      attributes: true, attributeFilter: ["hidden", "data-profile"],
      childList: true, subtree: true,
    });
    record();
    await new Promise((r) => setTimeout(r, ms));
    mo.disconnect();
    return out;
  };`;

/* Wait until this screen can really throw. */
const waitRollable = (page) =>
  page.json(`
    const b = document.querySelector(".board");
    for (let i = 0; i < 300; i++) {
      if (b.dataset.rollable === "true") return true;
      await new Promise((r) => setTimeout(r, 60));
    }
    return false;
  `);

/* One real turn: throw, answer whatever it put up, and hand the turn on. */
const playTurn = async (page) => {
  const ready = await waitRollable(page);
  if (!ready) return { threw: false };
  await page.eval(`(() => {
    document.querySelector(".board__dice").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  })()`);
  await page.json(`
    const b = document.querySelector(".board");
    const d = b.querySelector(".board__dice");
    for (let i = 0; i < 200; i++) {
      const rolling = d.dataset.rolling !== "false";
      if (!rolling && b.dataset.moving !== "true") break;
      await new Promise((r) => setTimeout(r, 40));
    }
    return true;
  `);
  // Buy if the card offers it, then answer the visit.
  const kind = await page.json(`return document.querySelector(".board").game.landing?.kind || "";`);
  if (kind === "buy") {
    await page.eval(`(() => {
      const buy = document.querySelector(".property-card__buy");
      if (buy && !buy.disabled) buy.click();
      return true;
    })()`);
    await sleep(900);
  }
  await page.eval(`(() => {
    const next = document.querySelector(".property-card__next");
    if (next && !next.hidden && getComputedStyle(next).display !== "none") next.click();
    return true;
  })()`);
  await sleep(1200);
  const state = await page.json(`return {
    landing: document.querySelector(".board").game.landing?.id || "",
    kind: document.querySelector(".board").game.landing?.kind || "",
    money: document.querySelector(".board").game.ledger.players.map((p) => p.money),
    owned: [...document.querySelector(".board").game.ledger.properties.entries()]
      .filter(([, s]) => s.owner !== null).map(([id, s]) => id + ":" + s.owner),
    phase: document.querySelector(".board").game.phase,
  };`);
  return { threw: true, ...state };
};

/* --- set the game up ---------------------------------------------------- */

await host.goto(URL_);
await guest.goto(URL_);
await sleep(1200);
await click(host, "create");
await fill(host, "Asha");
await pickCiv(host, "indus-valley");
await click(host, "next");
await fill(host, "Vikram");
await pickCiv(host, "aztec");
await click(host, "review");
await click(host, "create");
await sleep(2000);
const invite = await host.eval(`(() => {
  const i = document.querySelector("#invite");
  return i ? i.value : "";
})()`);
const code = (invite.match(/room=([a-z0-9]+)/i) || [])[1] || "";
console.log("room:", code);

await guest.goto(URL_);
await sleep(1000);
await click(guest, "join");
await guest.eval(`(() => {
  const i = document.querySelector("input[name=code]");
  const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  write.call(i, ${JSON.stringify(code)});
  i.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
})()`);
await click(guest, "next");
await sleep(1200);
await pickCiv(guest, "aztec");
await click(guest, "join");
await sleep(2500);
for (const page of [host, guest]) {
  if (!(await page.eval(`!!document.querySelector(".board")`))) {
    await click(page, "board");
    await sleep(2000);
  }
}
await host.eval(ANN_LOG);
await guest.eval(ANN_LOG);
console.log("both screens are on the board:",
  await host.eval(`!!document.querySelector(".board")`),
  await guest.eval(`!!document.querySelector(".board")`));

/* --- play until the guest owns a square --------------------------------- */

let guestOwns = [];
let hostOwns = [];
for (let turn = 0; turn < 14; turn += 1) {
  const whoseTurn = await host.json(`return document.querySelector(".board").game.active;`);
  const page = whoseTurn === 0 ? host : guest;
  const played = await playTurn(page);
  const state = await host.json(`return {
    owned: [...document.querySelector(".board").game.ledger.properties.entries()]
      .filter(([, s]) => s.owner !== null).map(([id, s]) => id + ":" + s.owner),
    money: document.querySelector(".board").game.ledger.players.map((p) => p.money),
  };`);
  hostOwns = state.owned.filter((o) => o.endsWith(":0"));
  guestOwns = state.owned.filter((o) => o.endsWith(":1"));
  console.log(`turn ${turn}: seat ${whoseTurn} rolled ${played.landing || "nothing"}`,
    `owned ${state.owned.join(" ") || "-"}`, `purse ${state.money.join("/")}`);
  if (hostOwns.length && guestOwns.length) break;
}

console.log("host owns:", hostOwns.join(" ") || "nothing");
console.log("guest owns:", guestOwns.join(" ") || "nothing");

/* --- the record is open while the other screen plays -------------------- */

await guest.eval(`document.querySelector('.who[data-seat="1"]').click(); true;`);
await sleep(600);
const recordOpen = await guest.json(`return {
  open: Boolean(document.querySelector(".board__profile")),
  profile: document.querySelector(".board").dataset.profile === "true",
  die: getComputedStyle(document.querySelector(".board__dice")).display,
};`);
console.log("the guest's record:", JSON.stringify(recordOpen));

const guestLog = guest.json("return await window.__annLog(20000);");
const hostLog = host.json("return await window.__annLog(20000);");

// The host plays until something is announced while the guest's record is open.
let queued = [];
for (let turn = 0; turn < 12; turn += 1) {
  const whoseTurn = await host.json(`return document.querySelector(".board").game.active;`);
  const page = whoseTurn === 0 ? host : guest;
  const played = await playTurn(page);
  const said = await guest.json(`return {
    visible: !document.querySelector(".board__announce").hidden,
    text: document.querySelector(".board__announce").textContent,
    profile: document.querySelector(".board").dataset.profile === "true",
  };`);
  console.log(`turn ${turn}: seat ${whoseTurn} rolled ${played.landing || "nothing"}`,
    `guest layer visible ${said.visible}`);
  if (said.visible) { queued.push(said.text); break; }
  if (played.kind === "rent" || played.kind === "buy") {
    // the host bought or was charged: an announcement is on its way
  }
  const hostSaid = await host.json(`return {
    visible: !document.querySelector(".board__announce").hidden,
    text: document.querySelector(".board__announce").textContent,
  };`);
  if (hostSaid.visible) { console.log("  host screen said:", hostSaid.text); break; }
}

// Close the record with the Escape key, as a player would.
await guest.send("Input.dispatchKeyEvent", {
  type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27,
});
await guest.send("Input.dispatchKeyEvent", {
  type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27,
});
await sleep(500);
const afterEscape = await guest.json(`return {
  open: Boolean(document.querySelector(".board__profile")),
  profile: document.querySelector(".board").dataset.profile === "true",
};`);
console.log("after Escape:", JSON.stringify(afterEscape));

await sleep(6000);
const guestEntries = await guestLog;
const hostEntries = await hostLog;
console.log("guest announcement log:");
for (const e of guestEntries) console.log("  ", JSON.stringify(e));
console.log("host announcement log:");
for (const e of hostEntries) console.log("  ", JSON.stringify(e));

const saidWhileOpen = guestEntries.filter((e) => e.visible && e.profile);
const saidAfter = guestEntries.filter((e) => e.visible && !e.profile);
console.log("\nRESULT");
console.log("  said while the record was open:", saidWhileOpen.length);
console.log("  said after it closed:", saidAfter.length,
  saidAfter.map((e) => `${e.label} ${e.big} ${e.sub}`).join(" | "));
console.log("  the record closed on Escape:", !afterEscape.open);

await host.close();
await guest.close();
await chrome.close();
