/* ==========================================================================
   GETTING ONTO THE BOARD

   The board screen is not a URL. state.screen becomes "board" because the
   server said the room is playing, so a rendered check has to make a room,
   fill it with two players, and wait to be let in - there is no shortcut past
   the join flow, and writing one into the app would mean testing a board that
   no player ever sees.

   So this drives the real flow, with real clicks.
   ========================================================================== */

import { sleep } from "./browser.mjs";

export async function joinToBoard(page, { host = "Asha", guest = "Vikram" } = {}) {
  const tap = async (text, wait = 700) => {
    const hit = await page.clickText(text);
    await sleep(wait);
    return hit;
  };

  const fill = async (value) =>
    page.eval(`(() => {
      const input = document.querySelector("input.field__input");
      if (!input) return "missing";
      input.focus();
      const write = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, "value",
      ).set;
      write.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return "ok";
    })()`);

  const civ = async (id) =>
    page.eval(`(() => {
      // Single quotes outside: JSON.stringify hands back a double-quoted
      // string, and nesting those inside a double-quoted selector ends the
      // page's string literal halfway through.
      const button = document.querySelector('.civ[data-civ=${JSON.stringify(id)}]');
      if (!button) return false;
      button.click();
      return true;
    })()`);

  await tap("create");
  await fill(host);
  await civ("indus-valley");
  await sleep(250);

  await tap("next");
  await fill(guest);
  await civ("aztec");
  await sleep(250);

  await tap("review");
  await tap("create", 1500);

  const gotThere = await page.clickText("board");
  await sleep(1400);

  const present = await page.eval(`!!document.querySelector(".board")`);
  if (!present) throw new Error("the join flow finished but there is no board on the page");

  return { gotThere };
}