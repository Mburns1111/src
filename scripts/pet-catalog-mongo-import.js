// Catalog import staging tool. Dry run by default and no MongoDB connection in preview mode.
// Production writes remain blocked until independent data-use approval is recorded.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { preparePetCatalogImport } from "../services/pet-catalog-import.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const load = name => JSON.parse(readFileSync(resolve(root, "data", name), "utf8"));

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
  const rows = preview.pets.map(p => ({
    petId: p.petId,
    name: p.name,
    rarity: p.officialRarity ?? "Unknown",
    availability: "unknown",
    sourceName: "Adopt Me official pet directory / release notes",
    sourceUrl: p.officialSourceUrls[0],
  }));
  const prepared = preparePetCatalogImport(rows);
  if (prepared.rejected.length || prepared.accepted.length !== preview.pets.length) {
    throw new Error("Invalid catalog rows: " + JSON.stringify(prepared.rejected.slice(0, 5)));
  }
  if (decisions?.rightsReview?.approvedForDatabaseImport !== true) {
    return { readyForImport: false, reason: "Database import rights not cleared", rows: prepared.accepted };
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
  if (!stage.readyForImport || decisions.rightsReview.approvedForDatabaseImport !== true) {
    throw new Error("MongoDB import blocked: independent source rights clearance not recorded");
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
