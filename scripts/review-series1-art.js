#!/usr/bin/env node
/**
 * Explicit, audit-trailed batches for the REAL 108-card Series 1 draft.
 * Dry run:
 *   node scripts/review-series1-art.js --scope=owner
 *   node scripts/review-series1-art.js --scope=artist-arial
 *   node scripts/review-series1-art.js --scope=artist-jovy
 *
 * Apply (ONLY after reviewing and documenting real ownership/permission):
 *   node scripts/review-series1-art.js --scope=owner --note="I created and authorize the 88 drawings and eight shared layers." --apply
 *
 * Scope 'owner' is Lilly's 88 pet images + 8 shared layers, while guest
 * artists are reviewed separately with truthful, artist-specific permission
 * evidence. Every newly approved asset creates an append-only audit record.
 * Image bytes, source links, rarity, weights, enabled cards, egg, achievements
 * and release status are NEVER changed by this script.
 */
import "dotenv/config";
import mongoose from "mongoose";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import CardArtwork from "../models/CardArtwork.js";
import CardArtworkReview from "../models/CardArtworkReview.js";
import { isCardGameTestMode } from "../services/card-game-mode.js";
import { planSeries1ArtworkReview } from "../services/card-series1-review-plan.js";

const args = Object.fromEntries(process.argv.slice(2).map(part => {
  const [key, ...value] = part.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : true];
}));
const scope = String(args.scope || "");
const note = String(args.note || "").trim();
const apply = args.apply === true;
const releaseId = "s1-r1";
const reviewerId = String(process.env.CARD_GAME_OWNER_DISCORD_ID || "");
if (!["owner","artist-arial","artist-jovy"].includes(scope))
  throw Error("Usage: node scripts/review-series1-art.js --scope=owner|artist-arial|artist-jovy [--note=\"permission evidence\"] [--apply]");
if (!isCardGameTestMode())
  throw Error("Batch review is a dev-only owner operation. ENABLE_CARD_GAME_TEST=1 is required.");
if (apply && (!/^\d{17,20}$/.test(reviewerId) || note.length < 20 || note.length > 1000))
  throw Error("Applying reviews requires an owner Discord ID and a truthful, specific --note= with 20–1000 characters documenting artwork ownership or artist permission.");
if (!process.env.MONGODB_URI) throw Error("MONGODB_URI required.");

await mongoose.connect(process.env.MONGODB_URI);
try {
  const release = await CardRelease.findOne({ releaseId }).lean();
  const definitions = await CardDefinition.find({ releaseId }).lean();
  const keys = [...new Set([
    ...definitions.map(card => card.petArtworkKey),
    release?.cardBackgroundKey, release?.cardFrameKey,
    ...Object.values(release?.cardRarityFrameKeys || {}),
    ...Object.values(release?.cardStageOverlayKeys || {}),
  ].filter(Boolean))];
  const artwork = await CardArtwork.find({ key: { $in: keys } })
    .select("_id key kind artistCredit artistUrl sourceUrl licenseReviewStatus").lean();
  const plan = planSeries1ArtworkReview({ release, definitions, artworks: artwork, scope });
  console.log(JSON.stringify({
    releaseId, mode: apply ? "APPLY" : "DRY RUN",
    scope, artistCredit: plan.artistCredit,
    selectedPetCards: plan.selectedCards,
    selectedArtworkAssets: plan.totalArtwork,
    assetsAwaitingApproval: plan.assetsToApprove.length,
    cardDefinitionsAwaitingApproval: plan.cardsToApprove.length,
    otherGuestArtistAssetsNotTouched: plan.guestAssetsUntouched,
    permissionEvidenceNoteSupplied: Boolean(note),
    imagesChanged: false, artistLinksChanged: false,
    cardsEnabled: false, releaseActivated: false,
  }, null, 2));

  if (!apply) {
    console.log("No changes made. Check real ownership/permission evidence before using --apply.");
  } else {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (!await CardRelease.exists({ releaseId, status:"draft" }).session(session) ||
            await CardDefinition.countDocuments({ releaseId }).session(session) !== 108)
          throw Error("Draft release roster changed before approval; nothing committed.");

        if (plan.assetsToApprove.length) {
          const timestamp = new Date();
          const updates = plan.assetsToApprove.map(asset => ({
            updateOne: {
              filter: { _id: asset._id, key: asset.key, kind: asset.kind,
                artistCredit: plan.artistCredit, licenseReviewStatus: "needs-review" },
              update: { $set: { licenseReviewStatus: "approved",
                reviewedBy: reviewerId, reviewedAt: timestamp } },
            },
          }));
          const result = await CardArtwork.bulkWrite(updates, { session, ordered: true });
          if (result.modifiedCount !== updates.length)
            throw Error("Artwork changed during approval. Transaction rolled back.");
          await CardArtworkReview.insertMany(plan.assetsToApprove.map(asset => ({
            artworkKey: asset.key, action: "approved", previousStatus: "needs-review",
            reviewerId, note,
          })), { session, ordered: true });
        }
        if (plan.cardsToApprove.length) {
          const updates = plan.cardsToApprove.map(card => ({
            updateOne: {
              filter: { _id: card._id, releaseId, petId: card.petId,
                artistCredit: plan.artistCredit, artStatus:"pending", enabled:false },
              update: { $set: { artStatus:"approved" } },
            },
          }));
          const result = await CardDefinition.bulkWrite(updates, { session, ordered:true });
          if (result.modifiedCount !== updates.length)
            throw Error("Card state changed during approval. Transaction rolled back.");
        }
      });
      console.log("Batch review recorded with per-asset audit history. No cards enabled, egg uploaded, or release activated.");
    } finally {
      await session.endSession();
    }
  }
} finally {
  await mongoose.disconnect();
}
