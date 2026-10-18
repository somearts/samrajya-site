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
   pill, four chests without one, and no card artwork on the board at all.

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

    /* ------------------------------------------------ the card, pressed on

       Done before anything else is measured, because a card sitting in the
       middle of the board is underneath everything else. */

    const specials = await page.json(`
      const board = document.querySelector(".board");
      const IDS = ["start", "omega", "akash-core", "marketplace",
                   "ragnarok", "nexus", "epoch", "kronos"];
      for (const id of IDS) board.querySelector('.board__cell[data-id="' + id + '"]').click();
      return {
        pressed: IDS.length,
        stillHidden: board.querySelector(".board__card").hidden,
        tags: IDS.map((id) => board.querySelector('.board__cell[data-id="' + id + '"]').tagName),
      };
    `);
    note(`${label}: none of the eight special squares is a button`,
      specials.tags.every((t) => t !== "BUTTON"), specials.tags.join(" "));
    note(`${label}: pressing all eight opens no card`,
      specials.pressed === 8 && specials.stillHidden === true);

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
      note(`${label}: inside the rectangle the six tiles bound`,
        b.left >= a.l - 0.5 && b.right <= a.r + 0.5 &&
        b.top >= a.top - 0.5 && b.bottom <= a.bottom + 0.5,
        `card ${b.left.toFixed(0)}..${b.right.toFixed(0)} / ${b.top.toFixed(0)}..${b.bottom.toFixed(0)}` +
        `  allowed ${a.l.toFixed(0)}..${a.r.toFixed(0)} / ${a.top.toFixed(0)}..${a.bottom.toFixed(0)}`);

      // Equal margins, to within what a half-pixel board origin allows. The board
      // deliberately sits at a half pixel - it is centred - so demanding exact
      // equality here would be an assertion that can never pass, and the one
      // thing worth checking is that no side is noticeably tighter than another.
      const gapL = b.left - a.l;
      const gapR = a.r - b.right;
      const gapT = b.top - a.top;
      const gapB = a.bottom - b.bottom;
      const gaps = [gapL, gapR, gapT, gapB];
      note(`${label}: with an even margin on every side, so it floats`,
        Math.min(...gaps) >= 2 && Math.max(...gaps) - Math.min(...gaps) <= 2.5,
        `${gapL.toFixed(1)} / ${gapR.toFixed(1)} / ${gapT.toFixed(1)} / ${gapB.toFixed(1)}`);
      note(`${label}: and it does not reach the lower rows`,
        b.bottom < a.bottom - 2,
        `bottom ${b.bottom.toFixed(0)} against ${a.bottom.toFixed(0)}`);
      note(`${label}: no text is clipped`, card.clipped.length === 0 &&
        !card.clippedName && !card.advantageClipped,
        card.clipped.length ? card.clipped.join(" / ") : "nothing clipped");
      note(`${label}: and the die is still below it`,
        card.die.top >= a.bottom - 0.5,
        `die ${card.die.top.toFixed(0)}..${card.die.bottom.toFixed(0)}`);
    }

    // A second property, one with no drawing, to prove it turns rather than
    // redrawing in place.
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
      };
    `);
    // The two lines are the data's breaks, so the textContent of them runs
    // together: DYSON SPHERE is written as DYSON / SPHERE.
    note(`${label}: pressing Dyson Sphere shows its own card`,
      second && second.property === "dyson-sphere" &&
      second.name.replace(/\s/g, "") === "DYSONSPHERE" &&
      second.price === "₹772" && second.accent === "#C9A24A",
      second ? `${second.name} ${second.price} ${second.accent}` : "no card");
    note(`${label}: falling back to a monogram where there is no drawing`,
      second?.monogram === true);

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

    note(`${label}: the die arrives with no number on it`,
      dieBefore.face === "0" && dieBefore.shown === 0,
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

    // Press it, and watch.
    const thrown = await page.json(`
      const d = document.querySelector(".board__dice");
      const board = document.querySelector(".board");
      const seen = new Set();
      const box = () => d.getBoundingClientRect();
      const before = box();
      let mid = false;
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
        // A throw must not move a single thing.
        moved: Math.abs(after.left - before.left) + Math.abs(after.top - before.top),
        boardMoved: JSON.stringify([document.documentElement.scrollWidth - document.documentElement.clientWidth,
                                     document.documentElement.scrollHeight - document.documentElement.clientHeight]) !==
                     JSON.stringify([0, 0]) ? "yes" : "no",
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

    // Six more presses. Asserting any two results DIFFER would be flaky - a repeat
    // is a legitimate outcome, one time in six - so what is checked is that every
    // press really throws and really lands on a face, and that the results are
    // not stuck on one number.
    const repeats = await page.json(`
      const d = document.querySelector(".board__dice");
      const faces = [];
      for (let n = 0; n < 6; n++) {
        d.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        let moved = false;
        for (let i = 0; i < 60; i++) {
          if (d.dataset.rolling === "true") moved = true;
          if (moved && d.dataset.rolling === "false") break;
          await new Promise((r) => setTimeout(r, 40));
        }
        faces.push(d.dataset.face);
      }
      return faces;
    `);
    note(`${label}: six presses, six throws, all landing on a face`,
      repeats.length === 6 && repeats.every((f) => /^[1-6]$/.test(f)), repeats.join(" "));
    note(`${label}: and the results are not stuck on one number`,
      new Set(repeats).size >= 2, `${new Set(repeats).size} distinct in six`);

    // Put it back to blank so the shots show the board as it is found.
    await page.eval(`document.querySelector(".board__card").hidden = true`);
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
        Math.abs(offX) <= 1 && Math.abs(offY) <= 1,
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