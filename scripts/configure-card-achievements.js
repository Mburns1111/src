import "dotenv/config";
import fs from "node:fs/promises";
import mongoose from "mongoose";
import CardRelease from "../models/CardRelease.js";
import CardDefinition from "../models/CardDefinition.js";
import {freezeAchievementRelease} from "../services/card-achievement-engine.js";
import {inspectReleaseAchievementReadiness} from "../services/card-release-achievement-readiness.js";
import {compilePrivateReleaseSecrets} from "../services/card-release-secret-authoring.js";

// Dry-run is strictly read-only. Applying freezes the private secrets and
// exact approved roster transactionally; it never starts achievements or an egg.
const [filename, ...flags] = process.argv.slice(2);
if (!filename || flags.some(flag => flag !== "--apply") || flags.length > 1)
  throw Error("Usage: node scripts/configure-card-achievements.js config.json [--apply]");
const apply = flags.includes("--apply");
const config = JSON.parse(await fs.readFile(filename, "utf8"));
if (!config.releaseId || !Array.isArray(config.secrets))
  throw Error("Expected releaseId and secrets array.");
if (!process.env.MONGODB_URI) throw Error("MONGODB_URI is required.");

async function validateConfiguration(session = null) {
  const query = CardRelease.findOne({releaseId:config.releaseId,status:"draft"});
  if (session) query.session(session);
  const release = await query;
  if (!release || release.achievementRoster?.length)
    throw Error("Only an unfrozen official draft release may be configured.");
  const cards = CardDefinition.find({releaseId:config.releaseId});
  if (session) cards.session(session);
  const definitions = await cards.lean();
  const compiled = compilePrivateReleaseSecrets(config, definitions);
  const result = inspectReleaseAchievementReadiness({
    release, definitions, secrets:compiled.secrets,
    requireFrozen:false, checkLaunchBoundary:false, requireValueReviews:false,
  });
  if (result.problems.length)
    throw Error("Secret/roster readiness failed: " + result.problems.join(" | "));
  return {release,result,compiled};
}

await mongoose.connect(process.env.MONGODB_URI);
try {
  if (!apply) {
    const {result} = await validateConfiguration();
    console.log(JSON.stringify({
      releaseId:config.releaseId,mode:"DRY RUN",privateSecretsValidated:result.releaseSecrets,
      approvedRosterCards:result.enabledRosterCount,
      reviewedValueCards:result.reviewedValueCards,
      warnings:result.warnings,
      changesMade:false,releaseRemainsDraft:true,
    },null,2));
  } else {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const {release,compiled} = await validateConfiguration(session);
        release.achievementSecrets = compiled.secrets;
        await release.validate();
        await release.save({session});
        await freezeAchievementRelease(config.releaseId,session);
      });
      console.log("Validated and froze private secrets and approved completion roster. Release remains DRAFT; no gameplay or achievements were started.");
    } finally { await session.endSession(); }
  }
} finally { await mongoose.disconnect(); }
