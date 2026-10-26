import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPetVerificationReport } from "../scripts/pet-catalog-review.js";

const load = name => JSON.parse(readFileSync(new URL("../data/" + name, import.meta.url), "utf8"));

test("review report preserves separation between identity matches and official rarity evidence", () => {
  const report = buildPetVerificationReport(
    load("pet-catalog-matched-candidates.json"),
    load("pet-catalog-unmatched-review.json"),
    load("pet-catalog-curated-verification.json"),
  );
  assert.equal(report.totals.matchedCandidates, 690);
  assert.equal(report.totals.initialUnmatched, 84);
  assert.equal(report.totals.officiallyConfirmedUnmatched, 7);
  assert.equal(report.totals.unresolvedUnmatched, 77);
  assert.equal(report.totals.officialPetsMissingFromBothDatasets, 9);
  assert.equal(report.totals.rarityConflicts, 0);
  assert.equal(report.verified.find(x => x.petId === "jester-dragon")?.rarity, "Legendary");
  assert.equal(report.newOfficial.find(x => x.petId === "copycat")?.rarity, "Legendary");
  assert.equal(report.communityOnly.find(x => x.petId === "wooly-rhino")?.reviewStatus, "needs-authoritative-check");
  assert.ok(!report.verified.some(x => x.petId === "wooly-rhino"));
});

test("official disagreements never silently overwrite a rarity", () => {
  const report = buildPetVerificationReport(
    { matched: [{ petId: "sample", name: "Sample", rarity: "Rare" }] },
    { onlyAdoptmeValues: [], onlyGamevaultFacts: [] },
    { generatedOn: "2026-10-26", records: [
      { petId: "sample", name: "Sample", rarity: "Legendary", sourceType: "official-test",
        sourceUrl: "https://example.com/official", verifiedOn: "2026-10-26" },
    ] },
  );
  assert.equal(report.totals.rarityConflicts, 1);
  assert.equal(report.totals.officialEvidenceReviewed, 0);
  assert.equal(report.conflicting[0].originalRarity, "Rare");
});

test("unmatched records remain in the review queue when verification is absent", () => {
  const report = buildPetVerificationReport(
    { matched: [] },
    { onlyAdoptmeValues: [{ petId: "one" }], onlyGamevaultFacts: [{ petId: "two" }] },
    { generatedOn: "2026-10-26", records: [] },
  );
  assert.equal(report.totals.initialUnmatched, 2);
  assert.equal(report.totals.unresolvedUnmatched, 2);
});

test("reject duplicate evidence records", () => {
  assert.throws(() => buildPetVerificationReport(
    { matched: [] },
    { onlyAdoptmeValues: [], onlyGamevaultFacts: [] },
    { records: [
      { petId: "cat", sourceUrl: "https://example.com", sourceType: "official-test" },
      { petId: "cat", sourceUrl: "https://example.com", sourceType: "official-test" },
    ] },
  ), /Duplicate/);
});
