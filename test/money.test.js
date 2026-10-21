/* ==========================================================================
   ONE MONEY FORMATTER

   Every rupee figure the game draws comes through `rupees`. The check that
   matters is the one a person makes at a glance: a number of a thousand or
   more has separators in it, so ₹1,200 never reads as ₹1200.
   ========================================================================== */

import test from "node:test";
import assert from "node:assert/strict";

import { rupees } from "../shared/economy.js";

test("a rupee figure carries the sign and the thousands separators", () => {
  assert.equal(rupees(0), "₹0");
  assert.equal(rupees(200), "₹200");
  assert.equal(rupees(999), "₹999");
  assert.equal(rupees(1000), "₹1,000");
  assert.equal(rupees(1200), "₹1,200");
  assert.equal(rupees(1400), "₹1,400");
  assert.equal(rupees(7000), "₹7,000");
});

test("it is the only form: nothing asks for a bare figure", () => {
  // `rupeesBare` used to be a second formatter for places with room. It is a
  // delegate now, so there is exactly one grouping rule in the project.
  for (const n of [1000, 1200, 1400, 7000]) {
    assert.match(rupees(n), /^₹\d{1,3}(,\d{3})+$/, `${n} is grouped`);
  }
});
