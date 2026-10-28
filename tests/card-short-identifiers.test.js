import test from "node:test";
import assert from "node:assert/strict";
import { CARD_ID_CAPACITY, encodeCardNumber, displayCardId, normalizeCardReference, upgradeLabel } from "../services/card-identifiers.js";

test("public card IDs use five case-sensitive characters, including letters and symbols", () => {
  assert.equal(encodeCardNumber(1), "00001");
  assert.equal(encodeCardNumber(10), "0000A");
  assert.equal(encodeCardNumber(63), "0000_");
  assert.equal(encodeCardNumber(64), "00010");
  assert.equal(encodeCardNumber(CARD_ID_CAPACITY-1), "_____");
  assert.equal(displayCardId({ publicId: "A7_kQ" }), "A7_kQ");
  assert.equal(normalizeCardReference("A7_kQ"), "A7_kQ");
  assert.equal(normalizeCardReference("a7_kq"), "a7_kq");
  assert.throws(() => normalizeCardReference("6ae23143a5e934a8f1b42926"), /five-character/);
});
test("upgrade labels include normal neon and mega", () => {
  assert.equal(upgradeLabel("normal"), "Normal");
  assert.equal(upgradeLabel("neon"), "Neon");
  assert.equal(upgradeLabel("mega"), "Mega Neon");
});
