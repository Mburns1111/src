import MemberDmPanel from "../models/MemberDmPanel.js";
import UserProfile from "../models/UserProfile.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";
import TradeListing from "../models/TradeListing.js";
import TradingPost from "../models/TradingPost.js";
import { DEFAULT_APPEARANCE, resolveAppearance } from "./post-appearance.js";
import { POINTS_MILESTONES } from "./points-policy.js";
import { awardMilestone } from "./points-rewards.js";
import PointsLedger from "../models/PointsLedger.js";

export function hasCustomizedAppearance(saved) {
  const original = resolveAppearance(DEFAULT_APPEARANCE);
  const current = resolveAppearance(saved);
  return Object.keys(original).some(key =>
    JSON.stringify(current[key]) !== JSON.stringify(original[key]));
}

// This is a per-member, opt-in retroactive scan. Evidence is limited to
// existing records; deleted listings and reverted appearance edits cannot be
// reliably reconstructed. Dry-run never creates Points or ledger entries.
export async function discoverExistingMilestones(guildId, userId) {
  const published = { $type: "string", $ne: "" };
  const [shop, profile, house, outfit, trade, tradingPost] = await Promise.all([
    MemberDmPanel.findOne({ guildId, discordUserId: userId, kind: "shop",
      messageId: published }).select("messageId").lean(),
    UserProfile.findOne({ guildId, discordUserId: userId }).lean(),
    HouseListing.findOne({ guildId, ownerId: userId, postMessageId: published }).select("_id").lean(),
    OutfitListing.findOne({ guildId, ownerId: userId, postMessageId: published }).select("_id").lean(),
    TradeListing.findOne({ guildId, ownerId: userId, postMessageId: published }).select("_id").lean(),
    TradingPost.findOne({ guildId, ownerId: userId, postMessageId: published }).select("_id").lean(),
  ]);
  const found = [];
  if (shop) found.push({ milestone: "shopFirstBrowse", sourceId: shop.messageId });
  if (profile && hasCustomizedAppearance(profile.profileAppearance)) {
    found.push({ milestone: "profileFirstCustomization", sourceId: "saved-profile" });
  }
  if (house) found.push({ milestone: "houseFirstListing", sourceId: String(house._id) });
  if (outfit) found.push({ milestone: "outfitFirstListing", sourceId: String(outfit._id) });
  if (trade) found.push({ milestone: "tradeFirstListing", sourceId: String(trade._id) });
  if (tradingPost) found.push({ milestone: "tradingPostFirstPublished", sourceId: String(tradingPost._id) });
  if (profile?.inventoryVideoPostMessageId || profile?.albumPosts?.some(entry => entry.messageId)) {
    found.push({ milestone: "inventoryFirstPost",
      sourceId: profile.inventoryVideoPostMessageId || profile.albumPosts.find(entry => entry.messageId).messageId });
  }
  return found;
}

export async function backfillMilestones(guildId, userId, { apply = false } = {}) {
  const discovered = await discoverExistingMilestones(guildId, userId);
  const awarded = await PointsLedger.find({
    guildId, discordUserId: userId,
    eventKey: { $in: discovered.map(item => `milestone:${item.milestone}`) },
  }).select("eventKey").lean();
  const already = new Set(awarded.map(entry => entry.eventKey));
  const pending = discovered.filter(item => !already.has(`milestone:${item.milestone}`));
  let total = 0;
  let count = 0;
  if (apply) {
    for (const item of pending) {
      const r = await awardMilestone(guildId, userId, item.milestone, { sourceId: item.sourceId });
      if (r.credited) { total += r.amount; count++; }
    }
  }
  return { discovered, pending, count, total,
    labels: pending.map(item => POINTS_MILESTONES[item.milestone].label) };
}
