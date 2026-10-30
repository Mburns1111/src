import test from "node:test";
import assert from "node:assert/strict";
import { CARD_ID_CAPACITY, encodeCardNumber, displayCardId, normalizeCardReference, upgradeLabel } from "../services/card-identifiers.js";

test("newly minted public IDs use five alphanumeric characters; old IDs remain valid", () => {
  const samples = [1, 10, 63, 64, 1000, CARD_ID_CAPACITY - 1].map(encodeCardNumber);
  assert.equal(new Set(samples).size, samples.length);
  for (const id of samples) assert.match(id, /^[0-9A-Za-z]{5}$/);
  assert.equal(displayCardId({ publicId: "A7_kQ" }), "A7_kQ");
  assert.equal(normalizeCardReference("A7_kQ"), "A7_kQ");
  assert.equal(normalizeCardReference("K-Q0i"), "K-Q0i");
  assert.throws(() => normalizeCardReference("6ae23143a5e934a8f1b42926"), /five-character/);
});
test("upgrade labels include normal neon and mega", () => {
  assert.equal(upgradeLabel("normal"), "Normal");
  assert.equal(upgradeLabel("neon"), "Neon");
  assert.equal(upgradeLabel("mega"), "Mega Neon");
});
