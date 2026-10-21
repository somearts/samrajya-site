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

/* Wait until the board is not busy: a press sent into an animation is
   dropped, and the press would simply never happen. */
const waitIdle = (page) =>
  page.json(`
    const b = document.querySelector(".board");
    for (let i = 0; i < 200; i++) {
      if (b.dataset.busy !== "true") return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  `);

/* Answer whatever the turn put on this screen: a buy, a chest, a pass, an
   upgrade to accept or decline. A card that is merely in the DOM is not
   necessarily a button a person can press, so what is visible is what is
   pressed. */
const answerVisit = async (page) => {
  for (let round = 0; round < 8; round += 1) {
    await waitIdle(page);
    const state = await page.json(`return {
      kind: document.querySelector(".board").game.landing?.kind || "",
      phase: document.querySelector(".board").game.phase,
      chest: Boolean(document.querySelector(".chest-card")),
      draw: Boolean(document.querySelector('.chest-card [data-action="draw"]:not([disabled])')),
      collect: Boolean(document.querySelector('.chest-card [data-action="collect"]:not([disabled])')),
      buy: (() => {
        const b = document.querySelector(".property-card__buy");
        return Boolean(b && !b.disabled && getComputedStyle(b).display !== "none" &&
          getComputedStyle(b).visibility !== "hidden");
      })(),
      next: (() => {
        const n = document.querySelector(".property-card__next");
        return Boolean(n && !n.hidden && getComputedStyle(n).display !== "none" &&
          getComputedStyle(n).visibility !== "hidden");
      })(),
    };`);
    if (state.chest && state.draw) {
      await page.eval(`(() => {
        document.querySelector('.chest-card [data-action="draw"]').click();
        return true;
      })()`);
      await sleep(1400);
      continue;
    }
    if (state.chest && state.collect) {
      await page.eval(`(() => {
        document.querySelector('.chest-card [data-action="collect"]').click();
        return true;
      })()`);
      await sleep(1400);
      continue;
    }
    if (state.kind === "buy" && state.buy) {
      await page.eval(`(() => {
        document.querySelector(".property-card__buy").click();
        return true;
      })()`);
      await sleep(1200);
      continue;
    }
    if (state.next) {
      await page.eval(`(() => {
        document.querySelector(".property-card__next").click();
        return true;
      })()`);
      await sleep(1200);
      continue;
    }
    break;
  }
  await waitIdle(page);
};

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
  await answerVisit(page);
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

// The last turn may have left a question open. Answer it, so the board is
// waiting rather than asking.
{
  const whose = await host.json(`return document.querySelector(".board").game.active;`);
  await answerVisit(whose === 0 ? host : guest);
}

/* --- the card that stood in for a decision ------------------------------ */

const stale = await guest.json(`return (() => {
  const b = document.querySelector(".board");
  const h = b.querySelector(".board__card");
  const die = b.querySelector(".board__dice");
  const r = (n) => { const x = n.getBoundingClientRect();
    return { left: x.left, top: x.top, right: x.right, bottom: x.bottom }; };
  const cardBox = h && !h.hidden ? r(h) : null;
  const dieBox = getComputedStyle(die).display === "none" ? null : r(die);
  const overlap = cardBox && dieBox
    ? !(cardBox.right <= dieBox.left || cardBox.left >= dieBox.right ||
         cardBox.bottom <= dieBox.top || cardBox.top >= dieBox.bottom)
    : false;
  return {
    cardHidden: h ? h.hidden : null,
    cardKind: h ? h.dataset.cardKind : null,
    dieDisplay: getComputedStyle(die).display,
    rollable: b.dataset.rollable,
    overlap,
    phase: b.game.phase,
    active: b.game.active,
  };
})();`);
console.log("the other screen after the turn changed hands:", JSON.stringify(stale));

/* --- the next player finds a clear board and a die they can use ---------- */

/* The turn has to be the guest's for this to mean anything: the die belongs to
   the player whose turn it is, and the card that used to be in the middle was
   standing over it. So the host plays out a turn, and the guest's board is
   then read as the next player reads it. */
const CENTRE = `
  return (() => {
    const b = document.querySelector(".board");
    const h = b.querySelector(".board__card");
    const die = b.querySelector(".board__dice");
    const r = (n) => { const x = n.getBoundingClientRect();
      return { left: x.left, top: x.top, right: x.right, bottom: x.bottom }; };
    const visibleCard = h && !h.hidden && getComputedStyle(h).visibility !== "hidden";
    const cardBox = visibleCard ? r(h) : null;
    const dieBox = getComputedStyle(die).display === "none" ? null : r(die);
    const overlap = cardBox && dieBox
      ? !(cardBox.right <= dieBox.left || cardBox.left >= dieBox.right ||
           cardBox.bottom <= dieBox.top || cardBox.top >= dieBox.bottom)
      : false;
    return {
      cardVisible: Boolean(cardBox),
      cardKind: h ? h.dataset.cardKind : null,
      dieDisplay: getComputedStyle(die).display,
      rollable: b.dataset.rollable,
      overlap,
      phase: b.game.phase,
      active: b.game.active,
    };
  })();`;

for (let attempt = 0; attempt < 6; attempt += 1) {
  const whose = await host.json(`return document.querySelector(".board").game.active;`);
  if (whose === 1) break;
  const page = whose === 0 ? host : guest;
  // Whatever that seat was left with is answered first: a turn cannot be
  // played from a board that is still asking a question.
  await answerVisit(page);
  const played = await playTurn(page);
  if (!played.threw) break;
}
await waitRollable(guest);
await sleep(400);

const nextPlayer = await guest.json(CENTRE);
console.log("the next player's board:", JSON.stringify(nextPlayer));

// And the die is really theirs to throw.
const guestThrew = await guest.eval(`(() => {
  const b = document.querySelector(".board");
  if (b.dataset.rollable !== "true") return false;
  b.querySelector(".board__dice").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return true;
})()`);
await sleep(2500);
const afterGuestThrow = await guest.json(`return {
  rolling: document.querySelector(".board__dice").dataset.rolling,
  face: document.querySelector(".board__dice").dataset.face,
  phase: document.querySelector(".board").game.phase,
};`);
console.log("the next player threw:", guestThrew, JSON.stringify(afterGuestThrow));
await answerVisit(guest);
await sleep(1500);
const afterGuestTurn = await host.json(`return {
  active: document.querySelector(".board").game.active,
  phase: document.querySelector(".board").game.phase,
};`);
console.log("after the next player's turn:", JSON.stringify(afterGuestTurn));

/* --- the record is open while the other screen plays -------------------- */

await guest.eval(`document.querySelector('.who[data-seat="1"]').click(); true;`);
await sleep(600);
const recordOpen = await guest.json(`return {
  open: Boolean(document.querySelector(".board__profile")),
  profile: document.querySelector(".board").dataset.profile === "true",
  die: getComputedStyle(document.querySelector(".board__dice")).display,
};`);
console.log("the guest's record:", JSON.stringify(recordOpen));

/* The log runs for as long as the whole check takes: a turn change can be
   several turns away, and the announcement that was waiting has to still be
   inside the window when the record closes. */
const guestLog = guest.json("return await window.__annLog(240000);");
const hostLog = host.json("return await window.__annLog(240000);");
await guest.eval(`(() => {
  const b = document.querySelector(".board");
  window.__snaps = [];
  const orig = b.applySnapshot.bind(b);
  b.applySnapshot = (s) => {
    window.__snaps.push({ seq: s?.state?.seq, events: (s?.events || []).map((e) => e.type) });
    return orig(s);
  };
  return true;
})()`);

// The host plays until something is announced while the guest's record is open.
let queued = [];
for (let turn = 0; turn < 16; turn += 1) {
  const whoseTurn = await host.json(`return document.querySelector(".board").game.active;`);
  const page = whoseTurn === 0 ? host : guest;
  const played = await playTurn(page);
  const said = await guest.json(`return {
    visible: !document.querySelector(".board__announce").hidden,
    text: document.querySelector(".board__announce").textContent,
    profile: document.querySelector(".board").dataset.profile === "true",
    seq: document.querySelector(".board").game.seq,
    phase: document.querySelector(".board").game.phase,
    turn: document.querySelector(".board__turn").textContent,
  };`);
  const hostSeen = await host.json(`return {
    seq: document.querySelector(".board").game.seq,
    phase: document.querySelector(".board").game.phase,
    turn: document.querySelector(".board__turn").textContent,
  };`);
  console.log(`turn ${turn}: seat ${whoseTurn} rolled ${played.landing || "nothing"}`,
    `guest layer visible ${said.visible}`,
    `| host seq ${hostSeen.seq} ${hostSeen.phase} "${hostSeen.turn}"`,
    `| guest seq ${said.seq} ${said.phase} "${said.turn}"`);
  if (said.visible) { queued.push(said.text); break; }
  if (played.kind === "rent" || played.kind === "buy") {
    // the host bought or was charged: an announcement is on its way
  }
  const hostSaid = await host.json(`return {
    visible: !document.querySelector(".board__announce").hidden,
    text: document.querySelector(".board__announce").textContent,
  };`);
  if (hostSaid.visible) { console.log("  host screen said:", hostSaid.text); }
  // Keep playing until the host has actually bought something: that is the
  // announcement the guest's record is holding.
  const bought = await guest.json(`return (window.__snaps || [])
    .some((s) => s.events.includes("bought"));`);
  if (hostSaid.visible || bought) break;
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

// Watch the layer directly for a few seconds: what the record was holding.
for (let i = 0; i < 14; i += 1) {
  await sleep(500);
  const now = await guest.json(`return {
    hidden: document.querySelector(".board__announce").hidden,
    text: document.querySelector(".board__announce").textContent,
  };`);
  console.log(`  +${((i + 1) * 0.5).toFixed(1)}s`, JSON.stringify(now));
  if (!now.hidden && now.text) break;
}

await sleep(6000);
const guestEntries = await guestLog;
const hostEntries = await hostLog;

const saidWhileOpen = guestEntries.filter((e) => e.visible && e.profile);
const saidAfter = guestEntries.filter((e) => e.visible && !e.profile);
console.log("\nRESULT");
console.log("  said while the record was open:", saidWhileOpen.length);
console.log("  said after it closed:", saidAfter.length,
  saidAfter.map((e) => `${e.label} ${e.big} ${e.sub}`).join(" | "));
console.log("  the record closed on Escape:", !afterEscape.open);
console.log("  guest snapshots:", JSON.stringify(await guest.json("return window.__snaps;")));

await host.close();
await guest.close();
await chrome.close();
