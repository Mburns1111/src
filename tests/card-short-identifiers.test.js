import test from "node:test";
import assert from "node:assert/strict";
import { displayCardId, normalizeCardReference, upgradeLabel } from "../services/card-identifiers.js";
test("short card reference displays 12 hex characters from existing full id", () => {
  assert.equal(displayCardId("6ae23143a5e934a8f1b42926"), "34a8f1b42926");
  assert.equal(normalizeCardReference("34A8F1B42926"), "34a8f1b42926");
  assert.equal(normalizeCardReference("6ae23143a5e934a8f1b42926"), "6ae23143a5e934a8f1b42926");
  assert.throws(() => normalizeCardReference("too-short"), /12-character/);
});
test("upgrade labels include normal neon and mega", () => {
  assert.equal(upgradeLabel("normal"), "Normal");
  assert.equal(upgradeLabel("neon"), "Neon");
  assert.equal(upgradeLabel("mega"), "Mega Neon");
});
