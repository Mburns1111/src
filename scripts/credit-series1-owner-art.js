#!/usr/bin/env node
/**
 * Replit development-only, read-only by default:
 *
 *   node scripts/credit-series1-owner-art.js --release=s1-r1 --credit="Your artist name"
 *   node scripts/credit-series1-owner-art.js --release=s1-r1 --credit="Your artist name" --apply
 *
 * Only fills empty artistCredit on the 88 owner-drawn cards and their
 * already-assigned shared art assets. Never touches the 20 guest artists,
 * source URLs, image bytes, approval statuses, or release activation.
 */
import "dotenv/config";
import mongoose from "mongoose";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import CardArtwork from "../models/CardArtwork.js";
import { isCardGameTestMode } from "../services/card-game-mode.js";
import { planSeries1OwnerArtCredit } from "../services/card-series1-owner-credit-plan.js";

const flags = Object.fromEntries(process.argv.slice(2).map(argument => {
  const [key, ...value] = argument.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : true];
}));
const releaseId = String(flags.release || "");
const credit = String(flags.credit || "").trim();
const apply = flags.apply === true;
if (releaseId !== "s1-r1" || !credit)
  throw Error('Usage: node scripts/credit-series1-owner-art.js --release=s1-r1 --credit="Artist Name" [--apply]');
if (!isCardGameTestMode()) throw Error("Only the development bot with ENABLE_CARD_GAME_TEST=1 may run this preparation script.");
if (apply && !/^\d{17,20}$/.test(String(process.env.CARD_GAME_OWNER_DISCORD_ID || "")))
  throw Error("Owner Discord ID must be configured before any modifications.");
if (!process.env.MONGODB_URI) throw Error("MONGODB_URI required.");

await mongoose.connect(process.env.MONGODB_URI);
try {
  const release = await CardRelease.findOne({ releaseId }).lean();
  if (!release) throw Error("Release not found in the configured MongoDB database.");
  const definitions = await CardDefinition.find({ releaseId }).lean();
  const keys = [...new Set([
    ...definitions.map(card => card.petArtworkKey),
    release.cardBackgroundKey, release.cardFrameKey,
    ...Object.values(release.cardRarityFrameKeys || {}),
    ...Object.values(release.cardStageOverlayKeys || {}),
  ].filter(Boolean))];
  const artworks = await CardArtwork.find({ key: { $in: keys } })
    .select("_id key kind artistCredit artistUrl sourceUrl licenseReviewStatus").lean();
  const plan = planSeries1OwnerArtCredit({ release, definitions, artworks, credit });
  console.log(JSON.stringify({
    releaseId: plan.releaseId,
    mode: apply ? "APPLY" : "DRY RUN",
    publicCredit: plan.credit,
    ownerCards: plan.ownerCardCount,
    untouchedGuestCards: plan.importedExternalCount,
    sharedLayers: plan.sharedArtCount,
    cardCreditsToFill: plan.cardsToUpdate.length,
    assetCreditsToFill: plan.artworkToUpdate.length,
    imageBytesChanged: false,
    externalAttributionsChanged: false,
    approvalsChanged: false,
    enablementChanged: false,
  }, null, 2));

  if (apply) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (!await CardRelease.exists({ releaseId, status: "draft" }).session(session))
          throw Error("The release was changed while preparing credits.");
        if (await CardDefinition.countDocuments({ releaseId }).session(session) !== 108)
          throw Error("The Series 1 roster changed while preparing credits.");

        for (const asset of plan.artworkToUpdate) {
          const result = await CardArtwork.updateOne({
            _id: asset._id, key: asset.key, kind: asset.kind,
            licenseReviewStatus: "needs-review", artistCredit: "",
          }, { $set: { artistCredit: plan.credit } }, { session, runValidators: true });
          if (result.modifiedCount !== 1)
            throw Error("Art review status/credit changed; rolled back: " + asset.key);
        }
        for (const card of plan.cardsToUpdate) {
          const result = await CardDefinition.updateOne({
            _id: card._id, releaseId, petId: card.petId,
            artistCredit: "", enabled: false, artStatus: { $in: ["pending","missing"] },
          }, { $set: { artistCredit: plan.credit } }, { session, runValidators: true });
          if (result.modifiedCount !== 1)
            throw Error("Pet credit/status changed; rolled back: " + card.petId);
        }
      });
      console.log("Owner artist credits saved. Artwork remains pending review and no cards were enabled.");
    } finally {
      await session.endSession();
    }
  } else {
    console.log("No changes made. After confirming your preferred public credit, rerun with --apply.");
  }
} finally {
  await mongoose.disconnect();
}
