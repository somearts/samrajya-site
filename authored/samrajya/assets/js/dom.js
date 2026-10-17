/* ==========================================================================
   SAMRAJYA - THE SMALL DOM HELPERS

   Enough to build the panels without reaching for a framework, and no more.
   The screens are small and mostly static; a template library would be more
   machinery than the thing it was fetching.
   ========================================================================== */

/** querySelector, for the handful of nodes the app keeps a handle on. */
export const $ = (selector, scope = document) => scope.querySelector(selector);

/** querySelectorAll, as a real array. */
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

/**
 * Apply a bag of styles to a node.
 *
 * Custom properties go through setProperty, not assignment. `style.foo = x`
 * works for `foo` being a real CSS property and silently does nothing for
 * `--foo`, because custom properties are not entries on the style object -
 * they live in a separate map. Assigning one therefore fails without any
 * error, and the declaration quietly falls back to its default, which is the
 * worst kind of bug to notice by eye.
 */
function setStyle(node, styles) {
  for (const [prop, value] of Object.entries(styles)) {
    if (value === null || value === undefined) continue;
    if (prop.startsWith("--")) node.style.setProperty(prop, String(value));
    else node.style[prop] = value;
  }
}

/**
 * Build an element.
 *
 * `el("button", { class: "btn", onclick: fn }, ["text", node])`
 *
 * Text is always set through textContent, never innerHTML: every string that
 * reaches the page is either ours or something a person typed, and a name is
 * not an opportunity to inject markup.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "html") node.innerHTML = value; // only ever our own markup
    else if (key === "style" && typeof value === "object") setStyle(node, value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (key === "disabled" || key === "hidden") {
      if (value) node.setAttribute(key, "");
    } else node.setAttribute(key, value === true ? "" : String(value));
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Put a button's label and its arrow in, so no screen hand-rolls the pair. */
export function button(label, { arrow = false, variant = "ghost", ...rest } = {}) {
  return el(
    "button",
    { type: "button", class: `btn btn--${variant}`, ...rest },
    [label, arrow ? el("span", { class: "btn__arrow", "aria-hidden": "true", text: "→" }) : null],
  );
}

/**
 * Move focus to the first control when a panel appears.
 *
 * Without this a keyboard or screen-reader user is left wherever the welcome
 * screen had them, which on a same-page transition is now nothing.
 *
 * The focus is applied synchronously, because the node is already in the
 * document by the time this is called. A requestAnimationFrame retry follows
 * for the case where the browser has not finished attaching layout - but it is
 * only a retry: rAF does not run at all in a background tab, and a transition
 * that quietly leaves focus on <body> is a real failure, not a slow one.
 */
export function focusFirst(scope) {
  // The marker may be on the scope itself - a panel that is only reporting
  // marks itself so its heading is announced - so scope is checked before its
  // descendants, not after.
  const target =
    (scope.matches && scope.matches("[data-autofocus]") && scope) ||
    scope.querySelector("[data-autofocus]") ||
    scope.querySelector("input, button");
  if (!target || typeof target.focus !== "function") return;

  target.focus({ preventScroll: true });
  if (document.activeElement === target) return;

  requestAnimationFrame(() => {
    if (document.activeElement !== target) target.focus({ preventScroll: true });
  });
}
