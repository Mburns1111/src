#!/usr/bin/env node
/**
 * Read-only by default. Enables only fully reviewed and approved Series 1 cards:
 *   node scripts/enable-series1-cards.js
 *   node scripts/enable-series1-cards.js --apply
 * Never activates the release, changes the artist/review, changes odds,
 * creates owned cards, or generates a public egg.
 */
import "dotenv/config";
import mongoose from "mongoose";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import CardArtwork from "../models/CardArtwork.js";
import { isCardGameTestMode } from "../services/card-game-mode.js";
import { planSeries1CardEnablement } from "../services/card-series1-enablement-plan.js";

const apply = process.argv.slice(2).includes("--apply");
if (process.argv.slice(2).some(arg => arg !== "--apply"))
  throw Error("Usage: node scripts/enable-series1-cards.js [--apply]");
if (!isCardGameTestMode()) throw Error("Only the development bot may prepare this draft.");
if (apply && !/^\d{17,20}$/.test(String(process.env.CARD_GAME_OWNER_DISCORD_ID || "")))
  throw Error("Configure CARD_GAME_OWNER_DISCORD_ID before applying.");
if (!process.env.MONGODB_URI) throw Error("MONGODB_URI required.");

await mongoose.connect(process.env.MONGODB_URI);
try {
  const releaseId = "s1-r1";
  const release = await CardRelease.findOne({releaseId}).lean();
  if (!release) throw Error("Official release s1-r1 not found.");
  const definitions = await CardDefinition.find({releaseId}).lean();
  const keys = [...new Set([
    ...definitions.flatMap(d => [d.petArtworkKey, ...Object.values(d.stagePetArtworkKeys || {})]),
    release.cardBackgroundKey, release.cardFrameKey,
    ...Object.values(release.cardRarityFrameKeys || {}),
    ...Object.values(release.cardStageOverlayKeys || {}),
  ].filter(Boolean))];
  const artwork = await CardArtwork.find({key:{$in:keys}})
    .select("key kind artistCredit artistUrl licenseReviewStatus").lean();
  const plan = planSeries1CardEnablement({release,definitions,artwork});
  console.log(JSON.stringify({
    releaseId, mode:apply?"APPLY":"DRY RUN",
    expectedCards:plan.cardCount,
    rarityCounts:plan.rarityCounts, ownerCards:plan.ownerCards,
    guestCards:plan.guestCards, sharedLayers:plan.sharedLayers,
    alreadyEnabled:plan.alreadyEnabled, pendingEnablement:plan.cardsToEnable.length,
    releaseRemainsDraft:true, cardRarityAndOddsUnchanged:true,
    imageAndReviewDataUnchanged:true, cardsIssued:0, publicEggsPosted:0,
  },null,2));
  if (!apply) {
    console.log("No changes made. Use --apply after checking the proposed 108-card roster.");
  } else {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const stillDraft = await CardRelease.exists({releaseId,status:"draft"}).session(session);
        if (!stillDraft || await CardDefinition.countDocuments({releaseId}).session(session) !== 108)
          throw Error("Release draft or roster changed while enabling; nothing committed.");
        if (plan.cardsToEnable.length) {
          const result = await CardDefinition.updateMany({
            releaseId, _id:{$in:plan.cardsToEnable.map(x=>x._id)},
            enabled:false, artStatus:"approved", hatchWeight:{$gt:0},
          },{$set:{enabled:true}},{session,runValidators:true});
          if (result.modifiedCount !== plan.cardsToEnable.length)
            throw Error("One or more cards changed during enablement. Transaction rolled back.");
        }
      });
      console.log("Enabled reviewed cards only. Series 1 remains DRAFT; no egg was posted or cards issued.");
    } finally { await session.endSession(); }
  }
} finally { await mongoose.disconnect(); }
