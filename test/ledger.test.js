/* ==========================================================================
   THE LEDGER

   Who holds what, and who may do what with it. Every rule is tested here rather
   than in the browser, which is the reason the rules were written without a
   single line of DOM in them.

   Most of this file is about refusal. A board game that quietly lets you build
   Lunar Colony before Lunar Outpost, or take a square you cannot afford, looks
   fine on a screen and is wrong; so each rule is asked both what it allows and
   what it says when it says no, because a refused action has to explain itself
   in a sentence the card can show.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import {
  createLedger,
  sheetFor,
  ownerOf,
  levelOf,
  rentAt,
  nextUpgrade,
  moneyOf,
  playerAt,
  nameOfSeat,
  canBuy,
  buy,
  canUpgrade,
  upgrade,
  rentPayer,
  payRent,
  STARTING_MONEY,
  MAX_UPGRADE,
} from "../shared/ledger.js";
import { PRICED_IDS, PRICING } from "../shared/economy.js";

/** Two players on seats 0 and 1, as the room hands them over. */
const twoPlayers = () =>
  createLedger([
    { seat: 0, name: "Sam", civ: "aztec" },
    { seat: 1, name: "Sakshi", civ: "ancient-egyptian" },
  ]);

/** One player, with as much money as a test needs. */
function solo(opening = 2000) {
  return createLedger([{ seat: 0, name: "Sam", civ: "aztec" }], { opening });
}

/* ----------------------------------------------------------------- starting */

test("both players start with two thousand", () => {
  const game = twoPlayers();
  assert.equal(STARTING_MONEY, 2000);
  assert.equal(moneyOf(game, 0), 2000);
  assert.equal(moneyOf(game, 1), 2000);
  assert.equal(playerAt(game, 0).name, "Sam");
  assert.equal(playerAt(game, 1).name, "Sakshi");
});

test("nothing is owned and nothing is built when the game opens", () => {
  const game = twoPlayers();
  for (const id of PRICED_IDS) {
    assert.equal(ownerOf(game, id), null, id);
    assert.equal(levelOf(game, id), 0, id);
    assert.equal(rentAt(game, id), PRICING[id].baseRent, id);
  }
});

test("a seat nobody is sitting in has no money and no name", () => {
  const game = twoPlayers();
  assert.equal(playerAt(game, 7), null);
  assert.equal(moneyOf(game, 7), 0);
  assert.equal(nameOfSeat(game, 7), "");
});

test("a square that is not for sale has no sheet at all", () => {
  const game = twoPlayers();
  for (const nope of ["ragnarok", "start", "black-hole", "fight", "", null, "roman"]) {
    assert.equal(sheetFor(game, nope), null, `${nope} is not for sale`);
    assert.equal(rentAt(game, nope), null);
    assert.equal(ownerOf(game, nope), null);
  }
});

/* -------------------------------------------------------------------- buying */

test("buying takes the square and the money, and nothing else", () => {
  const game = solo();
  const verdict = buy(game, "moon", 0);

  assert.equal(verdict.ok, true);
  assert.equal(verdict.spent, 200);
  assert.equal(moneyOf(game, 0), 1800);
  assert.equal(ownerOf(game, "moon"), 0);
  assert.equal(levelOf(game, "moon"), 0, "buying is not building");
  assert.equal(rentAt(game, "moon"), 20, "the rent does not change when it is bought");
});

test("a square can only be taken once", () => {
  const game = twoPlayers();
  assert.equal(buy(game, "jupiter", 0).ok, true);

  const again = buy(game, "jupiter", 1);
  assert.equal(again.ok, false);
  assert.match(again.why, /already holds/);
  assert.equal(ownerOf(game, "jupiter"), 0, "the first owner keeps it");
  assert.equal(moneyOf(game, 1), 2000, "and the second player pays nothing");
});

test("you cannot buy with money you do not have", () => {
  const game = solo(150);

  const verdict = buy(game, "moon", 0);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /need 50 more/);
  assert.equal(moneyOf(game, 0), 150, "a refused buy costs nothing");
  assert.equal(ownerOf(game, "moon"), null);
});

test("you can buy with money to the last rupee", () => {
  // Enough is enough, not more than enough.
  const game = solo(200);
  assert.equal(buy(game, "moon", 0).ok, true);
  assert.equal(moneyOf(game, 0), 0);
});

test("a square that is not for sale cannot be bought", () => {
  const game = solo();
  for (const nope of ["ragnarok", "start", "", null, 42]) {
    const verdict = buy(game, nope, 0);
    assert.equal(verdict.ok, false, `${nope} is not buyable`);
    assert.match(verdict.why, /not for sale/);
  }
});

test("a seat nobody is sitting in cannot buy anything", () => {
  const game = twoPlayers();
  const verdict = buy(game, "moon", 5);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /Nobody is sitting/);
});

/* ----------------------------------------------------------------- upgrading */

test("the three builds go on in order, and each one raises the rent", () => {
  const game = solo(5000);
  buy(game, "halleys-comet", 0);

  const seen = [rentAt(game, "halleys-comet")];
  const names = [];
  for (let n = 0; n < MAX_UPGRADE; n += 1) {
    const verdict = upgrade(game, "halleys-comet", 0);
    assert.equal(verdict.ok, true, `build ${n + 1}`);
    names.push(verdict.upgrade.name);
    seen.push(rentAt(game, "halleys-comet"));
  }

  assert.deepEqual(names, ["Tracking Array", "Comet Observatory", "Intercept Network"]);
  assert.deepEqual(seen, [50, 220, 700, 1500]);
  assert.equal(levelOf(game, "halleys-comet"), 3);
  assert.equal(moneyOf(game, 0), 5000 - 500 - 250 - 400 - 500);
});

test("the builds are offered in order, and only the next one is reachable", () => {
  const game = twoPlayers();
  buy(game, "moon", 0);

  // Out of order means out of offer: with the square bare, Lunar Colony is not
  // on the card at all - `nextUpgrade` says Lunar Outpost or nothing.
  assert.equal(nextUpgrade(game, "moon").name, "Lunar Outpost");
  assert.equal(canUpgrade(game, "moon", 0).upgrade.name, "Lunar Outpost");

  upgrade(game, "moon", 0);
  assert.equal(nextUpgrade(game, "moon").name, "Lunar Colony");

  upgrade(game, "moon", 0);
  assert.equal(nextUpgrade(game, "moon").name, "Lunar Dominion");

  upgrade(game, "moon", 0);
  assert.equal(nextUpgrade(game, "moon"), null, "a finished square offers nothing");
});

test("there is no fourth build", () => {
  const game = solo(9000);
  buy(game, "moon", 0);
  for (let n = 0; n < MAX_UPGRADE; n += 1) assert.equal(upgrade(game, "moon", 0).ok, true);

  const fourth = upgrade(game, "moon", 0);
  assert.equal(fourth.ok, false);
  assert.match(fourth.why, /as far as it goes/);
  assert.equal(levelOf(game, "moon"), 3);
  assert.equal(nextUpgrade(game, "moon"), null);
});

test("you cannot build on a square you do not hold", () => {
  const game = twoPlayers();
  buy(game, "moon", 0);

  const verdict = canUpgrade(game, "moon", 1);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /Sam holds this square/);

  const refused = upgrade(game, "moon", 1);
  assert.equal(refused.ok, false);
  assert.equal(levelOf(game, "moon"), 0);
  assert.equal(moneyOf(game, 1), 2000);
});

test("you cannot build on a square nobody holds", () => {
  const game = twoPlayers();
  const verdict = canUpgrade(game, "moon", 0);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /Nobody holds/);
});

test("you cannot build with money you do not have", () => {
  const game = solo(250);   // Moon costs 200, leaving 50; Outpost costs 100
  buy(game, "moon", 0);
  assert.equal(moneyOf(game, 0), 50);

  const verdict = canUpgrade(game, "moon", 0);
  assert.equal(verdict.ok, false);
  assert.match(verdict.why, /need 50 more/);

  assert.equal(upgrade(game, "moon", 0).ok, false);
  assert.equal(levelOf(game, "moon"), 0);
  assert.equal(moneyOf(game, 0), 50);
});

test("every property in the game can be bought and built to the top", () => {
  // The whole economy, walked once. Any square that cannot be taken, or cannot
  // be built out, fails here rather than in front of a player.
  for (const id of PRICED_IDS) {
    const game = solo(9000);
    const p = PRICING[id];

    assert.equal(buy(game, id, 0).ok, true, `${id} cannot be bought`);
    assert.equal(levelOf(game, id), 0);

    let rent = rentAt(game, id);
    assert.equal(rent, p.baseRent, `${id} bare rent`);

    for (const step of p.upgrades) {
      const verdict = upgrade(game, id, 0);
      assert.equal(verdict.ok, true, `${id} ${step.name} refused`);
      assert.equal(verdict.upgrade.name, step.name);
      assert.equal(verdict.rent, step.rentAfter, `${id} ${step.name} rent`);
      rent = rentAt(game, id);
      assert.ok(rent > 0 && Number.isInteger(rent), `${id} rent is ${rent}`);
    }

    assert.equal(levelOf(game, id), MAX_UPGRADE, `${id} build level`);
    assert.equal(rent, p.upgrades[2].rentAfter, `${id} top rent`);
    assert.ok(moneyOf(game, 0) >= 0, `${id} left the player owing money`);
  }
});

/* ---------------------------------------------------------------------- rent */

test("landing on somebody else's square pays them the rent it carries", () => {
  const game = twoPlayers();
  buy(game, "moon", 0);            // bare, 20
  upgrade(game, "moon", 0);        // Lunar Outpost, 80
  upgrade(game, "moon", 0);        // Lunar Colony, 240

  const before = { holder: moneyOf(game, 0), payer: moneyOf(game, 1) };
  const verdict = payRent(game, "moon", 1);

  assert.equal(verdict.ok, true);
  assert.equal(verdict.rent, 240);
  assert.equal(verdict.from, 1);
  assert.equal(verdict.to, 0);
  assert.equal(verdict.paid, true);
  assert.equal(moneyOf(game, 1), before.payer - 240);
  assert.equal(moneyOf(game, 0), before.holder + 240);
});

test("a rent moves money between the players and creates none", () => {
  const game = twoPlayers();
  buy(game, "moon", 0);
  upgrade(game, "moon", 0);

  const opening = moneyOf(game, 0) + moneyOf(game, 1);
  payRent(game, "moon", 1);
  payRent(game, "moon", 1);
  payRent(game, "moon", 0);   // their own square: no transfer

  assert.equal(moneyOf(game, 0) + moneyOf(game, 1), opening);
});

test("buying and building take money out of the game, into the bank", () => {
  // The other half of the ledger, and worth stating because it is the reason the
  // first test cannot simply say "the total never changes". A square somebody
  // buys is money that leaves both purses; only a rent is a transfer.
  const game = twoPlayers();
  const opening = moneyOf(game, 0) + moneyOf(game, 1);

  buy(game, "moon", 0);
  assert.equal(moneyOf(game, 0) + moneyOf(game, 1), opening - 200);

  upgrade(game, "moon", 0);
  assert.equal(moneyOf(game, 0) + moneyOf(game, 1), opening - 200 - 100);

  buy(game, "jupiter", 1);
  assert.equal(moneyOf(game, 0) + moneyOf(game, 1), opening - 200 - 100 - 350);
});

test("landing on your own square costs you nothing", () => {
  const game = twoPlayers();
  buy(game, "quasar", 0);
  upgrade(game, "quasar", 0);

  const before = moneyOf(game, 0);
  const verdict = payRent(game, "quasar", 0);

  assert.equal(verdict.ok, true, "nothing went wrong; there was simply nobody to pay");
  assert.equal(verdict.rent, 0);
  assert.equal(verdict.paid, false);
  assert.equal(moneyOf(game, 0), before);
});

test("landing on an unowned square costs you nothing", () => {
  const game = twoPlayers();
  const before = moneyOf(game, 1);
  const verdict = payRent(game, "moon", 1);

  assert.equal(verdict.ok, true);
  assert.equal(verdict.rent, 0);
  assert.equal(rentPayer(game, "moon", 1), null);
  assert.equal(moneyOf(game, 1), before);
});

test("landing on a corner or a chest costs you nothing", () => {
  const game = twoPlayers();
  for (const nope of ["ragnarok", "start", "fight", "black-hole"]) {
    const verdict = payRent(game, nope, 0);
    assert.equal(verdict.ok, true, nope);
    assert.equal(verdict.rent, 0, nope);
  }
});

test("a player is never left owing money", () => {
  const game = solo(0);
  buy(game, "moon", 0);          // -200? no: refused, because there is none
  assert.equal(moneyOf(game, 0), 0);

  // Now a landlord who cannot be paid.
  const rich = solo(5000);
  buy(rich, "quasar", 0);
  upgrade(rich, "quasar", 0);
  upgrade(rich, "quasar", 0);
  upgrade(rich, "quasar", 0);

  const broke = createLedger(
    [{ seat: 0, name: "Landlord", civ: "aztec" }, { seat: 1, name: "Broke", civ: "roma" }],
    { opening: 100000 },
  );
  // Give the landlord Quasar and leave the other player with less than the rent.
  const landlord = broke.players[0];
  landlord.money = 400;
  const sheet = sheetFor(broke, "quasar");
  sheet.owner = 0;
  sheet.upgradeLevel = 3;
  broke.players[1].money = 10;

  const verdict = payRent(broke, "quasar", 1);
  assert.equal(verdict.ok, false, "a rent nobody can pay is refused, not quietly borrowed");
  assert.match(verdict.why, /cannot pay/);
  assert.equal(moneyOf(broke, 1), 10, "and the purse is untouched");
  assert.equal(moneyOf(broke, 0), 400);
});

test("the rent charged is the rent the square carries right now", () => {
  // Earth 137 is deliberately the expensive one: a player who cannot pay its top
  // rent is refused, so this gives the payer enough to actually pay each time.
  const game = createLedger(
    [{ seat: 0, name: "Landlord", civ: "aztec" }, { seat: 1, name: "Payer", civ: "roma" }],
    { opening: 2000 },
  );
  game.players[1].money = 9000;
  buy(game, "earth-137", 0);

  const seen = [];
  for (let level = 0; level <= 3; level += 1) {
    if (level > 0) upgrade(game, "earth-137", 0);

    const before = moneyOf(game, 1);
    const verdict = payRent(game, "earth-137", 1);
    const actuallyPaid = before - moneyOf(game, 1);

    assert.equal(verdict.ok, true, `level ${level}`);
    assert.equal(verdict.rent, rentAt(game, "earth-137"), `level ${level}`);
    assert.equal(actuallyPaid, verdict.rent, `level ${level} took the right money`);
    seen.push(verdict.rent);
  }

  assert.deepEqual(seen, [75, 380, 1200, 2800]);
});