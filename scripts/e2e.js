// Drive the create and join flows through a real browser, the way a person
// would, and report what each step did. Uses CDP so a second, independent
// browser context can play the second player with their own identity.
//
//   node scripts/e2e.js --w 390 --h 844
//
// ONE VIEWPORT PER RUN. Four viewports means four invocations, not four passes
// inside one.
//
// What it is for is the board, and above all the cards. Everything it says about
// a title is measured off the rendered picture rather than off the markup,
// because getBBox() on an SVG <text> reports a layout box rather than the glyphs,
// and at the size a card is actually drawn on a phone the two are not the same
// thing.

import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PILL_LAYOUT } from "../authored/samrajya/assets/js/cards.js";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const URL_ = arg("--url", "http://127.0.0.1:8791/samrajya/");
const W = Number(arg("--w", "390"));
const H = Number(arg("--h", "844"));
// A real phone's pixel density, not 1. No phone renders at density 1, and
// measuring at 1 describes the harness rather than the page.
const DSF = Number(arg("--dsf", "3"));
const SHOTS = arg("--shots", null);
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const PLAYER1 = arg("--p1", "Asha");
const PLAYER2 = arg("--p2", "Vikram");
const CIV1 = arg("--civ1", "indus-valley");
const CIV2 = arg("--civ2", "aztec");

/* ------------------------------------------------------------------ reporting */

const results = [];
let section = "";
const note = (label, ok, detail = "") => {
  results.push({ section, label, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${!ok && detail ? `  ${detail}` : ""}`);
};

/* ----------------------------------------------------------------- the browser */

class Session {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      const h = this.pending.get(m.id);
      if (!h) return;
      this.pending.delete(m.id);
      m.error ? h.reject(new Error(m.error.message)) : h.resolve(m.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || ""));
    }
    return r.result.value;
  }
  async goto(url) {
    await this.send("Page.navigate", { url });
    for (let i = 0; i < 60; i++) {
      await sleep(150);
      if (await this.eval("document.readyState === 'complete'")) return;
    }
  }
}

const profile = await mkdtemp(join(tmpdir(), "kc-e2e-"));
const PORT = 9800 + (process.pid % 90);
const child = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--hide-scrollbars", "about:blank"], { stdio: "ignore" });

for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* not yet */ }
  await sleep(250);
}

/* The browser's own connection. Some CDP calls are only allowed here and never
   on a page's - creating a browser context is one of them - so both players
   hang off this. */
const root = new Session(new WebSocket(
  (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl,
));
await new Promise((r) => root.ws.addEventListener("open", r));

/** A player: a page of their own, in a context of their own. */
async function player(label, browserContextId) {
  let wsUrl;
  if (browserContextId) {
    const { targetId } = await root.send("Target.createTarget", { url: "about:blank", browserContextId });
    for (let i = 0; i < 40; i++) {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const found = list.find((t) => t.id === targetId);
      if (found && found.webSocketDebuggerUrl) { wsUrl = found.webSocketDebuggerUrl; break; }
      await sleep(150);
    }
    if (!wsUrl) throw new Error("could not open a page in the guest's context");
  } else {
    wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json()).webSocketDebuggerUrl;
  }
  const s = new Session(new WebSocket(wsUrl));
  await new Promise((r) => s.ws.addEventListener("open", r));
  s.label = label;
  await s.send("Page.enable");
  await s.send("Runtime.enable");
  await s.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DSF, mobile: true });
  await s.goto(URL_);
  await sleep(900);
  return s;
}

/* ------------------------------------------------------------------ page acts */

const clickText = (s, text) => s.eval(`(() => {
  const b = [...document.querySelectorAll('button, .btn, [role=button], a')]
    .find((e) => (e.textContent || '').trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
  if (!b) return false;
  b.click();
  return true;
})()`);

/** Fill one field the way a person would, so the app sees the events it listens for. */
const fill = (s, selector, value) => s.eval(`(() => {
  const i = document.querySelector(${JSON.stringify(selector)});
  if (!i) return 'no field';
  i.focus();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('change', { bubbles: true }));
  return 'ok';
})()`);

/** A real click, dispatched as a mouse event at the element's own coordinates.

    Some of the board's own controls will not act on a synthetic .click(), and a
    harness that cannot get onto the board cannot check the board. */
async function clickReal(s, text) {
  // Scrolled into view first: a mouse event is dispatched at a point on the
  // screen, so a button below the fold of a short viewport would simply be
  // clicked at a place where it is not.
  await s.eval(`(() => {
    const b = [...document.querySelectorAll('button, .btn, a')]
      .find((e) => (e.textContent || '').trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
    if (b) b.scrollIntoView({ block: 'center', inline: 'center' });
    return !!b;
  })()`);
  await sleep(250);
  const at = await s.eval(`(() => {
    const b = [...document.querySelectorAll('button, .btn, a')]
      .find((e) => (e.textContent || '').trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!at) return false;
  for (const type of ["mousePressed", "mouseReleased"]) {
    await s.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
  }
  return true;
}

const nameField = (s) => s.eval(`(() => {
  const i = document.querySelector('input.field__input');
  return i ? i.value : '';
})()`);

const pickCiv = (s, civ) => s.eval(`(() => {
  const b = document.querySelector('.civ[data-civ=${JSON.stringify(civ)}]');
  if (!b) return false;
  b.click();
  return true;
})()`);

const civState = (s) => s.eval(`JSON.stringify([...document.querySelectorAll('.civ[data-civ]')]
  .map((b) => ({ id: b.dataset.civ, on: b.getAttribute('aria-checked') === 'true',
                  dis: b.disabled || b.getAttribute('aria-disabled') === 'true' })))`);

const panelText = (s) => s.eval(`(() => {
  const el = document.querySelector('.panel') || document.body;
  return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
})()`);

async function shot(s, name) {
  if (!SHOTS) return;
  const r = await s.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(SHOTS, name), Buffer.from(r.data, "base64"));
}

/* ----------------------------------------------------------------- the flows */

let host, guest;
try {
  section = "WELCOME";
  const ctxGuest = await root.send("Target.createBrowserContext", {});
  host = await player("host");
  guest = await player("guest", ctxGuest.browserContextId);

  const welcome = JSON.parse(await host.eval(`JSON.stringify({
    head: (document.querySelector('h1, h2') || {}).textContent || '',
    buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()),
  })`));
  note("welcome renders the wordmark", /samrajya/i.test(welcome.head), welcome.head);
  note("welcome renders KALCHAKRA", /kalchakra/i.test(welcome.head), welcome.head);
  note("two buttons, in order",
    welcome.buttons.length === 2 && /create/i.test(welcome.buttons[0]) && /join/i.test(welcome.buttons[1]),
    welcome.buttons.join(" | "));
  await shot(host, `${W}-welcome`);

  /* --------------------------------------------------------------- creating */

  section = "CREATE";
  await clickText(host, "create");
  await sleep(700);
  note("create step 1 is Player 1", await nameField(host) === "" && !!(await host.eval(
    `!!document.querySelector('input[aria-label*="Player 1"]')`)));
  note("focus lands on the name field",
    await host.eval("document.activeElement && document.activeElement.tagName === 'INPUT'"));

  await clickText(host, "next");
  await sleep(500);
  note("an empty name is refused", !!(await host.eval(`!!document.querySelector('input[aria-label*="Player 1"]')`)));
  note("and we stay on step 1", !!(await host.eval(`!!document.querySelector('input[aria-label*="Player 1"]')`)));

  await fill(host, "input.field__input", PLAYER1);
  await sleep(300);
  note("typing clears the complaint", !(await host.eval(`!!document.querySelector('.field__error')`)));
  await pickCiv(host, CIV1);
  await sleep(300);
  note("a civilization can be chosen",
    JSON.parse(await civState(host)).some((c) => c.id === CIV1 && c.on));

  await clickText(host, "next");
  await sleep(800);
  note("step 2 is Player 2", !!(await host.eval(`!!document.querySelector('input[aria-label*="Player 2"]')`)));
  note("Player 1's civilization is unavailable to Player 2",
    JSON.parse(await civState(host)).some((c) => c.id === CIV1 && c.dis), await civState(host));

  await fill(host, "input.field__input", PLAYER2);
  await pickCiv(host, CIV2);
  await sleep(300);
  await clickText(host, "review");
  await sleep(900);
  const review = await panelText(host);
  note("step 3 is the review", /review/i.test(review), review.slice(0, 80));
  note("the review shows both players",
    review.includes(PLAYER1) && review.includes(PLAYER2), review.slice(0, 120));

  await clickText(host, "create");
  await sleep(1600);
  const lobby = await panelText(host);
  const invite = await host.eval(`(() => {
    const i = document.querySelector('#invite');
    return i ? i.value : '';
  })()`);
  const room = (invite.match(/room=([a-z0-9]+)/i) || [])[1] || "";
  note("a real code is accepted", /^[a-z0-9]{8}$/.test(room), invite || lobby.slice(0, 80));
  note("the host is told who they are", lobby.includes(PLAYER1), lobby.slice(0, 120));
  note("the reserved name is offered", lobby.includes(PLAYER2), lobby.slice(0, 120));
  await shot(host, `${W}-lobby-waiting`);

  /* ---------------------------------------------------------------- joining */

  section = "JOIN";
  // The invite link does not prefill the code field, so the joiner types it -
  // which is what a person would do.
  await guest.goto(URL_);
  await sleep(900);
  await clickText(guest, "join");
  await sleep(900);
  await fill(guest, "input[name=code]", room);
  await sleep(300);
  await clickText(guest, "next");
  await sleep(1000);

  const join2 = await panelText(guest);
  note("the joiner is told who they are joining", join2.includes(PLAYER1), join2.slice(0, 120));
  note("the joiner's name is already reserved", (await nameField(guest)) === PLAYER2, await nameField(guest));
  await pickCiv(guest, CIV2);
  await sleep(300);
  await clickText(guest, "join");
  await sleep(1800);
  const inLobby = await panelText(guest);
  note("the joiner reaches the lobby", /Both players are in the room/i.test(inLobby), inLobby.slice(0, 120));
  await shot(guest, `${W}-lobby-both`);

  /* ---------------------------------------------------------------- the board */

  section = "THE BOARD";
  // The lobby offers a way onto the board, and the wording is the board's to
  // choose, so any of them will do.
  for (const p of [host, guest]) {
    if (!(await p.eval(`!!document.querySelector('.board')`))) {
      await clickReal(p, "board");
      await sleep(1600);
    }
  }
  for (const p of [host, guest]) {
    const report = JSON.parse(await boardReport(p));
    if (!report.present) {
      note(`${p.label}: there is a board`, false, "no board on the page");
      continue;
    }
    boardNotes(p.label, report);
    await shot(p, `${W}-board-${p.label}`);
  }

  section = "BACK NAVIGATION";
  // Leaving the board goes back to the lobby; starting over from there is what
  // actually returns to the welcome screen, so both are pressed.
  await clickReal(host, "leave");
  await sleep(800);
  await clickReal(host, "start over");
  await sleep(900);
  // Back on the welcome screen, which means the two buttons a newcomer sees -
  // not merely a path that happens to be the same one.
  note("Start over returns to the welcome screen",
    await host.eval(`(() => {
      const b = [...document.querySelectorAll('button')].map((x) => x.textContent.trim());
      return b.length === 2 && /create/i.test(b[0]) && /join/i.test(b[1]);
    })()`),
    await host.eval(`[...document.querySelectorAll('button')].map((x) => x.textContent.trim()).join(' | ')`));
} finally {
  child.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}

/* ---------------------------------------------------------------- the summary */

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
for (const f of failed) console.log(`  - ${f.section}: ${f.label}${f.detail ? ` :: ${f.detail}` : ""}`);
process.exit(failed.length ? 1 : 0);

/* ----------------------------------------------------------- the board report */

function boardReport(s) {
  return s.eval(`(async () => {
    const board = document.querySelector('.board');
    if (!board) return JSON.stringify({ present: false, total: 0 });

    const PILL_LAYOUT = ${JSON.stringify(PILL_LAYOUT)};
    const hexToRgb = (h) => { const n = parseInt(h.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
    const tiles = [...board.querySelectorAll('.board__tile')];
    const corners = tiles.filter((t) => t.classList.contains('board__tile--corner'));
    const edges = tiles.filter((t) => !t.classList.contains('board__tile--corner'));
    const byArea = {};
    for (const t of tiles) byArea[t.dataset.area] = t;
    const areas = tiles.map((t) => t.dataset.area);
    const dupes = areas.filter((a, i) => areas.indexOf(a) !== i);
    const box = (el) => { const r = el.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1) }; };

    /* ------------------------------------------------------------- the ink scan

       Does any of this text touch its pill? Asked of the picture, not of the box.

       getBBox() on an SVG <text> reports a LAYOUT box rather than the glyphs, and
       at the size a card is actually drawn on a phone the two are not the same
       thing - which is how a check came to report a 28-unit title inside a box of
       42 units and blame the card for it. So each card is rasterised at the size
       the board draws it and the pixels are examined: a band just inside the
       pill's border is searched for any pixel near the title's own colour.
       Nothing there means the title is clear of every edge; title-coloured pixels
       there mean it is touching. A second look at the middle confirms the title
       actually drew, so the check can never pass by finding nothing at all. */
    const titleInk = await (async () => {
      const out = [];
      for (const svg of document.querySelectorAll('.space__card svg[data-card]')) {
        const pill = svg.querySelector('.title-pill rect');
        const text = svg.querySelector('.title-text');
        const vb = svg.getAttribute('viewBox').split(' ').map(Number);
        const want = hexToRgb((text.getAttribute('fill') || '#000').trim());
        const cardPx = svg.getBoundingClientRect().width;
        // four times the size the board uses, so a pixel here is a quarter of a
        // screen pixel there and a hairline cannot slip between samples
        const K = Math.max(4, Math.round((cardPx * 4) / vb[2]));
        const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const cv = document.createElement('canvas');
        cv.width = Math.round(vb[2] * K);
        cv.height = Math.round(vb[3] * K);
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, cv.width, cv.height);
        const px = g.getImageData(0, 0, cv.width, cv.height).data;
        const near = (i) => Math.abs(px[i] - want[0]) + Math.abs(px[i + 1] - want[1]) + Math.abs(px[i + 2] - want[2]) < 18;
        const rect = pill
          ? (() => { const b = pill.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()
          : (() => { const L = PILL_LAYOUT[vb[2]]; const b = text.getBBox(); return { x: L.x, y: L.y, w: b.x + b.width - L.x + 2, h: L.height }; })();
        const inset = Math.max(1, Math.round(K * 0.6));
        const x0 = Math.round(rect.x * K), x1 = Math.round((rect.x + rect.w) * K);
        const y0 = Math.round(rect.y * K), y1 = Math.round((rect.y + rect.h) * K);
        let edgeHits = 0, glyphHits = 0;
        for (let y = Math.max(0, y0 + inset); y < Math.min(cv.height, y1 - inset); y++) {
          for (let x = Math.max(0, x0 + inset); x < Math.min(cv.width, x1 - inset); x++) {
            if (!near((y * cv.width + x) * 4)) continue;
            glyphHits++;
            if (x - x0 < inset * 2 || x1 - x < inset * 2 || y - y0 < inset * 2 || y1 - y < inset * 2) edgeHits++;
          }
        }
        out.push({ key: svg.dataset.card, drew: glyphHits > 12, edgeHits, glyphHits });
      }
      return out;
    })();

    return JSON.stringify({
      present: true,
      titleInk,
      total: tiles.length,
      corners: corners.length,
      edges: edges.length,
      unique: new Set(areas).size,
      duplicates: dupes.length,
      duplicateList: dupes.join(','),
      width: +board.getBoundingClientRect().width.toFixed(1),
      height: +board.getBoundingClientRect().height.toFixed(1),
      landscape: edges.filter((t) => t.getBoundingClientRect().width > t.getBoundingClientRect().height).length,
      portrait: edges.filter((t) => t.getBoundingClientRect().height >= t.getBoundingClientRect().width).length,
      edgeSizes: edges.map((t) => +t.getBoundingClientRect().width.toFixed(1)),
      cornerSizes: corners.map((t) => +t.getBoundingClientRect().width.toFixed(1)),
      cornerNames: corners.map((t) => ((t.querySelector('.board__corner-name') || {}).textContent || '').trim()),
      cornerNameOverflow: ['tl', 'tr', 'bl', 'br'].map((a) => {
        const tile = byArea[a], n = tile && tile.querySelector('.board__corner-name');
        if (!tile || !n) return null;
        const t = tile.getBoundingClientRect(), r = n.getBoundingClientRect();
        const over = Math.max(0, t.left - r.left, r.right - t.right);
        return over > 0.5 ? a + ':' + over.toFixed(1) + 'px' : null;
      }).filter(Boolean),
      marks: tiles.filter((t) => t.querySelector('.board__star-mark')).length,
      code: board.dataset.room || '',
      who: [...document.querySelectorAll('.who__name')].map((n) => n.textContent),
      civs: [...document.querySelectorAll('.who__civ')].map((n) => n.textContent),
      spaces: tiles.filter((t) => t.matches('[data-space]')).map((t) => {
        const card = t.querySelector('.space__card svg[data-card]');
        const name = card ? card.querySelector('.title-text') : null;
        const pill = card ? card.querySelector('.title-pill rect') : null;
        return {
          area: t.dataset.area,
          top: +t.getBoundingClientRect().top.toFixed(1),
          kind: t.dataset.space,
          group: t.dataset.group || null,
          price: t.dataset.price || null,
          hasArt: !!card,
          cardKey: card ? card.dataset.card : null,
          cardType: card ? (card.dataset.type || 'property') : null,
          viewBox: card ? card.getAttribute('viewBox') : null,
          name: name ? name.textContent : '',
          nameColour: name ? (name.getAttribute('fill') || getComputedStyle(name).fill) : null,
          textLengthAttr: name ? name.getAttribute('textLength') : null,
          ground: getComputedStyle(t).backgroundColor,
          pillColour: pill ? pill.getAttribute('fill') : null,
          pillOpacity: pill ? pill.getAttribute('opacity') : null,
          pillBox: pill ? (() => { const b = pill.getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })() : null,
          clipId: (() => {
            const c = card && card.querySelector('clipPath');
            const g = card && card.querySelector('g[clip-path]');
            return { declared: c ? c.id : null, used: g ? g.getAttribute('clip-path') : null };
          })(),
          box: box(t),
          artBox: card ? box(card) : null,
          nameFits: name ? name.getBoundingClientRect().right <= t.getBoundingClientRect().right + 0.5 : true,
          printedPrice: t.textContent.includes('₹'),
        };
      }),
      noCardEffects: [...document.querySelectorAll('.space__card svg')].flatMap((svg) => {
        const tile = svg.closest('.board__tile');
        const area = tile && tile.dataset.area ? tile.dataset.area : '?';
        const html = svg.innerHTML;
        const hits = [];
        if (/linearGradient|radialGradient/i.test(html)) hits.push('gradient');
        if (html.indexOf('<filter') >= 0 || html.indexOf(' filter=') >= 0) hits.push('filter');
        if (html.indexOf('<image') >= 0) hits.push('image');
        if (/drop-shadow|box-shadow/i.test(html)) hits.push('shadow');
        // every url(#id) has to point at a clipPath, never at a gradient or a
        // filter - which is how a "flat" fill sneaks a gradient back in
        let at = html.indexOf('url(#');
        while (at >= 0) {
          const close = html.indexOf(')', at);
          const id = close < 0 ? '' : html.slice(at + 5, close);
          at = html.indexOf('url(#', close < 0 ? at : close);
          if (!id) continue;
          const node = svg.ownerDocument.getElementById(id);
          if (node && /Gradient|filter|fe[A-Z]/i.test(node.tagName)) hits.push('filter-url:' + id);
        }
        return hits.length ? [area + ':' + hits.join('+')] : [];
      }),
    });
  })()`);
}

/* ------------------------------------------------------- what the board must be */

function boardNotes(label, b) {
  note(`${label}: there is a board`, b.present, `${b.width}x${b.height}`);
  note(`${label}: 28 tiles in all`, b.total === 28, `${b.total} found`);
  note(`${label}: 4 corners`, b.corners === 4, `${b.corners}`);
  note(`${label}: 24 intermediate tiles`, b.edges === 24, `${b.edges}`);
  note(`${label}: no area used twice`, b.duplicates === 0, b.duplicateList);
  note(`${label}: every area distinct`, b.unique === 28, `${b.unique} distinct`);
  // Twelve one way and twelve the other, so the 24 are not all one width and
  // must not be compared as though they were: the twelve of a kind are
  // identical, and the other twelve are their transposes.
  const wide = b.edgeSizes.filter((w) => Math.abs(w - Math.max(...b.edgeSizes)) <= 1);
  const tall = b.edgeSizes.filter((w) => Math.abs(w - Math.min(...b.edgeSizes)) <= 1);
  const same = (a) => a.length > 0 && a.every((s) => Math.abs(s - a[0]) <= 0.6);
  note(`${label}: the twelve of a kind are identical, and so are the other twelve`,
    same(wide) && same(tall) && wide.length === 12 && tall.length === 12,
    `${wide.length} wide @${wide[0]} and ${tall.length} narrow @${tall[0]}`);
  note(`${label}: all 4 corners are identical`, same(b.cornerSizes), b.cornerSizes.join(" "));
  // Twelve one way and twelve the other, and that mix is deliberate: on a square
  // board a side cell and a top cell are transposes of each other, so exactly
  // one of them can be landscape.
  note(`${label}: the 24 tiles are the same shape as each other, rotated`,
    b.landscape === 12 && b.portrait === 12, `${b.portrait} portrait, ${b.landscape} landscape`);
  note(`${label}: the four corners are Omega, Start, Marketplace and Akash Core`,
    ["OMEGA", "START", "MARKETPLACE", "AKASH CORE"].every((n) => b.cornerNames.some((c) => c.toUpperCase().includes(n))),
    b.cornerNames.join(" | "));
  note(`${label}: no corner name is squeezed or clipped`, b.cornerNameOverflow.length === 0,
    b.cornerNameOverflow.join(" ") || "none");
  note(`${label}: every space that has a card renders one`, b.spaces.every((s) => s.hasArt),
    b.spaces.filter((s) => !s.hasArt).map((s) => s.area).join(", ") || "all six");
  note(`${label}: the twelve are on the left and top edges`,
    b.spaces.map((s) => s.area).sort().join(",") === "l1,l2,l3,l4,l5,l6,t1,t2,t3,t4,t5,t6",
    b.spaces.map((s) => s.area).join(","));
  // The pill is at its format's own place, read from the card module rather than
  // from a second copy of it written out here.
  note(`${label}: every property card's pill sits at its own format's place`,
    b.spaces.filter((s) => s.cardType === "property").every((s) => {
      if (!s.pillBox || s.pillBox.w <= 0) return false;
      const L = PILL_LAYOUT[Number(s.viewBox.split(" ")[2])];
      return L && s.pillBox.x === L.x && s.pillBox.y === L.y && s.pillBox.h === L.height;
    }),
    b.spaces.map((s) => (s.pillBox
      ? `${s.area}:${s.pillBox.x},${s.pillBox.y} ${s.pillBox.w}x${s.pillBox.h}`
      : `${s.area}:${s.cardType} none`)).join(" "));
  note(`${label}: the two chests have no pill at all`,
    b.spaces.filter((s) => !s.pillBox).length === 2 &&
      b.spaces.filter((s) => !s.pillBox).every((s) => s.cardType === "chest"));
  note(`${label}: the pills carry their group's colour`,
    b.spaces.filter((s) => s.pillColour).length === 10,
    b.spaces.map((s) => `${s.area}:${s.pillColour ?? "-"}`).join(" "));
  note(`${label}: every pill is at opacity 0.9`,
    b.spaces.filter((s) => s.pillColour).every((s) => s.pillOpacity === "0.9"));
  // White on a coloured pill, black on the two ivory chests - and a textLength
  // that makes the title hold its width whichever font finishes loading.
  note(`${label}: every title fits, with its textLength, in its own colour`,
    b.spaces.every((s) => {
      if (!s.textLengthAttr || Number(s.textLengthAttr) <= 0) return false;
      const want = s.cardType === "chest" ? "#241F19" : "#FFFFFF";
      return String(s.nameColour).toUpperCase() === want && s.nameFits;
    }),
    b.spaces.map((s) => `${s.area}(${s.cardType}):${s.nameColour} len=${s.textLengthAttr}`).join(" "));
  note(`${label}: no title touches its pill, and every title actually drew`,
    b.titleInk.length === 12 && b.titleInk.every((c) => c.drew && c.edgeHits === 0),
    b.titleInk.map((c) => `${c.key}: drew=${c.drew} ink=${c.glyphHits} onEdge=${c.edgeHits}`).join("  "));
  note(`${label}: clip ids are unique per instance`,
    b.spaces.every((s) => s.clipId.declared && s.clipId.used && s.clipId.used.includes(s.clipId.declared)),
    b.spaces.map((s) => `${s.area}:${s.clipId.used}`).join(" "));
  note(`${label}: no card uses a gradient, a filter or an image`,
    b.noCardEffects.length === 0, b.noCardEffects.join(" ") || "none in any of the six");
  note(`${label}: all six cards share one ivory ground`,
    new Set(b.spaces.map((s) => s.ground)).size === 1,
    [...new Set(b.spaces.map((s) => s.ground))].join(" "));
  note(`${label}: every card keeps its own format's ratio`,
    b.spaces.every((s) => s.artBox &&
      Math.abs(s.artBox.w / s.artBox.h - (s.artBox.w > s.artBox.h ? 328 / 212 : 190 / 300)) < 0.01),
    b.spaces.map((s) => (s.artBox ? `${s.area}: ${s.artBox.w}x${s.artBox.h}` : `${s.area}:no card`)).join("  "));
  note(`${label}: no space prints a price`, b.spaces.every((s) => !s.printedPrice),
    b.spaces.filter((s) => s.printedPrice).map((s) => s.area).join(",") || "none print one");
}
