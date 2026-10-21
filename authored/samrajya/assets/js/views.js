/* ==========================================================================
   SAMRAJYA - THE SCREENS

   Four screens, each a function from state to a DOM tree. They decide nothing
   and fetch nothing: what a button does is handed to them in `actions`, and
   what a room looks like arrives in `state`. That is what keeps the board
   game from having to rewrite this file - it arrives as new state and new
   actions.

   The welcome screen is the reference composition, untouched. The other three
   replace it in place, on the same page, with the same paper and the same
   ink, so moving between them feels like one object unfolding.
   ========================================================================== */

import { el, button, focusFirst } from "./dom.js";
import { masthead } from "./wordmark.js";
import { board } from "./board.js";
import { purseOf, figureOf } from "./economy-ui.js";
import { choices, civById, coinColor } from "./shared/civilizations.js";
import { NAME_MAX } from "./shared/identity.js";

/* ------------------------------------------------------------------ welcome */

export function welcomeView(state, actions) {
  const composition = el("div", { class: "composition" }, [
    el("h1", { class: "visually-hidden", text: "Samrajya Kalchakra" }),
    ...markup(masthead()),
    el("p", { class: "tagline" }, ["Empires rise.", el("br"), "Time turns."]),
    el(
      "div",
      { class: "actions" },
      [
        button("Create Game", {
          arrow: true,
          variant: "primary",
          onclick: actions.startCreate,
        }),
        button("Join Game", { arrow: true, variant: "ghost", onclick: actions.startJoin }),
      ],
    ),
  ]);

  return {
    body: composition,
    foot: null,
    onMount: () => composition.querySelector(".btn")?.focus({ preventScroll: true }),
  };
}

/** The wordmark ships as markup; put it in the document. */
function markup(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html.trim();
  return [...tpl.content.children];
}

/* ------------------------------------------------------------------- panels */

/**
 * A panel, its heading, and a way back.
 *
 * `focus` decides where the keyboard lands when the panel appears. On a step
 * with a field to fill in that is the field. On a screen that only reports -
 * the review, the lobby - it is the panel itself, so the heading is announced
 * instead of "Copy code" grabbing the keyboard for no reason.
 */
function panel({ title, step, lede, children, backTo, onBack, busy, error, focus = "field" }) {
  const body = el("div", { class: "panel" }, [
    el("div", { class: "panel__head" }, [
      el("h2", { class: "panel__title", text: title }),
      step ? el("p", { class: "panel__step", text: step }) : null,
    ]),
    lede ? el("p", { class: "panel__lede", text: lede }) : null,
    ...children,
    error ? el("p", { class: "field__error", role: "alert", text: error }) : null,
  ]);

  if (focus === "panel") {
    body.setAttribute("tabindex", "-1");
    body.setAttribute("data-autofocus", "");
  }

  return {
    body: el("div", { class: "composition" }, [body]),
    foot: el("button", {
      type: "button",
      class: "btn btn--quiet",
      text: backTo,
      disabled: busy,
      onclick: onBack,
    }),
    onMount: () => focusFirst(body),
  };
}

/* ------------------------------------------------------------------- fields */

function field({ label, name, value = "", placeholder, error, onInput, type, code, autofocus }) {
  const id = `f-${name}`;
  const errorId = `${id}-err`;
  let errorNode = error
    ? el("p", { class: "field__error", id: errorId, text: error })
    : null;

  const input = el("input", {
    id,
    class: `field__input${code ? " field__input--code" : ""}`,
    type: type || "text",
    name,
    value,
    placeholder: placeholder || "",
    autocomplete: "off",
    autocapitalize: "words",
    spellcheck: "false",
    maxlength: code ? 40 : String(NAME_MAX),
    "aria-label": label,
    "aria-describedby": errorNode ? errorId : null,
    "aria-invalid": errorNode ? "true" : null,
    ...(autofocus ? { "data-autofocus": true } : {}),
    oninput: (event) => {
      // Clear this field's complaint the moment the person starts answering it.
      // Re-rendering the panel instead would take the caret out of the input
      // they are typing into, which is worse than a message that lingers.
      if (errorNode) {
        errorNode.remove();
        errorNode = null;
        input.removeAttribute("aria-describedby");
        input.removeAttribute("aria-invalid");
      }
      onInput(event.target.value);
    },
  });

  return el("div", { class: "field" }, [
    el("label", { class: "field__label", for: id, text: label }),
    input,
    errorNode,
  ]);
}

/**
 * The token picker.
 *
 * Tokens are exclusive while both players are choosing, so anything already
 * claimed is disabled rather than hidden - a player can see what is gone and
 * why they cannot have it.
 *
 * The group updates its own selection when a token is tapped. That is what a
 * radiogroup is for, and it matters practically: re-rendering the whole panel
 * on every tap would throw away the caret in the name field next to it.
 * The app keeps the truth in `draft`; this keeps the picture honest.
 */
function civPicker({ label, value, taken = [], onPick, id, lede }) {
  const name = `civ-${id}`;
  const group = el("div", { class: "civs", role: "radiogroup", "aria-labelledby": `${name}-label` });

  const select = (chosen) => {
    for (const other of group.querySelectorAll(".civ")) {
      const on = other.dataset.civ === chosen;
      other.setAttribute("aria-checked", on ? "true" : "false");
      other.setAttribute("aria-pressed", on ? "true" : "false");
    }
  };

  for (const civ of choices()) {
    const isTaken = taken.includes(civ.id);
    group.append(
      el(
        "button",
        {
          type: "button",
          class: "civ",
          role: "radio",
          "aria-checked": value === civ.id ? "true" : "false",
          "aria-pressed": value === civ.id ? "true" : "false",
          "aria-label": isTaken ? `${civ.name} Civilization, taken` : `${civ.name} Civilization`,
          disabled: isTaken,
          "data-civ": civ.id,
          onclick: () => {
            if (isTaken) return;
            select(civ.id);
            onPick(civ.id);
          },
        },
        [
          // The full name, on one line, as the rules name it. Only the
          // trailing word is de-emphasised, so the option still reads as
          // "Indus Valley Civilization" rather than as a title with a
          // subtitle under it - and the whole name is one string of text.
          el("span", { class: "civ__name" }, [
            `${civ.name} `,
            el("span", { class: "civ__word", text: "Civilization" }),
          ]),
        ],
      ),
    );
  }

  return el("div", { class: "field", role: "group", "aria-label": label }, [
    el("p", { class: "field__label", id: `${name}-label`, text: label }),
    lede ? el("p", { class: "field__hint", text: lede }) : null,
    group,
  ]);
}

/**
 * One line in the review or the lobby: who, what, and where they stand.
 *
 * There is no mark beside the name. The civilisation tokens are a later phase
 * and putting four half-drawn symbols next to four real names would be worse
 * than putting nothing.
 */
function reviewRow(seat, name, civId, meta) {
  const civ = civById(civId);
  return el("div", { class: "review__row" }, [
    el("span", {}, [
      el("span", { class: "review__seat", text: seat }),
      el("span", { class: "review__name", text: ` ${name}` }),
    ]),
    el("span", { class: "review__meta", text: civ ? `${civ.name} Civilization` : "—" }),
    meta ? el("span", { class: "review__note", text: meta }) : null,
  ]);
}

/* ------------------------------------------------------------------- create */

export function createView(state, actions) {
  const { draft, step, errors = {}, busy, error } = state;

  const body = (() => {
    if (step === 0) {
      return panel({
        title: "Create Game",
        step: "1 of 3",
        lede: "This game is for two. Start with your own name.",
        backTo: "Back",
        onBack: actions.cancel,
        busy,
        error,
        children: [
          field({
            label: "Player 1 - your name",
            name: "p1name",
            value: draft.name,
            placeholder: "Your name",
            error: errors.name,
            autofocus: true,
            onInput: actions.setName,
          }),
          civPicker({
            id: "p1",
            label: "Choose your civilization",
            value: draft.civ,
            onPick: actions.setCiv,
          }),
          el("div", { class: "actions" }, [
            button("Next", {
              arrow: true,
              variant: "primary",
              disabled: busy,
              onclick: actions.createNext,
            }),
          ]),
        ],
      });
    }

    if (step === 1) {
      return panel({
        title: "Player 2",
        step: "2 of 3",
        lede: "Set your opponent up. They can change this when they join.",
        backTo: "Back",
        onBack: actions.createBack,
        busy,
        error,
        children: [
          field({
            label: "Player 2 - their name",
            name: "p2name",
            value: draft.guestName,
            placeholder: "Their name",
            error: errors.guestName,
            autofocus: true,
            onInput: actions.setGuestName,
          }),
          civPicker({
            id: "p2",
            label: "Choose their civilization",
            value: draft.guestCiv,
            taken: draft.civ ? [draft.civ] : [],
            onPick: actions.setGuestCiv,
          }),
          el("div", { class: "actions" }, [
            button("Review", {
              arrow: true,
              variant: "primary",
              disabled: busy,
              onclick: actions.createNext,
            }),
          ]),
        ],
      });
    }

    return panel({
      title: "Review",
      step: "3 of 3",
      lede: "Check the two of you before the game is opened.",
      backTo: "Back",
      onBack: actions.createBack,
      busy,
      error,
      focus: "panel",
      children: [
        el("div", { class: "review" }, [
          reviewRow("Player 1", draft.name, draft.civ, "you"),
          reviewRow("Player 2", draft.guestName, draft.guestCiv, "joins by code"),
        ]),
        el("p", {
          class: "field__hint",
          text: "You will get a code to send them. They open it, choose, and you are both at the board.",
        }),
        el("div", { class: "actions" }, [
          button(busy ? "Opening…" : "Create Game", {
            arrow: !busy,
            variant: "primary",
            disabled: busy,
            onclick: actions.createConfirm,
          }),
        ]),
      ],
    });
  })();

  return body;
}

/* --------------------------------------------------------------------- join */

export function joinView(state, actions) {
  const { draft, step, errors = {}, busy, error } = state;

  if (step === 0) {
    return panel({
      title: "Join Game",
      step: "1 of 2",
      lede: "Paste the code or the whole link you were sent.",
      backTo: "Back",
      onBack: actions.cancel,
      busy,
      error,
      children: [
        field({
          label: "Game code",
          name: "code",
          value: draft.rawCode,
          placeholder: "abcd2345",
          code: true,
          autofocus: true,
          error: errors.code,
          onInput: actions.setCode,
        }),
        el("div", { class: "actions" }, [
          button(busy ? "Looking…" : "Next", {
            arrow: !busy,
            variant: "primary",
            disabled: busy,
            onclick: actions.joinLookup,
          }),
        ]),
      ],
    });
  }

  const room = state.room;
  const taken = (room?.players || []).filter((p) => p.joined).map((p) => p.civ);

  return panel({
    title: "Join Game",
    step: "2 of 2",
    lede: room
      ? `You are joining ${room.players[0]?.name || "a game"}.`
      : "Tell them who you are.",
    backTo: "Back",
    onBack: actions.joinBack,
    busy,
    error,
    children: [
      field({
        label: "Your name",
        name: "joinname",
        value: draft.name,
        placeholder: "Your name",
        error: errors.name,
        autofocus: true,
        onInput: actions.setName,
      }),
      civPicker({
        id: "join",
        label: "Choose your civilization",
        value: draft.civ,
        taken,
        onPick: actions.setCiv,
      }),
      el("div", { class: "actions" }, [
        button(busy ? "Joining…" : "Join Game", {
          arrow: !busy,
          variant: "primary",
          disabled: busy,
          onclick: actions.joinConfirm,
        }),
      ]),
    ],
  });
}

/* -------------------------------------------------------------------- lobby */

export function lobbyView(state, actions) {
  const room = state.room;
  const code = room?.roomId || state.draft.code;
  const link = state.inviteLink || "";
  const [host, guest] = room?.players || [];
  const bothIn = host?.joined && guest?.joined;

  const rows = [
    room && host
      ? reviewRow("Player 1", host.name, host.civ, host.joined ? "ready" : "waiting")
      : null,
    room && guest
      ? reviewRow("Player 2", guest.name || "—", guest.civ, guest.joined ? "ready" : "to join")
      : null,
  ].filter(Boolean);

  return panel({
    title: bothIn ? "Both ready" : "Waiting",
    backTo: "Start over",
    onBack: actions.cancel,
    busy: false,
    error: state.error,
    focus: "panel",
    children: [
      el("p", {
        class: "panel__lede",
        text: bothIn
          ? "Both of you are in. The board is ready."
          : "Send this code to your opponent. You can go to the board now, and they will find you there.",
      }),
      el("div", { class: "code" }, [
        el("span", { class: "code__value", text: code || "—" }),
        el("div", { class: "code__actions" }, [
          el("button", {
            type: "button",
            class: "btn btn--quiet",
            text: "Copy code",
            onclick: () => actions.copy(code, "Code copied."),
          }),
        ]),
      ]),
      el("div", { class: "field" }, [
        el("label", { class: "field__label", for: "invite", text: "Or send the link" }),
        el("div", { class: "linkbox" }, [
          el("input", {
            id: "invite",
            class: "field__input",
            type: "text",
            value: link,
            readonly: true,
            "aria-label": "Invite link",
            onfocus: (e) => e.target.select(),
          }),
          el("button", {
            type: "button",
            class: "btn btn--quiet",
            text: "Copy",
            onclick: () => actions.copy(link, "Link copied."),
          }),
        ]),
      ]),
      el("div", { class: "review" }, rows),
      el("div", { class: "statusline" }, [
        el("span", { class: `pulse${bothIn ? "" : " pulse--wait"}`, "aria-hidden": "true" }),
        el("span", {
          text: bothIn
            ? "Both players are in the room."
            : "Waiting for the second player to join.",
        }),
      ]),
      el("div", { class: "actions" }, [
        button(bothIn ? "Go to the board" : "Enter the board alone", {
          arrow: true,
          variant: "primary",
          onclick: actions.enterBoard,
        }),
      ]),
    ],
  });
}

/* -------------------------------------------------------------------- board */

export function boardView(state, actions) {
  const room = state.room;
  const players = (room?.players || []).filter((p) => p.name);

  /* THE GAME
     --------
     The server owns it. `state.game` is the restored snapshot the room carries;
     it is null until the host has started the game, and the board screen says so
     rather than inventing a game of its own. */
  const game = state.game;
  if (!game) {
    return {
      body: el("div", { class: "board-screen" }, [
        el("div", { class: "board-waiting" }, [
          el("p", { class: "board-waiting__title", text: "Waiting for the game to start" }),
          el("p", {
            class: "board-waiting__note",
            text: "The first player starts the game from the lobby. This screen will show the board the moment it begins.",
          }),
        ]),
      ]),
      foot: el("button", {
        type: "button",
        class: "btn btn--quiet",
        text: "Back to the lobby",
        onclick: actions.leaveBoard,
      }),
    };
  }
  const ledger = game.ledger;

  // The two identities with the matchup between them. The VS goes in as a real
  // child rather than as a ::before on one of the blocks, because it has to sit
  // BETWEEN them and a pseudo-element belongs to one block - which would put it
  // on the outside, reading as a suffix on the first name. With one player there
  // is no matchup and no VS is drawn.
  //
  // THE CHIP
  // --------
  // A coin disc in the player's own civilization colour, the name, the
  // civilization, and - on the active seat - the word TURN in small caps. The
  // balance is its own line underneath: light digits, a rupee sign at six tenths
  // the size and quieter, because the number is the thing and the sign is the
  // label. The disc's colour comes from the same `coinColor` call the board coin
  // and the owner's ring use, so the three cannot drift apart.
  const roster = el("div", { class: "board-who" },
    players
      .map((p, i) => {
        const seat = players.indexOf(p);
        const civ = civById(p.civ);
        const money = purseOf(ledger, seat);
        return [
          i > 0 ? el("span", { class: "who__vs", text: "VS" }) : null,
          el("button", {
            type: "button",
            class: `who${room.seat === seat ? " who--me" : ""}`,
            "data-seat": String(seat),
            "data-civ": p.civ || "",
            "aria-label": `Open ${p.name}'s profile`,
            title: `Open ${p.name}'s profile`,
            style: { "--coin": coinColor(p.civ) || "var(--ink)" },
            onclick: () => theBoard.toggleProfile(seat),
          }, [
            el("span", { class: "who__coin", "aria-hidden": "true" }),
            el("span", { class: "who__name", text: p.name }),
            el("span", { class: "who__civ", text: `${civ?.name ?? "Unchosen"}` }),
            el("span", { class: "who__turn", hidden: true, text: "TURN" }),
            el("span", {
              class: "who__money",
              "aria-label": money,
            }, [
              el("span", { class: "who__rupee", "aria-hidden": "true", text: "₹" }),
              el("span", {
                class: "who__figure",
                "data-value": String(ledger.players.find((x) => x.seat === seat)?.money ?? 0),
                text: figureOf(ledger.players.find((x) => x.seat === seat)?.money ?? 0),
              }),
            ]),
            el("span", { class: "who__weapons", "aria-hidden": "true" }),
          ]),
        ];
      })
      .flat()
      .filter(Boolean),
  );

  const theBoard = board({
    players,
    game,
    seat: Number.isInteger(room?.seat) ? room.seat : 0,
    session: state.session,
    roomId: room?.roomId || null,
  });
  // The room is on the board itself, which is what lets a test - and anyone
  // with a screen reader - tell one game from another.
  theBoard.dataset.room = state.room?.roomId || "";

  // The live channel pushes the game here. `app.js` keeps `state.game` current
  // and hands the snapshot to the board, which animates it.
  state.applySnapshot = (snapshot) => {
    const frame = document.querySelector(".board");
    frame?.applySnapshot?.(snapshot);
  };

  return {
    body: el("div", { class: "board-screen" }, [roster, theBoard]),
    foot: el("button", {
      type: "button",
      class: "btn btn--quiet",
      text: "Leave the board",
      onclick: actions.leaveBoard,
    }),
    onMount: () => {
      // The board is the point of the screen, so the focus goes there rather
      // than to a button nobody asked for.
      const target = document.querySelector(".board");
      target?.setAttribute("tabindex", "-1");
      target?.focus({ preventScroll: true });
    },
  };
}
