/**
 * Replit-only owner import for EXTRACTED Hatchems.zip (no third-party ZIP module).
 * Dry run by default. This stages artwork on the REAL DRAFT release; it does
 * NOT approve art, enable hatches, create copies, or change Points/cooldowns.
 *
 * node scripts/import-hatchem-art-pack.js --release=s1-r1 --dir=./Hatchems
 * node scripts/import-hatchem-art-pack.js --release=s1-r1 --dir=./Hatchems --artist="Artist Name" --apply
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import mongoose from "mongoose";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import CardArtwork from "../models/CardArtwork.js";
import PetCatalog from "../models/PetCatalog.js";
import { assertImageSafeToDecode } from "../services/image-dimensions.js";
import { CARD_ARTWORK_BUCKET, CARD_ARTWORK_MAX_BYTES } from "../services/card-artwork-assets.js";
import { isCardGameTestMode } from "../services/card-game-mode.js";

const args = Object.fromEntries(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : true];
}));
const releaseId = String(args.release || "").trim();
const inputDir = path.resolve(String(args.dir || "./Hatchems"));
const apply = args.apply === true;
const artist = String(args.artist || "").trim();
const ownerId = String(process.env.CARD_GAME_OWNER_DISCORD_ID || "");
const MAX_FILES = 150;
const normalize = name => String(name).toLowerCase().normalize("NFKD")
  .replace(/[^a-z0-9]/g, "");
// Deliberate explicit filename mappings; do not guess pet IDs.
const nameAliases = Object.freeze({
  "chocolab": "Chocolate Labrador",
  "dalmation": "Dalmatian",
  "huskey": "Husky",
  "beluga": "Beluga Whale",
  "sea horse": "Seahorse",
  "ice dragon": "Frost Dragon",
});
const shared = Object.freeze({
  "01_base_background_900x1260.png": ["background", "background"],
  "common-basic.png": ["rarity", "Common"],
  "uncommon frame.png": ["rarity", "Uncommon"],
  "rare frame.png": ["rarity", "Rare"],
  "ultra rare frame.png": ["rarity", "Ultra-Rare"],
  "Leg frame.png": ["rarity", "Legendary"],
  "neon.png": ["stage", "neon"],
  "mega.png": ["stage", "mega"],
});
const ignore = new Set([
  "02_pet_artwork_734x748.png", "03_blank_rarity_900x1260.png",
  "04_blank_stage_900x1260.png",
  "05_ALIGNMENT_GUIDE_HIDE_BEFORE_EXPORT_900x1260.png", "pet.png",
]);

const keyFor = (entry) => {
  const tail = entry.kind === "pet" ? "pet-" + entry.pet.petId :
    entry.kind === "background" ? "background" :
      entry.kind === "rarity" ? "rarity-" + normalize(entry.slot) : "stage-" + entry.slot;
  const key = releaseId + "-" + tail + "-v1";
  if (!/^[a-z0-9_-]{3,64}$/.test(key)) throw Error("Artwork key is too long: " + key);
  return key;
};
const originalKind = entry => entry.kind === "pet" ? "pet" :
  entry.kind === "background" ? "background" : "frame";

async function preflight(catalog) {
  const filenames = (await fs.readdir(inputDir)).filter(name => name.toLowerCase().endsWith(".png"));
  if (!filenames.length || filenames.length > MAX_FILES) throw Error("Expected 1–150 PNGs in the extracted Hatchems directory.");
  const unique = new Map();
  for (const pet of catalog) {
    const norm = normalize(pet.name);
    if (!unique.has(norm)) unique.set(norm, []);
    unique.get(norm).push(pet);
  }
  const entries = [];
  for (const filename of filenames) {
    if (ignore.has(filename)) continue;
    const filePath = path.join(inputDir, filename);
    if (!(await fs.lstat(filePath)).isFile()) throw Error("Import refuses symlinks/non-files: " + filename);
    const meta = shared[filename];
    let entry;
    if (meta) entry = { filename, filePath, kind: meta[0], slot: meta[1] };
    else {
      const stem = filename.replace(/\.png$/i, "");
      const mapped = nameAliases[stem.toLowerCase()] || stem;
      const matches = unique.get(normalize(mapped)) || [];
      if (matches.length !== 1) throw Error("Cannot match pet artwork exactly: " + filename + " (" + matches.length + " catalog matches).");
      const pet = matches[0];
      if (!["Common","Uncommon","Rare","Ultra-Rare","Legendary"].includes(pet.rarity))
        throw Error("Cannot import unverified rarity for " + pet.name);
      entry = { filename, filePath, kind: "pet", slot: pet.petId, pet };
    }
    const bytes = await fs.readFile(filePath);
    if (!bytes.length || bytes.length > CARD_ARTWORK_MAX_BYTES ||
        !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      throw Error("Each artwork must be a PNG up to 12MB: " + filename);
    const dims = assertImageSafeToDecode(bytes);
    const sizeIsCard = dims.width === 900 && dims.height === 1260;
    const sizeIsPetWindow = dims.width === 734 && dims.height === 748;
    if (!sizeIsCard && !(entry.kind === "pet" && sizeIsPetWindow))
      throw Error("Wrong artwork dimensions in " + filename + ": " + dims.width + "×" + dims.height);
    entry.bytes = bytes;
    entry.sha256 = createHash("sha256").update(bytes).digest("hex");
    entry.key = keyFor(entry);
    entries.push(entry);
  }
  if (new Set(entries.map(e => e.key)).size !== entries.length) throw Error("Duplicate artwork keys; check filenames.");
  const counts = { pets: entries.filter(e=>e.kind==="pet").length,
    backgrounds: entries.filter(e=>e.kind==="background").length,
    rarityFrames: entries.filter(e=>e.kind==="rarity").length,
    stageOverlays: entries.filter(e=>e.kind==="stage").length };
  return { entries, counts };
}

async function store(entry) {
  const existing = await CardArtwork.findOne({ key: entry.key }).lean();
  if (existing) {
    if (existing.kind !== originalKind(entry) ||
        (existing.checksumSha256 && existing.checksumSha256 !== entry.sha256))
      throw Error("Existing artwork key refers to a different file: " + entry.key);
    console.log("Already uploaded:", entry.key);
    return;
  }
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: CARD_ARTWORK_BUCKET });
  const upload = bucket.openUploadStream(entry.key + ".png", {
    contentType:"image/png", metadata:{ key:entry.key, kind:originalKind(entry),
      checksumSha256:entry.sha256, importReleaseId:releaseId },
  });
  let finished = false;
  try {
    await new Promise((resolve,reject)=>{
      upload.once("error",reject); upload.once("finish",resolve); upload.end(entry.bytes);
    });
    finished = true;
    await CardArtwork.create({
      key:entry.key,kind:originalKind(entry),fileId:upload.id,
      bucket:CARD_ARTWORK_BUCKET,mime:"image/png",
      originalFilename:entry.filename, byteLength:entry.bytes.length,
      checksumSha256:entry.sha256,artistCredit:entry.kind==="pet"?artist:"",
      uploadedBy:ownerId,licenseReviewStatus:"needs-review",
    });
    console.log("Uploaded, awaiting review:",entry.key);
  } catch (error) {
    if (finished) { try { await bucket.delete(upload.id); } catch {} }
    else { try { await upload.abort(); } catch {} }
    throw error;
  }
}

async function assign(release, entry) {
  if (entry.kind === "pet") {
    const card = await CardDefinition.findOne({ releaseId, petId: entry.pet.petId });
    if (card?.enabled || card?.artStatus === "approved")
      throw Error("Refusing to replace enabled/approved card: " + entry.pet.name);
    if (card?.petArtworkKey && card.petArtworkKey !== entry.key)
      throw Error("Pet already has different artwork; use a reviewed new version: " + entry.pet.name);
    await CardDefinition.updateOne({ releaseId, petId:entry.pet.petId },
      { $setOnInsert:{ seriesId:release.seriesId,releaseId,
          petId:entry.pet.petId,rarity:entry.pet.rarity,hatchWeight:1 },
        $set:{ petArtworkKey:entry.key,artistCredit:artist,artStatus:"pending",enabled:false } },
      { upsert:true,runValidators:true });
    return;
  }
  const dotPath = entry.kind === "background" ? "cardBackgroundKey" :
    entry.kind === "rarity" ? "cardRarityFrameKeys."+entry.slot :
      "cardStageOverlayKeys."+entry.slot;
  const current = release.get(dotPath) || "";
  if (current && current !== entry.key) throw Error("Release already uses a different "+dotPath+"; manual review required.");
  if (current !== entry.key) {
    release.set(dotPath, entry.key);
    await release.save();
  }
}

if (!isCardGameTestMode()) throw Error("Import requires ENABLE_CARD_GAME_TEST=1 (dev only).");
if (!releaseId || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(releaseId) || releaseId.startsWith("test-"))
  throw Error("Use --release= with the REAL DRAFT release ID (not test-*).");
if (apply && !/^\d{17,20}$/.test(ownerId))
  throw Error("Set CARD_GAME_OWNER_DISCORD_ID before applying the import.");

if (!process.env.MONGODB_URI) throw Error("MONGODB_URI required.");
await mongoose.connect(process.env.MONGODB_URI);
try {
  const release = await CardRelease.findOne({ releaseId, status:"draft" });
  if (!release) throw Error("Real draft release not found. Create it first; active releases cannot be imported into.");
  const catalog = await PetCatalog.find({}).select("petId name rarity").lean();
  const { entries, counts } = await preflight(catalog);
  const knownPetIds = await CardDefinition.distinct("petId", { releaseId });
  const supplied = new Set(entries.filter(e=>e.kind==="pet").map(e=>e.pet.petId));
  const withoutArtwork = knownPetIds.filter(id=>!supplied.has(id));
  console.log(JSON.stringify({ releaseId, mode:apply?"APPLY":"DRY RUN",
    ...counts, missingFromZip:withoutArtwork, provisional:true,
    sourceReview:"NEEDS REVIEW, never auto-approved", artist:artist||"pending" },null,2));
  if (!apply) {
    console.log("No changes made. To stage the assets, rerun with --apply after reviewing the list.");
  } else {
    // Prevalidate all collisions BEFORE the first write.
    const keys = entries.map(e=>e.key);
    const existing = await CardArtwork.find({ key: { $in:keys } }).lean();
    for (const art of existing) {
      const entry = entries.find(e=>e.key===art.key);
      if (art.kind!==originalKind(entry) ||
          (art.checksumSha256 && art.checksumSha256!==entry.sha256))
        throw Error("Conflicting stored artwork: "+art.key);
    }
    const definitions = await CardDefinition.find({releaseId}).lean();
    for (const card of definitions.filter(c=>supplied.has(c.petId))) {
      const corresponding = entries.find(e=>e.pet?.petId===card.petId);
      if (card.enabled || card.artStatus==="approved" ||
          (card.petArtworkKey && card.petArtworkKey!==corresponding.key))
        throw Error("Would overwrite an existing card: "+card.petId);
    }
    for (const entry of entries.filter(e=>e.kind!=="pet")) {
      const dot = entry.kind==="background" ? "cardBackgroundKey" :
        entry.kind==="rarity" ? "cardRarityFrameKeys."+entry.slot :
          "cardStageOverlayKeys."+entry.slot;
      const old = release.get(dot);
      if (old && old!==entry.key) throw Error("Would overwrite a release art slot: "+dot);
    }
    // Safe to resume after interruptions; distinct GridFS assets are immutable.
    for (const entry of entries) {
      await store(entry);
      await assign(release, entry);
    }
    console.log("Artwork staged on draft. Nothing was enabled or launched.");
    console.log("Check /cards-owner preview-art and /cards-owner preview-drop in Discord.");
  }
} finally {
  await mongoose.disconnect();
}
