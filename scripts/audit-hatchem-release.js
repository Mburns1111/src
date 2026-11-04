#!/usr/bin/env node
/**
 * Read-only launch audit against the database currently configured in Replit.
 *
 *   node scripts/audit-hatchem-release.js --release=s1-r1 --expected=110
 *
 * Does NOT approve images, change card states, set achievement start dates,
 * activate releases, alter Discord permissions, or publish messages.
 * Prints no tokens, Mongo URI, secret names, private criteria or Discord IDs.
 */
import "dotenv/config";
import mongoose from "mongoose";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import CardArtwork from "../models/CardArtwork.js";
import CardEggArtwork from "../models/CardEggArtwork.js";
import GuildConfig from "../models/GuildConfig.js";
import { auditHatchemRelease } from "../services/card-release-audit.js";
import { checkOfficialReleaseReadiness } from "../services/card-global-releases.js";

const args=Object.fromEntries(process.argv.slice(2).map(arg=>{
  const [key,...value]=arg.replace(/^--/,"").split("=");
  return [key,value.length?value.join("="):true];
}));
const releaseId=String(args.release || "s1-r1").trim();
const expected=Number(args.expected ?? 110);
if(!/^[a-z0-9][a-z0-9-]{1,63}$/.test(releaseId) ||
   !Number.isSafeInteger(expected) || expected<1 || expected>200)
  throw Error("Usage: node scripts/audit-hatchem-release.js --release=s1-r1 --expected=110");
if(!process.env.MONGODB_URI)throw Error("MONGODB_URI is required.");

await mongoose.connect(process.env.MONGODB_URI);
try {
  const release=await CardRelease.findOne({releaseId}).lean();
  if(!release)throw Error("Release not found in the configured MongoDB database.");
  const definitions=await CardDefinition.find({releaseId}).lean();
  const keys=[...new Set([
    ...definitions.flatMap(d=>[
      d.petArtworkKey,...Object.values(d.stagePetArtworkKeys || {}),
    ]),
    release.cardBackgroundKey,release.cardFrameKey,
    ...Object.values(release.cardRarityFrameKeys || {}),
    ...Object.values(release.cardStageOverlayKeys || {}),
  ].filter(Boolean))];
  const [artwork,egg,guilds,official]=await Promise.all([
    CardArtwork.find({key:{$in:keys}}).select("key kind artistCredit artistUrl sourceUrl licenseReviewStatus").lean(),
    CardEggArtwork.findOne({releaseId}).select("releaseId fileId licenseReviewStatus").lean(),
    GuildConfig.find({hatchemChannelId:{$ne:""},cardRoleId:{$ne:""}})
      .select("hatchemChannelId cardRoleId").limit(200).lean(),
    checkOfficialReleaseReadiness({releaseId}),
  ]);
  const date=process.env.CARD_ACHIEVEMENTS_START_AT;
  const achievementStartConfigured=Boolean(date && Number.isFinite(new Date(date).getTime()));
  const report=auditHatchemRelease({
    release, definitions, artwork, egg, guilds, expected, achievementStartConfigured,
  });
  // The official launch gate also validates the current private secret
  // criteria and image approvals. Do not print secret content.
  const allProblems=[...new Set([...report.problems,...official.problems])];
  console.log(JSON.stringify({
    ...report,
    officialReleaseGate:official.problems.length?"BLOCKED":"PASS",
    gate:allProblems.length?"NOT READY":"DATABASE GATES PASS — MANUAL DISCORD TESTS STILL REQUIRED",
    problems:allProblems,
    readOnly:true,
  },null,2));
  if(allProblems.length)process.exitCode=2;
} finally {
  await mongoose.disconnect();
}
