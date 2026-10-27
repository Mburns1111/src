// Catalog import staging tool. Dry run by default and no MongoDB connection in preview mode.
// Production writes remain blocked until independent data-use approval is recorded.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { preparePetCatalogImport } from "../services/pet-catalog-import.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = name => JSON.parse(readFileSync(resolve(root, "data", name), "utf8"));
const GITHUB_VALUES = "https://github.com/ironbabatekkral/adoptme-values/blob/main/adoptme_values.json";
const GITHUB_FACTS = "https://github.com/gyanu1614/gamevault/blob/main/scripts/values-seeds/adopt-me.facts.json";
function petSources(pet) {
  const categories = new Set(pet.inputCategories);
  const sources = [];
  const add = (name, url, role, fields, verifiedManually, checkedAt = null) =>
    sources.push({ name, url, role, fields, verifiedManually, checkedAt });
  if (categories.has("matched") || categories.has("only-adoptme-values"))
    add("adoptme-values (GitHub candidate)", GITHUB_VALUES, "candidate-dataset", ["name", "rarity"], false);
  if (categories.has("matched") || categories.has("only-gamevault"))
    add("gamevault (GitHub candidate)", GITHUB_FACTS, "candidate-dataset", ["identity"], false);
  for (const url of pet.officialSourceUrls) {
    add("Adopt Me (manual official verification)", url, "official-manual-review",
      pet.officialRarity == null ? ["identity"] : ["name", "rarity"], true, pet.verifiedOn || null);
  }
  return sources;
}


export function prepareReviewedCatalog(preview, decisions) {
  if (!Array.isArray(preview?.pets) || preview.summary?.canonicalPets !== preview.pets.length) {
    throw new Error("Invalid catalog preview");
  }
  if (preview.pets.length !== 799 || preview.summary.officialRarityPending !== 3) {
    throw new Error("Expected reviewed 799-pet preview, including three Unknown rarities");
  }
  if (!preview.pets.every(p => p.reviewStatus === "pending" && p.officialSourceUrls?.length)) {
    throw new Error("Missing review or provenance metadata");
  }

  const prepared = preparePetCatalogImport(preview.pets.map(p => ({
    petId: p.petId, name: p.name, rarity: p.officialRarity ?? "Unknown", availability: "unknown",
  })));
  if (prepared.rejected.length) {
    throw new Error("Invalid rows: " + JSON.stringify(prepared.rejected.slice(0, 5)));
  }
  for (let i = 0; i < preview.pets.length; i++) {
    const pet = preview.pets[i];
    prepared.accepted[i].sources = petSources(pet);
    prepared.accepted[i].rarityVerification = pet.officialRarity == null ? "identity-only" :
      pet.rarityEvidence === "official-rarity-adjudicated" ? "official-adjudicated" : "official-verified";
  }
  if (prepared.rejected.length || prepared.accepted.length !== preview.pets.length) {
    throw new Error("Invalid catalog rows: " + JSON.stringify(prepared.rejected.slice(0, 5)));
  }
  const approval = decisions?.factualMetadataImport;
  if (!approval?.ownerApprovedForNamesAndRarities ||
      approval.sourceAttributionRequired !== true ||
      approval.officialManualEvidenceRequired !== true ||
      approval.defaultReviewStatus !== "pending" ||
      !["petId", "name", "rarity", "sources", "rarityVerification", "reviewStatus"].every(x => approval.scope?.includes(x))) {
    return { readyForImport: false, reason: "Factual metadata authorization is missing", rows: prepared.accepted };
  }
  return { readyForImport: true, rows: prepared.accepted };
}

const preview = load("pet-catalog-preview.json");
const decisions = load("pet-catalog-exception-decisions.json");
const stage = prepareReviewedCatalog(preview, decisions);
console.log(JSON.stringify({
  mode: process.argv.includes("--apply") ? "apply-requested" : "dry-run",
  pets: stage.rows.length,
  unknownRarities: stage.rows.filter(x => x.rarity === "Unknown").length,
  reviewStatus: "pending",
  readyForImport: stage.readyForImport,
  blocker: stage.reason ?? null,
}, null, 2));

if (process.argv.includes("--apply")) {
  if (!stage.readyForImport) {
    throw new Error("MongoDB import blocked: scoped factual metadata approval missing");
  }
  if (process.env.PET_CATALOG_IMPORT_APPROVED !== "YES") {
    throw new Error("Explicit PET_CATALOG_IMPORT_APPROVED=YES required");
  }
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  const mongoose = (await import("mongoose")).default;
  const PetCatalog = (await import("../models/PetCatalog.js")).default;
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    const ops = stage.rows.map(({ petId, ...data }) => ({
      updateOne: { filter: { petId }, update: { $setOnInsert: { petId, ...data } }, upsert: true },
    }));
    const result = await PetCatalog.bulkWrite(ops, { ordered: true });
    console.log(JSON.stringify({
      inserted: result.upsertedCount,
      alreadyPresentUnchanged: result.matchedCount,
      total: stage.rows.length,
    }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
} else {
  console.log("Dry run only: did not connect to or change MongoDB.");
}
