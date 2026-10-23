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

/* ----------------------------------------------------------------- restoring

   The screen between a refresh and the game.

   A refresh is not a page load of nothing: the browser already holds a seat,
   and the game is one request away. Showing the welcome screen in the gap
   makes a game that is there look like a game that is gone - and a player who
   thinks the game has gone refreshes again, and again, and each refresh looks
   the same. So the gap says what it is: the game is being found, and it will
   be here in a moment. */

export function restoringView(state) {
  return {
    body: el("div", { class: "composition composition--restoring" }, [
      el("h1", { class: "visually-hidden", text: "Samrajya Kalchakra" }),
      ...markup(masthead()),
      el("p", { class: "restoring__note", text: "Finding your game" }),
    ]),
    foot: null,
  };
}

/* ------------------------------------------------------------------ welcome */

export function welcomeView(state, actions) {  const composition = el("div", { class: "composition" }, [
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

function field({
  label,
  name,
  value = "",
  placeholder,
  error,
  onInput,
  onEnter,
  type,
  code,
  autofocus,
}) {
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
    autocapitalize: code ? "off" : "words",
    spellcheck: "false",
    // A four-digit code is typed on a number pad. `inputmode` asks for it
    // without forcing a numeric input, which would hide a pasted link.
    inputmode: code ? "numeric" : null,
    pattern: code ? "[0-9]*" : null,
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
    onkeydown: (event) => {
      if (!onEnter) return;
      if (event.key !== "Enter") return;
      event.preventDefault();
      onEnter();
    },
  });

  return el("div", { class: "field" }, [
    el("label", { class: "field__label", for: id, text: label }),
    input,
    errorNode,
  ]);
}

/**
 * One option in the civilization picker.
 *
 * The disc is the colour that civilization's coin is drawn in on the board, so
 * the choice a player makes here is the colour they will be looking for on
 * every square afterwards. It is a real element rather than a border or a
 * background tint: a dot of colour survives being selected (the row turns ink,
 * and a black border on black would not), and it is the same value the board
 * reads, so the two cannot drift.
 */
function civRow(civ, { chosen, taken, onPick }) {
  const node = el(
    "button",
    {
      type: "button",
      class: "civ",
      role: "radio",
      "aria-checked": chosen ? "true" : "false",
      "aria-pressed": chosen ? "true" : "false",
      "aria-label": taken ? `${civ.name} Civilization, taken` : `${civ.name} Civilization`,
      disabled: taken,
      "data-civ": civ.id,
      style: { "--coin": civ.coin },
      onclick: () => {
        if (taken) return;
        const group = node.closest(".civs");
        for (const other of group.querySelectorAll(".civ")) {
          const on = other === node;
          other.setAttribute("aria-checked", on ? "true" : "false");
          other.setAttribute("aria-pressed", on ? "true" : "false");
          other.querySelector(".civ__tick")?.remove();
        }
        // The tick follows the choice. Re-rendering the panel would be simpler
        // and would also throw the caret out of the name field beside it.
        node.append(el("span", { class: "civ__tick", "aria-hidden": "true", text: "✓" }));
        onPick(civ.id);
      },
    },
    [
      el("span", { class: "civ__swatch", "aria-hidden": "true" }),
      el("span", { class: "civ__name" }, [
        `${civ.name} `,
        el("span", { class: "civ__word", text: "Civilization" }),
      ]),
      chosen ? el("span", { class: "civ__tick", "aria-hidden": "true", text: "✓" }) : null,
    ],
  );
  return node;
}

/**
 * The civilization picker.
 *
 * The group updates its own selection when an option is tapped. That is what a
 * radiogroup is for, and it matters practically: re-rendering the whole panel
 * on every tap would throw away the caret in the name field next to it.
 * The app keeps the truth in `draft`; this keeps the picture honest.
 */
function civPicker({ label, value, taken = [], onPick, id, lede }) {
  const name = `civ-${id}`;
  const group = el("div", {
    class: "civs",
    role: "radiogroup",
    "aria-labelledby": `${name}-label`,
  });

  for (const civ of choices()) {
    group.append(civRow(civ, { chosen: value === civ.id, taken: taken.includes(civ.id), onPick }));
  }

  return el("div", { class: "field", role: "group", "aria-label": label }, [
    el("p", { class: "field__label", id: `${name}-label`, text: label }),
    lede ? el("p", { class: "field__hint", text: lede }) : null,
    group,
  ]);
}

/* ------------------------------------------------------------------- create */

/**
 * Open a game.
 *
 * One step, one player. The creator says who they are and what they are
 * playing, and that is the whole form - the second seat belongs to the person
 * who takes it, on their own device, with their own name and civilization.
 */
export function createView(state, actions) {
  const { draft, errors = {}, busy, error } = state;

  return panel({
    title: "Create Game",
    step: "1 of 1",
    lede: "Your name and your civilization. Then you get a four-digit code to share.",
    backTo: "Back",
    onBack: actions.cancel,
    busy,
    error,
    children: [
      field({
        label: "Your name",
        name: "p1name",
        value: draft.name,
        placeholder: "Your name",
        error: errors.name,
        autofocus: true,
        onInput: actions.setName,
        onEnter: actions.createConfirm,
      }),
      civPicker({
        id: "p1",
        label: "Choose your civilization",
        lede: "Each civilization plays as a colour. This one is yours on the board.",
        value: draft.civ,
        onPick: actions.setCiv,
      }),
      errors.civ ? el("p", { class: "field__error", role: "alert", text: errors.civ }) : null,
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
}

/* --------------------------------------------------------------------- join */

export function joinView(state, actions) {
  const { draft, step, errors = {}, busy, error } = state;

  if (step === 0) {
    return panel({
      title: "Join Game",
      step: "1 of 2",
      lede: "Type the four-digit code, or paste the link you were sent.",
      backTo: "Back",
      onBack: actions.cancel,
      busy,
      error,
      children: [
        field({
          label: "Game code",
          name: "code",
          value: draft.rawCode,
          placeholder: "4 digits",
          code: true,
          autofocus: true,
          error: errors.code,
          onInput: actions.setCode,
          onEnter: actions.joinLookup,
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
  const host = room?.players?.[0];

  return panel({
    title: "Join Game",
    step: "2 of 2",
    lede: host?.name
      ? `You are joining ${host.name}${host.civ ? ` (${civById(host.civ)?.name ?? ""} Civilization)` : ""}.`
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
        onEnter: actions.joinConfirm,
      }),
      civPicker({
        id: "join",
        label: "Choose your civilization",
        lede: "A colour and a people. Pick one that is still free.",
        value: draft.civ,
        taken,
        onPick: actions.setCiv,
      }),
      errors.civ ? el("p", { class: "field__error", role: "alert", text: errors.civ }) : null,
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

/**
 * One seat, as the lobby shows it.
 *
 * Three facts, in the order a person wants them: the colour they will look for
 * on the board, who is sitting there, and whether they are in yet. A seat
 * nobody has taken is not hidden - an empty chair is the thing being waited
 * for, and pretending it is not there makes the wait look like a fault.
 */
function seatRow({ player, index, seat, openLabel }) {
  const joined = Boolean(player?.joined && player?.name);
  const civ = civById(player?.civ);
  const mine = seat === index;

  return el("li", {
    class: `seat${joined ? " seat--in" : " seat--open"}${mine ? " seat--mine" : ""}`,
    "data-seat": String(index),
  }, [
    el("span", {
      class: `seat__coin${civ ? "" : " seat__coin--empty"}`,
      "aria-hidden": "true",
      style: civ ? { "--coin": coinColor(player.civ) } : null,
    }),
    el("span", { class: "seat__who" }, [
      el("span", { class: "seat__name" }, [
        joined ? player.name : openLabel,
        mine ? el("span", { class: "seat__you", text: "you" }) : null,
      ]),
      el("span", {
        class: "seat__civ",
        text: joined ? (civ ? `${civ.name} Civilization` : "—") : "Not joined yet",
      }),
    ]),
    el("span", {
      class: `seat__state${joined ? " seat__state--ready" : ""}`,
      text: joined ? "Ready" : "Waiting",
    }),
  ]);
}

/** The four digits, as four digits. One big number would be a word; this is a code. */
function codeTiles(code) {
  return el(
    "div",
    {
      class: "lobby__code",
      role: "group",
      "aria-label": code ? `Game code ${code.split("").join(" ")}` : "Game code not ready",
    },
    code
      ? code.split("").map((digit) => el("span", { class: "lobby__digit", text: digit }))
      : [el("span", { class: "lobby__digit lobby__digit--empty", text: "—" })],
  );
}

export function lobbyView(state, actions) {
  const room = state.room;
  const code = room?.roomId || state.draft.code || "";
  const link = state.inviteLink || "";
  const seat = Number.isInteger(room?.seat) ? room.seat : null;
  const [host, guest] = room?.players || [];
  const bothIn = Boolean(host?.joined && guest?.joined);
  const mineIsHost = seat === 0;
  const playing = room?.status === "PLAYING";
  const busy = Boolean(state.busy);
  const joinerCiv = civById(guest?.civ);
  const myCiv = civById(seat === 0 ? host?.civ : seat === 1 ? guest?.civ : null);

  const status = (() => {
    if (playing) return "The game has started. The board is ready.";
    if (bothIn) {
      // The host is told who arrived; the guest is told where they are. Saying
      // "Vikram has joined" to Vikram would be news about himself.
      return mineIsHost
        ? `${guest.name} has joined as ${joinerCiv?.name ?? "an"} Civilization — Ready.`
        : `You are in as ${myCiv?.name ?? "your"} Civilization — ready when ${host?.name || "the host"} starts.`;
    }
    if (mineIsHost) return "Waiting for the second player to join.";
    return `Waiting for ${host?.name || "the host"} to start the game.`;
  })();

  const linkLost = state.socket === "retrying";

  return panel({
    title: playing ? "In play" : "Lobby",
    step: bothIn || playing ? "2 of 2" : "1 of 2",
    backTo: playing ? "Leave the game" : "Leave lobby",
    onBack: actions.cancel,
    busy: false,
    error: state.error,
    focus: "panel",
    children: [
      el("p", {
        class: "panel__lede",
        text: playing
          ? "Both of you are in. Pick up where you left off."
          : mineIsHost
            ? "Send them the code or the link. You both stay in this room until you start."
            : "You are in the same room as your opponent. The board opens when they start it.",
      }),

      el("div", { class: "lobby__share" }, [
        el("p", { class: "field__label", text: "Game code" }),
        el("div", { class: "lobby__code-row" }, [
          codeTiles(code),
          el("button", {
            type: "button",
            class: "btn btn--quiet lobby__copy",
            text: "Copy code",
            onclick: () => actions.copy(code, "Code copied."),
          }),
        ]),
      ]),

      // Once the game is playing the number is still worth showing - it is how
      // you come back - but there is nobody left to invite, so the link field
      // goes rather than sitting there offering a door that is shut.
      playing
        ? null
        : el("div", { class: "field lobby__link" }, [
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

      el("div", { class: "lobby__players" }, [
        el("p", { class: "field__label", text: "At the table" }),
        el("ul", { class: "seats" }, [
          seatRow({ player: host, index: 0, seat, openLabel: "Player 1" }),
          seatRow({ player: guest, index: 1, seat, openLabel: "Player 2" }),
        ]),
      ]),

      el("div", { class: "statusline", role: "status", "aria-live": "polite" }, [
        el("span", { class: `pulse${bothIn || playing ? "" : " pulse--wait"}`, "aria-hidden": "true" }),
        el("span", { text: status }),
      ]),
      linkLost
        ? el("p", { class: "field__hint", text: "Reconnecting… the table is still here." })
        : null,

      el("div", { class: "actions" }, [
        playing
          ? button("Return to the board", {
              arrow: true,
              variant: "primary",
              onclick: actions.enterBoard,
            })
          : mineIsHost
            ? button(busy ? "Starting…" : bothIn ? "Start Game" : "Waiting for player 2", {
                arrow: bothIn && !busy,
                variant: "primary",
                disabled: !bothIn || busy,
                onclick: actions.startGame,
              })
            : button(`Waiting for ${host?.name || "the host"}`, {
                arrow: false,
                variant: "primary",
                disabled: true,
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
