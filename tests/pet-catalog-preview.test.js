import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPetCatalogPreview, renderPetCatalogPreviewCsv, renderPetCatalogPreviewMarkdown,
} from "../services/pet-catalog-preview.js";

const read = name => JSON.parse(readFileSync(new URL("../data/" + name, import.meta.url), "utf8"));
const inputs = () => [
  read("pet-catalog-matched-candidates.json"),
  read("pet-catalog-unmatched-review.json"),
  read("pet-catalog-curated-verification.json"),
  read("pet-catalog-exception-decisions.json"),
  read("pet-catalog-verification-report.json"),
];
const build = () => buildPetCatalogPreview(...inputs());
const get = (preview, id) => preview.pets.find(x => x.petId === id);

test("catalogue preview has exactly one canonical record per pet and no approvals", () => {
  const preview = build();
  assert.equal(preview.summary.inputEvidenceRecords, 794);
  assert.equal(preview.summary.canonicalPets, 793);
  assert.equal(preview.summary.duplicateSourceEntriesCollapsed, 1);
  assert.equal(preview.summary.aliasesResolved, 4);
  assert.equal(preview.summary.additionalOfficialPets, 20);
  assert.equal(preview.summary.officialRarityConfirmed, 791);
  assert.equal(preview.summary.officialRarityPending, 2);
  assert.equal(preview.summary.historicalDisagreementsAdjudicated, 1);
  assert.equal(preview.summary.reviewPending, 793);
  assert.equal(preview.summary.rightsClearedForImport, false);
  assert.equal(preview.summary.databaseWritesPerformed, false);
  assert.deepEqual(preview.summary.rarityCounts, {
    Common: 59, Uncommon: 100, Rare: 157, "Ultra-Rare": 228, Legendary: 247, Unknown: 2,
  });
  assert.equal(new Set(preview.pets.map(x => x.petId)).size, preview.pets.length);
  assert.ok(preview.pets.every(x => x.reviewStatus === "pending"));
  assert.ok(preview.pets.every(x => x.officialSourceUrls.length &&
    x.officialSourceUrls.every(url => url.startsWith("https://www.playadopt.me/"))));
  assert.ok(preview.pets.every(x => !Object.hasOwn(x, "guildId") && !Object.hasOwn(x, "cardArt") &&
    !Object.hasOwn(x, "tradingValue")));
});

test("aliases consolidate one duplicate and preserve all original source identifiers", () => {
  const preview = build();
  assert.deepEqual(get(preview, "ti-de-nadal").sourceRecordIds, ["ti-de-nadal", "tio-de-nadal"]);
  assert.deepEqual(get(preview, "ti-de-nadal").aliasIds, ["tio-de-nadal"]);
  for (const [alias, canonical] of [
    ["malaysian-tapir", "malayan-tapir"], ["wooly-rhino", "woolly-rhino"],
    ["s-mores-raccoon", "smores-raccoon"], ["tio-de-nadal", "ti-de-nadal"],
  ]) {
    assert.equal(get(preview, alias), undefined, "alias must never produce second pet");
    assert.ok(get(preview, canonical).aliasIds.includes(alias), "alias must remain searchable");
  }
  const totalOriginalIds = preview.pets.reduce((sum, pet) => sum + pet.sourceRecordIds.length, 0);
  assert.equal(totalOriginalIds, 794);
});

test("adjudicated rarity is official, original value is not erased, unknown is not guessed", () => {
  const preview = build();
  const blackDog = get(preview, "the-black-dog");
  assert.equal(blackDog.rarity, "Rare");
  assert.equal(blackDog.rarityEvidence, "official-rarity-adjudicated");
  assert.deepEqual(blackDog.historicalRarityConflict, {
    provisionalRarity: "Ultra-Rare", officialRarity: "Rare", historicalConflictRetained: true,
  });
  for (const id of ["blue-cat", "pink-dog"]) {
    const pet = get(preview, id);
    assert.equal(pet.officialRarity, null);
    assert.equal(pet.rarity, "Unknown");
    assert.equal(pet.communityProvisionalRarity, "Uncommon");
    assert.equal(pet.rarityEvidence, "official-identity-only");
    assert.ok(pet.flags.includes("official-rarity-pending"));
  }
  for (const id of ["blue-dog", "pink-cat"]) {
    assert.ok(get(preview, id) && get(preview, id).officialRarity);
  }
});

test("nine Halloween pets are staged and not confused with original baseline records", () => {
  const preview = build();
  const staged = preview.pets.filter(x => x.flags.includes("new-official-pet-staged"));
  assert.deepEqual(staged.map(x => x.petId).sort(), [
    "2026-birthday-butterfly", "2d-doggy", "bobageist", "boohoo", "bubblegeist",
    "budgie-witch", "caramelgeist", "chihuahua", "copycat", "count-slothula",
    "dylan", "granny-wolf", "ms-muffet", "pistachio", "ranger-beaver",
    "river", "shoebill", "stitches", "storm-condor", "stray-cat-dragon",
  ]);
  assert.equal(get(preview, "ranger-beaver")?.rarity, "Rare");
  assert.equal(get(preview, "ranger-beaver")?.officialSourceUrls[0],
    "https://www.playadopt.me/news/journey-to-summer-camp-week-1-notes");
  assert.equal(get(preview, "dylan")?.rarity, "Uncommon");
  assert.equal(get(preview, "ms-muffet")?.rarity, "Common");
  assert.equal(get(preview, "storm-condor")?.rarity, "Ultra-Rare");
  assert.ok(staged.every(x => x.reviewStatus === "pending" &&
    x.inputCategories.length === 1 && x.inputCategories[0] === "additional-official"));
});

test("JSON, CSV and Markdown snapshots match deterministic offline generator", () => {
  const preview = build();
  assert.deepEqual(preview, read("pet-catalog-preview.json"));
  const csv = readFileSync(new URL("../data/pet-catalog-preview.csv", import.meta.url), "utf8");
  const markdown = readFileSync(new URL("../docs/pet-catalog-preview.md", import.meta.url), "utf8");
  assert.equal(renderPetCatalogPreviewCsv(preview), csv);
  assert.equal(renderPetCatalogPreviewMarkdown(preview), markdown);
  assert.equal(csv.split("\n").length - 2, 793);
  assert.match(markdown, /Internal review only/);
  assert.match(markdown, /All 793 entries remain pending staff review/);
});

test("preview refuses contradictory or missing source evidence", () => {
  const changes = [
    inputs => { inputs[2].records.pop(); },
    inputs => { inputs[2].records[0].sourceUrl = "https://unofficial.example.com/pet"; },
    inputs => { inputs[0].matched[0].rarity = "Legendary"; },
    inputs => { inputs[3].canonicalAliases[0].canonicalId = "incorrect"; },
    inputs => { inputs[3].additionalOfficialPets.push({...inputs[3].additionalOfficialPets[0]}); },
    inputs => { inputs[3].rightsReview.approvedForDatabaseImport = true; },
    inputs => { inputs[4].totals.bulkDataReuseCleared = true; },
    inputs => { inputs[4].totals.unresolvedRarityDisagreements = 1; },
  ];
  for (const change of changes) {
    const data = inputs();
    change(data);
    assert.throws(() => buildPetCatalogPreview(...data), /Pet catalogue preview:/);
  }
});
