/* ==========================================================================
   SAMRAJYA - THE PROPERTY CARD

   What a property says about itself, and - when you have landed on it - what it
   lets you do.

   TWO WAYS TO SEE A CARD
   ----------------------
   Reading and deciding are different acts and they get different cards:

     read       opened by tapping a square. It explains the square, closes with
                a small x or a tap outside, and offers nothing that changes the
                turn. The die steps aside while it is up.
     decision   opened by the game when a throw stops on a square that needs an
                answer. There is no x, because leaving without answering is not
                a thing a turn allows. The die and the turn line are gone and the
                card owns the middle of the board.

   The same card is drawn either way, because it is the same property. What
   changes is the row of actions: Buy and Pass, or Done, or Continue, or nothing
   at all. `syncCard` is the one place that decides, and it asks shared/game.js
   rather than remembering a rule of its own.

   WHY IT IS NOT REDRAWN ON EVERY CHANGE
   -------------------------------------
   A card that was rebuilt after every purchase would swing on its hinge each
   time - and a player who has bought three times would have watched it three
   times for no reason. So it is drawn once and `syncCard` rewrites its figures
   in place. The one thing a card must not do while you are using it is move.

   Every figure on it is derived at the moment it is written. There is no stored
   price on the card and no remembered rent: the rent line is `rentAt` called
   again, so it cannot be stale by even one purchase.
   ========================================================================== */

import { el } from "./dom.js";
import { settled } from "./motion.js";
import { resetHolder } from "./board-fx.js";
import { cardArt } from "./cards.js";
import { propertyArt } from "./property-art.js";
import { propertyFor } from "./shared/properties.js";
import { upgradesOf, rupees } from "./shared/economy.js";
import { civById, coinColor } from "./shared/civilizations.js";
import { discountPrice, suitById } from "./shared/suits.js";
import {
  MAX_UPGRADE,
  canBuy,
  evenUpgradeBlocked,
  fullSetRent,
  hasMonopoly,
  levelOf,
  moneyOf,
  nameOfSeat,
  ownerOf,
  rentAt,
  saleValue,
  setHolder,
  setMembers,
} from "./shared/ledger.js";
import { upgradeOffer } from "./shared/game.js";

/** How long a turn takes. Short enough not to wait for, long enough to see. */
const TURN_MS = 320;

/** Reduce the work for a reader who has asked for less motion. */
function still() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The artwork for a property, or nothing.
 *
 * Two sources, in this order, and the order is the point:
 *
 *   1. `property-art.js` - the drawing written for the board. The ten that were
 *      made for the board's own use come from here.
 *   2. `cardArt` - the ten finished cards' own artwork, borrowed without its
 *      pill or its title, because the card has its own of each.
 *
 * The first source is asked first because it is the one meant for this
 * rectangle. The second is a borrowing, and a borrowing should never win over
 * the thing it borrows for.
 *
 * Only if neither has a drawing does the card fall back to a letter.
 */
function artwork(property) {
  const drawn = propertyArt(property.id);
  if (drawn) return el("div", { class: "property-card__art", html: drawn });

  if (property.art) {
    // The data's paths are "cards/horizontal/moon.svg"; the card module is keyed
    // by the card's own name, which is the same word without the set's path.
    const key = property.art.replace(/^cards\/(?:horizontal|vertical)\//, "").replace(/\.svg$/, "");
    const borrowed = cardArt(key);
    if (borrowed) return el("div", { class: "property-card__art", html: borrowed });
  }

  return null;
}

/** The mark shown where a property has no drawing. */
function monogram(property) {
  return el("div", {
    class: "property-card__art property-card__art--none",
    "aria-hidden": "true",
    text: (property.lines[0] || property.name).slice(0, 1),
  });
}

/** One card, for one property. */
export function propertyCard(property, ctx) {
  const isSet = Boolean(property.set);

  return el("article", {
    class: "property-card",
    "data-property": property.id,
    "data-set": property.set || "",
    // The accent is the property's own pill colour, so a card and the tile it
    // came from are unmistakably the same thing.
    style: { "--accent": property.color || "var(--ink)" },
    "aria-live": "polite",
  }, [
    // Reading only. A decision has no way out except answering it, and a close
    // button on a card that cannot be closed is a lie.
    el("button", {
      type: "button",
      class: "property-card__close",
      "aria-label": "Close",
      title: "Close",
      text: "×",
      onclick: () => ctx?.onClose?.(),
    }),

    el("div", { class: "property-card__head" }, [
      artwork(property) || monogram(property),
      el("div", { class: "property-card__title" }, [
        // The pill and the name, drawn exactly as the tile draws them: the same
        // colour, the same capitals, the same breaks.
        el("span", { class: "property-card__pill", "aria-hidden": "true" }),
        el("h3", {
          class: "property-card__name",
          html: property.lines
            .map((line) => `<span>${line}</span>`)
            .join(""),
        }),
      ]),
      el("p", { class: "property-card__price" }, [
        el("span", { class: "property-card__price-rupee", "aria-hidden": "true", text: "₹" }),
        el("span", { class: "property-card__price-figure", text: rupees(property.price).slice(1) }),
        /* The list price, shown struck through beside the discounted figure
           while an unspent suit stands behind the decision. Hidden by
           default; `syncCard` owns both figures. */
        el("span", { class: "property-card__price-was", hidden: true }),
      ]),
    ]),

    /* WHO HOLDS IT, AND WHAT IT COSTS RIGHT NOW.

       Both are written by `syncCard` and both are derived at the moment they
       are written. The status line says who; the rent line says what somebody
       landing here would be charged, which is a different number once anybody
       has built anything on it. */
    el("div", { class: "property-card__standing" }, [
      el("p", { class: "property-card__status" }),
      el("p", { class: "property-card__rent" }),
      // The full-set rent, when it applies: the extra line that says why the
      // number on the line above is what it is.
      el("p", { class: "property-card__fullset", hidden: true }),
    ]),

    el("p", {
      class: "property-card__description",
      html: property.description.map((line) => `<span>${line}</span>`).join(""),
    }),

    el("div", { class: "property-card__advantage" }, [
      el("span", { class: "property-card__label", text: "Advantage" }),
      el("p", { class: "property-card__advantage-text", text: property.advantage }),
    ]),

    // The Buy button. Shown only on a decision about an unowned square, and
    // taken away for every other card.
    el("div", { class: "property-card__buy-slot" }, [
      el("button", {
        type: "button",
        class: "property-card__buy",
      }, [
        el("span", { class: "property-card__buy-label" }),
        el("span", { class: "property-card__buy-cost" }),
      ]),
    ]),

    // Pass, Done, Continue. One pill, one label, and the decision says which
    // word it wears. It is directly under Buy when there is a Buy, because the
    // two answers belong together.
    el("button", {
      type: "button",
      class: "property-card__next",
      hidden: true,
    }, [el("span", { class: "property-card__next-label" })]),

    isSet ? null : el("span", { class: "property-card__noset", hidden: true }),
  ]);
}

/* -------------------------------------------------------- the introduction */

/**
 * One empire, as the introduction shows it: its coin, its name, its title.
 *
 * The coin is the board's own coin - the same disc, the same colour, the same
 * inner ring - because what a player picks here is what they will be looking
 * for on every square after it.
 */
function empire(player) {
  const civ = civById(player?.civ);
  const colour = coinColor(player?.civ) || "var(--ink)";

  return el("div", { class: "intro__empire" }, [
    el("span", {
      class: "coin intro__coin",
      "aria-hidden": "true",
      style: { "--coin": colour },
    }),
    el("div", { class: "intro__who" }, [
      el("span", { class: "intro__civ", text: civ?.name || "" }),
      civ?.title ? el("span", { class: "intro__title", text: civ.title }) : null,
    ]),
  ]);
}

/**
 * THE INTRODUCTION, IN THE PROPERTY POP-UP'S OWN CARD.
 *
 * A new game opens with one card before the turn is anybody's: the two
 * civilizations facing each other, and what the contest is. It is drawn into
 * the same holder, the same rectangle and the same card the board opens for a
 * tapped square - the same ground, the same border, the same shadow, the same
 * type, the same turn-in on the way up - because that is the pop-up this game
 * already has, and an introduction has no business inventing a second one.
 *
 * THE ONE DIFFERENCE IS THE X. A property card can be tapped away; this one
 * cannot, and nothing else dismisses it either: no tap outside, no Escape.
 * The only way past is the button, and the button belongs to the player who
 * takes the first throw - everybody else is shown the same card to read and
 * nothing on it to press. Because it is a card in the middle, the turn line
 * and the die stand down while it is up, exactly as they do for every other
 * card.
 */
export function introCard({ players = [], canBegin = false, onBegin = null } = {}) {
  const [first, second] = players;

  return el(
    "article",
    {
      class: "property-card intro-card",
      "data-property": "intro",
      style: { "--accent": "var(--ink)" },
      "aria-live": "polite",
    },
    [
      el("h3", { class: "property-card__name intro__heading", text: "LET THE CONQUEST BEGIN" }),

      /* The two empires, one above the other with the contest between them:
         the same VS the table says before a game, so the opposition reads as
         a fixture rather than a list. */
      el("div", { class: "intro__body" }, [
        first ? empire(first) : null,
        el("span", { class: "intro__vs", text: "VS" }),
        second ? empire(second) : null,
        el("div", { class: "property-card__description intro__copy" }, [
          el("span", {
            text: "Two civilizations. One cosmic battlefield. Your empire begins now.",
          }),
          el("span", {
            text:
              "Acquire properties, build your empire, and gather weapons to challenge your " +
              "opponent. Enter the Fight arena, unleash your arsenal, and let your " +
              "civilization's power shape the battle.",
          }),
          el("span", { text: "Only one empire will claim Samrajya." }),
        ]),
      ]),

      /* THE BUTTON IS THE FIRST THROW'S ALONE. The opponent is shown this
         very same card with nothing on it to press: they can read the
         contest, and only the player who starts the game can begin it. */
      canBegin
        ? el("button", {
            type: "button",
            class: "property-card__buy intro__begin",
            "data-action": "begin",
            text: "LET'S BEGIN",
            onclick: () => {
              if (typeof onBegin === "function") onBegin();
            },
          })
        : null,
    ],
  );
}

/**
 * Put the introduction in the middle, the way `showCard` puts a property
 * there: the holder is put right first, the card is drawn at once, and the
 * same turn-in plays over it. It is drawn from the game's own ledger, so both
 * devices show the same two civilizations without either of them being told.
 *
 * `canBegin` says whether this screen holds the one button; it comes from the
 * state (`intro.seat`), never from anything this screen decides for itself.
 */
export function showIntroCard(board, players, { canBegin = false, onBegin = null } = {}) {
  const holder = board.querySelector(".board__card");
  if (!holder) return Promise.resolve(null);

  resetHolder(holder);
  board.dataset.property = "";
  holder.dataset.cardKind = "property";
  holder.dataset.intro = "true";
  holder.replaceChildren(introCard({ players, canBegin, onBegin }));
  holder.hidden = false;
  holder.scrollTop = 0;

  if (still()) return Promise.resolve(holder.firstElementChild);

  /* The card arrives on the hinge every other card in the middle arrives on:
     drawn first, turned over the top of it, so it is readable from the frame
     it appears on rather than half a second later. */
  return settled(
    holder
      .animate(
        [
          { transform: "rotateY(-88deg)", opacity: 0 },
          { transform: "rotateY(0deg)", opacity: 1 },
        ],
        { duration: TURN_MS, easing: "cubic-bezier(.22,.7,.3,1)", fill: "both" },
      )
      .finished,
    TURN_MS + 150,
  ).then(() => holder.firstElementChild);
}

/* ------------------------------------------------------------- the three builds */

/**
 * The three things a square can become, below the card.
 *
 * Drawn in the chest's own vocabulary - the same inset ground, the same 6px
 * radius, the same hairline, the same type sizes - because they are the same
 * idea as the three weapon cards on a Ragnarok chest: three portrait panels
 * telling you what is on the table and what each one costs.
 *
 * What is deliberately not copied is their arrangement. Those are three columns
 * of a wide card; these are three rows beneath a card that already fills the
 * middle of the board, so they run across the width instead. Same look, same
 * voice, the shape the space actually allows.
 */
function buildCard(property) {
  const steps = upgradesOf(property.id);

  return el("section", { class: "builds", "aria-label": `What ${property.name} can be built into` }, [
    el("p", { class: "builds__label", text: "UPGRADES" }),
    el("p", { class: "builds__lock" }),
    el("p", { class: "builds__status" }),
    ...steps.map((step, n) =>
      el("article", { class: "build", "data-build": String(n + 1) }, [
        el("div", { class: "build__head" }, [
          // The pips first, so a card that is already built says which of the
          // three it is before the name does.
          el("span", { class: "build__step", "aria-hidden": "true" }, [
            el("span", { class: "build__pip" }),
            el("span", { class: "build__pip" }),
            el("span", { class: "build__pip" }),
          ]),
          el("h4", { class: "build__name", text: step.name }),
          el("p", { class: "build__cost" }, [
            el("span", { class: "build__cost-rupee", "aria-hidden": "true", text: "₹" }),
            el("span", { class: "build__cost-figure" }),
          ]),
        ]),

        el("p", { class: "build__description", text: step.description }),

        el("div", { class: "build__foot" }, [
          el("p", { class: "build__becomes" }),
          el("button", {
            type: "button",
            class: "build__button",
          }, [el("span", { class: "build__button-label" })]),
        ]),
      ]),
    ),
  ]);
}

/* ---------------------------------------------------------------------- selling */

/**
 * Sell a square back to the bank from the read-only card.
 *
 * Two presses, because it is irreversible and it is quiet: the first arms the
 * pill and says what it will pay, the second does it. The arming expires, so a
 * pill left alone is not a trap for the next tap.
 */
let sellTimer = null;

function sellPill(ctx) {
  return el("button", {
    type: "button",
    class: "property-card__sell",
    hidden: true,
  }, [el("span", { class: "property-card__sell-label" })]);
}

/* ---------------------------------------------------------------------- sync */

/**
 * Put every derived figure on the open card back in step with the game.
 *
 * Called after anything changes the game, and safe to call when no card is
 * open - which is most of the time. It writes only text, the `disabled`
 * attribute and the actions' own labels; it never adds or removes a node except
 * the Buy and Sell slots, which are the two things that appear and disappear.
 */
export function syncCard(board, ctx) {
  const holder = board?.querySelector(".board__card");
  const id = holder?.dataset.property;
  const card = holder?.querySelector(".property-card");
  if (!card || !id || holder.dataset.cardKind !== "property") return;

  const { ledger, seat, game, mode = "read" } = ctx || {};
  if (!ledger) return;

  /* --- who holds it, and what it charges --- */

  const owner = ownerOf(ledger, id);
  const level = levelOf(ledger, id);
  const rent = rentAt(ledger, id);

  /* THE DECISION THIS CARD IS ANSWERING, if it is answering one. Read here
     rather than further down because two of the figures below depend on it. */
  const decision = game?.landing?.id === id ? game.landing : null;

  /* ANCIENT GREEK TAKES JUPITER WITHOUT TRIBUTE.

     While the first throw's promise is standing, the price this square would
     have cost is struck out and FREE takes its place - the same figure the
     ledger will not take when the buy goes through. It is read from the state
     rather than remembered here, so both screens say the same thing and the
     card can never offer a price the server is about to charge. */
  const giftFree =
    Boolean(decision) &&
    owner === null &&
    id === "jupiter" &&
    game?.civGift?.[decision.seat] === "free-jupiter";

  /* THE ACTIVE SEAT'S UNSPENT SUIT - the discount this card must show
     BEFORE the purchase is confirmed, so the figure on the card and the
     figure the ledger takes are the same number. The purchase price only:
     rent and everything else stay exactly as they are. */
  const suit = ctx?.suit && !ctx.suit.used ? ctx.suit : null;
  const suitName = suit ? suitById(suit.id)?.name || "" : "";
  const listPrice = propertyFor(id).price;
  const price = giftFree ? 0 : suit ? discountPrice(listPrice, suit.discount || 0) : listPrice;

  const status = card.querySelector(".property-card__status");
  status.textContent =
    owner === null
      ? giftFree
        ? "Free"
        : `Cost ${rupees(price)}${suit ? ` · ${suit.discount}% off` : ""}`
      : owner === seat
        ? "You own this"
        : `Owned by ${nameOfSeat(ledger, owner)}`;

  // The header figure follows the same arithmetic, with the list price
  // struck through beside it while a suit stands behind the decision - or
  // while the throne asks no tribute, when FREE is the figure.
  const headFigure = card.querySelector(".property-card__price-figure");
  const headWas = card.querySelector(".property-card__price-was");
  const headRupee = card.querySelector(".property-card__price-rupee");
  if (headFigure) headFigure.textContent = giftFree ? "FREE" : rupees(price).slice(1);
  if (headRupee) headRupee.hidden = giftFree;
  if (headWas) {
    const showWas = giftFree ? owner === null : Boolean(suit) && owner === null && price !== listPrice;
    headWas.hidden = !showWas;
    headWas.textContent = showWas ? rupees(listPrice) : "";
  }

  // One clean figure: the rent this square charges right now. No sentences, no
  // repetition of who holds it - that is the status line's job.
  card.querySelector(".property-card__rent").textContent = `Rent ${rupees(rent)}`;

  // The full-set rent, when it applies: a quiet second line saying the doubled
  // amount. The main rent already shows what is charged; this says why.
  const fullSet = card.querySelector(".property-card__fullset");
  if (fullSet) {
    const doubled = fullSetRent(ledger, id);
    if (doubled === null) {
      fullSet.textContent = "";
      fullSet.hidden = true;
    } else {
      fullSet.textContent = `Full set ${rupees(doubled)}`;
      fullSet.hidden = false;
    }
  }

  const kind = decision?.kind || "";
  const deciding = mode === "decision" && Boolean(decision);
  // Once the decision has been answered the card stays up just long enough to
  // slide away, and for those two hundred milliseconds it must not offer the
  // answer again. The phase has already left DECISION by then.
  const answered = deciding && game?.phase !== "DECISION";

  // A rent that could not be met in full is still a visit that must be answered,
  // and the card says so in the same line as the rent: the payer paid everything
  // they held, and the rest is a short. Nothing else happened.
  if (deciding && kind === "rent" && game?.visit?.short > 0) {
    status.textContent += ` • Short ${rupees(game.visit.short)}`;
  }

  /* --- the close button --- */

  const close = card.querySelector(".property-card__close");
  close.hidden = deciding;
  close.style.display = deciding ? "none" : "";

  /* --- the Buy button --- */

  const slot = card.querySelector(".property-card__buy-slot");
  const buying = deciding && !answered && kind === "buy" && owner === null;
  if (!buying) {
    // Taken, or not for sale on this visit. There is nothing to buy, so the
    // button goes away rather than sitting there greyed out explaining a
    // purchase that cannot happen.
    slot.hidden = true;
    slot.style.display = "none";
  } else {
    const verdict = canBuy(ledger, id, seat, {
      discount: giftFree ? 100 : suit ? suit.discount || 0 : 0,
    });
    const money = moneyOf(ledger, seat);
    const affordable = money >= price;
    slot.hidden = false;
    slot.style.removeProperty("display");

    const button = slot.querySelector(".property-card__buy");
    // Not `disabled`: an unaffordable Buy is still a thing to press, because
    // pressing it is how the game says why - the refusal shakes the pill and
    // writes the sentence. A disabled button would swallow the press and leave
    // the player with a grey rectangle and no explanation. `aria-disabled`
    // still tells a screen reader the purchase cannot go through.
    button.disabled = false;
    button.setAttribute("aria-disabled", String(!verdict.ok));
    slot.querySelector(".property-card__buy-label").textContent =
      affordable ? "Buy" : "Not enough";
    // The shortfall on the button, in the four words that fit on one line of it:
    // the ledger's own sentence ("You need 1190 more to take it") is a useful
    // thing to be able to read, and far too long to be the thing sitting inside a
    // pill two hundred pixels wide, where it wrapped into four ragged lines. It
    // stays, as the button's title, so the reason is still there to be found.
    slot.querySelector(".property-card__buy-cost").textContent = affordable
      ? giftFree ? "FREE" : rupees(price)
      : `${rupees(price - money)} short`;
    button.title = affordable
      ? `Buy for ${rupees(price)}${suit ? ` with ${suitName} −${suit.discount}%` : ""}`
      : verdict.why;
    button.onclick = () => ctx?.onBuy?.();
  }

  /* --- Pass, Done, Continue --- */

  const next = card.querySelector(".property-card__next");
  /* The own-square CTA is "Already Yours": there was never an offer to
     decline, so the button says what the square is and ends the visit. */
  const words = { buy: "Pass", own: "Already Yours", rent: "Continue" };
  if (deciding && words[kind] && !answered) {
    next.hidden = false;
    next.dataset.kind = kind;
    next.querySelector(".property-card__next-label").textContent = words[kind];
    next.onclick = () => {
      if (kind === "buy" || kind === "own") ctx?.onPass?.();
      else ctx?.onContinue?.();
    };
  } else {
    next.hidden = true;
    delete next.dataset.kind;
    next.onclick = null;
  }

  /* --- the three builds ---

     A build is live on exactly one visit: the visit that landed on your own
     square, before this visit spent its one build. The rows that are not live
     still say why, because a row that is merely grey is a question rather than
     an answer. */

  const builds = holder.querySelector(".builds");
  if (builds) {
    // Somebody else's square has no build rows on a decision: the only thing to
    // decide is whether you have read the rent. Hiding them is also what lets
    // that card fit without a scroll.
    const showBuilds = !deciding || kind !== "rent";
    builds.hidden = !showBuilds;
    builds.style.display = showBuilds ? "" : "none";

    const offer =
      deciding && kind === "own" && owner === seat
        ? upgradeOffer(game, id)
        : { ok: false, why: "" };
    const spent = Boolean(game?.visit?.bought || (game?.visit?.upgrades || 0) >= 1);

    // The locked section: why upgrades are (or are not) available.
    //
    // It never says who holds what. A set is complete when one player holds
    // every colony in it, and the card says the size of the set and who owns
    // each colony - the fact, and nothing more.
    const lock = holder.querySelector(".builds__lock");
    const status = holder.querySelector(".builds__status");
    if (lock) {
      const members = setMembers(ledger, id);
      const complete = setHolder(ledger, id) !== null;
      // One simple line, no tick marks, no ownership list. The board already
      // shows who holds what; this line only says how many complete the set.
      lock.textContent = complete
        ? `Own all ${members.length} properties`
        : `Own all ${members.length} properties to unlock upgrades`;
      lock.hidden = false;
    }
    if (status) {
      status.textContent = "";
      status.hidden = true;
    }

    const steps = upgradesOf(id);
    for (const node of holder.querySelectorAll(".build")) {
      const n = Number(node.dataset.build) - 1;
      const step = steps[n];
      const nextLevel = level === n;
      const can = nextLevel && offer.ok;
      let label;

      // Monopoly gating: upgrades unlock only when the player has every square
      // in the set. The locked section above the rows explains why.
      const mono = hasMonopoly(ledger, id, seat);
      // Even building: no colony in a set may stand more than one level above
      // the lowest colony in it. A row that would break that says so.
      const evenBlocked = mono && evenUpgradeBlocked(ledger, id) && nextLevel;
      if (level > n) label = "Upgraded";
      else if (owner !== seat) label = "Locked";
      else if (!nextLevel) label = "Upgrade the previous level first";
      else if (evenBlocked) label = "Upgrade the other colonies in this set first";
      else if (mode !== "decision" || kind !== "own") {
        // Reading a square: the answer is always the same, and it is not a
        // refusal - it is the rule that building happens on a landing.
        label = mono ? "Land here to upgrade" : "Locked";
      } else if (spent) label = "Land here again to upgrade";
      else if (can) label = "Upgrade";
      else if (/more/.test(offer?.why || "")) label = "Can't afford";
      else if (/set/.test(offer?.why || "")) label = "Locked";
      else label = "Locked";

      node.dataset.state = can ? "next" : label === "Built" ? "done" : "locked";
      node.querySelector(".build__becomes").textContent = `Rent becomes ${rupees(step.rentAfter)}`;

      const button = node.querySelector(".build__button");
      const name = node.querySelector(".build__button-label");
      button.disabled = !can;
      button.setAttribute("aria-disabled", String(!can));
      button.title = can ? "" : offer.why || label;
      name.textContent = label;

      // Only the reachable build carries a handler at all. An inert button is
      // not merely disabled for now - there is nothing behind it to become live
      // later without the card being synced, and sync is what puts this back.
      if (can) button.onclick = () => ctx?.onUpgrade?.(n);
      else button.onclick = null;

      node.querySelector(".build__cost-figure").textContent = rupees(step.cost).slice(1);
    }
  }

  /* --- selling, and only while the turn is waiting for a throw --- */

  const sell = holder.querySelector(".property-card__sell");
  if (sell) {
    const value = saleValue(ledger, id);
    const canSell =
      mode !== "decision" &&
      owner === seat &&
      game?.phase === "AWAITING_ROLL" &&
      ctx?.sellEnabled !== false;
    if (!canSell) {
      sell.hidden = true;
      sell.style.display = "none";
      sell.dataset.armed = "";
    } else {
      sell.hidden = false;
      sell.style.removeProperty("display");
      if (sell.dataset.armed !== "true") {
        sell.querySelector(".property-card__sell-label").textContent = `Sell for ${rupees(value)}`;
      }
      sell.onclick = () => {
        if (sell.dataset.armed !== "true") {
          sell.dataset.armed = "true";
          sell.querySelector(".property-card__sell-label").textContent =
            `Confirm sale • ${rupees(value)}`;
          clearTimeout(sellTimer);
          sellTimer = setTimeout(() => {
            sell.dataset.armed = "";
            sell.querySelector(".property-card__sell-label").textContent =
              `Sell for ${rupees(value)}`;
          }, 4000);
          return;
        }
        sell.dataset.armed = "";
        clearTimeout(sellTimer);
        ctx?.onSell?.(id);
      };
    }
  }

  /* The decision card fills the middle, and the middle must not scroll. The
     stylesheet decides the rectangle; this only records which card is in it. */
  holder.dataset.mode = mode;
  holder.dataset.decision = kind;
}

/** What the sell pill would pay, via the ledger's own arithmetic. */

/* --------------------------------------------------------------- on the board */

/**
 * Show a property's card on the board, or take the current one away.
 *
 * `ctx.mode` is "read" by default and "decision" when the game has stopped here.
 * Returns a promise that settles when the card has finished turning, so a caller
 * can wait for it - and so a check can wait for it too.
 */
export async function showCard(board, id, ctx = null) {
  const property = propertyFor(id);
  const holder = board.querySelector(".board__card");
  if (!holder) return Promise.resolve(null);

  // Not a place anybody buys: take the card away and say so by returning null.
  if (!property) {
    holder.hidden = true;
    holder.replaceChildren();
    board.dataset.property = "";
    // A chest card is taller than this one. Leaving the flag behind would make
    // the NEXT property card open in the chest's rectangle, which is the kind of
    // thing that only shows up on the square after the one you were looking at.
    delete holder.dataset.cardKind;
    delete holder.dataset.mode;
    return Promise.resolve(null);
  }

  const mode = ctx?.mode === "decision" ? "decision" : "read";
  const turning = holder.dataset.property && holder.dataset.property !== id;
  board.dataset.property = id;

  /* The holder is put right before the card is drawn, so that no card is ever
     drawn inside a box the last one left transparent. See `resetHolder`. */
  resetHolder(holder);

  // The card, the builds and the quiet sell pill, written in one go so the
  // builds can never appear beside an empty card on a slow frame.
  const draw = () => {
    holder.replaceChildren(
      propertyCard(property, ctx),
      buildCard(property),
      sellPill(ctx),
    );
    holder.hidden = false;
    holder.dataset.property = id;
    // Back to the top, every time. The holder is the thing that scrolls, and it
    // keeps its position across a swap - so without this, opening a square after
    // building on the last one showed the new card already scrolled past its own
    // name and price, which is the part the player came to read.
    holder.scrollTop = 0;
    // Said on every swap rather than cleared when a chest goes away. A chest
    // card is taller than a property card, and the height lives on this holder -
    // so leaving "chest" behind when a property card arrives kept the tall
    // rectangle, and the property card hung 137px into the rows below the die.
    holder.dataset.cardKind = "property";
    // Filled in as it is drawn rather than synced afterwards, so the card is
    // never on screen for a frame with an empty status line and no figures.
    syncCard(board, ctx);
  };

  if (still()) {
    draw();
    return Promise.resolve(property);
  }

  // Already showing the right one: nothing to do. Sync it anyway, because the
  // turn may have handed the turn to the other player since it was opened.
  if (!turning && holder.firstElementChild) {
    // Back to the top: tapping a square is a request to read it, and a player who
    // scrolled down to the third build and then tapped the square again is asking
    // to see the top of it. This is the tap path only - `syncCard` is what runs
    // after a purchase, and that one must leave the scroll exactly where it is.
    holder.scrollTop = 0;
    syncCard(board, ctx);
    return Promise.resolve(property);
  }

  /* THE CARD IS DRAWN AT ONCE.

     The card the player asked for is the card on screen the moment they ask
     for it. It used to be drawn half a second later - away, swap, and back -
     and in that half second the middle was showing the PREVIOUS square's card
     and the board's own record of what it was showing was the previous
     square's. A tap that takes half a second to answer looks like a tap that
     was not answered at all.

     So the content is drawn first and the flourish is played over it. */
  draw();
  await settled(
    holder
      .animate(
        [
          { transform: "rotateY(-88deg)", opacity: 0 },
          { transform: "rotateY(0deg)", opacity: 1 },
        ],
        { duration: TURN_MS, easing: "cubic-bezier(.22,.7,.3,1)", fill: "both" },
      )
      .finished,
    TURN_MS + 150,
  );
  return property;
}

/** Take the card away. */
export function hideCard(board) {
  const holder = board.querySelector(".board__card");
  if (!holder) return Promise.resolve();
  board.dataset.property = "";
  holder.replaceChildren();
  holder.hidden = true;
  /* The holder is put right as it is emptied, so that the next card is never
     drawn inside a box this one left transparent. */
  resetHolder(holder);
  delete holder.dataset.cardKind;
  delete holder.dataset.mode;
  delete holder.dataset.decision;
  clearTimeout(sellTimer);
  return Promise.resolve();
}
