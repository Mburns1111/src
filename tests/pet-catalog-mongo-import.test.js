import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareReviewedCatalog } from "../scripts/pet-catalog-mongo-import.js";

const load = filename => JSON.parse(readFileSync(new URL("../data/" + filename, import.meta.url), "utf8"));

test("reviewed catalog produces exactly 799 pending import rows without guessing rarity", () => {
  const stage = prepareReviewedCatalog(load("pet-catalog-preview.json"), load("pet-catalog-exception-decisions.json"));
  assert.equal(stage.readyForImport, false);
  assert.match(stage.reason, /rights not cleared/);
  assert.equal(stage.rows.length, 799);
  assert.equal(new Set(stage.rows.map(x => x.petId)).size, 799);
  assert.ok(stage.rows.every(x => x.reviewStatus === "pending"));
  assert.deepEqual(stage.rows.filter(x => x.rarity === "Unknown").map(x => x.petId).sort(),
    ["blue-cat", "dirty-ducky", "pink-dog"]);
  assert.equal(stage.rows.find(x => x.petId === "the-black-dog").rarity, "Rare");
  assert.equal(stage.rows.filter(x => x.petId === "golden-chow-chow").length, 1);
});

test("invalid catalog cannot be staged", () => {
  const p = load("pet-catalog-preview.json"), d = load("pet-catalog-exception-decisions.json");
  p.pets.pop();
  assert.throws(() => prepareReviewedCatalog(p, d), /Invalid catalog/);
});
