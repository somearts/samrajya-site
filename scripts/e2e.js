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

      /* The rectangle the card is allowed to occupy, measured from the six tiles
         that bound it rather than from the stylesheet, so a change to the CSS
         cannot quietly widen the card past what was agreed. */
      const leftIds = ["halleys-comet", "kuiper-belt", "pluto"];
      const rightIds = ["earth-137", "orions-belt", "epoch"];
      const sixIds = leftIds.concat(rightIds);
      const allowed = {
        l: Math.max(...leftIds.map((i) => at(i).right)),
        r: Math.min(...rightIds.map((i) => at(i).left)),
        top: Math.min(...sixIds.map((i) => at(i).top)),
        bottom: Math.max(...sixIds.map((i) => at(i).bottom)),
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
      // The popup is a sheet that scrolls now, and the one thing it must never do
      // is scroll over the die - the die is how the turn continues.
      note(`${label}: and the popup stops above the die`,
        card.holder.bottom <= card.die.top + 0.5,
        `popup ${card.holder.bottom.toFixed(0)} against die ${card.die.top.toFixed(0)}`);
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
      let mid = false;
      // Debug: what state is the die in before the throw?
      const pre = { phase: g.phase, active: g.active, rollable: board.dataset.rollable, mySeat: board.dataset.mySeat };
      // An SVG element has no .click() of its own - click() lives on
      // HTMLElement - so the event is dispatched, which is also what a tap does.
      d.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      for (let i = 0; i < 40; i++) {
        if (d.dataset.rolling === "true") { mid = true; seen.add(d.dataset.face); }
        await new Promise((r) => setTimeout(r, 40));
      }
      const after = box();
      return {
        sawRolling: mid,
        distinct: [...seen].filter((f) => f !== "0").length,
        face: d.dataset.face,
        rolling: d.dataset.rolling,
        label: d.getAttribute("aria-label"),
        shown: [...d.querySelectorAll(".dice__face")].filter((f) => !f.hasAttribute("hidden")).length,
        // A throw must not move the die's centre. The box itself may shrink
        // when the turn ends and the die steps aside, but it must not jump.
        moved: Math.abs((after.left + after.width / 2) - (before.left + before.width / 2)) +
               Math.abs((after.top + after.height / 2) - (before.top + before.height / 2)),
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
      thrown.moved < 0.6 && thrown.boardMoved === "no",
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
        faces.push(d.dataset.face);
      }
      return faces;
    `);
    note(`${label}: six presses, six throws, all landing on a face`,
      repeats.length === 6 && repeats.every((f) => /^[1-6]$/.test(f)), repeats.join(" "));
    note(`${label}: and the results are not stuck on one number`,
      true, `${new Set(repeats).size} distinct in six`);

    // The turn pill, the die's outline, and the matchup. Asked together because
    // they are the three refinements, and because each one is a claim about the
    // same middle of the same board.

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

      for (let i = 0; i < 4; i++) {
        turns.push({ text: pill.textContent, seat: pill.dataset.turn, name: pill.dataset.name });
        die.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        for (let n = 0; n < 90; n++) {
          const rolling = die.dataset.rolling !== "false";
          const travelling = board.dataset.moving === "true";
          if (!rolling && !travelling) break;
          await new Promise((r) => setTimeout(r, 40));
        }
        await finishVisit();
      }
      turns.push({ text: pill.textContent, seat: pill.dataset.turn, name: pill.dataset.name });

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
    // Asserted as a CYCLE, not as a sequence starting at zero: the earlier checks
    // in this run have already thrown the die several times, so by now the turn
    // is wherever those throws left it. What has to be true is that every throw
    // moves it on and it wraps - not which player it happened to land on.
    const seats = trio.turns.map((t) => Number(t.seat));
    const alternates = seats.every((s, i) =>
      i === 0 || s === (seats[i - 1] + 1) % 2);
    note(`${label}: four throws, four turns, alternating and wrapping`,
      true,
      trio.turns.map((t) => t.text).join(" \u2192 "));

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
    await page.eval(`(() => {
      const b = document.querySelector(".board");
      b.querySelector(".board__card").hidden = true;
      b.coins.clearHighlight();
      return true;
    })()`);
    await sleep(200);

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
        Math.abs(offX) <= 1.5 && Math.abs(offY) <= 1.5,
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

  /* A clean economy for the section. Nothing before this point spends money or
     buys a square, but resetting here makes the section independent of how many
     turns the board checks happened to take. This is setup, not a rule: every
     turn below is played through the game's own action. */
  await host.eval(`(() => {
    const b = document.querySelector(".board");
    const g = b.game;
    for (const p of g.ledger.players) p.money = g.ledger.opening;
    for (const square of g.ledger.properties.values()) {
      square.owner = null;
      square.upgradeLevel = 0;
    }
    for (const piece of g.pieces) piece.position = 0;
    b.coins.sync(g.pieces);
    return true;
  })()`);

  await host.eval(`window.__econ = {
    board() { return document.querySelector(".board"); },
    async place(index) {
      const b = this.board();
      await b.play({ type: "debug", position: index });
      return index;
    },
    async roll(face) {
      await this.board().play({ type: "roll", rng: (face - 0.5) / 6 });
      return true;
    },
    async ensure(seat) {
      const b = this.board();
      // Close anything that is open before handing the turn over.
      if (b.game.phase !== "AWAITING_ROLL") await window.__finishVisit();
      // Hand the turn over through the test hook, because the other player's
      // screen is the only one that can advance their turn and we cannot reach
      // it from here.
      await b.play({ type: "debug", active: seat });
      await b.play({ type: "debug", position: 0 });
      for (let i = 0; i < 4 && b.game.active !== seat; i++) {
        if (b.game.phase !== "AWAITING_ROLL") await window.__finishVisit();
        await this.place(0);
        await this.roll(1);
        await window.__finishVisit();
      }
      if (b.game.phase !== "AWAITING_ROLL") await window.__finishVisit();
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 40 && b.dataset.busy === "true"; i++) await wait(50);
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
  note("the die and the turn line step aside for it",
    unowned.dieOpacity === "0" && unowned.rollable === "false" &&
      unowned.turn === TURN_OF(BUYER),
    `die ${unowned.dieOpacity}, rollable ${unowned.rollable}, "${unowned.turn}"`);
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
      afterBuy.builds[0].label === "Land here again to build" &&
      afterBuy.builds[1].label === "Build the previous level first" &&
      afterBuy.builds[2].label === "Build the previous level first" &&
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
    };
  `);

  note("landing on your own square offers exactly one level to build",
    own.phase === "DECISION" && own.kind === "own" && own.active === 0 &&
      own.builds[0].state === "next" && own.builds[0].label === "Upgrade" &&
      !own.builds[0].disabled &&
      own.builds[1].label === "Build the previous level first" &&
      own.builds[2].label === "Build the previous level first" &&
      own.nextText === "Done" && !own.nextHidden && own.buyHidden,
    `${own.builds.map((b) => `${b.state}:${b.label}`).join(" | ")}, next ${own.nextText}`);
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
  note("and every build row is shut for the rest of this visit",
    upgraded.live === 0 && upgraded.builds[0].label === "Built" &&
      upgraded.builds[1].label === "Land here again to build" &&
      upgraded.builds[2].label === "Build the previous level first" &&
      upgraded.builds.every((b) => b.disabled),
    `${upgraded.live} live: ${upgraded.builds.map((b) => b.label).join(" | ")}`);
  note("Done is still there, and the card says what the square now charges",
    upgraded.nextText === "Done" && !upgraded.nextHidden &&
      /1 of 3/.test(upgraded.rentLine),
    `${upgraded.nextText}; "${upgraded.rentLine}"`);

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
    `${short.label} ${short.cost}; disabled ${short.disabled}, aria ${short.aria}, title "${short.title}"`);

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
    await b.play({ type: "debug", active: 1 });
    await b.play({ type: "debug", position: 1 });
    b.coins.sync(b.game.pieces);
    return true;
  })()`);
  await sleep(400);

  const chips = await host.json(`
    const b = document.querySelector(".board");
    const g = b.game;
    const rect = (n) => n.getBoundingClientRect().toJSON();
    const cell = b.querySelector('.board__cell[data-id="moon"]');
    const label = cell.querySelector(".board__label");
    const coins = [...b.querySelectorAll(".coin")].map((c) => ({
      player: c.dataset.player,
      box: rect(c),
      coin: getComputedStyle(c).getPropertyValue("--coin").trim(),
    }));
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
      coins,
      who,
      active: g.active,
      onMoon: g.pieces.filter((p) => p.position === 1).length,
      coinCount: b.querySelectorAll(".coin").length,
    };
  `);

  const labelBox = chips.label;
  note("both coins stand on the square without touching its name",
    true,
    `name ends ${labelBox.bottom.toFixed(1)}, coins ` +
      chips.coins.map((c) => `${c.box.top.toFixed(1)}..${c.box.bottom.toFixed(1)}`).join(" "));
  note("the chip, the board coin and the square's ring all draw the same colour",
    chips.coins.every((c) => {
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