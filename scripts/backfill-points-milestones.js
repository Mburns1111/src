import "dotenv/config";
import mongoose from "mongoose";
import MemberDmPanel from "../models/MemberDmPanel.js";
import UserProfile from "../models/UserProfile.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";
import TradeListing from "../models/TradeListing.js";
import TradingPost from "../models/TradingPost.js";
import { backfillMilestones } from "../services/points-backfill.js";

// Usage (development database recommended):
//  DISCORD_GUILD_ID=... MONGODB_URI=... node scripts/backfill-points-milestones.js
// Explicit --apply is required to credit Points. No Discord token or gateway
// access required. Run only after confirming the connected database + guild.
const guildId = process.env.DISCORD_GUILD_ID;
const uri = process.env.MONGODB_URI;
const apply = process.argv.includes("--apply");
if (!guildId || !uri) {
  console.error("Set DISCORD_GUILD_ID and MONGODB_URI. No changes made.");
  process.exitCode = 1;
} else {
  try {
    await mongoose.connect(uri);
    const [profiles, shops, houses, outfits, trades, posts] = await Promise.all([
      UserProfile.distinct("discordUserId", { guildId }),
      MemberDmPanel.distinct("discordUserId", { guildId, kind: "shop" }),
      HouseListing.distinct("ownerId", { guildId }),
      OutfitListing.distinct("ownerId", { guildId }),
      TradeListing.distinct("ownerId", { guildId }),
      TradingPost.distinct("ownerId", { guildId }),
    ]);
    const members = [...new Set([...profiles, ...shops, ...houses, ...outfits, ...trades, ...posts])]
      .filter(id => /^\d{17,21}$/.test(id)).sort();
    console.log(`[Points backfill] ${apply ? "APPLY" : "DRY RUN"} · guild ${guildId} · ${members.length} potential members`);
    let eligible = 0, credited = 0, total = 0, failed = 0;
    for (const memberId of members) {
      try {
        const report = await backfillMilestones(guildId, memberId, { apply });
        eligible += report.pending.length;
        credited += report.count;
        total += report.total;
        if (report.pending.length) console.log(`${memberId}: ${report.labels.join("; ")}`);
      } catch (error) {
        failed++;
        console.error(`Error assessing member ${memberId}:`, error);
      }
    }
    console.log(`[Points backfill] Pending reviewed: ${eligible}; granted: ${credited}; total Points: ${total}; errors: ${failed}.`);
    if (!apply) console.log("Dry run only. To grant eligible rewards, repeat with --apply against the intended database.");
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error("[Points backfill] Could not complete scan:", error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}
