/**
 * Add-only import of the 20 owner-supplied Series 1 artist pet PNGs, WITHOUT
 * touching the 88 existing cards or any shared background/frame/stage artwork.
 *
 * DRY RUN (always first):
 *   node scripts/import-series1-artist-pets.js --release=s1-r1 --dir="./release one artist art"
 * APPLY (only after inspecting the dry-run):
 *   node scripts/import-series1-artist-pets.js --release=s1-r1 --dir="./release one artist art" --apply
 *
 * Every artist receives their own credit. All artwork stays needs-review,
 * and all new card definitions stay disabled/pending. No hatch/launch occurs.
 * No image resizing, clipping, alpha changes, or outline stripping.
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
import { planSeries1ArtistFiles } from "../services/card-series1-artist-pack.js";

const flags = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...parts] = arg.replace(/^--/, "").split("=");
  return [key, parts.length ? parts.join("=") : true];
}));
const releaseId = String(flags.release || "").trim();
const inputDir = path.resolve(String(flags.dir || "./release one artist art"));
const apply = flags.apply === true;
const ownerId = String(process.env.CARD_GAME_OWNER_DISCORD_ID || "").trim();
const PNG_HEADER = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

if (!isCardGameTestMode()) throw Error("This importer is dev-only; set ENABLE_CARD_GAME_TEST=1.");
if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(releaseId) || releaseId.startsWith("test-"))
  throw Error("Pass the real draft release ID, e.g. --release=s1-r1.");
if (apply && !/^\d{17,20}$/.test(ownerId))
  throw Error("CARD_GAME_OWNER_DISCORD_ID must be set to your owner account to apply.");
if (!process.env.MONGODB_URI) throw Error("MONGODB_URI is required.");

await mongoose.connect(process.env.MONGODB_URI);
try {
  const release = await CardRelease.findOne({ releaseId, status: "draft" }).lean();
  if (!release) throw Error("Release not found or no longer draft; no artwork may be staged.");
  const filenames = await fs.readdir(inputDir);
  const files = planSeries1ArtistFiles(filenames);

  const petIds = files.map(file => file.petId);
  const [catalog, priorCards, priorArt, startingCount] = await Promise.all([
    PetCatalog.find({ petId: { $in: petIds } }).select("petId name rarity").lean(),
    CardDefinition.find({ releaseId, petId: { $in: petIds } }).lean(),
    CardArtwork.find({ key: { $in: petIds.map(id => releaseId + "-pet-" + id + "-v1") } }).lean(),
    CardDefinition.countDocuments({ releaseId }),
  ]);
  const catalogMap = new Map(catalog.map(pet => [pet.petId, pet]));
  const cardsMap = new Map(priorCards.map(card => [card.petId, card]));
  const artworkMap = new Map(priorArt.map(art => [art.key, art]));
  const entries = [];

  for (const file of files) {
    const pet = catalogMap.get(file.petId);
    if (!pet || pet.name !== file.name)
      throw Error("Cannot find exact catalog identity for " + file.name + "; no changes made.");
    if (!["Common", "Uncommon", "Rare", "Ultra-Rare", "Legendary"].includes(pet.rarity))
      throw Error("Unverified rarity for " + pet.name + ".");
    const filePath = path.join(inputDir, file.filename);
    if (!(await fs.lstat(filePath)).isFile())
      throw Error("Refusing symlink or non-file: " + file.filename);
    const bytes = await fs.readFile(filePath);
    if (!bytes.length || bytes.length > CARD_ARTWORK_MAX_BYTES ||
        !bytes.subarray(0, 8).equals(PNG_HEADER))
      throw Error("Expected a PNG <=12MB: " + file.filename);
    const { width, height } = assertImageSafeToDecode(bytes);
    if (width !== 900 || height !== 1260)
      throw Error("Artwork must be 900x1260: " + file.filename + " (" + width + "x" + height + ")");
    const key = releaseId + "-pet-" + pet.petId + "-v1";
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const card = cardsMap.get(pet.petId);
    if (card && (card.enabled || card.artStatus === "approved" ||
        (card.petArtworkKey && card.petArtworkKey !== key)))
      throw Error("REFUSING to replace existing artwork/card: " + pet.name);
    const old = artworkMap.get(key);
    if (old && (old.kind !== "pet" || old.checksumSha256 !== sha256 ||
        (old.artistCredit && old.artistCredit !== file.artistCredit)))
      throw Error("Existing artwork key has different image or attribution: " + key);
    entries.push({ ...file, key, bytes, sha256, pet });
  }

  console.log(JSON.stringify({
    releaseId,
    mode: apply ? "APPLY" : "DRY RUN",
    existingReleaseCardCount: startingCount,
    artistImageCount: entries.length,
    newPetDefinitions: entries.filter(entry => !cardsMap.has(entry.petId)).length,
    projectedReleaseCardCount: startingCount + entries.filter(entry => !cardsMap.has(entry.petId)).length,
    artistCredits: Object.fromEntries([...new Set(entries.map(e => e.artistCredit))].map(name => [
      name, entries.filter(e => e.artistCredit === name).map(e => e.pet.name),
    ])),
    unchangedExistingCards: true,
    unchangedSharedLayers: true,
    artworkReview: "needs-review",
    cardStatus: "pending, disabled",
  }, null, 2));

  if (!apply) {
    console.log("No changes made. Inspect the names and run the same command with --apply to stage ONLY these 20.");
  } else {
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: CARD_ARTWORK_BUCKET });
    for (const entry of entries) {
      if (!await CardRelease.exists({ releaseId, status: "draft" }))
        throw Error("Release is no longer draft; stopping import.");
      const latest = await CardDefinition.findOne({ releaseId, petId: entry.pet.petId }).lean();
      if (latest && (latest.enabled || latest.artStatus === "approved" ||
          (latest.petArtworkKey && latest.petArtworkKey !== entry.key)))
        throw Error("Artwork ownership changed during import: " + entry.pet.name);

      if (!await CardArtwork.exists({ key: entry.key })) {
        const upload = bucket.openUploadStream(entry.key + ".png", {
          contentType: "image/png",
          metadata: { key: entry.key, kind: "pet", checksumSha256: entry.sha256, importReleaseId: releaseId },
        });
        let finished = false;
        try {
          await new Promise((resolve, reject) => {
            upload.once("error", reject);
            upload.once("finish", resolve);
            upload.end(entry.bytes);
          });
          finished = true;
          await CardArtwork.create({
            key: entry.key,
            kind: "pet",
            fileId: upload.id,
            bucket: CARD_ARTWORK_BUCKET,
            mime: "image/png",
            originalFilename: entry.filename,
            byteLength: entry.bytes.length,
            checksumSha256: entry.sha256,
            artistCredit: entry.artistCredit,
            artistUrl: entry.artistUrl,
            uploadedBy: ownerId,
            licenseReviewStatus: "needs-review",
          });
        } catch (error) {
          if (finished) { try { await bucket.delete(upload.id); } catch {} }
          else { try { await upload.abort(); } catch {} }
          throw error;
        }
      }
      await CardDefinition.updateOne(
        { releaseId, petId: entry.pet.petId },
        {
          $setOnInsert: {
            seriesId: release.seriesId,
            releaseId,
            petId: entry.pet.petId,
            rarity: entry.pet.rarity,
            hatchWeight: 1,
          },
          $set: {
            petArtworkKey: entry.key,
            artistCredit: entry.artistCredit,
            artistUrl: entry.artistUrl,
            artStatus: "pending",
            enabled: false,
          },
        },
        { upsert: true, runValidators: true },
      );
      console.log("Staged for review:", entry.pet.name, "—", entry.artistCredit);
    }
    const finalCount = await CardDefinition.countDocuments({ releaseId });
    console.log("Staged " + entries.length + " pet images. Release now has " + finalCount + " pet definitions.");
    console.log("No shared layers, approved cards, hatches, or production configuration were changed.");
    console.log("Use /cards-owner preview-art to inspect; cards remain disabled until manual approval.");
  }
} finally {
  await mongoose.disconnect();
}
