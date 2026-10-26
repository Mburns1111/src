import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPetVerificationReport, attachPetCatalogExceptionDecisions } from "../scripts/pet-catalog-review.js";

const load = name => JSON.parse(readFileSync(new URL("../data/" + name, import.meta.url), "utf8"));

test("review report preserves separation between identity matches and official rarity evidence", () => {
  const report = attachPetCatalogExceptionDecisions(buildPetVerificationReport(
    load("pet-catalog-matched-candidates.json"),
    load("pet-catalog-unmatched-review.json"),
    load("pet-catalog-curated-verification.json"),
  ), load("pet-catalog-exception-decisions.json"));
  assert.equal(report.totals.matchedCandidates, 690);
  assert.equal(report.totals.initialUnmatched, 84);
  assert.equal(report.totals.officiallyConfirmedUnmatched, 84);
  assert.equal(report.totals.unresolvedUnmatched, 0);
  assert.equal(report.totals.officialPetsMissingFromBothDatasets, 9);
  assert.equal(report.totals.canonicalAliases, 4);
  assert.equal(report.totals.identityVerifiedButRarityPending, 2);
  assert.equal(report.totals.matchedRaritiesSpotChecked, 689);
  assert.equal(report.unreviewedUnmatched.length, 0);
  assert.equal(report.aliases.find(x => x.petId === 's-mores-raccoon')?.canonicalId, 'smores-raccoon');
  assert.equal(report.totals.rarityConflicts, 1);
  assert.equal(report.totals.adjudicatedRarityDisagreements, 1);
  assert.equal(report.totals.unresolvedRarityDisagreements, 0);
  assert.equal(report.totals.canonicalAliasesDecided, 4);
  assert.equal(report.totals.additionalOfficialPetsStaged, 9);
  assert.equal(report.totals.officialRaritiesStillPendingOutsideMatchedSet, 2);
  assert.equal(report.totals.bulkDataReuseCleared, false);
  assert.equal(report.exceptionDecisions.importPermitted, false);
  assert.equal(report.exceptionDecisions.adjudicated[0].selectedRarity, "Rare");
  assert.equal(report.exceptionDecisions.adjudicated[0].originalRarity, "Ultra-Rare");
  assert.equal(report.exceptionDecisions.adjudicated[0].historicalConflictRetained, true);
  assert.equal(report.exceptionDecisions.stagedPets.length, 9);
  assert.ok(report.exceptionDecisions.stagedPets.every(x => x.imported === false));
  assert.equal(report.exceptionDecisions.pendingRarities.length, 2);
  assert.ok(report.exceptionDecisions.pendingRarities.every(x =>
    x.officialRarity === null && x.communityReportedRarity === "Uncommon"));
  assert.equal(report.exceptionDecisions.canonicalAliases.find(x =>
    x.petId === "tio-de-nadal")?.canonicalId, "ti-de-nadal");
  assert.ok(report.exceptionDecisions.canonicalAliases.every(x => !x.duplicateEntryAllowed));

  assert.equal(report.verified.find(x => x.petId === "apple-owl")?.rarity, "Legendary");
  assert.equal(report.verified.find(x => x.petId === "brown-chested-pheasant")?.rarity, "Ultra-Rare");
  assert.ok(report.verified.some(x => x.petId === "astronaut-gorilla"));
  assert.equal(report.verified.find(x => x.petId === "crow")?.rarity, "Legendary");
  assert.equal(report.verified.find(x => x.petId === "crocodile")?.rarity, "Ultra-Rare");
  assert.equal(report.verified.find(x => x.petId === "evil-unicorn")?.rarity, "Legendary");
  assert.equal(report.verified.find(x => x.petId === "frog")?.rarity, "Ultra-Rare");
  assert.equal(report.verified.find(x => x.petId === "golden-jaguar")?.rarity, "Ultra-Rare");
  assert.equal(report.verified.find(x => x.petId === "giant-panda")?.rarity, "Legendary");
  assert.equal(report.verified.find(x => x.petId === "green-amazon")?.rarity, "Ultra-Rare");
  assert.equal(report.verified.find(x => x.petId === "haetae")?.rarity, "Legendary");
  assert.equal(report.verified.find(x => x.petId === "hydra")?.rarity, "Ultra-Rare");
  assert.equal(report.verified.find(x => x.petId === "lion")?.rarity, "Ultra-Rare");
  assert.equal(report.verified.find(x => x.petId === "lunar-ox")?.rarity, "Ultra-Rare");
  assert.equal(report.verified.find(x => x.petId === "manta-ray")?.rarity, "Ultra-Rare");
  assert.equal(report.verified.find(x => x.petId === "naga-dragon")?.rarity, "Legendary");
  assert.equal(report.verified.find(x => x.petId === "kelp-captain")?.rarity, "Legendary");
  assert.equal(report.verified.find(x => x.petId === "orca")?.rarity, "Ultra-Rare");
  assert.equal(report.verified.find(x => x.petId === "quetzalcoatl")?.rarity, "Legendary");
  assert.equal(report.verified.find(x => x.petId === "astronaut-gorilla")?.rarity, "Legendary");
  assert.equal(report.verified.find(x => x.petId === "field-mouse")?.rarity, "Legendary");
  assert.equal(report.verified.find(x => x.petId === "pangolin")?.rarity, "Ultra-Rare");
  assert.equal(report.verified.find(x => x.petId === "jester-dragon")?.rarity, "Legendary");
  assert.equal(report.newOfficial.find(x => x.petId === "copycat")?.rarity, "Legendary");
  assert.equal(report.aliases.find(x => x.petId === "wooly-rhino")?.canonicalId, "woolly-rhino");
  assert.equal(report.identityOnly.find(x => x.petId === "blue-cat")?.rarity, null);
  assert.equal(report.conflicting.length, 1);
  assert.deepEqual(
    { rarity: report.conflicting[0].rarity, originalRarity: report.conflicting[0].originalRarity, petId: report.conflicting[0].petId },
    { rarity: "Rare", originalRarity: "Ultra-Rare", petId: "the-black-dog" },
  );
  assert.equal(report.conflicting[0].sourceUrl, "https://www.playadopt.me/discover/pets/the-black-dog");
  assert.equal(report.verified.find(x => x.petId === "2021-uplift-butterfly")?.rarity, "Uncommon");
  assert.equal(report.verified.find(x => x.petId === "abyssinian-cat")?.rarity, "Rare");
  assert.equal(report.verified.find(x => x.petId === "angelfish")?.rarity, "Common");
  assert.equal(report.verified.find(x => x.petId === "black-tiger")?.sourceType, "official-adopt-me-news");
  assert.equal(report.verified.find(x => x.petId === "chocolate-labrador")?.rarity, "Uncommon");
  assert.equal(report.verified.find(x => x.petId === "clover-cow")?.rarity, "Rare");
  assert.equal(report.verified.find(x => x.petId === "cockroach")?.rarity, "Common");
  assert.equal(report.verified.find(x => x.petId === "crab")?.rarity, "Uncommon");
  assert.equal(report.verified.find(x => x.petId === "elephant")?.rarity, "Rare");
  assert.equal(report.verified.find(x => x.petId === "halloween-white-mummy-cat")?.rarity, "Rare");
  assert.equal(report.verified.find(x => x.petId === "husky")?.rarity, "Rare");

  assert.equal(report.verified.find(x => x.petId === "hyena")?.rarity, "Rare");
  assert.equal(report.verified.find(x => x.petId === "island-tarsier")?.rarity, "Common");
  assert.equal(report.verified.find(x => x.petId === "island-tarsier")?.sourceType, "official-adopt-me-news");
  assert.equal(report.verified.find(x => x.petId === "kakapo")?.rarity, "Uncommon");
  assert.equal(report.verified.find(x => x.petId === "mecha-r4bbit")?.rarity, "Rare");
  assert.equal(report.verified.find(x => x.petId === "moonpine")?.rarity, "Rare");
  assert.equal(report.verified.find(x => x.petId === "patchy-bear")?.rarity, "Uncommon");
  assert.equal(report.verified.find(x => x.petId === "pig")?.rarity, "Rare");
  assert.equal(report.verified.find(x => x.petId === "pink-cat")?.rarity, "Uncommon");
  assert.equal(report.verified.find(x => x.petId === "piranha")?.rarity, "Common");
  assert.equal(report.verified.find(x => x.petId === "scarecrow")?.rarity, "Uncommon");
  assert.equal(report.verified.find(x => x.petId === "sneak-weasel")?.rarity, "Rare");
  assert.equal(report.verified.find(x => x.petId === "tarsier")?.rarity, "Rare");
  assert.equal(report.verified.find(x => x.petId === "warthog")?.rarity, "Uncommon");
  assert.equal(report.verified.find(x => x.petId === "winter-fawn")?.rarity, "Rare");
  assert.equal(report.verified.find(x => x.petId === "wolf")?.rarity, "Uncommon");
  assert.equal(report.verified.find(x => x.petId === "wolpertinger")?.rarity, "Common");
  assert.equal(report.verified.find(x => x.petId === "zombie-chick")?.rarity, "Rare");
  const verifiedMatchedByRarity = report.verified.filter(x => x.originalDatasetLocation === "matched")
    .reduce((counts, x) => (counts[x.rarity] = (counts[x.rarity] ?? 0) + 1, counts), {});
  assert.deepEqual(verifiedMatchedByRarity, {
    Uncommon: 87, Rare: 136, Common: 51, Legendary: 213, "Ultra-Rare": 202,
  });

  const matched = load("pet-catalog-matched-candidates.json").matched;
  const priority = matched.filter(x => x.rarity === "Legendary" || x.rarity === "Ultra-Rare");
  assert.equal(priority.length, 416);
  const reviewed = new Set([...report.verified, ...report.conflicting].filter(x =>
    x.originalDatasetLocation === "matched").map(x => x.petId));
  assert.ok(priority.every(x => reviewed.has(x.petId)), "all high-rarity candidate identities have official evidence");
  assert.equal(reviewed.size, matched.length, "every original matched pet has an official rarity review");
  assert.ok(matched.every(x => reviewed.has(x.petId)), "no unmatched rarity records remain");
  assert.equal(report.totals.matchedRaritiesSpotChecked + report.totals.rarityConflicts, matched.length);
  assert.equal(report.totals.officialEvidenceReviewed, 767);

  assert.equal(matched.length - report.totals.matchedRaritiesSpotChecked - report.totals.rarityConflicts, 0);
  assert.deepEqual(report, load("pet-catalog-verification-report.json"), "generated report must remain synchronized");
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

test("official name-only evidence does not approve a rarity", () => {
  const report = buildPetVerificationReport(
    { matched: [] },
    { onlyAdoptmeValues: [], onlyGamevaultFacts: [{ petId: "blue-cat" }] },
    { records: [{ petId: "blue-cat", name: "Blue Cat", rarity: null,
      sourceType: "official-adopt-me-news", sourceUrl: "https://www.playadopt.me/news/cat-cafe-notes" }] },
  );
  assert.equal(report.totals.identityVerifiedButRarityPending, 1);
  assert.equal(report.totals.officiallyConfirmedUnmatched, 1);
  assert.equal(report.verified.length, 0);
});

test("exception review rejects altered rarity adjudication or import approval", () => {
  const raw = buildPetVerificationReport(
    load("pet-catalog-matched-candidates.json"),
    load("pet-catalog-unmatched-review.json"),
    load("pet-catalog-curated-verification.json"),
  );
  const cases = [
    decisions => { decisions.rarityAdjudications[0].selectedRarity = "Ultra-Rare"; },
    decisions => { decisions.canonicalAliases[0].canonicalId = "wrong-pet"; },
    decisions => { decisions.canonicalAliases.push({ ...decisions.canonicalAliases[0] }); },
    decisions => { decisions.additionalOfficialPets[0].rarity = "Common"; },
    decisions => { decisions.identityConfirmedRarityPending[0].officialRarity = "Uncommon"; },
    decisions => { decisions.rightsReview.approvedForDatabaseImport = true; },
    decisions => { decisions.rightsReview.approvedForArtworkUse = true; },
  ];
  for (const tamper of cases) {
    const decisions = load("pet-catalog-exception-decisions.json");
    tamper(decisions);
    assert.throws(() => attachPetCatalogExceptionDecisions(raw, decisions));
  }
});

test("review records exact official evidence and keeps unapproved candidates separate", () => {
  const decisions = load("pet-catalog-exception-decisions.json");
  const candidates = load("pet-catalog-matched-candidates.json").matched;
  const initialUnmatched = load("pet-catalog-unmatched-review.json");
  const knownIds = new Set([
    ...candidates.map(x => x.petId),
    ...initialUnmatched.onlyAdoptmeValues.map(x => x.petId),
    ...initialUnmatched.onlyGamevaultFacts.map(x => x.petId),
  ]);
  for (const added of decisions.additionalOfficialPets) {
    assert.ok(!knownIds.has(added.petId), added.petId + " must not duplicate the original sources");
    assert.match(added.officialSourceUrl, /^https:\/\/www\.playadopt\.me\/news\//);
  }
  assert.equal(new Set(decisions.additionalOfficialPets.map(x => x.petId)).size, 9);
  assert.equal(new Set(decisions.canonicalAliases.map(x => x.canonicalId)).size, 4);
  for (const alias of decisions.canonicalAliases) {
    assert.notEqual(alias.aliasId, alias.canonicalId);
    assert.equal(alias.officialSourceUrl, "https://www.playadopt.me/discover/pets/" + alias.canonicalId);
  }
  assert.equal(decisions.rightsReview.approvedForDatabaseImport, false);
  assert.equal(decisions.rightsReview.approvedForArtworkUse, false);
});
