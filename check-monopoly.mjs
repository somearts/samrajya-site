import { applyAction, createGame } from "./shared/game.js";
import { sheetFor, evenUpgradeBlocked } from "./shared/ledger.js";
import { SETS } from "./shared/spaces.js";

function holding(ids, seat = 0) {
  const state = createGame([{ name: "A", civ: "indus-valley" }, { name: "B", civ: "mesopotamian" }], { testMode: true });
  for (const id of ids) sheetFor(state.ledger, id).owner = seat;
  return state;
}

for (const [name, ids] of Object.entries(SETS)) {
  const state = holding(ids, 0);
  const result = evenUpgradeBlocked(state.ledger, ids[0]);
  console.log(ids[0], "->", result, result === false ? "OK" : "FAIL expected false");
  if (result !== false) {
    console.log("  members:", [...state.ledger.properties.entries()].map(([k, v]) => `${k}:${v.owner}:${v.upgradeLevel}`));
  }
}