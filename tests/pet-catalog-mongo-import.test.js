import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareReviewedCatalog } from "../scripts/pet-catalog-mongo-import.js";

const load = filename => JSON.parse(readFileSync(new URL("../data/" + filename, import.meta.url), "utf8"));

test("reviewed catalog produces exactly 799 pending import rows without guessing rarity", () => {
  const stage = prepareReviewedCatalog(load("pet-catalog-preview.json"), load("pet-catalog-exception-decisions.json"));
  assert.equal(stage.readyForImport, true);
  assert.equal(stage.rows.length, 799);
  assert.equal(new Set(stage.rows.map(x => x.petId)).size, 799);
  assert.ok(stage.rows.every(x => x.reviewStatus === "pending"));
  assert.deepEqual(stage.rows.filter(x => x.rarity === "Unknown").map(x => x.petId).sort(),
    ["blue-cat", "dirty-ducky", "pink-dog"]);
  const adjudicated = stage.rows.find(x => x.petId === "the-black-dog");
  assert.equal(adjudicated.rarity, "Rare");
  assert.equal(adjudicated.rarityVerification, "official-adjudicated");
  assert.equal(stage.rows.filter(x => x.petId === "golden-chow-chow").length, 1);
  const matched = stage.rows.find(x => x.petId === "2021-uplift-butterfly");
  assert.equal(matched.sources.filter(x => x.role === "candidate-dataset").length, 2);
  assert.ok(matched.sources.some(x => x.url.includes("ironbabatekkral/adoptme-values")));
  assert.ok(matched.sources.some(x => x.url.includes("gyanu1614/gamevault")));
  assert.ok(matched.sources.some(x => x.role === "official-manual-review" &&
    x.verifiedManually && x.fields.includes("rarity")));
  const extra = stage.rows.find(x => x.petId === "cake-friend");
  assert.equal(extra.sources.filter(x => x.role === "candidate-dataset").length, 0);
  assert.equal(extra.sources.filter(x => x.role === "official-manual-review").length, 1);
  const dirty = stage.rows.find(x => x.petId === "dirty-ducky");
  assert.equal(dirty.rarityVerification, "identity-only");
  assert.ok(dirty.sources.every(x => !x.fields.includes("rarity")));
  assert.ok(stage.rows.every(x => x.sources.every(y => y.url.startsWith("https://"))));
});

test("invalid catalog cannot be staged", () => {
  const p = load("pet-catalog-preview.json"), d = load("pet-catalog-exception-decisions.json");
  p.pets.pop();
  assert.throws(() => prepareReviewedCatalog(p, d), /Invalid catalog/);
});

test("scoped approval gate rejects import when owner approval is withdrawn", () => {
  const p = load("pet-catalog-preview.json");
  const d = load("pet-catalog-exception-decisions.json");
  d.factualMetadataImport.ownerApprovedForNamesAndRarities = false;
  const stage = prepareReviewedCatalog(p, d);
  assert.equal(stage.readyForImport, false);
  assert.match(stage.reason, /authorization/);
});
