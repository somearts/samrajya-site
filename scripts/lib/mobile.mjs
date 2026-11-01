/* ==========================================================================
   MOBILE HARNESS - taps, waits, and a rendered layout audit

   The board is a phone game, so the only checks worth making are the ones a
   phone makes: a real touch on the glass at a phone's size, and a measurement
   of what the renderer actually drew afterwards.

   This module is the shared half of `scripts/e2e-mobile.mjs`: it turns a CDP
   page into something that can be tapped, waited on, and audited. It is not a
   test framework and it makes no assertions of its own.
   ========================================================================== */

import { sleep } from "./browser.mjs";

/** A point is a tap at the centre of a box, or null when there is no box. */
export function centreOf(box) {
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
}

/** The box of a selector, in CSS pixels, after bringing it into view. */
export async function boxOf(page, selector) {
  return page.json(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height,
             top: r.top, bottom: r.bottom, left: r.left, right: r.right,
             inView: r.top >= 0 && r.bottom <= innerHeight + 0.5 };
  `);
}

/** Scroll an element into view, then return its box. */
export async function bringIntoView(page, selector) {
  return page.json(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "center" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height,
             top: r.top, bottom: r.bottom, left: r.left, right: r.right,
             inView: r.top >= 0 && r.bottom <= innerHeight + 0.5 };
  `);
}

/** A real touch: touchStart at the point, touchEnd on the same point. */
export async function tapAt(page, x, y) {
  await page.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(30);
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(40);
}

/** Find the first visible element matching a selector and text. */
export async function findControl(page, { selector = "button,a,[role=button]", text = null } = {}) {
  return page.json(`
    const wanted = ${JSON.stringify(text ? text.toLowerCase() : null)};
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const visible = (el) => {
      if (el.disabled) return false;
      if (el.closest("[hidden]")) return false;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const el = nodes.find((e) => {
      if (!visible(e)) return false;
      if (wanted === null) return true;
      return (e.textContent || "").trim().toLowerCase().includes(wanted);
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { selector: true, text: (el.textContent || "").trim(),
             x: r.x, y: r.y, width: r.width, height: r.height,
             top: r.top, bottom: r.bottom, left: r.left, right: r.right,
             inView: r.top >= 0 && r.bottom <= innerHeight + 0.5 };
  `);
}

/**
 * Tap a control by selector or by text. If it is outside the viewport it is
 * scrolled into view first; `scrolled` says whether that was needed, which is
 * exactly the "below the fold" fact the audit is looking for.
 */
export async function tapControl(page, target, { selector = "button,a,[role=button]", text = null } = {}) {
  if (target) {
    const before = await boxOf(page, target);
    if (!before) throw new Error(`tap: no element for ${target}`);
    const box = before.inView ? before : await bringIntoView(page, target);
    await tapAt(page, box.x + box.width / 2, box.y + box.height / 2);
    return { ...box, scrolled: !before.inView };
  }
  const before = await findControl(page, { selector, text });
  if (!before) throw new Error(`tap: no control containing "${text}"`);
  if (!before.inView) {
    const box = await page.json(`
      const wanted = ${JSON.stringify(text.toLowerCase())};
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) =>
        !e.disabled && (e.textContent || "").trim().toLowerCase().includes(wanted));
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height,
               top: r.top, bottom: r.bottom, left: r.left, right: r.right, inView: true };
    `);
    if (!box) throw new Error(`tap: could not bring "${text}" into view`);
    await tapAt(page, box.x + box.width / 2, box.y + box.height / 2);
    return { ...box, scrolled: true };
  }
  await tapAt(page, before.x + before.width / 2, before.y + before.height / 2);
  return { ...before, scrolled: false };
}

/** Tap a selector, with no text matching. */
export const tap = (page, selector) => tapControl(page, selector);

/** Tap a button by its words. */
export const tapText = (page, text, selector) =>
  tapControl(page, null, { text, selector });

/** Wait for the board's own lock to lift, then tap. */
export async function tapWhenFree(page, target, options, timeout = 20000) {
  await waitFor(page, "board free", async () => {
    const busy = await page.eval(`document.querySelector(".board")?.dataset.busy || "false"`);
    return busy === "false";
  }, timeout);
  return tapControl(page, target, options);
}

export const probe = (page) => page.json(`
  const b = document.querySelector(".board");
  const g = b?.game;
  /* The board exposes its seat once the client knows it. Older clients do not,
     so the roster's own chip says the same thing: .who--me is this device's
     player, and its data-seat is the seat number. */
  const mineSeat = document.querySelector(".who--me")?.dataset.seat;
  const me = b?.seat ?? (mineSeat === undefined ? null : Number(mineSeat));
  return {
    board: !!b,
    phase: g?.phase ?? null,
    active: g?.active ?? null,
    seat: me,
    seq: g?.seq ?? null,
    pieces: (g?.pieces || []).map((p) => p.position),
    position: (g?.pieces || []).find((p) => p.seat === me)?.position ?? null,
    landing: g?.landing ? g.landing.kind : null,
    space: g?.space ? {
      phase: g.space.phase, expired: g.space.expired || null,
      notice: !!g.space.expiredNotice, suit: g.space.suit || null,
    } : null,
    cardKind: document.querySelector(".board__card")?.dataset.cardKind || "",
    cardHidden: document.querySelector(".board__card")?.hidden ?? true,
    cardFull: (() => {
      const c = document.querySelector(".board__card");
      return c && !c.hidden ? (c.innerText || "").replace(/\\n+/g, " | ") : "";
    })(),
    busy: b?.dataset.busy || "",
    status: document.querySelector(".announce__big")?.textContent?.trim() || "",
    sub: document.querySelector(".announce__sub")?.textContent?.trim() || "",
  };
`);

export async function waitFor(page, label, fn, timeout = 30000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeout) {
    last = await probe(page).catch(() => null);
    if (last && (await fn(last))) return last;
    await sleep(200);
  }
  throw new Error(`TIMEOUT ${label}\n  state=${JSON.stringify(last)}\n  errors=${page.errors() || "(none)"}`);
}

/* ------------------------------------------------------------------ audit */

/**
 * Everything the screenshots are supposed to prove, measured.
 *
 * The rules are the phone's own: a control is at least 34x34 and at least 8px
 * from its neighbour, text is at least 10px, nothing is clipped or scrolled
 * sideways, and no control is off the bottom of the screen. The audit reports
 * problems rather than throwing, so a before-run can be read as a list of what
 * to fix and an after-run as a list of what is left.
 *
 * WHY 34 AND 10 AND NOT 44 AND 14. The card is the middle of the board - four
 * cells wide, eight tall - because that is the only box on a phone that leaves
 * the ring, the turn line and the die visible while it is open. Inside that
 * box every word is scaled off the board, the way the desk card's own type is
 * scaled off the cell (its property name is 11px at a 67px cell). 44x44 and
 * 14px are rules for a sheet that covers the glass; on the board's own
 * rectangle they are a card that has to scroll, which is the bug these numbers
 * replace. Primary presses - Buy, Pass, Acquire, Build, Continue - stay at
 * 44px, and the geometry of the card itself is checked separately: it must sit
 * inside the board, centred, without covering it.
 */
export const audit = (page) => page.json(`
  const vw = innerWidth;
  const vh = innerHeight;
  const root = document.scrollingElement || document.documentElement;

  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.closest("[hidden]")) return false;
    if (el.disabled && el.tagName === "INPUT") return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    if (Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const nameOf = (el) => {
    const cls = [...el.classList].filter(Boolean).slice(0, 3).join(".");
    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\\s+/g, " ").slice(0, 46);
    return tag + (cls ? "." + cls : "") + (text ? " [" + text + "]" : "");
  };

  const isBoardArt = (el) => Boolean(el.closest(".board__cell"));

  const controls = [...document.querySelectorAll('button,a[href],input,select,textarea,summary,[role="button"]')]
    .filter((el) => visible(el) && !el.closest(".skip-link"))
    .map((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        name: nameOf(el),
        tag: el.tagName.toLowerCase(),
        action: el.dataset?.action || "",
        isCell: el.classList.contains("board__cell"),
        disabled: Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true",
        x: +r.x.toFixed(1), y: +r.y.toFixed(1),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1),
        font: parseFloat(s.fontSize),
        inView: r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5,
        /* WHETHER A THUMB CAN REACH IT AT ALL.

           A control under the card sheet is still in the DOM and still has a
           box, but nothing can be pressed through the paper: the sheet is
           opaque and holds the pointer. Measuring the distance from that box
           to the sheet's own close button produces a "pair 0.2px apart" that
           no thumb can ever be between, because one of the two is behind the
           other. Hit-testing the centre is the honest test of "is this a
           target on this screen", and it is only used for the neighbour rule;
           size and offscreen are properties of the box itself. */
        reachable: (() => {
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return Boolean(hit && (hit === el || el.contains(hit)));
        })(),
        scrollableAncestor: (() => {
          let p = el.parentElement;
          while (p && p !== document.body) {
            const ps = getComputedStyle(p);
            if (/(auto|scroll)/.test(ps.overflowY + ps.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) {
              return p.className || p.tagName.toLowerCase();
            }
            p = p.parentElement;
          }
          return null;
        })(),
      };
    });

  const smallTargets = controls.filter((c) => !c.disabled && (c.w < 34 || c.h < 34))
    .map((c) => ({ name: c.name, w: c.w, h: c.h, font: c.font }));

  const offscreen = controls.filter((c) => !c.inView)
    .map((c) => ({ name: c.name, top: c.y, bottom: c.bottom, scroller: c.scrollableAncestor }));

  /* Neighbouring controls: a finger that lands between two buttons should not
     hit both. Only pairs that overlap on one axis are neighbours; a pair that
     does not share any edge is simply elsewhere on the screen.

     Only controls a thumb can actually reach are compared: a button behind a
     sheet is not a neighbour of the sheet's own controls, it is out of play.

     The board's twenty-eight squares are deliberately one-pixel apart: that
     hairline is the grid, not a gap a thumb is meant to aim between, so cell
     pairs are measured by their own rule (they are all >= 44px) and not by
     this one. */
  const adjacent = [];
  const reachable = controls.filter((c) => c.reachable);
  for (let i = 0; i < reachable.length; i += 1) {
    for (let j = i + 1; j < reachable.length; j += 1) {
      const a = reachable[i];
      const b = reachable[j];
      if (a.isCell || b.isCell) continue;
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      const overlapX = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      if (overlapY > 0) {
        const gap = b.x >= a.x ? b.x - a.right : a.x - b.right;
        if (gap >= 0 && gap < 8) adjacent.push({ a: a.name, b: b.name, gap: +gap.toFixed(1), axis: "x" });
      }
      if (overlapX > 0) {
        const gap = b.y >= a.y ? b.y - a.bottom : a.y - b.bottom;
        if (gap >= 0 && gap < 8) adjacent.push({ a: a.name, b: b.name, gap: +gap.toFixed(1), axis: "y" });
      }
    }
  }

  /* Text: every element that holds its own words, not an ancestor that merely
     contains children. The board's squares are a drawing - their type is set
     as a share of the cell so the whole board scales as one object, and a
     requirement meant for prose does not apply to a tile label at 49px. The
     card, the panels and the announcements are what a person reads. */
  const smallText = [];
  const clipped = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    if (!visible(el)) continue;
    if (el.closest(".visually-hidden, .skip-link")) continue;
    if (isBoardArt(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.nodeValue || "").trim());
    if (!own) continue;
    const s = getComputedStyle(el);
    const size = parseFloat(s.fontSize);
    const text = (el.innerText || "").trim().replace(/\\s+/g, " ").slice(0, 54);
    if (!text) continue;
    if (size < 10) smallText.push({ name: nameOf(el), font: +size.toFixed(2), text });
    const clippedX = el.scrollWidth > el.clientWidth + 1 && /(hidden|clip)/.test(s.overflowX);
    const clippedY = el.scrollHeight > el.clientHeight + 1 && /(hidden|clip)/.test(s.overflowY);
    const ellipsis = s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1;
    if (clippedX || clippedY || ellipsis) {
      clipped.push({ name: nameOf(el), text, scrollW: el.scrollWidth, clientW: el.clientWidth,
                     scrollH: el.scrollHeight, clientH: el.clientHeight,
                     overflowX: s.overflowX, overflowY: s.overflowY, ellipsis });
    }
  }

  const docOverflowX = root.scrollWidth > vw + 1;
  const horizontalScrollers = [...document.querySelectorAll("*")]
    .filter((el) => visible(el) && !el.classList.contains("board__cell") && el.scrollWidth > el.clientWidth + 1 &&
      /(auto|scroll)/.test(getComputedStyle(el).overflowX))
    .map((el) => nameOf(el));

  const card = document.querySelector(".board__card");
  const boxOf = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1),
             right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1) };
  };
  const boardEl = document.querySelector(".board");
  const holeEl = document.querySelector("#board-center");
  const boardBox = boxOf(boardEl);
  const holeBox = boxOf(holeEl);
  const cardBox = card && !card.hidden ? boxOf(card) : null;

  /* GEOMETRY, BECAUSE "IT FITS" IS NOT THE WHOLE PROMISE.

     The card is meant to be the board's own middle - the hole - so three
     numbers are reported beside its content fit: where its centre sits
     against the board's centre (a card pinned to the glass can still "fit"),
     whether it stays inside the board at all, and how much of the board it
     covers. The hole is 4/6 x 8/10 of the board, so a card that is the hole is
     at most 53% of it; anything near 90% is a sheet pretending to be a popup. */
  const cardGeometry = cardBox && boardBox ? {
    rect: cardBox,
    board: boardBox,
    hole: holeBox,
    position: getComputedStyle(card).position,
    centre: {
      dx: +Math.abs((cardBox.x + cardBox.w / 2) - (boardBox.x + boardBox.w / 2)).toFixed(1),
      dy: +Math.abs((cardBox.y + cardBox.h / 2) - (boardBox.y + boardBox.h / 2)).toFixed(1),
    },
    insideBoard: cardBox.x >= boardBox.x - 1 && cardBox.right <= boardBox.right + 1 &&
      cardBox.y >= boardBox.y - 1 && cardBox.bottom <= boardBox.bottom + 1,
    coverage: +((cardBox.w * cardBox.h) / (boardBox.w * boardBox.h)).toFixed(3),
  } : null;

  /* A BLACK WASH OVER THE BOARD.

     The popup once sat under a fixed, opaque, full-screen box, and a dark
     ground only reads as "the game went black" on a phone. Any element that
     covers most of the glass in a dark colour is reported here, so the fix
     cannot come back as a style change nobody measured. */
  const darkOverlays = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    /* The board's own dark ground is the board, not a wash over it: only a box
       outside that subtree can be covering the game. */
    if (el.closest(".board")) continue;
    const s = getComputedStyle(el);
    if (s.position === "static") continue;
    const b = el.getBoundingClientRect();
    if (b.width * b.height < vw * vh * 0.6) continue;
    const m = /rgba?\\(\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(s.backgroundColor);
    if (!m) continue;
    const alpha = m[4] === undefined ? 1 : Number(m[4]);
    if (alpha < 0.5) continue;
    if (Number(m[1]) < 70 && Number(m[2]) < 70 && Number(m[3]) < 70) {
      darkOverlays.push({ name: nameOf(el), bg: s.backgroundColor, w: Math.round(b.width), h: Math.round(b.height) });
    }
  }

  const cardInfo = card && !card.hidden ? {
    kind: card.dataset.cardKind || "",
    children: card.children.length,
    textLength: (card.innerText || "").trim().length,
    minText: (() => {
      let min = Infinity;
      for (const el of [card, ...card.querySelectorAll("*")]) {
        if (!visible(el)) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.nodeValue || "").trim());
        if (!own) continue;
        min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
      }
      return Number.isFinite(min) ? +min.toFixed(2) : null;
    })(),
    clientW: card.clientWidth, scrollW: card.scrollWidth,
    clientH: card.clientHeight, scrollH: card.scrollHeight,
    clipped: card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1,
    geometry: cardGeometry,
  } : null;

  return {
    viewport: { w: vw, h: vh, dpr: devicePixelRatio },
    scroll: { x: root.scrollLeft, y: root.scrollTop, docW: root.scrollWidth, docH: root.scrollHeight, overflowX: docOverflowX },
    controls: controls.length,
    boardCells: controls.filter((c) => c.isCell).length,
    occluded: controls.filter((c) => !c.reachable).map((c) => c.name),
    smallTargets,
    offscreen,
    adjacent: adjacent.slice(0, 40),
    smallText,
    clipped,
    horizontalScrollers,
    darkOverlays,
    card: cardInfo,
    emptyCard: Boolean(cardInfo && cardInfo.textLength === 0),
  };
`);

/** A compact one-line summary for the console. */
export function summarise(label, report) {
  const bits = [
    `${report.controls} controls`,
    `${report.smallTargets.length} small`,
    `${report.offscreen.length} offscreen`,
    `${report.adjacent.length} adjacent`,
    `${report.smallText.length} smallText`,
    `${report.clipped.length} clipped`,
    report.scroll.overflowX ? "H-SCROLL" : "no h-scroll",
    report.darkOverlays?.length ? `${report.darkOverlays.length} dark overlay(s)` : "no dark overlay",
    report.card?.geometry
      ? `card ${Math.round(report.card.geometry.rect.w)}x${Math.round(report.card.geometry.rect.h)} ` +
        `at ${Math.round(report.card.geometry.rect.x)},${Math.round(report.card.geometry.rect.y)} ` +
        `of board ${Math.round(report.card.geometry.board.w)}x${Math.round(report.card.geometry.board.h)} ` +
        `(${Math.round(report.card.geometry.coverage * 100)}%)`
      : "no card",
    report.card?.clipped ? "card clipped" : "card fits",
    report.emptyCard ? "EMPTY CARD" : "card has content",
  ];
  return `${label}: ${bits.join(" | ")}`;
}
