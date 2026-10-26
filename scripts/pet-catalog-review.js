// Offline review report. Reads files already staged in this repository.
// Never connects to MongoDB, fetches the web, or approves/publishes a card.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = file => JSON.parse(readFileSync(resolve(root, "data", file), "utf8"));
const normalize = s => String(s || "").normalize("NFKD").toLowerCase()
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

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
  const report = buildPetVerificationReport(
    read("pet-catalog-matched-candidates.json"),
    read("pet-catalog-unmatched-review.json"),
    read("pet-catalog-curated-verification.json"),
  );
  const output = resolve(root, "data", "pet-catalog-verification-report.json");
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.totals, null, 2));
  console.log("Saved " + output + " (not imported)");
}
