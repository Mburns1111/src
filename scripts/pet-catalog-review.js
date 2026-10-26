// Offline review report. Reads files already staged in this repository.
// Never connects to MongoDB, fetches the web, or approves/publishes a card.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => JSON.parse(readFileSync(resolve(root, "data", file), "utf8"));
const normalize = s => String(s || "").normalize("NFKD").toLowerCase()
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Apply explicit reviewer decisions without erasing original source disagreements.
// This remains an offline review report; it never authorizes a database import.
export function attachPetCatalogExceptionDecisions(report, decisions) {
  if (!decisions || !Array.isArray(decisions.rarityAdjudications) ||
      !Array.isArray(decisions.canonicalAliases) ||
      !Array.isArray(decisions.additionalOfficialPets) ||
      !Array.isArray(decisions.identityConfirmedRarityPending) || !decisions.rightsReview) {
    throw new Error("Invalid pet catalogue exception decisions");
  }
  const uniqueIds = (records, key) => {
    const ids = records.map(x => x[key]);
    if (ids.some(x => !x) || new Set(ids).size !== ids.length) {
      throw new Error("Duplicate or invalid exception decision identifier: " + key);
    }
  };
  const sourceCheck = (source, officialSource) => {
    if (!source || source !== officialSource) throw new Error("Exception official source mismatch");
  };
  uniqueIds(decisions.rarityAdjudications, "petId");
  uniqueIds(decisions.canonicalAliases, "aliasId");
  uniqueIds(decisions.canonicalAliases, "canonicalId");
  uniqueIds(decisions.additionalOfficialPets, "petId");
  uniqueIds(decisions.identityConfirmedRarityPending, "petId");

  const conflicts = new Map(report.conflicting.map(x => [x.petId, x]));
  const aliases = new Map(report.aliases.map(x => [x.petId, x]));
  const newPets = new Map(report.newOfficial.map(x => [x.petId, x]));
  const identityOnly = new Map(report.identityOnly.map(x => [x.petId, x]));
  if (conflicts.size !== decisions.rarityAdjudications.length ||
      aliases.size !== decisions.canonicalAliases.length ||
      newPets.size !== decisions.additionalOfficialPets.length ||
      identityOnly.size !== decisions.identityConfirmedRarityPending.length) {
    throw new Error("Exception decisions must account for all outstanding evidence groups");
  }

  const adjudicated = decisions.rarityAdjudications.map(x => {
    const original = conflicts.get(x.petId);
    if (!original || x.decision !== "official-rarity-selected" ||
        x.originalRarity !== original.originalRarity ||
        x.officialRarity !== original.rarity ||
        x.selectedRarity !== original.rarity ||
        !x.originalEvidenceRetained ||
        !Array.isArray(x.sourceUrls) || !x.sourceUrls.includes(original.sourceUrl)) {
      throw new Error("Invalid rarity adjudication: " + x.petId);
    }
    return { ...original, selectedRarity: x.selectedRarity,
      decision: x.decision, evidenceUrls: x.sourceUrls, historicalConflictRetained: true };
  });

  const canonicalAliases = decisions.canonicalAliases.map(x => {
    const original = aliases.get(x.aliasId);
    if (!original || x.decision !== "canonical-identity-decided" ||
        x.canonicalId !== original.canonicalId || x.rarity !== original.rarity ||
        !x.canonicalName || x.aliasId === x.canonicalId) {
      throw new Error("Invalid canonical alias decision: " + x.aliasId);
    }
    sourceCheck(x.officialSourceUrl, original.sourceUrl);
    return { ...original, canonicalName: x.canonicalName,
      decision: x.decision, duplicateEntryAllowed: false };
  });

  const stagedPets = decisions.additionalOfficialPets.map(x => {
    const original = newPets.get(x.petId);
    if (!original || x.decision !== "verified-staged-for-later-catalogue-preview" ||
        x.name !== original.name || x.rarity !== original.rarity) {
      throw new Error("Invalid official additional pet decision: " + x.petId);
    }
    sourceCheck(x.officialSourceUrl, original.sourceUrl);
    return { ...original, decision: x.decision, imported: false };
  });

  const pendingRarities = decisions.identityConfirmedRarityPending.map(x => {
    const original = identityOnly.get(x.petId);
    if (!original || x.officialRarity !== null ||
        x.decision !== "uncommon-provisional-only-official-rarity-unverified" ||
        !x.communityEvidenceUrl?.startsWith("https://") ||
        !x.communityReportedRarity) {
      throw new Error("Invalid pending official rarity decision: " + x.petId);
    }
    sourceCheck(x.officialIdentitySourceUrl, original.sourceUrl);
    return { ...original, communityReportedRarity: x.communityReportedRarity,
      communityEvidenceUrl: x.communityEvidenceUrl,
      officialRarity: null, decision: x.decision };
  });

  const rights = decisions.rightsReview;
  if (rights.decision !== "not-cleared-for-bulk-import-or-republication" ||
      rights.approvedForDatabaseImport !== false ||
      rights.approvedForArtworkUse !== false ||
      rights.requiresIndependentRightsClearance !== true ||
      !rights.officialTermsUrl?.startsWith("https://")) {
    throw new Error("Bulk data rights are not approved by exception review");
  }
  return {
    ...report,
    totals: {
      ...report.totals,
      adjudicatedRarityDisagreements: adjudicated.length,
      unresolvedRarityDisagreements: conflicts.size - adjudicated.length,
      canonicalAliasesDecided: canonicalAliases.length,
      additionalOfficialPetsStaged: stagedPets.length,
      officialRaritiesStillPendingOutsideMatchedSet: pendingRarities.length,
      bulkDataReuseCleared: false,
    },
    exceptionDecisions: { adjudicated, canonicalAliases, stagedPets, pendingRarities,
      rightsStatus: rights.decision, importPermitted: false },
  };
}

export function buildPetVerificationReport(matchedData, unmatchedData, curatedData) {
  const matched = matchedData.matched;
  const onlyA = unmatchedData.onlyAdoptmeValues;
  const onlyB = unmatchedData.onlyGamevaultFacts;
  const evidence = curatedData.records;
  if (!Array.isArray(matched) || !Array.isArray(onlyA) ||
      !Array.isArray(onlyB) || !Array.isArray(evidence)) throw new Error("Invalid review inputs");

  const matchMap = new Map(matched.map(x => [x.petId, x]));
  const aMap = new Map(onlyA.map(x => [x.petId, x]));
  const bMap = new Map(onlyB.map(x => [x.petId, x]));
  const seen = new Set();
  const verified = [], conflicting = [], newOfficial = [], communityOnly = [], aliases = [], identityOnly = [];
  for (const entry of evidence) {
    const id = normalize(entry.petId);
    if (!id || seen.has(id)) throw new Error("Duplicate or invalid evidence ID: " + id);
    seen.add(id);
    const original = matchMap.get(id) || aMap.get(id) || bMap.get(id);
    const location = matchMap.has(id) ? "matched" : aMap.has(id) ? "onlyA" :
      bMap.has(id) ? "onlyB" : "not-in-either-dataset";
    const result = {
      petId: id, name: entry.name, rarity: entry.rarity,
      originalRarity: original?.rarity || null,
      originalDatasetLocation: location, sourceUrl: entry.sourceUrl,
      sourceType: entry.sourceType, verifiedOn: entry.verifiedOn,
      ...(entry.canonicalId ? { canonicalId: entry.canonicalId } : {}),
    };
    if (!entry.sourceUrl?.startsWith("https://")) throw new Error("Missing provenance for " + id);
    if (!entry.sourceType?.startsWith("official-")) {
      communityOnly.push({ ...result, reviewStatus: "needs-authoritative-check" });
    } else if (!entry.rarity) {
      identityOnly.push({ ...result, reviewStatus: "identity-confirmed-rarity-pending" });
    } else if (original?.rarity && original.rarity !== entry.rarity) {
      conflicting.push({ ...result, reviewStatus: "rarity-conflict" });
    } else if (entry.canonicalId) {
      aliases.push({ ...result, reviewStatus: "alias-awaiting-canonical-merge" });
    } else if (location === "not-in-either-dataset") {
      newOfficial.push({ ...result, reviewStatus: "new-pet-requires-catalogue-entry" });
    } else {
      verified.push({ ...result, reviewStatus: "official-evidence-reviewed" });
    }
  }
  const confirmedUnmatched = new Set([...verified, ...aliases, ...identityOnly].filter(x =>
    x.originalDatasetLocation === "onlyA" || x.originalDatasetLocation === "onlyB").map(x => x.petId));
  const unreviewedUnmatched = [
    ...onlyA.filter(x => !confirmedUnmatched.has(x.petId)),
    ...onlyB.filter(x => !confirmedUnmatched.has(x.petId)),
  ].map(x => ({ petId: x.petId, reason: x.reviewReason || "Requires separate identity and rarity check" }));
  return {
    generatedOn: curatedData.generatedOn,
    disclaimer: "Evidence review, not licensed dataset clearance or a database import.",
    totals: {
      matchedCandidates: matched.length,
      initialUnmatched: onlyA.length + onlyB.length,
      officialEvidenceReviewed: verified.length,
      officiallyConfirmedUnmatched: confirmedUnmatched.size,
      unresolvedUnmatched: unreviewedUnmatched.length,
      rarityConflicts: conflicting.length,
      officialPetsMissingFromBothDatasets: newOfficial.length,
      communityOnlyEvidence: communityOnly.length,
      canonicalAliases: aliases.length,
      identityVerifiedButRarityPending: identityOnly.length,
      matchedRaritiesSpotChecked: verified.filter(x => x.originalDatasetLocation === "matched").length,
    },
    verified, conflicting, newOfficial, communityOnly, aliases, identityOnly, unreviewedUnmatched,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = attachPetCatalogExceptionDecisions(buildPetVerificationReport(
    read("pet-catalog-matched-candidates.json"),
    read("pet-catalog-unmatched-review.json"),
    read("pet-catalog-curated-verification.json"),
  ), read("pet-catalog-exception-decisions.json"));
  const output = resolve(root, "data", "pet-catalog-verification-report.json");
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.totals, null, 2));
  console.log("Saved " + output + " (not imported)");
}
