/* ==========================================================================
   THE WHOLE GAME, IN A REAL BROWSER

   Two players, two separate browsers, the real flows: welcome, create, review,
   lobby, join, the board, and back out again. Everything is driven the way a
   person would drive it - real mouse events at the element's own coordinates,
   a name typed into a real field - and everything it says about the board is
   read off the rendered page.

   What this file used to check
   ---------------------------
   An earlier scripts/e2e.js asserted an 8x8 board: twenty-eight `.board__tile`
   elements addressed by data-area ("tl", "l1" ... "t6"), four of them corners,
   twenty-four intermediate tiles split twelve wide and twelve tall, and a card
   SVG inside every one of them. That board no longer exists and neither do its
   selectors, so none of those assertions could be carried across. What is here
   is written against the six-by-ten ring: twenty-eight `.board__cell` elements
   addressed by data-id and data-index, four corners, twenty properties with a
   pill, four chests without one, and no card artwork until a card is opened.

   It is NOT the old file rebuilt, and it does not claim to cover what the old
   one covered. In particular it no longer checks the card artwork's ink, its
   textLength, its pill opacity or its clip ids against the rendered board - the
   board does not draw cards, so there is nothing on the page to measure. Those
   are checked against the card module itself in test/shared.test.js instead.

     node scripts/e2e.js [--url ...] [--w 390] [--h 844] [--shots DIR]
   ========================================================================== */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};

const URL_ = arg("--url", "http://127.0.0.1:8791/samrajya/");
const W = Number(arg("--w", "390"));
const H = Number(arg("--h", "844"));
const DSF = Number(arg("--dsf", "3"));
const SHOTS = arg("--shots", null);
const HOST_NAME = arg("--p1", "Asha");
const GUEST_NAME = arg("--p2", "Vikram");
const HOST_CIV = arg("--civ1", "indus-valley");
const GUEST_CIV = arg("--civ2", "aztec");

if (SHOTS) await mkdir(SHOTS, { recursive: true });

/* ------------------------------------------------------------------ reporting */

const results = [];
let section = "";

function note(label, ok, detail = "") {
  results.push({ section, label, ok: Boolean(ok), detail: String(detail) });
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${!ok && detail ? `  ${detail}` : ""}`);
}

function heading(title) {
  section = title;
  console.log(`\n${title}`);
}

/* --------------------------------------------------------------- page acts */

const click = (page, text) => page.clickText(text);
const clickReal = (page, text) => page.clickText(text);

async function fill(page, value) {
  return page.eval(`(() => {
    const input = document.querySelector("input.field__input");
    if (!input) return "no field";
    input.focus();
    const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    write.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return "ok";
  })()`);
}

const pickCiv = (page, civ) =>
  page.eval(`(() => {
    const button = document.querySelector('.civ[data-civ=${JSON.stringify(civ)}]');
    if (!button) return false;
    button.click();
    return true;
  })()`);

const civState = (page) =>
  page.json(`
    return [...document.querySelectorAll(".civ[data-civ]")].map((b) => ({
      id: b.dataset.civ,
      on: b.getAttribute("aria-checked") === "true",
      dis: b.disabled || b.getAttribute("aria-disabled") === "true",
    }));
  `);

const nameField = (page) =>
  page.eval(`(() => {
    const i = document.querySelector("input.field__input");
    return i ? i.value : "";
  })()`);

const text = (page) =>
  page.eval(`(() => {
    const el = document.querySelector(".panel") || document.body;
    return (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
  })()`);

const hasField = (page, who) =>
  page.eval(`!!document.querySelector('input[aria-label*=${JSON.stringify(who)}]')`);

const hasComplaint = (page) => page.eval(`!!document.querySelector(".field__error")`);

async function shot(page, name) {
  if (!SHOTS) return;
  await writeFile(join(SHOTS, `${name}.png`), await page.screenshot());
}

/* ---------------------------------------------------------------- the board */

function boardReport(page) {
  return page.json(`
    const board = document.querySelector(".board");
    if (!board) return { present: false };

    const cells = [...board.querySelectorAll(".board__cell")];
    const corners = cells.filter((c) => c.classList.contains("board__cell--corner"));
    const chests = cells.filter((c) => c.classList.contains("board__cell--chest"));
    const properties = cells.filter((c) => c.classList.contains("board__cell--property"));
    const ids = cells.map((c) => c.dataset.id);
    const indexes = cells.map((c) => c.dataset.index);
    const box = (el) => { const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
               w: r.width, h: r.height }; };

    const centre = document.querySelector("#board-center");
    const centreStyle = centre ? getComputedStyle(centre) : null;

    return {
      present: true,
      total: cells.length,
      corners: corners.length,
      chests: chests.length,
      properties: properties.length,
      uniqueIds: new Set(ids).size,
      uniqueIndexes: new Set(indexes).size,
      duplicateIds: ids.filter((v, i) => ids.indexOf(v) !== i),
      duplicateIndexes: indexes.filter((v, i) => indexes.indexOf(v) !== i),

      // All twenty-eight the same square, corners included.
      sizes: [...new Set(cells.map((c) => {
        const r = c.getBoundingClientRect();
        return r.width.toFixed(3) + " x " + r.height.toFixed(3);
      }))],

      grounds: {
        corner: [...new Set(corners.map((c) => getComputedStyle(c).backgroundColor))],
        chest: [...new Set(chests.map((c) => getComputedStyle(c).backgroundColor))],
        property: [...new Set(properties.map((c) => getComputedStyle(c).backgroundColor))],
      },

      cornerNames: corners.map((c) => ({
        id: c.dataset.id,
        name: (c.querySelector(".board__corner-name")?.textContent || "").trim(),
        mark: !!c.querySelector(".board__mark--corner svg"),
        rule: !!c.querySelector(".board__corner-rule"),
        overflow: (() => {
          const t = box(c), n = box(c.querySelector(".board__corner-name"));
          return Math.max(0, t.left - n.left, n.right - t.right, t.top - n.top, n.bottom - t.bottom);
        })(),
      })),

      // Every property is a real button with its own id and index on it.
      propertiesAreButtons: properties.every(
        (c) => c.tagName === "BUTTON" && c.type === "button" &&
               c.dataset.id && c.dataset.index !== undefined,
      ),

      /* The wash, asked of the page rather than calculated here.

         The strength and the paper are read off the board's own computed style,
         and the expected colour is produced by asking the browser to run the
         same color-mix() the stylesheet runs. Nothing in this file knows what
         7% of #3F8F96 over #F7F4EF comes out as - the browser does the
         arithmetic, so this check cannot drift away from the CSS it is
         checking, and cannot be wrong about rounding. */
      wash: (() => {
        const s = getComputedStyle(document.querySelector(".board-screen"));
        const strength = s.getPropertyValue("--wash-strength").trim();
        const paper = s.getPropertyValue("--cell-ground").trim();
        const mix = (wash) => {
          const probe = document.createElement("div");
          probe.style.background = \`color-mix(in srgb, \${wash} \${strength}, \${paper})\`;
          document.body.appendChild(probe);
          const got = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return got;
        };
        return {
          strength,
          paper,
          chestWash: s.getPropertyValue("--chest-wash").trim(),
          cornerGround: s.getPropertyValue("--corner-ground").trim(),
          washedChest: mix(s.getPropertyValue("--chest-wash").trim()),
        };
      })(),

      propertyNames: properties.map((c) => ({
        id: c.dataset.id,
        label: (c.querySelector(".board__label")?.textContent || "").trim(),
        pillExists: !!c.querySelector(".board__pill"),
        pill: getComputedStyle(c.querySelector(".board__pill") || document.body).backgroundColor,
        ground: getComputedStyle(c).backgroundColor,
        set: c.dataset.set || null,
      })),
      chestNames: chests.map((c) => ({
        id: c.dataset.id,
        label: (c.querySelector(".board__label")?.textContent || "").trim(),
        pillExists: !!c.querySelector(".board__pill"),
        ground: getComputedStyle(c).backgroundColor,
        ink: getComputedStyle(c.querySelector(".board__label")).color,
        // A chest's name must read the same as a property's name.
        propertyInk: getComputedStyle(properties[0].querySelector(".board__label")).color,
      })),

      // Does any name stick out of its cell?
      overflow: cells.flatMap((c) => {
        const label = c.querySelector(".board__label") || c.querySelector(".board__corner-name");
        if (!label) return [];
        const t = box(c), l = box(label);
        const over = Math.max(0, t.left - l.left, l.right - t.right, t.top - l.top, l.bottom - t.bottom);
        return over > 0.5 ? [c.dataset.id + ":" + over.toFixed(1) + "px"] : [];
      }),

      // The cards are not on the board, and that is the state of the work.
      cardsOnBoard: board.querySelectorAll(".space__card, svg[data-card]").length,

      centreSpan: centreStyle
        ? centreStyle.gridColumnStart + "/" + centreStyle.gridColumnEnd + " " +
          centreStyle.gridRowStart + "/" + centreStyle.gridRowEnd
        : null,
      centreBox: centre ? box(centre) : null,

      /* The die, and the rectangle it is meant to be centred in.

         Rows 8 and 9, full width - which is the box that MOON, LAGRANGE POINT
         L2, MILKY WAY and RAMA describe. Stated here as the union of those four
         cells' own measured rectangles, so the check below is asking whether
         the die sits in the middle of THAT, rather than asking whether it sits
         where a hand-written offset happens to put it. */
      diceBox: (() => {
        const d = board.querySelector(".board__dice");
        return d ? box(d) : null;
      })(),
      rectangle: ["moon", "lagrange-l2", "milky-way", "rama"].reduce((acc, id) => {
        const c = board.querySelector('.board__cell[data-id="' + id + '"]');
        if (!c) return acc;
        const r = c.getBoundingClientRect();
        return acc === null
          ? { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }
          : {
              x0: Math.min(acc.x0, r.left),
              y0: Math.min(acc.y0, r.top),
              x1: Math.max(acc.x1, r.right),
              y1: Math.max(acc.y1, r.bottom),
            };
      }, null),
      diceFace: (() => {
        const d = board.querySelector(".board__dice");
        return d ? d.dataset.face : null;
      })(),
      diceAria: (() => {
        const d = board.querySelector(".board__dice");
        return d ? d.getAttribute("aria-label") : null;
      })(),
      diceVisibleFaces: [...board.querySelectorAll(".dice__face")].filter(
        (f) => !f.hasAttribute("hidden"),
      ).length,
      dicePips: board.querySelectorAll(".dice__pip").length,
      diceSettled: (() => {
        const d = board.querySelector(".board__dice");
        return d ? d.dataset.rolling : null;
      })(),
      ornamentGone: board.querySelectorAll(".board__star, .board__line, .board__centre-mark").length,

      /* The coins, read off the page rather than assumed.

         The two questions this answers cannot be asked any other way. Whether
         two coins OVERLAP is a question about two rectangles, and it changes with
         the cell size - an arrangement that fits at 390px wide can touch at
         320px. And whether the dice are refused mid-move is a question about an
         event arriving, which only a real browser can be asked.

         Overlap is measured with a tolerance of a pixel, because a shadow
         on a 40px disc is wider than the gap between two of them and a check
         that counted shadows would fail a correct layout. */
      coins: {
        count: board.querySelectorAll(".coin").length,
        moving: board.dataset.moving === "true",
        layerPointerEvents: (() => {
          const l = board.querySelector(".board__coins");
          return l ? getComputedStyle(l).pointerEvents : null;
        })(),
        positions: (board.coins?.state?.players || []).map((p) => ({
          id: p.id, position: p.position,
        })),
        rects: [...board.querySelectorAll(".coin")].map((c) => {
          const r = c.getBoundingClientRect();
          return { player: c.dataset.player, slot: c.dataset.slot, box: box(c), w: r.width, h: r.height };
        }),
        // The squares that carry a landing mark, and the card that is open.
        landed: [...board.querySelectorAll(".board__cell[data-landed]")]
          .map((c) => c.dataset.index),
        openCard: board.dataset.property || null,
        cardVisible: (() => {
          const h = board.querySelector(".board__card");
          return Boolean(h && !h.hidden && h.firstElementChild);
        })(),
      },

      board: box(board),
      screen: { w: innerWidth, h: innerHeight },
      scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      who: [...document.querySelectorAll(".who__name")].map((n) => n.textContent.trim()),
      civs: [...document.querySelectorAll(".who__civ")].map((n) => n.textContent.trim()),
    };
  `);
}

/* ----------------------------------------------------------------- the run */

const chrome = await launch({ port: 9780 + (process.pid % 40) });
let host;
let guest;

try {
  heading("WELCOME");

  // Two isolated contexts: each player holds their own identity, and a second
  // tab sharing storage would be the same player twice.
  const guestContext = await chrome.newContext();
  host = await chrome.newPage();
  guest = await chrome.newPage(guestContext);
  for (const page of [host, guest]) {
    await page.setViewport(W, H, DSF);
    await page.goto(URL_);
  }
  await sleep(700);

  const welcome = await host.json(`
    return {
      head: (document.querySelector("h1, h2") || {}).textContent || "",
      buttons: [...document.querySelectorAll("button")].map((b) => b.textContent.trim()),
    };
  `);

  note("the welcome screen names the game", /samrajya/i.test(welcome.head), welcome.head);
  note("and the word beneath it", /kalchakra/i.test(welcome.head), welcome.head);
  note(
    "and offers exactly two ways in, Create first",
    welcome.buttons.length === 2 &&
      /create/i.test(welcome.buttons[0]) &&
      /join/i.test(welcome.buttons[1]),
    welcome.buttons.join(" | "),
  );
  await shot(host, `${W}-welcome`);

  /* ----------------------------------------------------------------- create */

  heading("CREATE");

  await click(host, "create");
  await sleep(600);
  note("step one asks for Player 1", (await hasField(host, "Player 1")) && (await nameField(host)) === "");
  note("and puts the caret in the field", await host.eval("document.activeElement?.tagName === 'INPUT'"));

  await click(host, "next");
  await sleep(400);
  note("an empty name is refused", await hasField(host, "Player 1"));
  note("with something to read about it", await hasComplaint(host));

  await fill(host, HOST_NAME);
  await sleep(250);
  note("typing clears the complaint", !(await hasComplaint(host)));
  const chose = await pickCiv(host, HOST_CIV);
  const checked = await host.json(`
    return !!document.querySelector(
      '.civ[data-civ=${JSON.stringify(HOST_CIV)}][aria-checked="true"]',
    );
  `);
  note("a civilization can be chosen", chose && checked, `${HOST_CIV} ${checked ? "checked" : "not checked"}`);

  await click(host, "next");
  await sleep(700);
  note("step two asks for Player 2", await hasField(host, "Player 2"));
  note(
    "and Player 1's civilization is not offered to Player 2",
    (await civState(host)).some((c) => c.id === HOST_CIV && c.dis),
    JSON.stringify(await civState(host)),
  );

  await fill(host, GUEST_NAME);
  await pickCiv(host, GUEST_CIV);
  await sleep(250);
  await click(host, "review");
  await sleep(800);

  const review = await text(host);
  note("step three is the review", /review/i.test(review), review.slice(0, 70));
  note("and it shows both players", review.includes(HOST_NAME) && review.includes(GUEST_NAME), review.slice(0, 110));
  await shot(host, `${W}-review`);

  await click(host, "create");
  await sleep(1500);

  const lobby = await text(host);
  const invite = await host.eval(`(() => {
    const i = document.querySelector("#invite");
    return i ? i.value : "";
  })()`);
  const code = (invite.match(/room=([a-z0-9]+)/i) || [])[1] || "";

  note("creating gives a room with a real code", /^[a-z0-9]{8}$/.test(code), invite || lobby.slice(0, 80));
  note("the host is told who they are", lobby.includes(HOST_NAME), lobby.slice(0, 110));
  note("and that the other seat is waiting", lobby.includes(GUEST_NAME), lobby.slice(0, 110));
  await shot(host, `${W}-lobby-waiting`);

  /* ------------------------------------------------------------------- join */

  heading("JOIN");

  // The invite does not prefill the code, so the joiner types it, as a person would.
  await guest.goto(URL_);
  await sleep(700);
  await click(guest, "join");
  await sleep(700);
  await guest.eval(`(() => {
    const i = document.querySelector("input[name=code]");
    if (!i) return false;
    const write = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    write.call(i, ${JSON.stringify(code)});
    i.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(250);
  await click(guest, "next");
  await sleep(900);

  const arriving = await text(guest);
  note("the joiner is told who they are joining", arriving.includes(HOST_NAME), arriving.slice(0, 110));
  note("and the name is already reserved", (await nameField(guest)) === GUEST_NAME, await nameField(guest));
  await pickCiv(guest, GUEST_CIV);
  await sleep(250);
  await click(guest, "join");
  await sleep(1600);

  const together = await text(guest);
  note("the joiner reaches the lobby", /both players are in the room/i.test(together), together.slice(0, 110));
  await shot(guest, `${W}-lobby-both`);

  /* ------------------------------------------------------------------ board */

  heading("THE BOARD");

  for (const [label, page] of [["host", host], ["guest", guest]]) {
    if (!(await page.eval(`!!document.querySelector(".board")`))) {
      await clickReal(page, "board");
      await sleep(1500);
    }

    /* Answer whatever a turn put on the board and wait for the next throw to
       be allowed. A throw can open a buy card, an upgrade card, a rent card or
       a chest, and none of those is the end of the visit. The die loops below
       need the turn actually finished, not merely the die stopped. */
    await page.eval(`
      window.__finishVisit = async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const b = document.querySelector(".board");
        for (let i = 0; i < 320; i++) {
          if (b.dataset.reading === "true") {
            b.querySelector(".property-card__close")?.click();
            await wait(60);
            continue;
          }
          const g = b.game;
          if (g?.phase === "DECISION") {
            const holder = b.querySelector(".board__card");
            const chest = holder?.querySelector(".chest-card");
            if (chest) {
              const draw = chest.querySelector('[data-action="draw"]');
              if (draw && !draw.disabled) { draw.click(); await wait(60); continue; }
              const collect = chest.querySelector('[data-action="collect"]');
              if (collect && !collect.disabled) { collect.click(); await wait(60); continue; }
            } else {
              const next = holder?.querySelector(".property-card__next");
              if (next && !next.hidden && getComputedStyle(next).display !== "none") {
                next.click();
                await wait(90);
                continue;
              }
            }
          }
          if (
            g?.phase === "AWAITING_ROLL" &&
            b.dataset.moving !== "true"
          ) return true;
          await wait(60);
        }
        return false;
      };
    `);

    // The host drives; the guest is a mirror. The interactive checks below are
    // the host's. The guest is checked once, after the host's turn, for
    // agreement - which is the multiplayer fact the whole phase is about.
    if (label !== "host") continue;

    /* ------------------------------------------------ the card, pressed on

       Done before anything else is measured, because a card sitting in the
       middle of the board is underneath everything else. */

    const specials = await page.json(`
      const board = document.querySelector(".board");
      const IDS = ["start", "outer-space", "black-hole", "fight",
                   "ragnarok", "nexus", "epoch", "kronos"];
      for (const id of IDS) board.querySelector('.board__cell[data-id="' + id + '"]').click();
      return {
        pressed: IDS.length,
        tags: IDS.map((id) => board.querySelector('.board__cell[data-id="' + id + '"]').tagName),
        /* Which of the eight opened ITSELF a card.

           Asked as "is a card on screen" it would answer yes for every square
           after Ragnarok, because that card is still there - a corner does not
           dismiss somebody else's card. What is wanted is whether pressing this
           square put THIS square's card up, which is what the board's own
           record of what it is showing says. */
        opened: IDS.filter((id) => {
          board.querySelector('.board__cell[data-id="' + id + '"]').click();
          return board.dataset.property === id;
        }),
      };
    `);
    // Seven of the eight are still not buttons, and still open nothing.
    //
    // Ragnarok is the eighth and it is a BUTTON, which is a deliberate change.
    // The rule the other seven follow is that a square you cannot act on should
    // not be a button, because a button that does nothing is still one a reader
    // can find and press. Ragnarok now does something, so the rule no longer
    // applies to it - and a chest you can look at but not reach is worse than
    // one that is simply not there.
    note(`${label}: seven of the eight special squares are still not buttons`,
      specials.tags.filter((t) => t !== "BUTTON").length === 7,
      specials.tags.join(" "));
    note(`${label}: and of those eight, only Ragnarok opens a card`,
      specials.opened.length === 1 && specials.opened[0] === "ragnarok",
      `opened: ${specials.opened.join(" ") || "none"}`);
    note(`${label}: and Ragnarok opens it read-only, with no Draw`,
      await page.json(`
        const d = document.querySelector(".chest-card [data-action='draw']");
        return Boolean(d && d.disabled);
      `), "the Draw pill is there and disabled");

    await page.eval(`document.querySelector('.board__cell[data-id="moon"]').click()`);
    await sleep(900);

    const card = await page.json(`
      const board = document.querySelector(".board");
      const holder = board.querySelector(".board__card");
      const card = holder.querySelector(".property-card");
      const box = (el) => { const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                 w: r.width, h: r.height }; };
      const at = (id) =>
        board.querySelector('.board__cell[data-id="' + id + '"]').getBoundingClientRect();

      /* The rectangle the card is allowed to occupy: the middle itself, measured
         rather than described. A card that now owns the middle has to sit inside
         the middle and nowhere else. */
      const middle = board.querySelector("#board-center").getBoundingClientRect();
      const allowed = {
        l: middle.left,
        r: middle.right,
        top: middle.top,
        bottom: middle.bottom,
      };

      if (!card) return { present: false, hidden: holder.hidden };

      const name = card.querySelector(".property-card__name");
      const price = card.querySelector(".property-card__price");
      const lines = [...card.querySelectorAll(".property-card__description span")];
      const adv = card.querySelector(".property-card__advantage-text");
      const pill = card.querySelector(".property-card__pill");

      return {
        present: true,
        hidden: holder.hidden,
        property: card.dataset.property,
        set: card.dataset.set,
        accent: getComputedStyle(card).getPropertyValue("--accent").trim(),
        name: name ? name.textContent.replace(/\\s+/g, " ").trim() : "",
        nameLines: name ? name.children.length : 0,
        price: price ? price.textContent.trim() : "",
        descriptionLines: lines.length,
        description: lines.map((l) => l.textContent),
        // Anything wider or taller than its own box would be cut off.
        clipped: lines.filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent),
        clippedName: name ? name.scrollWidth > name.clientWidth + 1 : false,
        advantage: adv ? adv.textContent.trim() : "",
        advantageClipped: adv ? adv.scrollHeight > adv.clientHeight + 1 : false,
        pill: pill ? getComputedStyle(pill).backgroundColor : null,
        art: card.querySelector(".property-card__art--none")
          ? null : card.querySelector(".property-card__art-svg")?.dataset.art || null,
        box: box(card),
        holder: box(holder),
        allowed,
        die: box(board.querySelector(".board__dice")),
      };
    `);

    if (!card.present) {
      note(`${label}: pressing Moon opens a card`, false, "no card on the board");
    } else {
      note(`${label}: pressing Moon opens a card`, !card.hidden && card.property === "moon");
      note(`${label}: named MOON`, card.name === "MOON", card.name);
      note(`${label}: priced 200`, card.price === "₹200", card.price);
      note(`${label}: carrying the property's own accent`, card.accent === "#7B68B0", card.accent);
      note(`${label}: and a pill in that same colour`,
        card.pill === "rgb(123, 104, 176)", String(card.pill));
      note(`${label}: two lines of description`, card.descriptionLines === 2,
        card.description.join(" / "));
      note(`${label}: and a short advantage`, card.advantage.length > 20, card.advantage);
      note(`${label}: the artwork is the project's own`, card.art === "moon", String(card.art));

      const b = card.box;
      const a = card.allowed;

      /* THE CARD IS NO LONGER THREE ROWS TALL.
      
         It was, and it was checked that way: inside the rectangle the six tiles
         bound, on every side. It cannot be any more, because it now carries the
         owner, the rent and the Buy button as well as everything it carried
         before, and the only way to keep it three rows was to cut the advantage
         text off at the bottom edge.
      
         So what is checked here is what the rectangle was always a proxy for: the
         card is in the middle, it starts at the top of the middle, it does not
         run out of the middle sideways, and the popup does not reach the die. */
      note(`${label}: inside the rectangle the six tiles bound, side to side`,
        b.left >= a.l - 0.5 && b.right <= a.r + 0.5 && b.top >= a.top - 0.5,
        `card ${b.left.toFixed(0)}..${b.right.toFixed(0)} / ${b.top.toFixed(0)}..${b.bottom.toFixed(0)}` +
        `  allowed ${a.l.toFixed(0)}..${a.r.toFixed(0)} / ${a.top.toFixed(0)}..${a.bottom.toFixed(0)}`);

      // Equal margins, to within what a half-pixel board origin allows. The board
      // deliberately sits at a half pixel - it is centred - so demanding exact
      // equality here would be an assertion that can never pass, and the one
      // thing worth checking is that no side is noticeably tighter than another.
      // Side to side only, now: the card is flush with the top of the middle and
      // runs as far down as its contents need, so there is no bottom margin to
      // compare anything with.
      const gapL = b.left - a.l;
      const gapR = a.r - b.right;
      const gapT = b.top - a.top;
      note(`${label}: with an even margin on the left and right, so it floats`,
        Math.min(gapL, gapR, gapT) >= 2 && Math.abs(gapL - gapR) <= 2.5,
        `${gapL.toFixed(1)} / ${gapR.toFixed(1)} / ${gapT.toFixed(1)}`);
      note(`${label}: no text is clipped`, card.clipped.length === 0 &&
        !card.clippedName && !card.advantageClipped,
        card.clipped.length ? card.clipped.join(" / ") : "nothing clipped");
      // The read card now has the whole middle, and the die is out of the way
      // entirely - not merely transparent. So the thing to check is that the
      // sheet stays inside the middle it owns, and that the die has no box at
      // all while the card is up.
      note(`${label}: and the popup fills the middle without spilling out of it`,
        card.holder.bottom <= card.allowed.bottom + 0.5 &&
          card.holder.top >= card.allowed.top - 0.5 &&
          card.die.w === 0 && card.die.h === 0,
        `popup ${card.holder.top.toFixed(0)}..${card.holder.bottom.toFixed(0)} / ` +
          `middle bottom ${card.allowed.bottom.toFixed(0)}; die ` +
          `${card.die.w.toFixed(0)}x${card.die.h.toFixed(0)}`);
    }

    // A second property, to prove it turns rather than redrawing in place.
    await page.eval(`document.querySelector('.board__cell[data-id="dyson-sphere"]').click()`);
    await sleep(900);
    const second = await page.json(`
      const c = document.querySelector(".board__card .property-card");
      if (!c) return null;
      return {
        property: c.dataset.property,
        name: c.querySelector(".property-card__name").textContent.replace(/\\s+/g," ").trim(),
        price: c.querySelector(".property-card__price").textContent.trim(),
        accent: getComputedStyle(c).getPropertyValue("--accent").trim(),
        monogram: !!c.querySelector(".property-card__art--none"),
        art: c.querySelector(".property-card__art-svg")?.dataset.art || null,
      };
    `);
    // The two lines are the data's breaks, so the textContent of them runs
    // together: DYSON SPHERE is written as DYSON / SPHERE.
    note(`${label}: pressing Dyson Sphere shows its own card`,
      second && second.property === "dyson-sphere" &&
      second.name.replace(/\s/g, "") === "DYSONSPHERE" &&
      second.price === "₹900" && second.accent === "#C9A24A",
      second ? `${second.name} ${second.price} ${second.accent}` : "no card");
    // One of the ten that used to be a letter. It is a drawing now, and the
    // drawing is the board's own rather than one borrowed from a card.
    note(`${label}: and it is drawn, not spelled as a letter`,
      second?.monogram === false && second?.art === "dyson-sphere",
      `monogram ${second?.monogram}, art ${second?.art}`);

    /* --------------------------------- every property's drawing, one by one

       Half the collection - Earth 137 through Sagittarius A* - was a letter for
       a while, so this walks all twenty and asks each card what it drew. It is
       the check that could not be written any other way: whether a property has
       a picture depends on the artwork module answering and on the card falling
       through to it, and only a real card in a real browser knows that.

       Distinctness is asked for too, because twenty cards that all answer "yes"
       but share one drawing would pass a naive check and look like nothing was
       done at all. */

    const EVERY_PROPERTY = [
      "moon", "lagrange-l2", "asteroid-belt", "jupiter", "pluto",
      "kuiper-belt", "halleys-comet", "voyager-1", "proxima-centauri", "earth-137",
      "orions-belt", "wow-signal", "dyson-sphere", "wormhole", "milky-way",
      "rama", "quasar", "supernova", "sagittarius-a-star", "event-horizon",
    ];

    const drawnAll = [];
    for (const id of EVERY_PROPERTY) {
      await page.eval(`document.querySelector('.board__cell[data-id="${id}"]').click()`);
      await sleep(260);
      drawnAll.push(await page.json(`
        const c = document.querySelector(".board__card .property-card");
        if (!c) return null;
        const svg = c.querySelector(".property-card__art-svg");
        return {
          id: c.dataset.property,
          monogram: !!c.querySelector(".property-card__art--none"),
          art: svg ? svg.dataset.art : null,
          // Enough of the markup to tell two drawings apart, and no more than
          // enough to keep the report readable.
          shapes: svg ? svg.querySelectorAll("circle,ellipse,rect,path,polygon,line").length : 0,
          painted: svg ? svg.querySelectorAll("circle,ellipse,rect,path,polygon").length : 0,
        };
      `));
    }

    const missing = drawnAll.filter((d) => !d || d.monogram || !d.art).map((d) => d?.id);
    note(`${label}: all twenty properties are drawn, none is a letter`,
      drawnAll.length === 20 && missing.length === 0,
      missing.length ? `undrawn: ${missing.join(" ")}` : `${drawnAll.length} drawn`);

    note(`${label}: and each card's drawing is its own`,
      new Set(drawnAll.map((d) => d.art)).size === 20,
      `${new Set(drawnAll.map((d) => d.art)).size} distinct`);

    note(`${label}: every one of them actually puts ink on the page`,
      drawnAll.every((d) => d && d.painted >= 6),
      drawnAll.map((d) => `${d.id}:${d.painted}`).join(" "));

    /* -------------------------------------------------------------- the coins

       Everything here is measured off the rendered page. The overlap one cannot
       be asked anywhere else: two 14px discs with 1px shadows either side of them
       is a question about rectangles that changes with the cell size, and an
       arrangement that fits at 390px wide can touch at 320px. */

    /** Do two boxes overlap? A pixel of slack, for the shadows. */
    const overlaps = (a, b, slack = 1) =>
      a.left < b.right - slack && b.left < a.right - slack &&
      a.top < b.bottom - slack && b.top < a.bottom - slack;

    const start = await boardReport(page);
    const c0 = start.coins;

    note(`${label}: both players have a coin`,
      c0.count === start.who.length && c0.count >= 2,
      `${c0.count} coins for ${start.who.length} players`);

    note(`${label}: and they all start on Start`,
      c0.positions.length > 0 && c0.positions.every((p) => p.position === 0),
      c0.positions.map((p) => `${p.id}=${p.position}`).join(" "));

    note(`${label}: the coin layer takes no taps, so a square is still pressable`,
      c0.layerPointerEvents === "none", `pointer-events: ${c0.layerPointerEvents}`);

    note(`${label}: and two coins on Start do not overlap`,
      !c0.rects.some((r, i) => c0.rects.slice(i + 1).some((o) => overlaps(r.box, o.box))),
      c0.rects.map((r) => `${r.player}@${r.box.left.toFixed(0)},${r.box.top.toFixed(0)}`).join(" "));

    note(`${label}: each coin is about 0.36 of a cell across`,
      c0.rects.every((r) => r.w > 4 && r.w < 30),
      c0.rects.map((r) => `${r.w.toFixed(1)}px`).join(" "));

    /* A move, driven through the same function the die calls. Three puts a coin
       on Asteroid Belt, which is a property - so the landing has a card to open,
       and the two squares it crossed must not be marked or opened. */
    await page.eval(`
      (async () => {
        const c = document.querySelector(".board").coins;
        c.reset();
        await c.movePlayer("seat-0", 3);
        return true;
      })()
    `);
    await sleep(1800);
    const landed = await boardReport(page);
    const cl = landed.coins;

    note(`${label}: a coin moves to the square the die named`,
      cl.positions[0].position === 3,
      cl.positions.map((p) => `${p.id}=${p.position}`).join(" "));

    note(`${label}: only the destination is marked`,
      cl.landed.length === 1 && cl.landed[0] === "3",
      `marked: ${cl.landed.join(" ") || "none"} (destination is 3)`);

    note(`${label}: and only the destination opens its card`,
      cl.cardVisible && cl.openCard === "asteroid-belt",
      `open: ${cl.openCard}, visible ${cl.cardVisible}`);

    note(`${label}: the squares it crossed get neither`,
      !cl.landed.includes("1") && !cl.landed.includes("2"),
      `1 and 2 are marked: ${cl.landed.includes("1")}/${cl.landed.includes("2")}`);

    /* Wrapping. Twenty-seven from Start is Fight, and one more is Start - so the
       coin has to come back round rather than walk off the end of the board. */
    await page.eval(`
      (async () => {
        const c = document.querySelector(".board").coins;
        c.reset();
        await c.movePlayer("seat-0", 27);
        await c.movePlayer("seat-0", 1);
        return true;
      })()
    `);
    await sleep(2200);
    const wrapped = await boardReport(page);
    const cw = wrapped.coins;

    note(`${label}: wrapping past Start brings the coin home`,
      cw.positions[0].position === 0,
      cw.positions.map((p) => `${p.id}=${p.position}`).join(" "));

    note(`${label}: and a corner gets the mark but no card`,
      cw.landed.length === 1 && cw.landed[0] === "0" && !cw.cardVisible,
      `marked ${cw.landed.join(" ")}, card visible ${cw.cardVisible}`);

    /* Two coins on one square. Both are driven to Asteroid Belt, which is what
       two threes would do, and the question is whether they can both be seen. */
    await page.eval(`
      (async () => {
        const c = document.querySelector(".board").coins;
        c.reset();
        await c.movePlayer("seat-1", 3);
        await c.movePlayer("seat-0", 3);
        return true;
      })()
    `);
    await sleep(2200);
    const shared = await boardReport(page);
    const cs = shared.coins;

    note(`${label}: two coins can stand on one square`,
      cs.positions.filter((p) => p.position === 3).length === 2,
      cs.positions.map((p) => `${p.id}=${p.position}`).join(" "));

    note(`${label}: and when they do, they do not overlap`,
      !cs.rects.some((r, i) => cs.rects.slice(i + 1).some((o) => overlaps(r.box, o.box))),
      cs.rects.map((r) => `${r.player} slot ${r.slot} at ${r.box.left.toFixed(0)},${r.box.top.toFixed(0)}`).join(" | "));

    note(`${label}: and each takes a different slot`,
      new Set(cs.rects.map((r) => r.slot)).size === cs.rects.length,
      cs.rects.map((r) => `${r.player}:${r.slot}`).join(" "));

    /* The die is refused while a coin is in the air.

       Asked by throwing one, which is the only way the question arises: if the
       throw went through, the turn would advance and a second move would be
       started off one roll.

       The thing watched is the TURN, not the coin. A coin's own position while
       it is mid-hop changes on every frame by design, so comparing it before
       and after proves nothing - the first version of this check compared
       positions and passed or failed for reasons that had nothing to do with
       the die. The turn advancing is the observable that means a throw was
       actually accepted. */
    const during = await page.eval(`
      (async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const b = document.querySelector(".board");
        const die = b.querySelector(".board__dice");
        const pill = b.querySelector(".board__turn");
        const seatNow = () => pill.dataset.turn;

        const moving = b.coins.movePlayer("seat-0", 6);
        await wait(120);
        const wasMoving = b.dataset.moving === "true";
        const seatBefore = seatNow();
        const faceBefore = die.dataset.face;

        // Throw while the coin is in the air.
        die.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await wait(320);
        const seatAfter = seatNow();
        const faceAfter = die.dataset.face;

        await moving;
        await wait(200);
        return {
          wasMoving,
          seatBefore, seatAfter,
          faceBefore, faceAfter,
          unlocked: b.dataset.moving !== "true",
        };
      })()
    `);
    note(`${label}: the coin is in the air while it moves`,
      during.wasMoving, `board said moving=${during.wasMoving}`);
    note(`${label}: the die is refused mid-move, so one roll moves one coin`,
      during.seatAfter === during.seatBefore && during.faceAfter === during.faceBefore,
      `turn ${during.seatBefore} stayed ${during.seatAfter}; die ${during.faceBefore} stayed ${during.faceAfter}`);
    note(`${label}: and it is unlocked afterwards`,
      during.unlocked, `board still moving=${!during.unlocked}`);

    /* ---------------------------------------------------------------- ragnarok

       Everything here is about one square. It cannot be asked of the other
       chests - Nexus, Epoch and Kronos have no purpose decided yet, and asking
       them questions would mean inventing answers for them. */

    const READ_CHEST = `
      const b = document.querySelector(".board");
      const card = b.querySelector(".chest-card");
      const holder = b.querySelector(".board__card");
      const centre = b.querySelector("#board-center");
      const draw = card?.querySelector('[data-action="draw"]');
      const collect = card?.querySelector('[data-action="collect"]');
      const box = (e) => { const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      return {
        open: Boolean(card),
        phase: card?.dataset.phase || null,
        kind: holder?.dataset.cardKind || null,
        drawPresent: Boolean(draw),
        drawDisabled: draw ? draw.disabled : null,
        collectPresent: Boolean(collect),
        title: card?.querySelector(".property-card__name")?.textContent || "",
        kind_: card?.querySelector(".chest-card__kind")?.textContent || "",
        price: card?.querySelector(".property-card__price") ? true : false,
        slots: card ? card.querySelectorAll(".chest-card__slot").length : 0,
        slotNames: [...(card?.querySelectorAll(".chest-card__slot-name") || [])].map((n) => n.textContent),
        drew: card?.querySelector(".chest-card__drew")?.textContent || "",
        targets: [...(card?.querySelectorAll(".chest-card__target") || [])].map((n) => n.textContent),
        blurb: card?.querySelector(".chest-card__blurb")?.textContent || "",
        // Does the card stay inside the ring? Read AFTER the turn animation has
        // finished: a rotateY in flight inflates the bounding box, and measuring
        // mid-turn reports a card that is nowhere near overflowing.
        settled: !card || holder.getAnimations().every((a) => a.playState !== "running"),
        insideMiddle: !card ? true :
          box(card).top >= box(centre).top - 0.5 && box(card).bottom <= box(centre).bottom + 0.5,
        overflows: card ? card.scrollHeight > card.clientHeight + 1 : false,
        insideRing: !card ? true :
          box(card).left >= box(b).left - 0.5 && box(card).right <= box(b).right + 0.5,
        // Does the title say all of itself?
        titleClipped: card
          ? [...card.querySelectorAll(".property-card__name span")]
              .some((s) => s.scrollWidth > s.clientWidth + 1)
          : false,
        /* The title's lines, kept apart. textContent joins two spans with nothing
           between them, so "Welcome to" and "Ragnarok" arrive as
           "Welcome toRagnarok" - a string the card never says, and one that
           would make the comparison below fail for the wrong reason. */
        titleLines: [...(card?.querySelectorAll(".property-card__name span") || [])]
          .map((n) => n.textContent),
        // The numbers, so a geometry failure can say which edge is out.
        geometry: (() => {
          if (!card) return null;
          const c = box(card), m = box(centre);
          return {
            top: c.top.toFixed(1) + " (middle " + m.top.toFixed(1) + ")",
            bottom: c.bottom.toFixed(1) + " (middle " + m.bottom.toFixed(1) + ")",
          };
        })(),
        // What the player is carrying.
        weapons: b.coins.state.players.map((p) => p.id + "=[" + p.weapons.join(",") + "]"),
        dots: document.querySelectorAll(".who__weapon").length,
        count: document.querySelector(".who__weapons")?.dataset.count || "0",
        whoOverflow: (() => {
          const chips = [...document.querySelectorAll(".who")];
          return chips.some((c) => c.scrollWidth > c.clientWidth + 1);
        })(),
      };
    `;

    /* Land on Ragnarok the way a turn does: the active piece is put back on
       Start (setup only), then a real roll of four is played. The roll, the
       walk, the landing and the chest are all the game's own. */
    const landOnRagnarok = async () => page.eval(`
      (async () => {
        const b = document.querySelector(".board");
        const g = b.game;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        // The previous chest's turn may still be finishing. A throw into a busy
        // board is refused, which would leave nothing to draw.
        if (b.dataset.reading === "true") {
          b.querySelector(".property-card__close")?.click();
        }
        for (let i = 0; i < 120; i++) {
          if (b.game.phase === "AWAITING_ROLL" && b.dataset.rollable === "true") break;
          await wait(50);
        }
        // Hand the turn to the host and put the piece on Start, through the
        // server's test hook, because the server owns both.
        await b.play({ type: "debug", active: 0 });
        await b.play({ type: "debug", position: 0 });
        for (let i = 0; i < 120; i++) {
          if (b.game.phase === "AWAITING_ROLL" && b.dataset.rollable === "true") break;
          await wait(50);
        }
        /* Started, not awaited. A landing on a chest is settled by the draw,
           and the turn only returns after the chest is answered - so awaiting
           this promise here would wait for the click the checks make next. */
        b.play({ type: "roll", rng: 0.55 });
        return true;
      })()
    `);
    const settle = () => sleep(2600);

    // Landed on it: drawable.
    await landOnRagnarok();
    await settle();
    const chestLanded = await page.json(READ_CHEST);

    note(`${label}: landing on Ragnarok opens the chest card by itself`,
      chestLanded.open && chestLanded.kind === "chest",
      `open ${chestLanded.open}, kind ${chestLanded.kind}`);
    note(`${label}: with a Draw that is not disabled`,
      chestLanded.drawPresent && chestLanded.drawDisabled === false,
      `present ${chestLanded.drawPresent}, disabled ${chestLanded.drawDisabled}`);
    note(`${label}: it says what it is in its title, and quotes no price`,
      chestLanded.kind_ === "" && !chestLanded.price,
      `label "${chestLanded.kind_}", price shown ${chestLanded.price}`);
    note(`${label}: and its title is not cut short`,
      chestLanded.titleLines.join(" ") === "Welcome to Ragnarok" && !chestLanded.titleClipped,
      `"${chestLanded.titleLines.join(" ")}", clipped ${chestLanded.titleClipped}`);
    note(`${label}: three face-down cards, each named`,
      chestLanded.slots === 3 &&
      chestLanded.slotNames.join("|") === "Antimatter Weapon|Nuclear Warhead|Eye of Shiva",
      chestLanded.slotNames.join(" | "));
    note(`${label}: the card stays inside the ring, and inside the middle`,
      chestLanded.insideMiddle && chestLanded.insideRing,
      `middle ${chestLanded.insideMiddle}, ring ${chestLanded.insideRing}; top ${chestLanded.geometry?.top}, bottom ${chestLanded.geometry?.bottom}`);
    note(`${label}: and it does not overflow its own box`,
      !chestLanded.overflows, `scrolls past its own bottom: ${chestLanded.overflows}`);

    /* It cannot be dismissed before the draw is answered. Tried three ways:
       another square, the same square, and a new throw. */
    await sleep(500);
    await page.eval(`
      (async () => {
        const b = document.querySelector(".board");
        // Forced to a weapon, and forced for the WHOLE shuffle.
        window.__drawRng = 0.15;   // forces a weapon, not bad luck
        const draw = b.querySelector('[data-action="draw"]');
        if (draw) draw.click();
        return draw ? "clicked" : "no button";
      })()
    `);
    await sleep(500);
    const locked = await page.json(READ_CHEST);
    const stayedPut = await page.eval(`
      (async () => {
        const b = document.querySelector(".board");
        b.querySelector('.board__cell[data-id="moon"]').click();
        await new Promise((r) => setTimeout(r, 300));
        const afterSquare = Boolean(b.querySelector(".chest-card"));

        b.querySelector('.board__cell[data-id="ragnarok"]').click();
        await new Promise((r) => setTimeout(r, 300));
        const afterSame = Boolean(b.querySelector(".chest-card"));

        b.querySelector(".board__dice").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
        return { afterSquare, afterSame, stillChest: Boolean(b.querySelector(".chest-card")) };
      })()
    `);
    note(`${label}: it cannot be closed before the draw is answered`,
      locked.phase === "drawing" && stayedPut.afterSquare && stayedPut.afterSame && stayedPut.stillChest,
      `phase ${locked.phase}; survived a square ${stayedPut.afterSquare}, itself ${stayedPut.afterSame}, a throw ${stayedPut.stillChest}`);

    // Let the draw finish, then collect. The forced generator is put back here,
    // once the draw has actually happened.
    await sleep(1600);
    await page.eval(`(() => { delete window.__drawRng; return true; })()`);
    const chestRevealed = await page.json(READ_CHEST);
    note(`${label}: a weapon says what it is and what it reaches`,
      /^You drew the /.test(chestRevealed.drew) &&
      chestRevealed.targets.length >= 6 && chestRevealed.blurb.length > 20,
      `"${chestRevealed.drew}", ${chestRevealed.targets.length} targets`);
    note(`${label}: and every target is named as its own tile names it`,
      chestRevealed.targets.every((t) => t.trim().length > 2),
      chestRevealed.targets.join(" | "));

    const before = chestRevealed.weapons.join(" ");
    await page.eval(`document.querySelector('[data-action="collect"]').click(); true;`);
    await sleep(1400);
    const collected = await page.json(READ_CHEST);
    note(`${label}: collecting adds exactly one weapon`,
      collected.weapons[0] !== before && collected.weapons[0].includes("]") &&
      !collected.weapons[0].endsWith("=[]") &&
      collected.dots === 1,
      `${before} -> ${collected.weapons.join(" ")}, ${collected.dots} dots`);
    note(`${label}: and the card closes`,
      !collected.open, `open ${collected.open}`);

    /* Bad luck. Forced, so the branch is seen rather than waited for. */
    await landOnRagnarok();
    await settle();
    await page.eval(`
      (async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        window.__drawRng = 0.97;   // the last tenth of the roll
        document.querySelector('[data-action="draw"]').click();
        await wait(1500);
        delete window.__drawRng;
        return true;
      })()
    `);
    await sleep(400);
    // Polled rather than waited for. The line appears about two seconds after
    // the tap - a nine-hundred-millisecond shuffle, then the shake, and only
    // then the sentence - and a fixed sleep that guesses wrong fails for a
    // reason that has nothing to do with bad luck.
    await page.eval(`
      (async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let i = 0; i < 80; i++) {
          if (document.querySelector(".chest-card__drew")) break;
          await wait(50);
        }
        return true;
      })()
    `);
    const bad = await page.json(READ_CHEST);
    note(`${label}: bad luck says so and adds nothing`,
      bad.drew === "Bad luck. Try next time." && bad.collectPresent === false,
      `"${bad.drew}", collect offered ${bad.collectPresent}`);

    await sleep(2600);
    const afterBad = await page.json(READ_CHEST);
    note(`${label}: and closes itself, having given no weapon`,
      !afterBad.open && afterBad.dots === 1,
      `open ${afterBad.open}, dots still ${afterBad.dots}`);

    /* The chip at 360px with seven weapons. Six dots and a count, so the name is
       never the thing that gets squeezed. */
    await page.setViewport(360, 800, DSF);
    await sleep(400);
    await page.eval(`
      (async () => {
        const b = document.querySelector(".board");
        const p = b.coins.state.players[0];
        p.weapons = ["antimatter","nuclear","shiva","nuclear","shiva","antimatter","nuclear"];
        const m = await import("/samrajya/assets/js/chest-card.js");
        m.renderWeapons(document, 0, p.weapons);
        return true;
      })()
    `);
    await sleep(300);
    const chip = await page.json(READ_CHEST);
    note(`${label}: seven weapons show six dots and a count at 360px`,
      chip.dots === 6 && chip.count === "7" && !chip.whoOverflow,
      `${chip.dots} dots, count "${chip.count}", chip overflowing ${chip.whoOverflow}`);

    await page.setViewport(W, H, DSF);
    await sleep(400);
    await page.eval(`
      (async () => {
        const b = document.querySelector(".board");
        b.coins.state.players[0].weapons = [];
        const m = await import("/samrajya/assets/js/chest-card.js");
        m.renderWeapons(document, 0, []);
        return true;
      })()
    `);

    /* ------------------------------------------------------------- the die */

    /* Bring the board back to a state where the die is this seat's to throw.
       The card is gone and the turn is finished, because the die is display:none
       while anything is being read or while the other seat is playing - and a
       zero-sized box is not a die to measure. */
    await page.eval(`(async () => {
      const b = document.querySelector(".board");
      const d = b.querySelector(".board__dice");
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 80 && d.dataset.rolling === "true"; i++) await wait(50);
      await window.__finishVisit();
      const seat = Number(document.querySelector(".who--me")?.dataset.seat ?? 0);
      await b.play({ type: "debug", active: seat });
      await b.play({ type: "debug", position: 0 });
      for (let i = 0; i < 80 && d.dataset.rolling === "true"; i++) await wait(50);
      return true;
    })()`);
    await sleep(300);

    const dieBefore = await page.json(`
      const d = document.querySelector(".board__dice");
      const b = document.querySelector(".board");
      return {
        face: d.dataset.face, rolling: d.dataset.rolling,
        label: d.getAttribute("aria-label"),
        pips: d.querySelectorAll(".dice__pip").length,
        shown: [...d.querySelectorAll(".dice__face")].filter((f) => !f.hasAttribute("hidden")).length,
        rim: getComputedStyle(d.querySelector(".dice__body")).strokeWidth,
        width: d.getBoundingClientRect().width,
        cell: parseFloat(getComputedStyle(document.querySelector(".board")).gridTemplateColumns.split(" ")[0]),
        scrollBefore: [document.documentElement.scrollWidth - document.documentElement.clientWidth,
                       document.documentElement.scrollHeight - document.documentElement.clientHeight],
      };
    `);

    note(`${label}: the die shows the one face it last threw`,
      /^[1-6]$/.test(dieBefore.face) && dieBefore.shown === 1,
      `face ${dieBefore.face}, ${dieBefore.shown} faces showing, says "${dieBefore.label}"`);
    note(`${label}: and it is about half the size it was`,
      dieBefore.width <= dieBefore.cell * 0.7 && dieBefore.width >= dieBefore.cell * 0.5,
      `${dieBefore.width.toFixed(1)}px in a ${dieBefore.cell.toFixed(0)}px cell`);
    note(`${label}: its rim is thin`,
      parseFloat(dieBefore.rim) <= 3, `${dieBefore.rim}`);

    // The pips are the board's own set colours, so this asks the browser what is
    // actually painted rather than what the markup claims. A die that fell back
    // to the ink colour would look perfectly plausible and would be wrong.
    const painted = await page.json(`
      const d = document.querySelector(".board__dice");
      const faces = [...d.querySelectorAll(".dice__face")];
      const hex = (rgb) => {
        const [r, g, b] = rgb.match(/\\d+/g).map(Number);
        return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0"))
          .join("").toUpperCase();
      };
      return faces.map((f) => hex(getComputedStyle(f.querySelector(".dice__pip")).fill));
    `);
    note(`${label}: and its six faces are painted in six set colours`,
      new Set(painted).size === 6 && painted.every((c) => /^#[0-9A-F]{6}$/.test(c)) &&
        painted.includes("#7B68B0") && painted.includes("#C9A24A"),
      painted.join(" "));

    // Make sure the host is the one whose turn it is, so the throw is actually his.
    await host.eval(`(async () => {
      const b = document.querySelector(".board");
      await b.play({ type: "debug", active: 0 });
      await b.play({ type: "debug", position: 0 });
      return true;
    })()`);
    await sleep(200);

    // Press it, and watch.
    const thrown = await page.json(`
      const d = document.querySelector(".board__dice");
      const board = document.querySelector(".board");
      const g = board.game;
      const seen = new Set();
      const box = () => d.getBoundingClientRect();
      const before = box();
      const cx = (r) => r.left + r.width / 2;
      const cy = (r) => r.top + r.height / 2;
      const x0 = cx(before);
      const y0 = cy(before);
      let moved = 0;
      let mid = false;
      // Debug: what state is the die in before the throw?
      const pre = { phase: g.phase, active: g.active, rollable: board.dataset.rollable, mySeat: board.dataset.mySeat };
      // An SVG element has no .click() of its own - click() lives on
      // HTMLElement - so the event is dispatched, which is also what a tap does.
      d.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let i = 0; i < 40; i++) {
        if (d.dataset.rolling === "true") { mid = true; seen.add(d.dataset.face); }
        // Only a box that exists is a position. Once the turn is over the die
        // is display:none, and measuring that would read as a jump to 0,0.
        const r = box();
        if (r.width > 0) {
          moved = Math.max(moved, Math.abs(cx(r) - x0) + Math.abs(cy(r) - y0));
        }
        await new Promise((r) => setTimeout(r, 40));
      }
      return {
        sawRolling: mid,
        distinct: [...seen].filter((f) => f !== "0").length,
        face: d.dataset.face,
        rolling: d.dataset.rolling,
        label: d.getAttribute("aria-label"),
        shown: [...d.querySelectorAll(".dice__face")].filter((f) => !f.hasAttribute("hidden")).length,
        // A throw must not move the die's centre while it is up. The box is
        // allowed to vanish when the turn ends - a hidden die is display:none
        // now - so this is the largest offset seen among boxes that existed.
        moved,
        boardMoved: JSON.stringify([document.documentElement.scrollWidth - document.documentElement.clientWidth,
                                     document.documentElement.scrollHeight - document.documentElement.clientHeight]) !==
                     JSON.stringify([0, 0]) ? "yes" : "no",
        pre,
      };
    `);

    note(`${label}: pressing it throws it`, thrown.sawRolling && thrown.distinct > 1,
      `${thrown.distinct} faces passed through`);
    note(`${label}: and it settles on one from one to six`,
      /^[1-6]$/.test(thrown.face) && thrown.rolling === "false" && thrown.shown === 1,
      `face ${thrown.face}, rolling=${thrown.rolling}, says "${thrown.label}"`);
    note(`${label}: the throw moved nothing`,
      thrown.moved < 2 && thrown.boardMoved === "no",
      `die moved ${thrown.moved.toFixed(2)}px`);

    // That throw was a real turn: finish whatever it opened before throwing
    // again.
    await page.eval("window.__finishVisit()");

    // Six more presses. Asserting any two results DIFFER would be flaky - a repeat
    // is a legitimate outcome, one time in six - so what is checked is that every
    // press really throws and really lands on a face, and that the results are
    // not stuck on one number.
    const repeats = await page.json(`
      const b = document.querySelector(".board");
      const d = b.querySelector(".board__dice");
      const faces = [];

      /* Answer any visit a throw put up, so the next press is not into a locked
         die. See window.__finishVisit for why this is needed. */
      const finishVisit = () => window.__finishVisit();

      // The throw before this block may have handed the turn on. Bring it back
      // first, or the first press is into a die that is not on this screen.
      const meNow = Number(document.querySelector(".who--me")?.dataset.seat ?? 0);
      for (let k = 0; k < 12; k += 1) {
        if (b.dataset.busy !== "true" && b.dataset.reading !== "true" &&
            b.game.phase === "AWAITING_ROLL" && b.game.active === meNow) break;
        await finishVisit();
        await b.play({ type: "debug", active: meNow });
        await new Promise((r) => setTimeout(r, 80));
      }

      for (let n = 0; n < 6; n++) {
        d.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        let moved = false;
        for (let i = 0; i < 120; i++) {
          if (d.dataset.rolling === "true") moved = true;
          const settled = moved && d.dataset.rolling === "false";
          // The coin has to have landed too. A throw also walks a coin, and the
          // die is refused while one is in the air - so pressing again the
          // moment the die stops would be pressing into a locked die. This loop
          // used to wait only for the die, and passed by a lucky margin.
          if (settled && b.dataset.moving !== "true") break;
          await new Promise((r) => setTimeout(r, 40));
        }
        await finishVisit();
        // The turn has just passed to the other seat, and this screen cannot
        // throw for them. Hand the turn back through the test hook so the next
        // press is a real press and not a refusal on a hidden die.
        const me = Number(document.querySelector(".who--me")?.dataset.seat ?? 0);
        for (let k = 0; k < 12; k += 1) {
          if (b.dataset.busy !== "true" && b.dataset.reading !== "true" &&
              b.game.phase === "AWAITING_ROLL" && b.game.active === me) break;
          await finishVisit();
          await b.play({ type: "debug", active: me });
          await new Promise((r) => setTimeout(r, 80));
        }
        faces.push(d.dataset.face);
      }
      return faces;
    `);
    note(`${label}: six presses, six throws, all landing on a face`,
      repeats.length === 6 && repeats.every((f) => /^[1-6]$/.test(f)), repeats.join(" "));
    note(`${label}: and the results are not stuck on one number`,
      new Set(repeats).size >= 2, `${new Set(repeats).size} distinct in six`);

    // The turn pill, the die's outline, and the matchup. Asked together because
    // they are the three refinements, and because each one is a claim about the
    // same middle of the same board.

    // The die is only on this seat's screen on this seat's turn, so put the turn
    // back here before asking where the die and its pill sit.
    await page.eval(`(async () => {
      const b = document.querySelector(".board");
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) await wait(50);
      await window.__finishVisit();
      for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) await wait(50);
      const seat = Number(document.querySelector(".who--me")?.dataset.seat ?? 0);
      await b.play({ type: "debug", active: seat });
      await wait(300);
      return true;
    })()`);
    await sleep(300);

    const trio = await page.json(`
      const board = document.querySelector(".board");
      const centre = document.querySelector("#board-center");
      const die = board.querySelector(".board__dice");
      const pill = board.querySelector(".board__turn");
      const box = (el) => { const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; };

      /* The pill, thrown four times, so the alternation is seen rather than
         assumed. Each press is given time to land - the turn moves on landing,
         not on the tap, which is the whole difference between this and a
         counter that counts touches.

         Waiting is for the WHOLE turn, not just for the die to stop rolling. A
         throw now also walks a coin, and the die is refused while that coin is
         in the air - so waiting only for the roll would have the second press
         refused by the very rule the game now has, and four throws would read
         as one. The board says so itself: data-moving is set for exactly as
         long as a coin is travelling. */
      const turns = [];
      /* Finish whatever a throw put on the board.

         A throw now also walks a coin, and landing on Ragnarok puts a chest
         card up that cannot be dismissed until the draw is answered - so that
         turn is not over when the die stops, it is over when the visit is. A
         loop that threw four times in a row would press into a locked die and
         read four throws as two or three.

         So after each throw this waits, and if a chest is waiting it answers it
         the way a player would: draw, then collect. Forcing a weapon rather than
         letting the draw fall where it may keeps the loop about the turn cycle
         and not about the odds. */
      /* Finish whatever a throw put on the board: a buy card, an upgrade card,
         a rent card or a chest. See window.__finishVisit. */
      const finishVisit = () => window.__finishVisit();

      const meSeat = Number(document.querySelector(".who--me")?.dataset.seat ?? 0);
      /* Wait until this screen can really throw: the turn is here, the phase is
         AWAITING, and the die has a box. A debug action sent while a banner or a
         card is still animating is dropped, so it is retried rather than assumed. */
      const makeRollable = async () => {
        for (let k = 0; k < 24; k++) {
          if (board.dataset.busy !== "true" && board.dataset.reading !== "true" &&
              board.game.phase === "AWAITING_ROLL" && board.game.active === meSeat) {
            return true;
          }
          await finishVisit();
          await board.play({ type: "debug", active: meSeat });
          await new Promise((r) => setTimeout(r, 120));
        }
        return false;
      };
      await makeRollable();

      const snap = () => ({
        text: pill.textContent,
        seat: pill.dataset.turn,
        name: pill.dataset.name,
        face: die.dataset.face,
        rolling: die.dataset.rolling,
        phase: board.game.phase,
        active: board.game.active,
        busy: board.dataset.busy,
        moving: board.dataset.moving,
      });

      for (let i = 0; i < 4; i++) {
        turns.push(snap());
        die.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        // The click starts an action, not a state. Wait for the die to actually
        // roll - and for the coin it walks to land - before finishing the visit,
        // or the next press goes into a board that is still busy.
        let sawRoll = false;
        for (let n = 0; n < 120; n += 1) {
          if (die.dataset.rolling === "true") sawRoll = true;
          const settled = sawRoll && die.dataset.rolling === "false";
          if (settled && board.dataset.moving !== "true") break;
          if (board.dataset.moving === "true") sawRoll = true;
          await new Promise((r) => setTimeout(r, 40));
        }
        await finishVisit();
      }
      turns.push(snap());

      /* Put the die back on this seat's screen before measuring where it sits.
         The throws above may have left the turn on the other seat, and a die
         that is display:none has no box to be balanced against. */
      await makeRollable();
      for (let i = 0; i < 80 && board.dataset.busy === "true"; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }

      /* The die's own styles after being pressed, focused and left focused -
         read from the computed style, because an outline is exactly the sort of
         thing that is written once and overridden by a later rule. */
      die.focus();
      const focus = getComputedStyle(die);
      const outline = { width: focus.outlineWidth, style: focus.outlineStyle };
      die.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      die.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      const held = getComputedStyle(die).outlineStyle;
      die.blur();

      /* What can be pressed in the middle. The die, and only the die. */
      const pressable = [...centre.querySelectorAll("button, a, input, [tabindex]")]
        .map((e) => e.className.baseVal ?? e.className);

      /* The matchup. Two blocks and a VS between them, all on one line. */
      const roster = document.querySelector(".board-who");
      const blocks = [...roster.querySelectorAll(".who")].map(box);
      const vsEl = roster.querySelector(".who__vs");
      const vs = vsEl ? box(vsEl) : null;

      const pillBox = box(pill);
      const dieBox = box(die);
      // The floor of the die's own two rows: the bottom of the LAGRANGE POINT
      // L2 / MILKY WAY row and the MOON / RAMA row, which is the same four cells
      // the die is placed against. Not the board's bottom edge - there is one
      // more row of tiles below the die, and the pill belongs above it.
      const bandBottom = Math.max(
        ...["moon", "lagrange-l2", "milky-way", "rama"]
          .map((id) => board.querySelector('.board__cell[data-id="' + id + '"]')
            .getBoundingClientRect().bottom),
      );

      return {
        turns,
        rollable: board.dataset.rollable,
        active: board.game.active,
        meSeat,
        phase: board.game.phase,
        reading: board.dataset.reading,
        busy: board.dataset.busy,
        dieDisplay: getComputedStyle(die).display,
        pill: { ...pillBox, hidden: pill.hidden, text: pill.textContent,
                pointer: getComputedStyle(pill).pointerEvents,
                font: getComputedStyle(pill).fontSize,
                background: getComputedStyle(pill).backgroundColor,
                radius: getComputedStyle(pill).borderTopLeftRadius },
        die: dieBox,
        bandBottom,
        outline, held,
        pressable,
        roster: { height: roster.getBoundingClientRect().height, blocks, vs,
                  vsText: vsEl ? vsEl.textContent : null,
                  clipped: [...roster.querySelectorAll(".who__name, .who__civ")]
                    .filter((e) => e.scrollWidth > e.clientWidth + 1).length },
      };
    `);

    // --- the die's outline, which is the thing that was wrong ---
    note(`${label}: the die draws no outline when focused`,
      trio.outline.style === "none" || parseFloat(trio.outline.width) === 0,
      `outline-style ${trio.outline.style}, width ${trio.outline.width}`);
    note(`${label}: and none while it is held either`, trio.held === "none", trio.held);
    note(`${label}: the die is still the only thing in the middle you can press`,
      trio.pressable.length === 1 && String(trio.pressable[0]).includes("board__dice"),
      trio.pressable.join(", ") || "nothing pressable");

    // --- the turn pill ---
    note(`${label}: a turn pill is shown under the die`,
      !trio.pill.hidden && /\u2019s turn$/.test(trio.pill.text), trio.pill.text);
    note(`${label}: it is transparent, pill-shaped and readably sized`,
      /rgba\(0, 0, 0, 0\)|transparent/.test(trio.pill.background) &&
      parseFloat(trio.pill.radius) >= parseFloat(trio.pill.h) / 2 &&
      parseFloat(trio.pill.font) >= 11,
      `${trio.pill.font}, radius ${trio.pill.radius}, height ${trio.pill.h.toFixed(1)}px`);
    note(`${label}: it sits between the die and the bottom of its two rows`,
      trio.pill.top >= trio.die.bottom - 0.5 && trio.pill.bottom <= trio.bandBottom + 0.5,
      `die ends ${trio.die.bottom.toFixed(0)}, pill ${trio.pill.top.toFixed(0)}..${trio.pill.bottom.toFixed(0)}, floor ${trio.bandBottom.toFixed(0)}`);
    const gapAbove = trio.pill.top - trio.die.bottom;
    const gapBelow = trio.bandBottom - trio.pill.bottom;
    note(`${label}: balanced in that space`,
      gapAbove >= 2 && Math.abs(gapAbove - gapBelow) <= 3,
      `${gapAbove.toFixed(1)}px above, ${gapBelow.toFixed(1)}px below`);
    note(`${label}: and it is not a control`,
      trio.pill.pointer === "none", trio.pill.pointer);
    // Asserted as a transition, not as four presses on this screen: after the
    // first throw the turn belongs to the other player, and their die is the
    // only one that can be pressed. The full alternating cycle is played later
    // from both screens, which is the only way to test it honestly.
    const seats = trio.turns.map((t) => Number(t.seat));
    note(`${label}: a throw hands the turn to the other seat`,
      seats.length >= 2 && seats[0] !== seats[1] &&
        [0, 1].includes(seats[0]) && [0, 1].includes(seats[1]),
      JSON.stringify(trio.turns.map((t) => ({ s: t.seat, f: t.face, r: t.rolling, p: t.phase, a: t.active }))));

    // --- the matchup ---
    note(`${label}: the header says VS between the two players`,
      trio.roster.vsText === "VS" && trio.roster.blocks.length === 2,
      `${trio.roster.blocks.length} blocks, VS: ${trio.roster.vsText}`);
    note(`${label}: sitting between them, not outside either`,
      trio.roster.vs.left >= trio.roster.blocks[0].right - 0.5 &&
      trio.roster.vs.right <= trio.roster.blocks[1].left + 0.5,
      `${trio.roster.blocks[0].right.toFixed(0)} | VS ${trio.roster.vs.left.toFixed(0)}..${trio.roster.vs.right.toFixed(0)} | ${trio.roster.blocks[1].left.toFixed(0)}`);
    const sameLine = Math.min(trio.roster.vs.bottom, trio.roster.blocks[1].bottom) -
      Math.max(trio.roster.vs.top, trio.roster.blocks[1].top);
    note(`${label}: aligned with them, and not clipped or wrapped`,
      sameLine > 0 && trio.roster.clipped === 0,
      `overlap ${sameLine.toFixed(0)}px, ${trio.roster.clipped} clipped`);
    note(`${label}: the whole matchup on one line`,
      trio.roster.height < trio.roster.blocks[0].h * 2.2,
      `${trio.roster.height.toFixed(0)}px tall`);

    // Put it back to blank so the shots show the board as it is found. The
    // landing mark is a mark of where the last throw stopped, not a wash of
    // the square's set, so it is cleared before the washes are compared.
    await page.eval(`(async () => {
      const b = document.querySelector(".board");
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) await wait(50);
      await window.__finishVisit();
      for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) await wait(50);
      await b.play({ type: "debug", active: Number(document.querySelector(".who--me")?.dataset.seat ?? 0) });
      await wait(250);
      const holder = b.querySelector(".board__card");
      holder.hidden = true;
      b.coins.clearHighlight();
      return true;
    })()`);
    await sleep(300);

    const b = await boardReport(page);
    const name = `${label}:`;

    if (!b.present) {
      note(`${name} there is a board`, false, "nothing on the page");
      continue;
    }

    note(`${name} there is a board`, true, `${b.board.w.toFixed(1)} x ${b.board.h.toFixed(1)}`);
    note(`${name} twenty-eight cells`, b.total === 28, `${b.total} found`);
    note(`${name} four of them corners`, b.corners === 4, `${b.corners}`);
    note(`${name} twenty properties`, b.properties === 20, `${b.properties}`);
    note(`${name} four chests`, b.chests === 4, `${b.chests}`);
    note(`${name} every cell has its own id`, b.uniqueIds === 28, `${b.uniqueIds} distinct${b.duplicateIds.length ? ", " + b.duplicateIds : ""}`);
    note(`${name} and its own index`, b.uniqueIndexes === 28, `${b.uniqueIndexes} distinct${b.duplicateIndexes.length ? ", " + b.duplicateIndexes : ""}`);
    note(`${name} all twenty-eight are the same square`, b.sizes.length === 1, b.sizes.join(" | "));
    note(`${name} the board fits the screen`, b.board.w <= b.screen.w && b.board.h <= b.screen.h,
      `board ${b.board.w.toFixed(1)}x${b.board.h.toFixed(1)}, screen ${b.screen.w}x${b.screen.h}`);
    note(`${name} and nothing scrolls`, b.scrollX === 0 && b.scrollY === 0, `x ${b.scrollX}, y ${b.scrollY}`);

    note(`${name} the corners are solid black, unwashed`, b.grounds.corner.every((g) => g === "rgb(18, 18, 18)"), b.grounds.corner.join(" "));
    note(`${name} the four chests are the black wash over the paper`,
      b.chestNames.every((c) => c.ground === b.wash.washedChest),
      `${b.wash.chestWash} at ${b.wash.strength} over ${b.wash.paper} = ${b.wash.washedChest}; got ${[...new Set(b.chestNames.map((c) => c.ground))].join(" ")}`);
    note(`${name} and a chest's name reads exactly as a property's does`,
      b.chestNames.every((c) => c.ink === c.propertyInk),
      `${[...new Set(b.chestNames.map((c) => c.ink))].join(" ")}`);
    note(`${name} every property is washed in its own pill's colour`,
      b.propertyNames.every((p) => p.ground !== b.wash.paper),
      [...new Set(b.propertyNames.map((p) => `${p.set}:${p.ground}`))].join(" "));
    note(`${name} and no two properties that share a set differ`,
      b.propertyNames.every((p) => {
        const same = b.propertyNames.filter((q) => q.set === p.set);
        return same.every((q) => q.ground === p.ground && q.pill === p.pill);
      }));

    // textContent joins the two lines with nothing between them, so AKASH CORE
    // reads "AKASHCORE" and MARKET- / PLACE reads "MARKET-PLACE". The break is
    // the data's and is checked in test/cells.test.js; what matters here is
    // that the four corners are the four they are supposed to be, so the
    // spacing and the break are taken out of the comparison.
    note(
      `${name} the four corners are Start, Outer Space, Black Hole and Fight`,
      ["START", "OUTERSPACE", "BLACKHOLE", "FIGHT"].every((n) =>
        b.cornerNames.some((c) => c.name.toUpperCase().replace(/[\s-]/g, "") === n),
      ),
      b.cornerNames.map((c) => c.name).join(" | "),
    );
    note(`${name} each keeps its mark and its rule`,
      b.cornerNames.every((c) => c.mark && c.rule),
      b.cornerNames.map((c) => `${c.id}:${c.mark ? "mark" : "NO MARK"}/${c.rule ? "rule" : "NO RULE"}`).join(" "));
    note(`${name} and no corner name is clipped`, b.cornerNames.every((c) => c.overflow <= 0.5),
      b.cornerNames.map((c) => `${c.id}:${c.overflow.toFixed(1)}`).join(" "));

    note(`${name} every property is a real button`, b.propertiesAreButtons);
    note(`${name} every property has a pill`, b.propertyNames.every((p) => p.pillExists));
    note(`${name} and the pill carries the set's colour`,
      b.propertyNames.every((p) => /^rgb\(\d+, \d+, \d+\)$/.test(p.pill) && p.pill !== "rgb(0, 0, 0)"),
      [...new Set(b.propertyNames.map((p) => `${p.set}:${p.pill}`))].join(" "));
    note(`${name} no chest has a pill`, b.chestNames.every((c) => !c.pillExists));
    note(`${name} no name overflows its cell`, b.overflow.length === 0, b.overflow.join(" ") || "none of the 28");
    note(`${name} and the board draws no card artwork yet`, b.cardsOnBoard === 0, `${b.cardsOnBoard} found`);
    note(`${name} the centre is columns 2 to 5 and rows 2 to 9`, b.centreSpan === "2/6 2/10", b.centreSpan);

    // The die, and the only question that matters about it: is it in the middle
    // of the rectangle those four tiles describe, and nowhere else.
    note(`${name} there is one die`, !!b.diceBox && b.diceVisibleFaces === 1 && b.dicePips === 21,
      b.diceBox ? `${b.dicePips} pips, ${b.diceVisibleFaces} face showing` : "no die on the board");
    note(`${name} and the old diamond and its lines are gone`, b.ornamentGone === 0,
      `${b.ornamentGone} pieces of the old ornament left`);
    note(`${name} the die has settled on a face from one to six`,
      /^[1-6]$/.test(b.diceFace || "") && b.diceSettled === "false",
      `face ${b.diceFace}, rolling=${b.diceSettled}, says "${b.diceAria}"`);
    if (b.diceBox && b.rectangle) {
      const r = b.rectangle;
      const targetX = (r.x0 + r.x1) / 2;
      const targetY = (r.y0 + r.y1) / 2;
      const offX = b.diceBox.left + b.diceBox.w / 2 - targetX;
      const offY = b.diceBox.top + b.diceBox.h / 2 - targetY;
      note(
        `${name} and it is centred in the rectangle MOON, LAGRANGE, MILKY WAY and RAMA describe`,
        // A pixel out of a whole rectangle is a rounding artefact, not an
        // off-centre die.
        Math.abs(offX) <= 2 && Math.abs(offY) <= 2,
        `${offX.toFixed(2)}px across, ${offY.toFixed(2)}px down from the middle of a ` +
          `${(r.x1 - r.x0).toFixed(0)}x${(r.y1 - r.y0).toFixed(0)} rectangle`,
      );
      // Whitespace, asked for rather than assumed, and asked of the SHORTER side
      // of the rectangle - which is the two rows the die lives in, so that is
      // the side that can actually crowd it. The die may take at most 62% of it,
      // which leaves better than a sixth of the band clear on every side.
      const short = Math.min(r.x1 - r.x0, r.y1 - r.y0);
      const gap = Math.min(
        b.diceBox.left - r.x0, r.x1 - b.diceBox.right,
        b.diceBox.top - r.y0, r.y1 - b.diceBox.bottom,
      );
      const take = b.diceBox.w / short;
      note(`${name} with room round it`, take <= 0.62 && gap >= short * 0.12,
        `die takes ${(take * 100).toFixed(0)}% of the ${short.toFixed(0)}px band, ` +
          `${gap.toFixed(1)}px clear at the tightest side`);
      // And it must not be sitting in the middle of the middle either.
      const boardMidY = b.board.top + b.board.h / 2;
      note(`${name} and it is NOT in the middle of the board`,
        Math.abs(b.diceBox.top + b.diceBox.h / 2 - boardMidY) > 20,
        `${(b.diceBox.top + b.diceBox.h / 2 - boardMidY).toFixed(1)}px below the board's centre`);
    }
    note(`${name} both players are named above the board`,
      b.who.length === 2 && b.who.includes(HOST_NAME) && b.who.includes(GUEST_NAME),
      b.who.join(" | "));
    note(`${name} with their civilizations`, b.civs.length === 2, b.civs.join(" | "));

    await shot(page, `${W}-board-${label}`);
  }

  /* ------------------------------------- four real turns, on both screens

     The board checks above can only press one screen's die, and after the first
     throw the turn belongs to the other player. This walks the whole cycle the
     way two phones do: whichever seat is active presses its own die, answers
     whatever it landed on, and hands the turn on. Four throws must visit both
     seats and come back to where it started. */

  heading("FOUR TURNS, TWO SCREENS");

  // A helper both screens carry: wait until this screen can really throw, then
  // press the die. It is state-based rather than stylesheet-based, because a
  // debug hand-over can repaint a moment later and leave the attribute stale.
  const ROLLABLE = `window.__throwIt = async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const b = document.querySelector(".board");
    const die = b.querySelector(".board__dice");
    const me = Number(document.querySelector(".who--me")?.dataset.seat ?? 0);
    for (let k = 0; k < 24; k += 1) {
      if (b.dataset.busy === "true") { await wait(50); continue; }
      if (b.dataset.reading === "true" || b.game.phase !== "AWAITING_ROLL") {
        await window.__finishVisit();
        await wait(50);
        continue;
      }
      if (b.game.active !== me) {
        await b.play({ type: "debug", active: me });
        await wait(100);
        continue;
      }
      die.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let i = 0; i < 15; i += 1) {
        if (b.dataset.rolling === "true" || b.game.phase !== "AWAITING_ROLL") return true;
        await wait(40);
      }
      await wait(80);
    }
    return false;
  };`;
  await host.eval(ROLLABLE);
  await guest.eval(ROLLABLE);

  const readTurn = `
    const b = document.querySelector(".board");
    return { active: b.game.active,
             phase: b.game.phase,
             moving: b.dataset.moving,
             busy: b.dataset.busy,
             turn: b.querySelector(".board__turn").textContent,
             seat: b.querySelector(".board__turn").dataset.turn };
  `;

  const settleBoth = async () => {
    for (let i = 0; i < 80; i += 1) {
      const [h, g] = await Promise.all([host.json(readTurn), guest.json(readTurn)]);
      if (h.active === g.active && h.phase === g.phase &&
          h.phase === "AWAITING_ROLL" && h.moving !== "true" && g.moving !== "true" &&
          h.busy !== "true" && g.busy !== "true") {
        return { ...h, guestActive: g.active, guestSeat: g.seat };
      }
      await sleep(60);
    }
    return null;
  };

  const cycle = [];
  let attempts = 0;
  while (cycle.length < 4 && attempts < 16) {
    attempts += 1;
    const beforeThrow = await settleBoth();
    if (!beforeThrow) continue;
    const screen = beforeThrow.active === 0 ? host : guest;

    const thrown = await screen.eval("window.__throwIt()");
    if (!thrown) continue;

    await screen.eval(`(async () => {
      const b = document.querySelector(".board");
      for (let i = 0; i < 140; i++) {
        const rolling = b.querySelector(".board__dice").dataset.rolling !== "false";
        if (!rolling && b.dataset.moving !== "true") break;
        await new Promise((r) => setTimeout(r, 40));
      }
      return true;
    })()`);
    await screen.eval("window.__finishVisit()");

    const afterThrow = await settleBoth();
    if (!afterThrow || afterThrow.active === beforeThrow.active) continue;
    cycle.push({ beforeThrow, thrown, afterThrow });
  }

  const thrownSeats = cycle.map((c) => c.beforeThrow.active);
  const wrapped = cycle.map((c) => c.afterThrow.active);
  note("four throws, four turns, alternating and wrapping",
    cycle.length === 4 && cycle.every((c) => c.thrown) &&
      thrownSeats.every((s, i) => i === 0 || s === 1 - thrownSeats[i - 1]) &&
      wrapped.every((s, i) => s === 1 - thrownSeats[i]) &&
      wrapped[3] === thrownSeats[0],
    `thrown ${thrownSeats.join(" \u2192 ")}; then ${wrapped.join(" \u2192 ")} ` +
      `(${attempts} attempt(s))`);
  note("and both screens name the same active seat after every throw",
    cycle.length === 4 &&
      cycle.every((c) => c.afterThrow.active === c.afterThrow.guestActive &&
        c.afterThrow.seat === c.afterThrow.guestSeat) &&
      cycle.every((c) => new RegExp(c.afterThrow.active === 0 ? HOST_NAME : GUEST_NAME)
        .test(c.afterThrow.turn)),
    cycle.map((c) => `${c.afterThrow.active}:${c.afterThrow.turn}`).join(" | "));

  /* ------------------------------------------------------------ the economy

     The whole property economy, driven through the page a player is looking
     at, in the order a player lives it: land on a square nobody holds, buy it,
     come back and build once, be charged rent on it, try to buy something you
     cannot afford, read it, sell it, and fit the same card on a smaller phone.

     Everything here reads the rendered page. The ledger is reachable from
     outside the module because board.js publishes it the way it publishes the
     coin layer, and the checks below read the DOM rather than the ledger, so a
     rule that works and a screen that does not show it still fails. */

  heading("THE ECONOMY");

  /* A clean economy for the section. The reset goes through the server's own
     test hook rather than by editing the client's copy of the ledger, because a
     debug action that follows would otherwise bring the old copy straight back. */
  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) await wait(50);
    await b.play({ type: "debug", reset: true });
    for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) await wait(50);
    b.coins.sync(b.game.pieces);
    return true;
  })()`);

  await host.eval(`window.__econ = {
    board() { return document.querySelector(".board"); },
    async quiet() {
      const b = this.board();
      for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return true;
    },
    async place(index) {
      await this.quiet();
      const b = this.board();
      await b.play({ type: "debug", position: index });
      return index;
    },
    async roll(face) {
      await this.quiet();
      await this.board().play({ type: "roll", rng: (face - 0.5) / 6 });
      return true;
    },
    async ensure(seat) {
      const b = this.board();
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      /* Hand the turn over only when this screen is ready to receive it: a
         debug action sent into a card, a walk or a banner is dropped by the
         action lock and then silently does nothing. */
      for (let k = 0; k < 24; k += 1) {
        if (b.dataset.busy === "true" || b.dataset.reading === "true" ||
            b.game.phase !== "AWAITING_ROLL") {
          await window.__finishVisit();
          await wait(50);
          continue;
        }
        if (b.game.active !== seat) {
          await b.play({ type: "debug", active: seat });
          await wait(100);
          continue;
        }
        await b.play({ type: "debug", position: 0 });
        await wait(100);
        return b.game.active;
      }
      return b.game.active;
    },
  };`);

  const roster = await host.json(`
    const g = document.querySelector(".board").game;
    return g.ledger.players.map((p) => ({ seat: p.seat, name: p.name }));
  `);
  const BUYER = roster.find((p) => p.seat === 0)?.name || "seat 0";
  const OTHER = roster.find((p) => p.seat === 1)?.name || "seat 1";
  const TURN_OF = (name) => `${name}\u2019s turn`;

  await host.setViewport(390, 850, DSF);
  await sleep(400);
  await host.eval("window.__econ.ensure(0)");

  const setup = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    return {
      phase: g.phase,
      active: g.active,
      money: g.ledger.players.map((p) => p.money),
      owned: [...g.ledger.properties.values()].filter((s) => s.owner !== null).length,
      turn: b.querySelector(".board__turn").textContent,
      rollable: b.dataset.rollable,
    };
  `);
  note("the economy begins on the first seat's turn",
    setup.phase === "AWAITING_ROLL" && setup.active === 0 &&
      setup.turn === TURN_OF(BUYER) && setup.rollable === "true",
    `phase ${setup.phase}, seat ${setup.active}, "${setup.turn}", rollable ${setup.rollable}`);
  note("both purses hold two thousand", setup.money.join(" ") === "2000 2000", setup.money.join(" "));
  note("and nobody holds a square yet", setup.owned === 0, `${setup.owned} owned`);

  /* --- landing on a square nobody holds -------------------------------- */

  await host.eval("window.__econ.place(0)");
  await host.eval("window.__econ.roll(6)"); // Start + 6 is Pluto, price 400.

  const unowned = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const h = b.querySelector(".board__card");
    const card = h.querySelector(".property-card");
    const centre = b.querySelector("#board-center");
    const rect = (n) => n ? n.getBoundingClientRect().toJSON() : null;
    const builds = [...h.querySelectorAll(".build")];
    return {
      phase: g.phase,
      active: g.active,
      kind: g.landing?.kind,
      property: h.dataset.property,
      mode: h.dataset.mode,
      reading: b.dataset.reading,
      readingState: window.__readingState || null,
      rollable: b.dataset.rollable,
      turn: b.querySelector(".board__turn").textContent,
      dieDisplay: getComputedStyle(b.querySelector(".board__dice")).display,
      dieOpacity: getComputedStyle(b.querySelector(".board__dice")).opacity,
      holder: rect(h),
      centre: rect(centre),
      card: rect(card),
      buildsBox: rect(h.querySelector(".builds")),
      holderClient: h.clientHeight,
      holderScroll: h.scrollHeight,
      cardClient: card.clientHeight,
      cardScroll: card.scrollHeight,
      closeHidden: h.querySelector(".property-card__close").hidden,
      buyHidden: h.querySelector(".property-card__buy-slot").hidden,
      buyLabel: h.querySelector(".property-card__buy-label").textContent,
      buyCost: h.querySelector(".property-card__buy-cost").textContent,
      buyDisabled: h.querySelector(".property-card__buy").disabled,
      buyAria: h.querySelector(".property-card__buy").getAttribute("aria-disabled"),
      buyBox: rect(h.querySelector(".property-card__buy")),
      nextText: h.querySelector(".property-card__next-label").textContent,
      nextHidden: h.querySelector(".property-card__next").hidden,
      nextBox: rect(h.querySelector(".property-card__next")),
      builds: builds.map((n) => ({
        state: n.dataset.state,
        label: n.querySelector(".build__button-label").textContent,
        disabled: n.querySelector(".build__button").disabled,
      })),
      purse: Object.fromEntries([...document.querySelectorAll(".who")].map((w) => [
        w.dataset.seat,
        w.querySelector(".who__money").textContent.replace(/\\s+/g, ""),
      ])),
      owner: b.querySelector('.board__cell[data-id="pluto"]').dataset.owner ?? "",
    };
  `);

  note("landing on a square nobody holds opens a decision card",
    unowned.phase === "DECISION" && unowned.kind === "buy" &&
      unowned.mode === "decision" && unowned.property === "pluto",
    `phase ${unowned.phase}, kind ${unowned.kind}, mode ${unowned.mode}, ${unowned.property}`);
  note("the die is taken out of the middle, not just faded",
    unowned.dieDisplay === "none" && unowned.rollable === "false" &&
      unowned.turn === TURN_OF(BUYER),
    `die display ${unowned.dieDisplay} (opacity ${unowned.dieOpacity}), ` +
      `rollable ${unowned.rollable}, "${unowned.turn}"`);
  note("there is no close button on a decision",
    unowned.closeHidden === true, `hidden ${unowned.closeHidden}`);
  note("Buy is live at the square's price, with Pass directly under it",
    unowned.buyHidden === false && unowned.buyLabel === "Buy" &&
      unowned.buyCost === "\u20b9400" && unowned.buyDisabled === false &&
      unowned.buyAria === "false" && unowned.nextText === "Pass" &&
      unowned.nextHidden === false &&
      unowned.buyBox.bottom <= unowned.nextBox.top + 1,
    `${unowned.buyLabel} ${unowned.buyCost}, disabled ${unowned.buyDisabled}; ` +
      `Buy ends ${unowned.buyBox.bottom.toFixed(1)}, Pass starts ${unowned.nextBox.top.toFixed(1)}`);
  note("the three builds are shown and shut, because nobody owns it",
    unowned.builds.length === 3 &&
      unowned.builds.every((b) => b.state === "locked" && b.label === "Locked" && b.disabled),
    unowned.builds.map((b) => `${b.state}:${b.label}`).join(" | "));
  note("a square nobody holds carries no ownership mark",
    unowned.owner === "", `owner "${unowned.owner}"`);
  note("and both purses are still two thousand",
    unowned.purse["0"] === "\u20b92,000" && unowned.purse["1"] === "\u20b92,000",
    `${unowned.purse["0"]} ${unowned.purse["1"]}`);
  note("the decision card fills the whole 4x8 middle, inset only by the card gap",
    unowned.holder.left >= unowned.centre.left - 1 &&
      unowned.holder.right <= unowned.centre.right + 1 &&
      unowned.holder.top >= unowned.centre.top - 1 &&
      unowned.holder.bottom <= unowned.centre.bottom + 1 &&
      Math.abs(unowned.holder.width - unowned.centre.width) <= 12,
    `card ${unowned.holder.left.toFixed(0)}..${unowned.holder.right.toFixed(0)} / ` +
      `${unowned.holder.top.toFixed(0)}..${unowned.holder.bottom.toFixed(0)}; ` +
      `middle ${unowned.centre.left.toFixed(0)}..${unowned.centre.right.toFixed(0)} / ` +
      `${unowned.centre.top.toFixed(0)}..${unowned.centre.bottom.toFixed(0)}`);
  note("and its card and builds fit without a scroll at 390x850",
    unowned.holderScroll <= unowned.holderClient + 1 &&
      unowned.cardScroll <= unowned.cardClient + 1 &&
      unowned.buildsBox.bottom <= unowned.holder.bottom + 1,
    `holder ${unowned.holderClient}/${unowned.holderScroll}, ` +
      `card ${unowned.cardClient}/${unowned.cardScroll}, ` +
      `builds end ${unowned.buildsBox.bottom.toFixed(1)} vs ${unowned.holder.bottom.toFixed(1)}`);
  await shot(host, "phase1-unowned-390");

  /* --- buying, and the visit ending ------------------------------------ */

  const moneyBefore = await host.eval(`
    document.querySelector(".board").game.ledger.players.map((p) => p.money).join(" ")
  `);

  await host.eval(`document.querySelector(".property-card__buy").click(); true;`);
  await sleep(300);

  const afterBuy = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const h = b.querySelector(".board__card");
    const builds = [...h.querySelectorAll(".build")];
    return {
      phase: g.phase,
      active: g.active,
      turn: b.querySelector(".board__turn").textContent,
      turnHidden: b.querySelector(".board__turn").hidden,
      cardHidden: h.hidden,
      money: g.ledger.players.map((p) => p.money),
      square: g.ledger.properties.get("pluto"),
      ownerMark: b.querySelector('.board__cell[data-id="pluto"]').dataset.owner ?? "",
      buyHidden: h.querySelector(".property-card__buy-slot").hidden,
      nextHidden: h.querySelector(".property-card__next").hidden,
      builds: builds.map((n) => ({
        state: n.dataset.state,
        label: n.querySelector(".build__button-label").textContent,
        disabled: n.querySelector(".build__button").disabled,
      })),
    };
  `);

  note("Buy takes the price out of the buyer's purse and gives them the square",
    afterBuy.money[0] === Number(moneyBefore.split(" ")[0]) - 400 &&
      afterBuy.square.owner === 0 && afterBuy.square.upgradeLevel === 0 &&
      afterBuy.ownerMark === "0",
    `money ${afterBuy.money.join(" ")}, owner ${afterBuy.square.owner}, ` +
      `level ${afterBuy.square.upgradeLevel}, mark "${afterBuy.ownerMark}"`);
  note("the card stops offering the answer the instant it is accepted",
    afterBuy.buyHidden === true && afterBuy.nextHidden === true,
    `Buy hidden ${afterBuy.buyHidden}, Pass hidden ${afterBuy.nextHidden}`);
  note("and the build rows lock immediately, before the card slides away",
    !afterBuy.cardHidden &&
      afterBuy.builds[0].label === "Locked" &&
      afterBuy.builds[1].label === "Upgrade the previous level first" &&
      afterBuy.builds[2].label === "Upgrade the previous level first" &&
      afterBuy.builds.every((b) => b.disabled && b.state === "locked"),
    `${afterBuy.cardHidden ? "card gone" : "card up"}: ` +
      afterBuy.builds.map((b) => b.label).join(" | "));
  note("and the turn line does not move before TURN_END",
    afterBuy.active === 0 && afterBuy.turn === TURN_OF(BUYER) && !afterBuy.turnHidden,
    `active ${afterBuy.active}, "${afterBuy.turn}"`);
  await shot(host, "phase1-after-buy-390");

  await host.eval("window.__finishVisit()");
  await sleep(700);

  const handed = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const h = b.querySelector(".board__card");
    return {
      phase: g.phase,
      active: g.active,
      turn: b.querySelector(".board__turn").textContent,
      turnHidden: b.querySelector(".board__turn").hidden,
      cardHidden: h.hidden,
      rollable: b.dataset.rollable,
      dieOpacity: getComputedStyle(b.querySelector(".board__dice")).opacity,
      purse: Object.fromEntries([...document.querySelectorAll(".who")].map((w) => [
        w.dataset.seat,
        w.querySelector(".who__money").textContent.replace(/\\s+/g, ""),
      ])),
    };
  `);

  note("answering the visit ends the turn and hands it on",
    handed.phase === "AWAITING_ROLL" && handed.active === 1 &&
      handed.turn === TURN_OF(OTHER) && !handed.turnHidden,
    `phase ${handed.phase}, active ${handed.active}, "${handed.turn}"`);
  note("the card is gone and the turn has handed on",
    handed.cardHidden === true && handed.phase === "AWAITING_ROLL" && handed.active === 1,
    `card hidden ${handed.cardHidden}, phase ${handed.phase}, active ${handed.active}`);
  note("and the chips show what the ledger holds",
    handed.purse["0"] === "\u20b91,600" && handed.purse["1"] === "\u20b92,000",
    `${handed.purse["0"]} ${handed.purse["1"]}`);

  /* --- landing on your own square: one upgrade ------------------------ */

  // Back to seat 0. The filler turn lands on the still-unowned Moon and passes.
  await host.eval("window.__econ.ensure(0)");
  // Upgrades are unlocked by a monopoly now, so give the buyer the other two
  // colonies in Pluto's set. This is setup, not a shortcut around a rule: the
  // rule under test is the landing on your own square, and the test says what
  // the board looked like before it.
  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    for (const id of ["asteroid-belt", "jupiter"]) {
      await b.play({ type: "debug", owner: { id, seat: 0 } });
    }
    return true;
  })()`);
  await host.eval("window.__econ.place(0)");
  await host.eval("window.__econ.roll(6)"); // Pluto, now the buyer's.

  const own = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const h = b.querySelector(".board__card");
    const builds = h ? [...h.querySelectorAll(".build")] : [];
    const next = h ? h.querySelector(".property-card__next") : null;
    const nextLabel = next ? next.querySelector(".property-card__next-label") : null;
    const close = h ? h.querySelector(".property-card__close") : null;
    const buySlot = h ? h.querySelector(".property-card__buy-slot") : null;
    console.log("OWN DEBUG: phase", g.phase, "active", g.active, "kind", g.landing?.kind, "mode", h?.dataset?.mode, "cardKind", h?.dataset?.cardKind);
    return {
      phase: g.phase,
      active: g.active,
      kind: g.landing?.kind,
      money: g.ledger.players.map((p) => p.money),
      level: g.ledger.properties.get("pluto")?.upgradeLevel ?? null,
      closeHidden: close ? close.hidden : true,
      nextText: nextLabel ? nextLabel.textContent : null,
      nextHidden: next ? next.hidden : true,
      buyHidden: buySlot ? buySlot.hidden : true,
      builds: builds.map((n) => ({
        state: n.dataset.state,
        label: n.querySelector(".build__button-label").textContent,
        disabled: n.querySelector(".build__button").disabled,
        cost: n.querySelector(".build__cost-figure").textContent,
      })),
      owners: [...g.ledger.properties.entries()]
        .filter(([id, s]) => s.owner !== null && ["pluto", "jupiter", "asteroid-belt"].includes(id))
        .map(([id, s]) => id + ":" + s.owner),
      lock: h ? h.querySelector(".builds__lock").textContent : null,
    };
  `);

  note("landing on your own square offers exactly one level to upgrade",
    own.phase === "DECISION" && own.kind === "own" && own.active === 0 &&
      own.builds[0].state === "next" && own.builds[0].label === "Upgrade" &&
      !own.builds[0].disabled &&
      own.builds[1].label === "Upgrade the previous level first" &&
      own.builds[2].label === "Upgrade the previous level first" &&
      own.nextText === "Done" && !own.nextHidden && own.buyHidden,
    `${own.builds.map((b) => `${b.state}:${b.label}`).join(" | ")}, next ${own.nextText}` +
      `; owners ${own.owners.join(" ")}; lock "${own.lock}"`);
  note("and the card has no close button, so the visit must be answered",
    own.closeHidden === true, `hidden ${own.closeHidden}`);
  await shot(host, "phase1-own-upgrade-390");

  const upgradeCost = Number(own.builds[0].cost);
  const moneyBeforeUpgrade = own.money[0];
  await host.eval(`document.querySelector(".build__button:not([disabled])").click(); true;`);
  await sleep(700);

  const upgraded = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const h = b.querySelector(".board__card");
    const builds = [...h.querySelectorAll(".build")];
    return {
      phase: g.phase,
      active: g.active,
      money: g.ledger.players.map((p) => p.money),
      square: g.ledger.properties.get("pluto"),
      builds: builds.map((n) => ({
        state: n.dataset.state,
        label: n.querySelector(".build__button-label").textContent,
        disabled: n.querySelector(".build__button").disabled,
      })),
      live: [...h.querySelectorAll(".build__button:not([disabled])")].length,
      nextText: h.querySelector(".property-card__next-label").textContent,
      nextHidden: h.querySelector(".property-card__next").hidden,
      rentLine: h.querySelector(".property-card__rent").textContent,
    };
  `);

  note("one upgrade costs the figure the row quoted and raises the level by one",
    upgraded.money[0] === moneyBeforeUpgrade - upgradeCost &&
      upgraded.square.upgradeLevel === 1 && upgraded.active === 0,
    `paid ${moneyBeforeUpgrade - upgraded.money[0]} of ${upgradeCost}, ` +
      `level ${upgraded.square.upgradeLevel}`);
  note("and every other upgrade row is shut for the rest of this visit",
    upgraded.live === 0 && upgraded.builds[0].label === "Upgraded" &&
      upgraded.builds[1].label === "Land here again to upgrade" &&
      upgraded.builds[2].label === "Upgrade the previous level first" &&
      upgraded.builds.every((b) => b.disabled),
    `${upgraded.live} live: ${upgraded.builds.map((b) => b.label).join(" | ")}`);
  note("Done is still there, and the card says what the square now charges",
    upgraded.nextText === "Done" && !upgraded.nextHidden &&
      /1 of 3/.test(upgraded.rentLine),
    `${upgraded.nextText}; "${upgraded.rentLine}"`);

  // The upgrade's announcement is still playing for a moment after the card
  // updates. Wait for the board to be free again before asking for a second
  // upgrade, or the press lands while the action lock is held and is simply
  // dropped rather than refused.
  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return true;
  })()`);

  const secondUpgrade = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const before = {
      money: g.ledger.players.map((p) => p.money),
      level: g.ledger.properties.get("pluto").upgradeLevel,
    };
    const result = await b.play({ type: "upgrade" });
    const refused = result?.events.find((e) => e.type === "refused");
    return {
      why: refused?.why || "",
      before,
      after: {
        money: g.ledger.players.map((p) => p.money),
        level: g.ledger.properties.get("pluto").upgradeLevel,
      },
      phase: g.phase,
    };
  `);

  note("a second upgrade in the same visit is refused and moves nothing",
    secondUpgrade.why.length > 0 &&
      secondUpgrade.after.money.join(" ") === secondUpgrade.before.money.join(" ") &&
      secondUpgrade.after.level === secondUpgrade.before.level &&
      secondUpgrade.phase === "DECISION",
    `"${secondUpgrade.why}"; money ${secondUpgrade.after.money.join(" ")}, ` +
      `level ${secondUpgrade.after.level}`);

  await host.eval(`document.querySelector(".property-card__next").click(); true;`);
  await host.eval("window.__finishVisit()");
  await sleep(500);

  // Put the other two colonies in Pluto's set back on the bank. They were only
  // there to unlock the upgrade above; the rent and affordability sections
  // below depend on the board being as the earlier turns left it.
  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    for (const id of ["asteroid-belt", "jupiter"]) {
      await b.play({ type: "debug", owner: { id, seat: null } });
    }
    return true;
  })()`);

  /* --- rent, paid by landing on somebody else's square ----------------- */

  const beforeRent = await host.eval(`
    document.querySelector(".board").game.ledger.players.map((p) => p.money).join(" ")
  `);

  // The rupees are only in the air for about a second, so the poll has to run
  // while the throw does, not after it.
  const flightPromise = (async () => {
    for (let i = 0; i < 80; i++) {
      const f = await host.json(`
        const tokens = [...document.querySelectorAll(".board__rupee")];
        return tokens.length
          ? { count: tokens.length, boxes: tokens.map((t) => t.getBoundingClientRect().toJSON()) }
          : null;
      `);
      if (f) return f;
      await sleep(50);
    }
    return null;
  })();

  await host.eval(`(async () => { await document.querySelector(".board").play({ type: "debug", active: 1 }); return true; })()`);
  await sleep(300);
  await guest.eval(`(async () => { await document.querySelector(".board").play({ type: "debug", position: 0 }); return true; })()`);
  await sleep(300);
  const rentRollRes = await guest.eval(`(async () => {
    const r = await document.querySelector(".board").play({ type: "roll", rng: 0.9167 });
    return JSON.stringify(r);
  })()`);
  console.log("RENT ROLL:", rentRollRes);

  const flight = await flightPromise;
  note("rent is paid in rupee tokens flying between the two chips",
    Boolean(flight) && flight.count >= 3,
    flight ? `${flight.count} tokens in the air` : "no tokens seen");
  // Hold the tokens at the middle of their flight for the shot. They are only
  // in the air for about half a second, and a screenshot taken after the poll
  // would catch them already fading into the holder's chip.
  if (flight) {
    await host.eval(`(() => {
      for (const token of document.querySelectorAll(".board__rupee")) {
        for (const animation of token.getAnimations()) {
          animation.pause();
          animation.currentTime = 230;
        }
      }
      return true;
    })()`);
  }
  await shot(host, "phase1-rent-flight-390");
  await host.eval(`(() => {
    for (const token of document.querySelectorAll(".board__rupee")) {
      for (const animation of token.getAnimations()) animation.play();
    }
    return true;
  })()`);

  for (let i = 0; i < 120; i++) {
    const phase = await host.eval(`document.querySelector(".board").game.phase`);
    if (phase === "DECISION") break;
    await sleep(100);
  }
  // The two purses count to their new figures over about half a second after
  // the tokens land. The ledger is already right; the chips are what is read.
  await sleep(700);

  const rent = await guest.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const h = b.querySelector(".board__card");
    const builds = h ? h.querySelector(".builds") : null;
    const statusEl = h ? h.querySelector(".property-card__status") : null;
    const nextEl = h ? h.querySelector(".property-card__next-label") : null;
    const nextBtn = h ? h.querySelector(".property-card__next") : null;
    const closeEl = h ? h.querySelector(".property-card__close") : null;
    return {
      phase: g.phase,
      active: g.active,
      kind: g.landing?.kind,
      landingId: g.landing?.id,
      turn: b.querySelector(".board__turn").textContent,
      money: g.ledger.players.map((p) => p.money),
      status: statusEl ? statusEl.textContent : null,
      buildsHidden: builds ? builds.hidden : null,
      nextText: nextEl ? nextEl.textContent : null,
      nextHidden: nextBtn ? nextBtn.hidden : null,
      closeHidden: closeEl ? closeEl.hidden : null,
      purse: Object.fromEntries([...document.querySelectorAll(".who")].map((w) => [
        w.dataset.seat,
        w.querySelector(".who__money").textContent.replace(/\\s+/g, ""),
      ])),
    };
  `);
  const rentFigure = rent.status ? Number((rent.status.match(/\u20b9([\d,]+)/) || [0, "0"])[1].replace(/,/g, "")) : 0;
  // Seat 0 holds the square and seat 1 landed on it, so the payer is the
  // second purse in the list, not the first.
  const [holderBefore, payerBefore] = beforeRent.split(" ").map(Number);

  console.log("RENT DEBUG:", JSON.stringify({ phase: rent.phase, active: rent.active, kind: rent.kind, landingId: rent.landingId, money: rent.money, status: rent.status, nextText: rent.nextText }));
  note("landing on somebody else's square charges the rent automatically",
    rent.kind === "rent" && rent.phase === "DECISION" &&
      Number(rent.money[1]) === payerBefore - rentFigure &&
      Number(rent.money[0]) === holderBefore + rentFigure,
    `rent ${rentFigure}: ${rent.money.join(" ")} from ${payerBefore} ${holderBefore}`);
  note("the payer's purse goes down, the holder's goes up, and the chips agree",
    rent.purse["1"] === `\u20b9${(payerBefore - rentFigure).toLocaleString("en-IN")}` &&
      rent.purse["0"] === `\u20b9${(holderBefore + rentFigure).toLocaleString("en-IN")}`,
    `${rent.purse["0"]} ${rent.purse["1"]}`);
  note("and the card offers only Continue, with no build rows",
    rent.nextText === "Continue" && !rent.nextHidden &&
      rent.buildsHidden === true && rent.closeHidden === true,
    `${rent.nextText}, builds hidden ${rent.buildsHidden}`);
  note("the turn line stays on the payer while the rent card is up",
    rent.active === 1 && rent.turn === TURN_OF(OTHER),
    `active ${rent.active}, "${rent.turn}"`);
  await shot(host, "phase1-rent-card-390");

  // Continue, and catch the banner that sweeps across the hand-over. The
  // Continue button belongs to the payer's screen, because the host's copy of
  // the card is read-only.
  await guest.eval(`document.querySelector(".property-card__next").click(); true;`);
  let banner = null;
  for (let i = 0; i < 60; i++) {
    banner = await host.json(`
      const n = document.querySelector(".board__banner");
      return n ? { text: n.textContent, cls: n.className } : null;
    `);
    if (banner) break;
    await sleep(40);
  }
  note("the turn hand-over sweeps in a banner that says whose turn it is",
    Boolean(banner) && banner.text === "Your turn" && /board__banner/.test(banner.cls),
    banner ? `"${banner.text}" (${banner.cls})` : "no banner seen");
  // The banner sweeps in and then fades. Hold it at the middle of its own
  // animation for the shot: a screenshot taken on a wall clock can catch the
  // first half of the sweep or the last of the fade, and neither is the thing
  // the banner is for.
  await sleep(140);
  await host.eval(`(() => {
    const node = document.querySelector(".board__banner");
    for (const animation of node?.getAnimations?.() ?? []) {
      animation.pause();
      animation.currentTime = 350;
    }
    return true;
  })()`);
  await shot(host, "phase1-turn-banner-390");
  await host.eval(`(() => {
    const node = document.querySelector(".board__banner");
    for (const animation of node?.getAnimations?.() ?? []) animation.play();
    return true;
  })()`);
  await host.eval("window.__finishVisit()");
  await sleep(500);

  /* --- a rent the payer cannot fully meet ------------------------------ */

  // Seat 1 is the payer next. Give them less than Pluto's rent, then put them on
  // it. The rule: they hand over everything they hold, the ledger keeps the rest
  // as a short, and a notice says so. Nothing else happens.
  await host.eval(`(async () => { await document.querySelector(".board").play({ type: "debug", active: 1 }); return true; })()`);
  await sleep(300);
  await guest.eval(`(async () => { await document.querySelector(".board").play({ type: "debug", money: 50 }); return true; })()`);
  await sleep(300);
  await guest.eval(`(async () => { await document.querySelector(".board").play({ type: "debug", position: 0 }); return true; })()`);
  await sleep(300);
  const rollRes = await guest.eval(`(async () => {
    const r = await document.querySelector(".board").play({ type: "roll", rng: 0.9167 });
    return JSON.stringify(r);
  })()`);
  console.log("RENT ROLL:", rollRes);

  const rentShort = await guest.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const h = b.querySelector(".board__card");
    const toasts = [...b.querySelectorAll(".board__toast")];
    return {
      phase: g.phase,
      kind: g.landing?.kind,
      money: g.ledger.players.map((p) => p.money),
      short: g.ledger.players.find((p) => p.seat === 1).short,
      status: h.querySelector(".property-card__status").textContent,
      toast: toasts.at(-1)?.textContent || "",
      nextText: h.querySelector(".property-card__next-label").textContent,
    };
  `);

  note("a rent the payer cannot meet takes everything they hold and records the short",
    rentShort.kind === "rent" && rentShort.money[1] === 0 &&
      rentShort.money[0] === 1580 + 50 && rentShort.short === 180 - 50 &&
      /Short \u20b9130/.test(rentShort.toast),
    `money ${rentShort.money.join(" ")}, short ${rentShort.short}, toast "${rentShort.toast}"`);
  note("and the card says the short, and still offers only Continue",
    /Short \u20b9130/.test(rentShort.status) && rentShort.nextText === "Continue",
    `"${rentShort.status}"`);
  await shot(host, "phase1-rent-short-390");

  await host.eval(`document.querySelector(".property-card__next").click(); true;`);
  await host.eval("window.__finishVisit()");
  await sleep(400);

  /* --- a square the player cannot afford ------------------------------- */

  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return true;
  })()`);
  await host.eval(`(async () => { await document.querySelector(".board").play({ type: "debug", active: 0 }); return true; })()`);
  await host.eval(`(async () => { await document.querySelector(".board").play({ type: "debug", money: 10 }); return true; })()`);
  await host.eval("window.__econ.place(0)");
  await host.eval("window.__econ.roll(5)"); // Jupiter, unowned and 500.

  const short = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const h = b.querySelector(".board__card");
    const buy = h.querySelector(".property-card__buy");
    return {
      phase: g.phase,
      active: g.active,
      kind: g.landing?.kind,
      price: g.ledger.properties.has(g.landing?.id) ? g.landing.id : null,
      landingId: g.landing?.id ?? null,
      cardMode: h.dataset.mode ?? null,
      cardKind: h.dataset.cardKind ?? null,
      owner: g.ledger.properties.get(g.landing?.id)?.owner ?? null,
      label: h.querySelector(".property-card__buy-label").textContent,
      cost: h.querySelector(".property-card__buy-cost").textContent,
      disabled: buy.disabled,
      aria: buy.getAttribute("aria-disabled"),
      title: buy.title,
    };
  `);

  note("a square beyond the purse still offers Buy, and says the shortfall on one line",
    short.label === "Not enough" && /\u20b9[\d,]+ short/.test(short.cost) &&
      short.disabled === false && short.aria === "true" && /more|afford|need/i.test(short.title),
    `${short.label} ${short.cost}; disabled ${short.disabled}, aria ${short.aria}, title "${short.title}"` +
      `; ${short.landingId}/${short.cardMode}/${short.cardKind}, owner ${short.owner}`);

  await host.eval(`document.querySelector(".property-card__buy").click(); true;`);
  await sleep(200);
  const refused = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const buy = b.querySelector(".property-card__buy");
    return {
      phase: g.phase,
      active: g.active,
      money: g.ledger.players.map((p) => p.money),
      toast: b.querySelector(".board__toast")?.textContent || "",
      shaking: buy ? buy.getAnimations().some((a) => a.playState === "running") : false,
      owner: g.ledger.properties.get(b.game.landing?.id)?.owner ?? null,
    };
  `);
  note("pressing an unaffordable Buy is refused with a sentence and a shake",
    refused.phase === "DECISION" && refused.active === 0 &&
      refused.money[0] === 10 && refused.owner === null &&
      refused.toast.length > 0 && refused.shaking === true,
    `money ${refused.money[0]}, owner ${refused.owner}, toast "${refused.toast}", shaking ${refused.shaking}`);
  await shot(host, "phase1-cannot-afford-390");

  await host.eval(`document.querySelector(".property-card__next").click(); true;`);
  await host.eval("window.__finishVisit()");
  await sleep(400);

  /* --- the read card, the die, and the sale ---------------------------- */

  heading("THE READ CARD AND THE SALE");

  // Back to the buyer and with money in the purse, so the sale's arithmetic is
  // about the sale and not about a purse of ten.
  await host.eval("window.__econ.ensure(0)");
  await host.eval(`(async () => {
    await document.querySelector(".board").play({ type: "debug", money: 2000 });
    return true;
  })()`);
  await host.eval(`document.querySelector('.board__cell[data-id="pluto"]').click(); true;`);
  await sleep(500);

  const reading = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const h = b.querySelector(".board__card");
    const card = h.querySelector(".property-card");
    const builds = h ? [...h.querySelectorAll(".build")] : [];
    const sell = h.querySelector(".property-card__sell");
    return {
      phase: g.phase,
      active: g.active,
      reading: b.dataset.reading,
      mode: h.dataset.mode,
      level: g.ledger.properties.get("pluto")?.upgradeLevel ?? 0,
      money: g.ledger.players.map((p) => p.money),
      closeHidden: h.querySelector(".property-card__close").hidden,
      buyHidden: h.querySelector(".property-card__buy-slot").hidden,
      nextHidden: h.querySelector(".property-card__next").hidden,
      builds: builds.map((n) => ({
        state: n.dataset.state,
        label: n.querySelector(".build__button-label").textContent,
        disabled: n.querySelector(".build__button").disabled,
      })),
      sellHidden: sell.hidden,
      sellLabel: sell.querySelector(".property-card__sell-label").textContent,
      sellBox: sell.getBoundingClientRect().toJSON(),
      sellBackground: getComputedStyle(sell).backgroundColor,
      holder: h.getBoundingClientRect().toJSON(),
      cardClient: card.clientHeight,
      cardScroll: card.scrollHeight,
      holderClient: h.clientHeight,
      holderScroll: h.scrollHeight,
      dieDisplay: getComputedStyle(b.querySelector(".board__dice")).display,
      rollable: b.dataset.rollable,
    };
  `);

  note("tapping a square outside a landing opens a read-only card with a close button",
    reading.phase === "AWAITING_ROLL" && reading.reading === "true" &&
      reading.mode === "read" && reading.closeHidden === false &&
      reading.buyHidden === true && reading.nextHidden === true,
    `phase ${reading.phase}, reading ${reading.reading}, close hidden ${reading.closeHidden}`);
  note("the die is gone from the middle while a card is being read",
    reading.rollable === "false" && reading.dieDisplay === "none",
    `rollable ${reading.rollable}, die display ${reading.dieDisplay}`);
  note("your own square offers no upgrade outside a landing, only the rule in words",
    reading.builds.length === 3 && reading.builds.every((b) => b.disabled) &&
      reading.builds[0].label === "Upgraded" &&
      reading.builds[1].label === "Locked" &&
      reading.builds[2].label === "Upgrade the previous level first" &&
      reading.level === 1,
    `${reading.level}: ${reading.builds.map((b) => b.label).join(" | ")}`);
  note("and Sell is visible with the amount it will pay, in red",
    reading.sellHidden === false &&
      /^Sell for \u20b9[\d,]+$/.test(reading.sellLabel) &&
      (() => {
        const [r, g, b] = (reading.sellBackground.match(/\d+/g) || []).map(Number);
        return r > g + 30 && r > b + 30;
      })(),
    `${reading.sellLabel}; background ${reading.sellBackground}`);
  note("the read card's long description stays inside its own sheet, never clipped",
    reading.cardScroll <= reading.cardClient + 1,
    `card ${reading.cardClient}/${reading.cardScroll}; ` +
      `its holder is the scroller at ${reading.holderClient}/${reading.holderScroll}`);

  const unchanged = await host.eval(`(async () => {
    const b = document.querySelector(".board");
    const before = {
      level: b.game.ledger.properties.get("pluto")?.upgradeLevel ?? 0,
      money: b.game.ledger.players[0].money,
    };
    b.querySelector(".build__button").click();
    await new Promise((r) => setTimeout(r, 200));
    return {
      level: b.game.ledger.properties.get("pluto")?.upgradeLevel ?? 0,
      money: b.game.ledger.players[0].money,
    };
  })()`);
  note("pressing a build row on a read-only card changes nothing",
    unchanged.level === reading.level && unchanged.money === reading.money[0],
    `level ${unchanged.level}, money ${unchanged.money}`);

  // A tap outside is the other way out. It must not change the turn, and the
  // die must come back the moment the card goes.
  await host.eval(`(() => {
    const b = document.querySelector(".board");
    b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    return true;
  })()`);
  await sleep(360);
  const outside = await host.json(`
    const b = document.querySelector(".board");
    return {
      reading: b.dataset.reading,
      hidden: b.querySelector(".board__card").hidden,
      phase: b.game.phase,
      active: b.game.active,
      rollable: b.dataset.rollable,
      dieDisplay: getComputedStyle(b.querySelector(".board__dice")).display,
    };
  `);
  note("a tap outside a read-only card closes it and gives the die back",
    outside.reading === "false" && outside.hidden === true &&
      outside.phase === "AWAITING_ROLL" && outside.rollable === "true" &&
      outside.dieDisplay !== "none",
    `reading ${outside.reading}, die ${outside.dieDisplay}, rollable ${outside.rollable}`);
  note("and closing a card does not pass the turn",
    outside.active === reading.active,
    `active ${outside.active}, was ${reading.active}`);

  // Open it again for the sale.
  await host.eval(`document.querySelector('.board__cell[data-id="pluto"]').click(); true;`);
  await sleep(400);

  const saleValue = Number(
    (reading.sellLabel.match(/\u20b9([\d,]+)/) || [0, "0"])[1].replace(/,/g, ""),
  );
  const moneyBeforeSale = reading.money[0];

  await host.eval(`document.querySelector(".property-card__sell").click(); true;`);
  await sleep(200);
  const armed = await host.json(`
    const sell = document.querySelector(".property-card__sell");
    return { label: sell.querySelector(".property-card__sell-label").textContent,
             armed: sell.dataset.armed };
  `);
  note("Sell asks once before it sells",
    armed.armed === "true" && /Confirm sale/.test(armed.label),
    `"${armed.label}", armed ${armed.armed}`);

  await host.eval(`document.querySelector(".property-card__sell").click(); true;`);
  await sleep(900);

  const sold = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const h = b.querySelector(".board__card");
    const sell = h.querySelector(".property-card__sell");
    return {
      money: g.ledger.players.map((p) => p.money),
      square: g.ledger.properties.get("pluto"),
      ownerMark: b.querySelector('.board__cell[data-id="pluto"]').dataset.owner ?? "",
      status: h.querySelector(".property-card__status").textContent,
      sellHidden: sell.hidden,
      builds: [...h.querySelectorAll(".build__button-label")].map((n) => n.textContent),
      reading: b.dataset.reading,
      phase: g.phase,
      active: g.active,
    };
  `);

  note("selling pays half of what was spent, and the square goes back to the bank",
    sold.money[0] === moneyBeforeSale + saleValue &&
      sold.square.owner === null && sold.square.upgradeLevel === 0 &&
      sold.ownerMark === "" && /Unowned/i.test(sold.status),
    `paid ${sold.money[0] - moneyBeforeSale} of ${saleValue}; ` +
      `owner ${sold.square.owner}, level ${sold.square.upgradeLevel}, "${sold.status}"`);
  note("and the card becomes an unowned square again, with no Sell",
    sold.sellHidden === true &&
      sold.builds.join(" ") === "Locked Locked Locked",
    `sell hidden ${sold.sellHidden}, builds ${sold.builds.join(" | ")}`);
  note("selling does not end the turn",
    sold.phase === "AWAITING_ROLL" && sold.active === 0 && sold.reading === "true",
    `phase ${sold.phase}, active ${sold.active}`);

  await host.eval(`document.querySelector(".property-card__close").click(); true;`);
  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    for (let i = 0; i < 60 && b.querySelector(".board__announce:not([hidden])"); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return true;
  })()`);
  await sleep(300);
  const closed = await host.json(`
    const b = document.querySelector(".board");
    return {
      reading: b.dataset.reading,
      cardHidden: b.querySelector(".board__card").hidden,
      dieDisplay: getComputedStyle(b.querySelector(".board__dice")).display,
      rollable: b.dataset.rollable,
    };
  `);
  note("closing the read card brings the die back and leaves the turn alone",
    closed.reading === "false" && closed.cardHidden === true &&
      closed.dieDisplay !== "none" && closed.rollable === "true",
    `reading ${closed.reading}, card hidden ${closed.cardHidden}, die ${closed.dieDisplay}`);

  /* --- the same card on a 360x700 phone ------------------------------- */

  await host.setViewport(360, 700, DSF);
  await sleep(500);
  await host.eval("window.__econ.place(0)");
  await host.eval("window.__econ.roll(5)"); // Jupiter again.

  const small = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const h = b.querySelector(".board__card");
    const centre = b.querySelector("#board-center");
    const card = h ? h.querySelector(".property-card") : null;
    const builds = h ? h.querySelector(".builds") : null;
    const buy = h ? h.querySelector(".property-card__buy") : null;
    const next = h ? h.querySelector(".property-card__next") : null;
    const rect = (n) => n ? n.getBoundingClientRect().toJSON() : null;
    return {
      phase: g.phase,
      kind: g.landing?.kind,
      holder: rect(h),
      centre: rect(centre),
      holderClient: h.clientHeight,
      holderScroll: h.scrollHeight,
      cardClient: card ? card.clientHeight : 0,
      cardScroll: card ? card.scrollHeight : 0,
      builds: rect(builds),
      buy: rect(buy),
      next: rect(next),
      buyVisible: buy ? !buy.hidden && getComputedStyle(buy).display !== "none" : false,
      nextVisible: next ? !next.hidden && getComputedStyle(next).display !== "none" : false,
      chips: [...document.querySelectorAll(".who")].map((w) => ({
        seat: w.dataset.seat,
        client: w.clientWidth,
        scroll: w.scrollWidth,
        nameClient: w.querySelector(".who__name").clientWidth,
        nameScroll: w.querySelector(".who__name").scrollWidth,
      })),
    };
  `);

  note("the decision card fits the middle at 360x700 with no scrolling",
    small.phase === "DECISION" && small.kind === "buy" &&
      small.holderScroll <= small.holderClient + 1 &&
      small.cardScroll <= small.cardClient + 1 &&
      (small.builds?.bottom ?? 0) <= (small.holder?.bottom ?? 0) + 1 &&
      small.buyVisible && small.nextVisible &&
      (small.buy?.top ?? 0) >= (small.holder?.top ?? 0) - 1 &&
      (small.next?.bottom ?? 0) <= (small.holder?.bottom ?? 0) + 1,
    `holder ${small.holderClient}/${small.holderScroll}, card ${small.cardClient}/${small.cardScroll}; ` +
      `Buy ${small.buyVisible}, Pass ${small.nextVisible}; ` +
      `Pass ends ${small.next?.bottom?.toFixed(1)} vs middle ${small.holder?.bottom?.toFixed(1)}`);
  note("and it still spans the full middle",
    small.holder.left >= small.centre.left - 1 &&
      small.holder.right <= small.centre.right + 1 &&
      Math.abs(small.holder.width - small.centre.width) <= 12,
    `card ${small.holder.width.toFixed(1)} of middle ${small.centre.width.toFixed(1)}`);
  note("no chip overflows at 360px on the decision",
    small.chips.every((c) => c.scroll <= c.client + 1 && c.nameScroll <= c.nameClient + 1),
    small.chips.map((c) => `${c.seat}:${c.scroll}/${c.client}`).join(" "));
  await shot(host, "phase1-unowned-360");

  await host.eval(`document.querySelector(".property-card__next").click(); true;`);
  await host.eval("window.__finishVisit()");
  await sleep(500);

  /* --- Ragnarok's three slots are the same slot ----------------------- */

  await host.eval("window.__econ.ensure(0)");
  await sleep(400);
  await host.eval(`document.querySelector('.board__cell[data-id="ragnarok"]').click(); true;`);
  await sleep(400);

  const ragnarok = await host.json(`
    const b = document.querySelector(".board");
    const h = b.querySelector(".board__card");
    const card = h.querySelector(".chest-card");
    const rect = (n) => n ? n.getBoundingClientRect().toJSON() : null;
    const slots = [...(card?.querySelectorAll(".chest-card__slot") || [])].map(rect);
    const close = card?.querySelector(".property-card__close");
    return {
      open: Boolean(card),
      kind: h.dataset.cardKind,
      closePresent: Boolean(close),
      closeHidden: close ? close.hidden : null,
      slots,
      slotsCount: slots.length,
      gaps: slots.length === 3
        ? [slots[1].left - slots[0].right, slots[2].left - slots[1].right]
        : [],
      card: rect(card),
      holder: rect(h),
      holderClient: h.clientHeight,
      holderScroll: h.scrollHeight,
      pageScrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      pageScrollY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    };
  `);

  const widths = ragnarok.slots.map((s) => s.width);
  const heights = ragnarok.slots.map((s) => s.height);
  const ratios = ragnarok.slots.map((s) => s.height / s.width);
  note("Ragnarok opens a read-only chest with three equal slots",
    ragnarok.open && ragnarok.kind === "chest" && ragnarok.slotsCount === 3 &&
      Math.max(...widths) - Math.min(...widths) <= 1 &&
      Math.max(...heights) - Math.min(...heights) <= 1 &&
      Math.max(...ratios) - Math.min(...ratios) <= 0.02 &&
      Math.abs(ragnarok.gaps[0] - ragnarok.gaps[1]) <= 1,
    `widths ${widths.map((w) => w.toFixed(1)).join(" ")}; ` +
      `heights ${heights.map((h) => h.toFixed(1)).join(" ")}; ` +
      `gaps ${ragnarok.gaps.map((g) => g.toFixed(1)).join(" ")}`);
  note("each slot is portrait-shaped and inside the card",
    ratios.every((r) => r > 1.1) &&
      ragnarok.slots.every((s) => s.left >= ragnarok.card.left - 1 &&
        s.right <= ragnarok.card.right + 1 &&
        s.top >= ragnarok.card.top - 1 &&
        s.bottom <= ragnarok.card.bottom + 1),
    ratios.map((r) => r.toFixed(2)).join(" "));
  note("the chest fits its holder, and the page does not scroll sideways",
    ragnarok.holderScroll <= ragnarok.holderClient + 1 &&
      ragnarok.pageScrollX === 0,
    `holder ${ragnarok.holderClient}/${ragnarok.holderScroll}, ` +
      `page x ${ragnarok.pageScrollX} y ${ragnarok.pageScrollY}`);
  note("and it has a close button of its own",
    ragnarok.closePresent === true && ragnarok.closeHidden === false,
    `present ${ragnarok.closePresent}, hidden ${ragnarok.closeHidden}`);
  await shot(host, "phase1-ragnarok-360");

  await host.eval(`document.querySelector(".property-card__close")?.click(); true;`);
  await sleep(300);
  const chestClosed = await host.json(`
    const b = document.querySelector(".board");
    return {
      cardHidden: b.querySelector(".board__card").hidden,
      reading: b.dataset.reading,
      dieOpacity: getComputedStyle(b.querySelector(".board__dice")).opacity,
      phase: b.game.phase,
    };
  `);
  note("closing the chest returns the board to the waiting turn",
    chestClosed.cardHidden === true && chestClosed.reading === "false" &&
      chestClosed.phase === "AWAITING_ROLL",
    `card hidden ${chestClosed.cardHidden}, die ${chestClosed.dieOpacity}`);

  /* --- the chips, the coins, and one colour for both ------------------ */

  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    await b.play({ type: "debug", active: 0 });
    await b.play({ type: "debug", position: 1 });
    return true;
  })()`);
  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    await b.play({ type: "debug", weapons: ["antimatter"] });
    return true;
  })()`);
  await guest.eval(`(async () => {
    const b = document.querySelector(".board");
    await b.play({ type: "debug", position: 1 });
    return true;
  })()`);
  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    await b.play({ type: "debug", active: 1 });
    b.coins.sync(b.game.pieces);
    return true;
  })()`);
  await sleep(1200);

  const chips = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const rect = (n) => n.getBoundingClientRect().toJSON();
    const cell = b.querySelector('.board__cell[data-id="moon"]');
    const label = cell.querySelector(".board__label");
    const moon = rect(cell);
    const coins = [...b.querySelectorAll(".coin")].map((c) => ({
      player: c.dataset.player,
      box: rect(c),
      coin: getComputedStyle(c).getPropertyValue("--coin").trim(),
    }));
    const onMoon = coins.filter((c) =>
      c.box.left >= moon.left - 1 && c.box.right <= moon.right + 1 &&
      c.box.top >= moon.top - 1 && c.box.bottom <= moon.bottom + 1);
    const who = [...document.querySelectorAll(".who")].map((w) => ({
      seat: w.dataset.seat,
      active: w.classList.contains("who--active"),
      turnShown: !w.querySelector(".who__turn").hidden,
      coin: getComputedStyle(w.querySelector(".who__coin")).getPropertyValue("--coin").trim()
        || getComputedStyle(w).getPropertyValue("--coin").trim(),
      overflow: w.scrollWidth > w.clientWidth + 1,
      nameOverflow: w.querySelector(".who__name").scrollWidth >
        w.querySelector(".who__name").clientWidth + 1,
      money: w.querySelector(".who__money").textContent.replace(/\\s+/g, ""),
      weapons: w.querySelectorAll(".who__weapon").length,
    }));
    return {
      label: rect(label),
      moon,
      coins,
      onMoon,
      who,
      active: g.active,
      positionOnMoon: g.pieces.filter((p) => p.position === 1).length,
      coinCount: b.querySelectorAll(".coin").length,
    };
  `);

  const labelBox = chips.label;
  note("both coins stand on the square without touching its name",
    chips.positionOnMoon === 2 && chips.onMoon.length === 2 &&
      chips.onMoon.every((c) => c.box.top >= labelBox.bottom - 0.5),
    `${chips.positionOnMoon} on Moon, ${chips.onMoon.length} drawn; ` +
      `name ends ${labelBox.bottom.toFixed(1)}, coins ` +
      chips.onMoon.map((c) => `${c.box.top.toFixed(1)}..${c.box.bottom.toFixed(1)}`).join(" "));
  note("the chip, the board coin and the square's ring all draw the same colour",
    chips.onMoon.length === 2 && chips.onMoon.every((c) => {
      const seat = c.player.replace("seat-", "");
      return chips.who.find((w) => w.seat === seat)?.coin === c.coin;
    }),
    chips.coins.map((c) => `${c.player}:${c.coin}`).join(" ") + " | " +
      chips.who.map((w) => `${w.seat}:${w.coin}`).join(" "));
  note("the active chip wears the TURN tag, and only the active one",
    chips.who.filter((w) => w.active && w.turnShown).length === 1 &&
      chips.who.find((w) => w.active)?.seat === String(chips.active),
    chips.who.map((w) => `${w.seat}:${w.active ? "active" : "idle"}/${w.turnShown ? "TURN" : "-"}`).join(" "));
  note("no chip overflows at 360px, and a weapon dot still sits on the chip",
    chips.who.every((w) => !w.overflow && !w.nameOverflow) &&
      chips.who.some((w) => w.weapons >= 1),
    chips.who.map((w) => `${w.seat}:${w.money}/${w.weapons} dots`).join(" | "));
  await shot(host, "phase1-chips-coins-360");

  await host.setViewport(W, H, DSF);
  await sleep(400);

  /* --- what an action says, and in whose words ------------------------- */

  heading("THE ANNOUNCEMENT, WORDED FOR EACH VIEWER");

  // A watcher that records every change in the announcement layer and the card
  // behind it. The timings are read from the page's own clock, so the pause
  // between two samples never becomes part of the measurement. `skipAt` taps the
  // layer at that moment, which is the only way a test can prove the skip.
  const WATCHER = `
    window.__watchAnnounce = async (ms, skipAt = -1) => {
      const b = document.querySelector(".board");
      const out = [];
      let last = "";
      let skipped = false;
      const start = performance.now();
      while (performance.now() - start < ms) {
        const n = b.querySelector(".board__announce");
        const h = b.querySelector(".board__card");
        const pick = (sel) => n?.querySelector(sel)?.textContent || "";
        const sample = {
          t: Math.round(performance.now() - start),
          hidden: n ? n.hidden : true,
          label: pick(".announce__label"),
          big: pick(".announce__big"),
          sub: pick(".announce__sub"),
          cardHidden: h ? h.hidden : true,
          cardVisible: Boolean(h && !h.hidden && getComputedStyle(h).visibility !== "hidden"),
          phase: b.game.phase,
          kind: b.game.landing?.kind || "",
          active: b.game.active,
          money: b.game.ledger.players.map((p) => p.money),
          rupees: b.querySelectorAll(".board__rupee").length,
        };
        const key = [sample.hidden, sample.label, sample.big, sample.sub,
          sample.cardHidden, sample.phase, sample.kind, sample.active,
          sample.money.join(",")].join("|");
        if (key !== last) {
          out.push(sample);
          last = key;
        }
        if (!skipped && skipAt >= 0 && sample.t >= skipAt && !sample.hidden) {
          skipped = true;
          n?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        }
        await new Promise((r) => setTimeout(r, 40));
      }
      return out;
    };`;
  await host.eval(WATCHER);
  await guest.eval(WATCHER);

  // A clean, known board: the buyer owns all of Moon's set, Moon is upgraded
  // twice so its pips have something to show, and the throw will pass Start and
  // land on Lagrange - a salary and a decision in one turn.
  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    await window.__econ.quiet();
    await b.play({ type: "debug", money: 2000 });
    await b.play({ type: "debug", owner: { id: "moon", seat: 0, level: 2 } });
    await b.play({ type: "debug", owner: { id: "lagrange-l2", seat: 0, level: 0 } });
    await b.play({ type: "debug", owner: { id: "jupiter", seat: 0, level: 0 } });
    await b.play({ type: "debug", active: 0 });
    await b.play({ type: "debug", position: 26 });
    return true;
  })()`);

  const salaryWatch = host.json("return await window.__watchAnnounce(7000);");
  await host.eval(`(() => {
    const b = document.querySelector(".board");
    (async () => {
      await window.__econ.quiet();
      await b.play({ type: "roll", rng: (4 - 0.5) / 6 });
    })();
    return true;
  })()`);
  const salarySamples = await salaryWatch;

  const salaryFirst = salarySamples.find((s) => !s.hidden && s.label === "SALARY");
  const salaryEnd = salarySamples.find((s) => salaryFirst && s.t > salaryFirst.t && s.hidden);
  const afterSalary = salarySamples.find(
    (s) => salaryEnd && s.t >= salaryEnd.t && !s.cardHidden && s.cardVisible,
  );
  const salaryRuns = salarySamples.filter((s) => !s.hidden && s.label === "SALARY").length;

  note("passing Start says SALARY, +₹200 and Lap complete",
    Boolean(salaryFirst) && salaryFirst.big === "+\u20b9200" &&
      salaryFirst.sub === "Lap complete" && salaryRuns === 1,
    salaryFirst
      ? `${salaryFirst.label} / ${salaryFirst.big} / ${salaryFirst.sub}; ${salaryRuns} run(s)`
      : "no salary announcement");
  note("and the salary is said before the landing card is shown",
    Boolean(salaryFirst) && salaryFirst.cardHidden === true &&
      Boolean(afterSalary) && afterSalary.kind === "own" &&
      afterSalary.phase === "DECISION",
    `card hidden while salary: ${salaryFirst?.cardHidden}; ` +
      `then ${afterSalary?.phase}/${afterSalary?.kind}`);
  note("the announcement holds the middle for about a second and a half",
    Boolean(salaryFirst) && Boolean(salaryEnd) &&
      salaryEnd.t - salaryFirst.t >= 1400 && salaryEnd.t - salaryFirst.t <= 2300,
    salaryEnd ? `${salaryEnd.t - salaryFirst.t}ms on screen` : "no exit seen");
  note("and the salary itself is paid once, into the purse",
    salarySamples.at(-1)?.money[0] === 2200,
    `purse ${salarySamples.at(-1)?.money.join(" ")}`);

  /* --- the profile ------------------------------------------------------ */

  heading("A PLAYER, OPENED");

  // The chip is the control. Both chips are buttons, and each says whose record
  // it opens; the profile itself is the same panel for either seat.
  const chipButtons = await host.json(`
    return [...document.querySelectorAll(".who")].map((w) => ({
      seat: w.dataset.seat,
      tag: w.tagName,
      aria: w.getAttribute("aria-label"),
      text: w.textContent.replace(/\\s+/g, " ").trim(),
      money: w.querySelector(".who__money").textContent.trim(),
    }));
  `);
  note("each whole chip is one button, labelled with the profile it opens",
    chipButtons.length === 2 &&
      chipButtons.every((c) => c.tag === "BUTTON" &&
        new RegExp("^Open .+'s profile$").test(c.aria || "")) &&
      chipButtons.every((c) => c.text.includes(c.money)),
    chipButtons.map((c) => `${c.seat}:${c.tag} "${c.aria}"`).join(" | "));

  const beforeProfile = await host.json(`
    const b = document.querySelector(".board");
    const h = b.querySelector(".board__card");
    return {
      seq: b.game.seq,
      mode: h.dataset.mode,
      name: h.querySelector(".property-card__name")?.textContent || "",
      next: h.querySelector(".property-card__next-label")?.textContent || "",
      phase: b.game.phase,
      active: b.game.active,
      hidden: h.hidden,
      money: b.game.ledger.players.map((p) => p.money),
    };
  `);

  await host.eval(`document.querySelector('.who[data-seat="0"]').click(); true;`);
  await sleep(400);

  const prof = await host.json(`
    const b = document.querySelector(".board");
    const centre = b.querySelector("#board-center");
    const panel = b.querySelector(".board__profile");
    const card = b.querySelector(".board__card");
    const die = b.querySelector(".board__dice");
    const turn = b.querySelector(".board__turn");
    const rect = (n) => n ? n.getBoundingClientRect().toJSON() : null;
    const style = (n) => n ? getComputedStyle(n) : null;
    const close = panel?.querySelector(".profile__close");
    const name = panel?.querySelector(".profile__name");
    const cash = panel?.querySelector(".profile__cash");
    const worth = panel?.querySelector(".profile__worth");
    const labels = [...panel.querySelectorAll(".profile__label")].map((n) => ({
      text: n.textContent,
      size: parseFloat(style(n).fontSize),
      spacing: parseFloat(style(n).letterSpacing),
    }));
    panel.scrollTop = 100000;
    const scrolled = panel.scrollTop;
    panel.scrollTop = 0;
    return {
      open: Boolean(panel),
      seat: panel?.dataset.profileSeat,
      aria: panel?.getAttribute("aria-label"),
      dataProfile: b.dataset.profile,
      panel: rect(panel),
      centre: rect(centre),
      close: rect(close),
      closeSize: close ? [parseFloat(style(close).width), parseFloat(style(close).height)] : [],
      coin: rect(panel?.querySelector(".profile__coin")),
      name: name?.textContent,
      nameSize: parseFloat(style(name).fontSize),
      civ: panel?.querySelector(".profile__civ")?.textContent,
      civSize: parseFloat(style(panel?.querySelector(".profile__civ")).fontSize),
      cash: cash?.textContent,
      cashSize: parseFloat(style(cash).fontSize),
      cashWeight: style(cash).fontWeight,
      cashVariant: style(cash).fontVariantNumeric,
      worth: worth?.textContent,
      labels,
      count: panel?.querySelector(".profile__count")?.textContent,
      sets: [...panel.querySelectorAll(".profile-set")].map((s) => ({
        set: s.dataset.set,
        badge: s.querySelector(".profile-set__badge").textContent,
        label: s.querySelector(".profile-set__label").textContent,
        names: [...s.querySelectorAll(".profile-colony__name")].map((n) => n.textContent),
        rents: [...s.querySelectorAll(".profile-colony__rent")].map((n) => n.textContent),
        pipsOn: s.querySelectorAll('.profile-pip[data-on="true"]').length,
        pips: s.querySelectorAll(".profile-pip").length,
      })),
      weapons: [...panel.querySelectorAll(".profile-weapon")].map((w) => ({
        id: w.dataset.weapon,
        name: w.querySelector(".profile-weapon__name").textContent,
        targets: w.querySelectorAll(".profile-weapon__target").length,
        face: Boolean(w.querySelector(".profile-weapon__emblem svg, .profile-weapon__emblem .chest-card__emblem")),
      })),
      emptyWeapons: panel?.querySelector('[data-section="weapons"] .profile__empty')?.textContent || null,
      ledger: [...panel.querySelectorAll(".profile-ledger__row")].slice(0, 6).map((r) => ({
        kind: r.dataset.kind,
        turn: r.querySelector(".profile-ledger__turn").textContent,
        text: r.querySelector(".profile-ledger__text").textContent,
        amount: r.querySelector(".profile-ledger__amount").textContent,
        balance: r.querySelector(".profile-ledger__balance").textContent,
        align: style(r.querySelector(".profile-ledger__money")).textAlign,
        variant: style(r.querySelector(".profile-ledger__amount")).fontVariantNumeric,
      })),
      ledgerCount: panel?.querySelectorAll(".profile-ledger__row").length || 0,
      client: panel?.clientHeight,
      scroll: panel?.scrollHeight,
      scrolled,
      scrollbar: style(panel).scrollbarWidth,
      bodySize: parseFloat(style(panel).fontSize),
      lineHeight: style(panel).lineHeight,
      padding: style(panel).padding,
      radius: style(panel).borderRadius,
      shadow: style(panel).boxShadow,
      text: panel?.textContent || "",
      dieDisplay: style(die).display,
      turnDisplay: style(turn).display,
      cardVisibility: style(card).visibility,
      cardHidden: card.hidden,
      seq: b.game.seq,
    };
  `);

  note("the whole chip opens that player's record over the entire middle",
    prof.open && prof.seat === "0" && prof.dataProfile === "true" &&
      prof.aria === "Asha's profile" &&
      Math.abs(prof.panel.left - prof.centre.left) <= 1 &&
      Math.abs(prof.panel.right - prof.centre.right) <= 1 &&
      Math.abs(prof.panel.top - prof.centre.top) <= 1 &&
      Math.abs(prof.panel.bottom - prof.centre.bottom) <= 1 &&
      prof.dieDisplay === "none" && prof.turnDisplay === "none" &&
      prof.cardVisibility === "hidden",
    `panel ${prof.panel?.width.toFixed(0)}x${prof.panel?.height.toFixed(0)} of ` +
      `${prof.centre?.width.toFixed(0)}x${prof.centre?.height.toFixed(0)}; ` +
      `die ${prof.dieDisplay}, turn ${prof.turnDisplay}, card ${prof.cardVisibility}`);
  note("and it closes with a 32px button in its top right",
    prof.closeSize[0] === 32 && prof.closeSize[1] === 32 &&
      prof.close.right <= prof.panel.right - 8 &&
      prof.close.top <= prof.panel.top + 24,
    `close ${prof.closeSize.join("x")} at ${prof.close.right.toFixed(0)},${prof.close.top.toFixed(0)}`);
  note("the header is coin, name, civilization and cash, in the card's own voice",
    prof.name === "Asha" && prof.nameSize === 22 && prof.civ === "Indus Valley" &&
      prof.civSize === 11 && prof.cash === "\u20b92,200" && prof.cashSize === 36 &&
      Number(prof.cashWeight) <= 300 && /tabular-nums/.test(prof.cashVariant) &&
      /^Net worth \u20b9[\d,]+$/.test(prof.worth || "") &&
      prof.coin.width === 28 && prof.coin.height === 28 &&
      prof.padding === "16px" && prof.bodySize === 13 &&
      Math.abs(parseFloat(prof.lineHeight) / prof.bodySize - 1.4) < 0.02,
    `${prof.name} ${prof.nameSize}px, ${prof.civ} ${prof.civSize}px, ` +
      `cash ${prof.cash} ${prof.cashSize}px/${prof.cashWeight}, ${prof.worth}`);
  note("the quiet labels are 11-12px uppercase at 0.08em",
    prof.labels.length === 3 &&
      prof.labels.map((l) => l.text).join(" ") === "PROPERTIES WEAPONS LEDGER" &&
      prof.labels.every((l) => l.size >= 11 && l.size <= 12 && l.spacing >= 0.7),
    prof.labels.map((l) => `${l.text}:${l.size}px/${l.spacing}px`).join(" "));
  note("PROPERTIES counts the colonies and groups them by set, with the full set marked",
    prof.count === "Owns 3 of 20 colonies" && prof.sets.length === 2 &&
      prof.sets[0].set === "s1" && prof.sets[0].badge === "Full set" &&
      prof.sets[0].names.join(" ") === "Moon Lagrange Point L2" &&
      prof.sets[1].set === "s2" && prof.sets[1].badge === "1 of 3" &&
      prof.sets[0].pipsOn === 2 && prof.sets[0].pips === 6 &&
      prof.sets[0].rents.every((r) => /^\u20b9[\d,]+$/.test(r)),
    `${prof.count}; ${prof.sets.map((s) => `${s.set}:${s.badge}[${s.names.join(",")}]`).join(" ")}`);
  note("WEAPONS shows the face-up cards the player carries",
    prof.weapons.length >= 1 && prof.weapons.every((w) => w.face && w.targets >= 3) &&
      prof.weapons.some((w) => w.name === "Antimatter Weapon"),
    prof.weapons.map((w) => `${w.name} (${w.targets})`).join(", ") || prof.emptyWeapons);
  note("LEDGER is newest first, salary on top, with the signed amount and balance",
    prof.ledger.length >= 4 && prof.ledger[0].kind === "salary" &&
      /Salary .* lap complete/.test(prof.ledger[0].text) &&
      prof.ledger[0].amount === "+\u20b9200" &&
      prof.ledger[0].balance === "\u20b92,200" &&
      /^T\d+$/.test(prof.ledger[0].turn) &&
      prof.ledger.every((r) => r.align === "right" && /tabular-nums/.test(r.variant)) &&
      prof.ledgerCount >= 4,
    `${prof.ledgerCount} rows; top ${prof.ledger[0]?.turn} ${prof.ledger[0]?.text} ` +
      `${prof.ledger[0]?.amount} / ${prof.ledger[0]?.balance}`);
  note("the record scrolls inside itself, with no scrollbar in the middle",
    prof.scroll > prof.client && prof.scrolled > 0 && prof.scrollbar === "none",
    `client ${prof.client}, scroll ${prof.scroll}, scrolled ${prof.scrolled}, ` +
      `scrollbar ${prof.scrollbar}`);
  note("no rupee amount in the record is missing its thousands separator",
    !/\u20b9\d{4,}/.test(prof.text), "amounts scanned");
  note("nothing in the record says build",
    !/\bbuild/i.test(prof.text), "wording scanned");

  // The same chip, second tap. Everything underneath must come back exactly as
  // it was - including the decision, which was never answered.
  await host.eval(`document.querySelector('.who[data-seat="0"]').click(); true;`);
  await sleep(350);
  const afterProfile = await host.json(`
    const b = document.querySelector(".board");
    const h = b.querySelector(".board__card");
    return {
      open: Boolean(b.querySelector(".board__profile")),
      dataProfile: b.dataset.profile || "",
      mode: h.dataset.mode,
      name: h.querySelector(".property-card__name")?.textContent || "",
      next: h.querySelector(".property-card__next-label")?.textContent || "",
      phase: b.game.phase,
      active: b.game.active,
      hidden: h.hidden,
      visible: getComputedStyle(h).visibility,
      dieDisplay: getComputedStyle(b.querySelector(".board__dice")).display,
      seq: b.game.seq,
      money: b.game.ledger.players.map((p) => p.money),
    };
  `);
  note("a second tap of the same chip closes the record",
    afterProfile.open === false && afterProfile.dataProfile === "" &&
      afterProfile.visible === "visible",
    `open ${afterProfile.open}, data-profile "${afterProfile.dataProfile}"`);
  note("and gives back exactly the middle that was underneath, untouched",
    afterProfile.mode === beforeProfile.mode &&
      afterProfile.name === beforeProfile.name &&
      afterProfile.next === beforeProfile.next &&
      afterProfile.phase === beforeProfile.phase &&
      afterProfile.active === beforeProfile.active &&
      afterProfile.hidden === beforeProfile.hidden &&
      afterProfile.seq === beforeProfile.seq &&
      afterProfile.money.join(" ") === beforeProfile.money.join(" "),
    `${afterProfile.mode}/${afterProfile.name}/${afterProfile.next}; ` +
      `phase ${afterProfile.phase}, active ${afterProfile.active}, seq ${afterProfile.seq}`);

  // The same chip opens the other player's record. Their empty states are part
  // of the panel, not a separate screen.
  await host.eval(`document.querySelector('.who[data-seat="1"]').click(); true;`);
  await sleep(350);
  const guestProfile = await host.json(`
    const b = document.querySelector(".board");
    const panel = b.querySelector(".board__profile");
    return {
      open: Boolean(panel),
      seat: panel?.dataset.profileSeat,
      name: panel?.querySelector(".profile__name")?.textContent,
      count: panel?.querySelector(".profile__count")?.textContent,
      weapons: panel?.querySelectorAll(".profile-weapon").length || 0,
      emptyColonies: panel?.querySelector('[data-section="properties"] .profile__empty')?.textContent || null,
      emptyWeapons: panel?.querySelector('[data-section="weapons"] .profile__empty')?.textContent || null,
      ledger: panel?.querySelectorAll(".profile-ledger__row").length || 0,
    };
  `);
  note("the other player's chip opens their record too, with the empty states said plainly",
    guestProfile.open && guestProfile.seat === "1" && guestProfile.name === "Vikram" &&
      guestProfile.emptyColonies === "No colonies yet." &&
      ((guestProfile.weapons === 0 &&
        guestProfile.emptyWeapons === "No weapons yet. Draw at Ragnarok.") ||
       (guestProfile.weapons > 0 && guestProfile.emptyWeapons === null)),
    `${guestProfile.name}: ${guestProfile.weapons} weapon(s), ` +
      `"${guestProfile.emptyColonies}" / "${guestProfile.emptyWeapons}"`);
  await host.eval(`document.querySelector('.who[data-seat="1"]').click(); true;`);
  await sleep(300);

  // Finish the decision so the profile can be tested over a die that is up.
  await host.eval(`document.querySelector(".property-card__next").click(); true;`);
  await host.eval("window.__finishVisit()");
  await host.eval("window.__econ.ensure(0)");
  await sleep(300);
  const overDie = await host.json(`
    const b = document.querySelector(".board");
    return { dieDisplay: getComputedStyle(b.querySelector(".board__dice")).display,
             rollable: b.dataset.rollable };
  `);
  await host.eval(`document.querySelector('.who[data-seat="0"]').click(); true;`);
  await sleep(250);
  const profOpen = await host.json(`
    const b = document.querySelector(".board");
    return { open: Boolean(b.querySelector(".board__profile")),
             dieDisplay: getComputedStyle(b.querySelector(".board__dice")).display };
  `);
  await host.eval(`document.querySelector('.who[data-seat="0"]').click(); true;`);
  await sleep(250);
  const profClosed = await host.json(`
    const b = document.querySelector(".board");
    return { open: Boolean(b.querySelector(".board__profile")),
             dieDisplay: getComputedStyle(b.querySelector(".board__dice")).display };
  `);
  note("the record can be opened with the die showing, and the die is gone while it is up",
    overDie.dieDisplay !== "none" && overDie.rollable === "true" &&
      profOpen.open && profOpen.dieDisplay === "none" &&
      profClosed.open === false && profClosed.dieDisplay !== "none",
    `die before ${overDie.dieDisplay}, open ${profOpen.dieDisplay}, ` +
      `closed ${profClosed.dieDisplay}`);

  // A turn that changes while the record is open must not close it or change
  // whose record it is. The panel is re-read from the live game, not a snapshot.
  await host.eval(`document.querySelector('.who[data-seat="0"]').click(); true;`);
  await sleep(200);
  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    await b.play({ type: "debug", active: 1 });
    await new Promise((r) => setTimeout(r, 300));
    return true;
  })()`);
  const acrossTurn = await host.json(`
    const b = document.querySelector(".board");
    const panel = b.querySelector(".board__profile");
    return {
      open: Boolean(panel),
      seat: panel?.dataset.profileSeat,
      name: panel?.querySelector(".profile__name")?.textContent,
      active: b.game.active,
    };
  `);
  await host.eval(`document.querySelector('.who[data-seat="0"]').click(); true;`);
  await sleep(250);
  const turnUnder = await host.json(`
    const b = document.querySelector(".board");
    return { dieDisplay: getComputedStyle(b.querySelector(".board__dice")).display,
             active: b.game.active,
             turn: b.querySelector(".board__turn").textContent };
  `);
  note("it stays open, and on the same player, when the turn changes underneath",
    acrossTurn.open && acrossTurn.seat === "0" && acrossTurn.name === "Asha" &&
      acrossTurn.active === 1 && turnUnder.dieDisplay === "none" &&
      turnUnder.active === 1 && /Vikram/.test(turnUnder.turn),
    `open ${acrossTurn.open} seat ${acrossTurn.seat}; active ${turnUnder.active}, ` +
      `die ${turnUnder.dieDisplay}, "${turnUnder.turn}"`);
  await host.eval(`(async () => {
    await document.querySelector(".board").play({ type: "debug", active: 0 });
    return true;
  })()`);

  /* ------------------------------------------- one rent, two sentences ----- */

  heading("ONE RENT, TWO SENTENCES");

  // A fresh game, the buyer holding Moon, and the other seat rolling onto it.
  // Both screens watch their own copy of the same event.
  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) await wait(50);
    await b.play({ type: "debug", reset: true });
    for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) await wait(50);
    await b.play({ type: "debug", owner: { id: "moon", seat: 0, level: 0 } });
    await b.play({ type: "debug", money: 2000 });
    await b.play({ type: "debug", active: 1 });
    await b.play({ type: "debug", position: 10 });
    b.coins.sync(b.game.pieces);
    return true;
  })()`);
  await guest.eval(`(async () => {
    const b = document.querySelector(".board");
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) await wait(50);
    await b.play({ type: "debug", money: 2000 });
    await b.play({ type: "debug", position: 0 });
    return true;
  })()`);
  await sleep(400);

  const hostRentWatch = host.json("return await window.__watchAnnounce(6000);");
  const guestRentWatch = guest.json("return await window.__watchAnnounce(6000);");
  await guest.eval(`(() => {
    const b = document.querySelector(".board");
    (async () => {
      await window.__finishVisit();
      await b.play({ type: "debug", active: 1 });
      await b.play({ type: "debug", position: 0 });
      await b.play({ type: "roll", rng: (1 - 0.5) / 6 });
    })();
    return true;
  })()`);
  const [hostRentSamples, guestRentSamples] =
    await Promise.all([hostRentWatch, guestRentWatch]);

  const rentOn = (samples, label) =>
    samples.filter((s) => !s.hidden && s.label === label);
  const hostRent = rentOn(hostRentSamples, "RENT RECEIVED");
  const guestRent = rentOn(guestRentSamples, "RENT PAID");
  const spanOf = (samples, first) => {
    const end = samples.find((s) => first && s.t > first.t && s.hidden);
    return end ? end.t - first.t : -1;
  };
  const hostRentSpan = spanOf(hostRentSamples, hostRent[0]);
  const guestRentSpan = spanOf(guestRentSamples, guestRent[0]);
  const hostRentCard = hostRentSamples.find(
    (s) => hostRent[0] && s.t >= hostRent[0].t && !s.cardHidden && s.cardVisible && s.kind === "rent",
  );
  const guestRentCard = guestRentSamples.find(
    (s) => guestRent[0] && s.t >= guestRent[0].t && !s.cardHidden && s.cardVisible && s.kind === "rent",
  );

  note("the payer is told RENT PAID, with the amount and the holder",
    guestRent.length === 1 && guestRent[0].big === "\u2212\u20b920" &&
      guestRent[0].sub === "to Asha \u00b7 Moon" && Boolean(guestRentCard),
    guestRent[0] ? `${guestRent[0].label} ${guestRent[0].big} ${guestRent[0].sub}` : "none");
  note("and the holder is told RENT RECEIVED, with the payer's name",
    hostRent.length === 1 && hostRent[0].big === "+\u20b920" &&
      hostRent[0].sub === "from Vikram \u00b7 Moon" && Boolean(hostRentCard),
    hostRent[0] ? `${hostRent[0].label} ${hostRent[0].big} ${hostRent[0].sub}` : "none");
  note("each sentence is said once, for the viewer it belongs to",
    hostRent.length === 1 && guestRent.length === 1 &&
      hostRentSpan > 0 && guestRentSpan > 0 &&
      Math.abs(hostRentSpan - guestRentSpan) <= 200 &&
      hostRentSpan >= 1400 && hostRentSpan <= 2300,
    `host ${hostRentSpan}ms, guest ${guestRentSpan}ms`);
  note("and the purses move by exactly the rent, on both ledgers",
    hostRentSamples.at(-1)?.money[0] === 2020 &&
      hostRentSamples.at(-1)?.money[1] === 1980,
    `host ${hostRentSamples.at(-1)?.money.join(" ")}`);

  await guest.eval(`document.querySelector(".property-card__next")?.click(); true;`);
  await sleep(1800);

  /* ------------------------------------------- the skip and the quiet mode */

  heading("TAP TO SKIP, AND LESS MOTION");

  await host.eval("window.__econ.ensure(0)");
  await host.eval(`(async () => {
    await document.querySelector(".board").play({ type: "debug", position: 26 });
    return true;
  })()`);
  await sleep(300);

  const skipWatch = host.json("return await window.__watchAnnounce(6000, 700);");
  await host.eval(`(() => {
    const b = document.querySelector(".board");
    (async () => {
      await window.__econ.quiet();
      await b.play({ type: "roll", rng: (4 - 0.5) / 6 });
    })();
    return true;
  })()`);
  const skipSamples = await skipWatch;
  const skipSalary = skipSamples.find((s) => !s.hidden && s.label === "SALARY");
  const skipEnd = skipSamples.find((s) => skipSalary && s.t > skipSalary.t && s.hidden);
  note("a tap skips the announcement and gives the middle back at once",
    Boolean(skipSalary) && Boolean(skipEnd) &&
      (skipEnd.t - skipSalary.t) <= 1200,
    skipSalary && skipEnd ? `${skipEnd.t - skipSalary.t}ms from visible to gone` : "not seen");

  await host.eval("window.__finishVisit()");
  await sleep(300);

  await host.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await sleep(300);
  const reduced = await host.json(`return matchMedia("(prefers-reduced-motion: reduce)").matches;`);

  await host.eval("window.__econ.ensure(0)");
  await host.eval(`(async () => {
    await document.querySelector(".board").play({ type: "debug", position: 26 });
    return true;
  })()`);
  await sleep(300);
  const redWatch = host.json("return await window.__watchAnnounce(6000);");
  await host.eval(`(() => {
    const b = document.querySelector(".board");
    (async () => {
      await window.__econ.quiet();
      await b.play({ type: "roll", rng: (4 - 0.5) / 6 });
    })();
    return true;
  })()`);
  const redSamples = await redWatch;
  const redSalary = redSamples.filter((s) => !s.hidden && s.label === "SALARY");
  const maxRupees = Math.max(...redSamples.map((s) => s.rupees), 0);
  note("a reader who asks for less motion gets the same words and no travel",
    reduced === true && redSalary.length === 1 && redSalary[0].big === "+\u20b9200" &&
      maxRupees === 0,
    `matchMedia ${reduced}; ${redSalary.length} salary; ${maxRupees} coin token(s)`);
  await host.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  await host.eval("window.__finishVisit()");
  await sleep(300);

  /* ------------------------------------------- Ragnarok at three sizes ----- */

  heading("RAGNAROK AT THREE SIZES");
  await host.eval("window.__econ.ensure(0)");
  await sleep(300);

  const chestAt = async (w, h) => {
    await host.setViewport(w, h, DSF);
    await sleep(500);
    await host.eval(`document.querySelector('.board__cell[data-id="ragnarok"]').click(); true;`);
    await sleep(400);
    const data = await host.json(`
      const b = document.querySelector(".board");
      const card = b.querySelector(".chest-card");
      const rect = (n) => { const r = n.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                 w: r.width, h: r.height }; };
      const slots = [...(card?.querySelectorAll(".chest-card__slot") || [])].map((slot) => {
        const name = slot.querySelector(".chest-card__slot-name");
        const pill = slot.querySelector(".chest-card__pill");
        const box = rect(slot);
        const nb = rect(name);
        const pb = rect(pill);
        let lines = 0;
        try {
          const range = document.createRange();
          range.selectNodeContents(name);
          lines = [...range.getClientRects()].filter((r) => r.height > 1).length;
        } catch {
          lines = 0;
        }
        return { box, name: nb, pill: pb, lines,
                 nameScroll: name.scrollHeight, nameClient: name.clientHeight,
                 text: name.textContent };
      });
      return { slots, text: card?.textContent || "",
               card: card ? rect(card) : null,
               holder: rect(b.querySelector(".board__card")),
               holderClient: b.querySelector(".board__card").clientHeight,
               holderScroll: b.querySelector(".board__card").scrollHeight };
    `);
    await host.eval(`document.querySelector(".property-card__close")?.click(); true;`);
    await sleep(300);
    return data;
  };

  const chestSizes = [];
  for (const size of [[360, 700], [390, 850], [430, 932]]) {
    chestSizes.push({ size, ...(await chestAt(size[0], size[1])) });
  }

  const spread = (nums) => Math.max(...nums) - Math.min(...nums);
  note("the three slots are one slot, the same at every phone size",
    chestSizes.every((c) => c.slots.length === 3 &&
      spread(c.slots.map((s) => s.box.w)) <= 0.5 &&
      spread(c.slots.map((s) => s.box.h)) <= 0.5 &&
      spread(c.slots.map((s) => s.pill.h)) <= 0.5 &&
      c.slots.every((s) => s.nameScroll <= s.nameClient + 1)),
    chestSizes.map((c) => c.size.join("x") + ":" +
      c.slots.map((s) => s.box.w.toFixed(1)).join("/")).join(" | "));
  note("each slot is a 3:4 portrait with a fixed two-line label, never clipped",
    chestSizes.every((c) => c.slots.every((s) =>
      Math.abs(s.box.h / s.box.w - 4 / 3) <= 0.02 &&
      s.lines >= 1 && s.lines <= 2 &&
      s.nameScroll <= s.nameClient + 1 &&
      s.name.h >= 16 &&
      s.box.left >= c.card.left - 1 && s.box.right <= c.card.right + 1) &&
      spread(c.slots.map((s) => s.name.h)) <= 0.5),
    chestSizes.map((c) => c.size.join("x") + ":" +
      c.slots.map((s) => (s.box.h / s.box.w).toFixed(2) + "/" + s.lines + "ln/" +
        s.name.h.toFixed(0) + "px").join("/")).join(" | "));
  note("the chest says nothing about odds, and it fits its holder",
    chestSizes.every((c) => !/30%|10%/.test(c.text) && c.holderScroll <= c.holderClient + 1),
    chestSizes.map((c) => c.size.join("x") + ":" + c.holderScroll + "/" + c.holderClient).join(" | "));

  /* ------------------------------------------- twenty squares, four states */

  heading("TWENTY SQUARES, FOUR STATES, TWO PHONES");

  const PROPERTY_IDS = [
    "moon", "lagrange-l2", "asteroid-belt", "jupiter", "pluto",
    "kuiper-belt", "halleys-comet", "voyager-1", "proxima-centauri",
    "event-horizon", "earth-137", "orions-belt", "wow-signal",
    "dyson-sphere", "wormhole", "milky-way", "rama", "quasar",
    "supernova", "sagittarius-a-star",
  ];
  const STATES = [
    { name: "unowned", seat: null, level: 0 },
    { name: "owned", seat: 0, level: 0 },
    { name: "one up", seat: 0, level: 1 },
    { name: "full up", seat: 0, level: 3 },
  ];

  const matrixAt = async (w, h, states) => {
    await host.setViewport(w, h, DSF);
    await sleep(500);
    await host.eval("window.__econ.ensure(0)");
    await sleep(200);
    return host.json(`
      const b = document.querySelector(".board");
      const centre = b.querySelector("#board-center");
      const ids = ${JSON.stringify(PROPERTY_IDS)};
      const states = ${JSON.stringify(states)};
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const rect = (n) => { const r = n.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                 w: r.width, h: r.height }; };
      const rows = [];
      for (const id of ids) {
        for (const state of states) {
          await b.play({ type: "debug", owner: { id, seat: state.seat, level: state.level } });
          const cell = b.querySelector('.board__cell[data-id="' + id + '"]');
          const holder = b.querySelector(".board__card");
          let card = null;
          for (let attempt = 0; attempt < 5 && !card; attempt += 1) {
            holder.querySelector(".property-card__close")?.click();
            await wait(60);
            cell.click();
            await wait(160);
            card = holder.querySelector(".property-card");
          }
          if (!card) {
            rows.push({ id, state: state.name, missing: true });
            continue;
          }
          const buttons = [...holder.querySelectorAll("button")].filter((btn) =>
            !btn.hidden && getComputedStyle(btn).display !== "none" &&
            getComputedStyle(btn).visibility !== "hidden" &&
            !btn.closest(".builds"));
          const lastInteractive = buttons.length
            ? Math.max(...buttons.map((x) => x.getBoundingClientRect().bottom)) : 0;
          const measured = [...card.querySelectorAll(
            ".property-card__name,.property-card__status,.property-card__rent," +
            ".property-card__description,.property-card__advantage-text," +
            ".build__name,.build__description,.build__button-label," +
            ".build__cost-figure,.builds__label,.property-card__label")].map((n) => {
            const cs = getComputedStyle(n);
            return { text: n.textContent, cls: n.className,
                     sw: n.scrollWidth, cw: n.clientWidth,
                     sh: n.scrollHeight, ch: n.clientHeight,
                     fs: parseFloat(cs.fontSize) };
          });
          const bodyTexts = measured.filter((t) =>
            !/(^|__)(label|step|cost-rupee)$/.test(t.cls) && !/builds__label/.test(t.cls));
          const outsideBuilds = [...card.querySelectorAll(
            ".property-card__name,.property-card__status,.property-card__rent," +
            ".property-card__description,.property-card__advantage-text,.property-card__price")].map((n) => ({
            sw: n.scrollWidth, cw: n.clientWidth,
            sh: n.scrollHeight, ch: n.clientHeight,
            fs: parseFloat(getComputedStyle(n).fontSize), text: n.textContent, cls: n.className,
          }));
          rows.push({
            id, state: state.name,
            holder: rect(holder), centre: rect(centre),
            holderScroll: holder.scrollHeight, holderClient: holder.clientHeight,
            cardScroll: card.scrollHeight, cardClient: card.clientHeight,
            lastInteractive,
            minFont: bodyTexts.length ? Math.min(...bodyTexts.map((t) => t.fs)) : 99,
            truncated: outsideBuilds.filter((t) => t.sw > t.cw + 1 || t.sh > t.ch + 1),
            text: card.textContent,
          });
          holder.querySelector(".property-card__close")?.click();
          await wait(110);
        }
      }
      return rows;
    `);
  };

  const matrix = [];
  for (const size of [[390, 850], [360, 700]]) {
    matrix.push({ size, rows: await matrixAt(size[0], size[1], STATES) });
  }
  matrix.push({ size: [430, 932], rows: await matrixAt(430, 932, [STATES[3]]) });

  const flat = matrix.flatMap((m) => m.rows);
  const bad = flat.filter((row) =>
    row.missing === true ||
    row.holderScroll > row.holderClient + 1 ||
    row.cardScroll > row.cardClient + 1 ||
    row.lastInteractive > row.holder.bottom + 1 ||
    row.truncated.length > 0 ||
    row.minFont < 11);
  note("every card state fits the middle at 390, 360 and 430 without a scroll",
    flat.length >= 160 && bad.length === 0,
    `${flat.length} cards; ${bad.length} failures` +
      (bad.length ? ": " + JSON.stringify(bad.slice(0, 2)) : ""));
  note("no rendered amount lacks a separator and nothing says build",
    flat.every((row) => !/\u20b9\d{4,}/.test(row.text) && !/\bbuild/i.test(row.text)),
    "wording and amounts scanned");

  /* ------------------------------------------- the pips under a name ------- */

  heading("THE PIPS UNDER A NAME");
  await host.eval(`(async () => {
    const b = document.querySelector(".board");
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) await wait(50);
    await b.play({ type: "debug", reset: true });
    for (let i = 0; i < 80 && b.dataset.busy === "true"; i++) await wait(50);
    await b.play({ type: "debug", owner: { id: "moon", seat: 0, level: 2 } });
    await b.play({ type: "debug", owner: { id: "jupiter", seat: 0, level: 0 } });
    await b.play({ type: "debug", owner: { id: "lagrange-l2", seat: 0, level: 1 } });
    await b.play({ type: "debug", active: 0 });
    await b.play({ type: "debug", position: 1 });
    b.coins.sync(b.game.pieces);
    return true;
  })()`);
  await guest.eval(`(async () => {
    const b = document.querySelector(".board");
    await b.play({ type: "debug", position: 5 });
    return true;
  })()`);
  await sleep(900);

  const pipsAt = async (w, h) => {
    await host.setViewport(w, h, DSF);
    await sleep(400);
    return host.json(`
      const b = document.querySelector(".board");
      const rect = (n) => { const r = n.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                 w: r.width, h: r.height }; };
      const cells = [...b.querySelectorAll(".board__cell[data-id]")];
      const coins = [...b.querySelectorAll(".coin")].map((c) => rect(c));
      const rows = cells.filter((c) => c.dataset.owner !== undefined).map((c) => {
        const box = rect(c);
        const pips = c.querySelector(".board__pips");
        const label = c.querySelector(".board__label");
        const nameNode = [...label.children]
          .filter((x) => !x.classList.contains("board__pips")).at(-1);
        const pr = rect(pips);
        const lr = rect(label);
        const nr = nameNode ? rect(nameNode) : lr;
        const here = coins.filter((x) =>
          x.left >= box.left - 1 && x.right <= box.right + 1 &&
          x.top >= box.top - 1 && x.bottom <= box.bottom + 1);
        return {
          id: c.dataset.id, owner: c.dataset.owner, built: c.dataset.built,
          pips: pr, label: lr, name: nr,
          pipsVisible: getComputedStyle(pips).display !== "none",
          pipCenter: pr.left + pr.w / 2, labelCenter: lr.left + lr.w / 2,
          onPips: [...pips.querySelectorAll(".board__pip")]
            .filter((p) => p.dataset.on === "true").length,
          coins: here,
          noBefore: getComputedStyle(c, "::before").content,
        };
      });
      const unowned = cells.filter((c) => c.dataset.owner === undefined &&
        c.querySelector(".board__pips")).map((c) => ({
        id: c.dataset.id,
        pipsDisplay: getComputedStyle(c.querySelector(".board__pips")).display,
        noBefore: getComputedStyle(c, "::before").content,
      }));
      return { rows, unowned, cellCount: cells.length, coinCount: coins.length };
    `);
  };

  const pips = [];
  for (const size of [[390, 850], [360, 700]]) {
    pips.push({ size, ...(await pipsAt(size[0], size[1])) });
  }
  const pipFailing = pips.flatMap((p) => p.rows.filter((r) =>
    !(r.pipsVisible && Math.abs(r.pipCenter - r.labelCenter) <= 1.5 &&
      r.pips.top >= r.name.bottom - 0.5 &&
      r.onPips === Number(r.built) &&
      r.coins.every((c) => c.top >= r.name.bottom - 0.5 &&
        c.top >= r.pips.bottom - 0.5))).map((r) => ({
    size: p.size.join("x"), id: r.id, on: r.onPips, built: r.built,
    pip: r.pips, name: r.name, coins: r.coins,
    centred: Math.abs(r.pipCenter - r.labelCenter),
  })));
  note("pips sit centred under the name, below it, and never over the coins",
    pipFailing.length === 0,
    JSON.stringify(pipFailing.slice(0, 3)));
  note("pips appear only on owned squares, and the old top-right mark is gone",
    pips.every((p) => p.unowned.every((u) => u.pipsDisplay === "none" &&
      u.noBefore === "none") && p.rows.every((r) => r.noBefore === "none")),
    pips.map((p) => p.size.join("x") + ": " + p.rows.length + " owned, " +
      p.unowned.length + " unowned").join(" | "));

  /* ------------------------------------------- Sell at 360, and the words */

  await host.setViewport(360, 700, DSF);
  await sleep(500);
  await host.eval(`document.querySelector('.board__cell[data-id="moon"]').click(); true;`);
  await sleep(400);
  const sell360 = await host.json(`
    const b = document.querySelector(".board");
    const h = b.querySelector(".board__card");
    const sell = h.querySelector(".property-card__sell");
    const rect = (n) => { const r = n.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
               w: r.width, h: r.height }; };
    const buttons = [...h.querySelectorAll("button")].filter((x) =>
      !x.hidden && getComputedStyle(x).display !== "none" &&
      getComputedStyle(x).visibility !== "hidden" && !x.closest(".builds"));
    return {
      hidden: sell.hidden,
      label: sell.querySelector(".property-card__sell-label").textContent,
      background: getComputedStyle(sell).backgroundColor,
      box: rect(sell), holder: rect(h),
      lastInteractive: Math.max(...buttons.map((x) => x.getBoundingClientRect().bottom)),
      text: h.textContent,
    };
  `);
  const sell360Rgb = (sell360.background.match(/\d+/g) || []).map(Number);
  note("Sell is a red pill with the real amount, visible without scrolling at 360",
    sell360.hidden === false && /^Sell for \u20b9[\d,]+$/.test(sell360.label) &&
      sell360Rgb[0] > sell360Rgb[1] + 30 && sell360Rgb[0] > sell360Rgb[2] + 30 &&
      sell360.box.bottom <= sell360.holder.bottom + 1 &&
      sell360.box.top >= sell360.holder.top - 1 &&
      sell360.lastInteractive <= sell360.holder.bottom + 1,
    `${sell360.label} ${sell360.background}; ends ${sell360.box.bottom.toFixed(1)} ` +
      `of ${sell360.holder.bottom.toFixed(1)}`);
  note("and the card's own words never say build",
    !/\bbuild/i.test(sell360.text), "wording scanned");
  await host.eval(`document.querySelector(".property-card__close")?.click(); true;`);
  await sleep(300);

  /* ------------------------------------------------------- back out again */

  heading("BACK OUT");

  await clickReal(host, "leave");
  await sleep(700);
  await clickReal(host, "start over");
  await sleep(800);
  const back = await host.json(`
    return [...document.querySelectorAll("button")].map((b) => b.textContent.trim());
  `);
  note(
    "Start over returns to the welcome screen",
    back.length === 2 && /create/i.test(back[0]) && /join/i.test(back[1]),
    back.join(" | "),
  );
} finally {
  await host?.close();
  await guest?.close();
  await chrome.close();
}

/* ---------------------------------------------------------------- summary */

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
for (const f of failed) {
  console.log(`  - ${f.section}: ${f.label}${f.detail ? ` :: ${f.detail}` : ""}`);
}
process.exit(failed.length ? 1 : 0);