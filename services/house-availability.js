import HouseListing from "../models/HouseListing.js";
import { refreshHouseStyleCard } from "./house-card.js";
export async function checkHousePost(guild, listing) {
  if (!listing?.postChannelId || !listing?.postMessageId || listing.status !== "active") {
    return { state: "unavailable" };
  }
  let channel;
  try {
    channel = await guild.channels.fetch(listing.postChannelId);
    if (!channel?.messages?.fetch) return { state: "unavailable" };
    const message = await channel.messages.fetch(listing.postMessageId);
    if (message?.author?.id !== guild.client.user.id) return { state: "unavailable" };
    return { state: "present", message };
  } catch (error) {
    if (![10003, 10008].includes(Number(error?.code))) return { state: "unavailable", error };
    await HouseListing.updateOne({
      _id: listing._id, guildId: guild.id, status: "active",
      postMessageId: listing.postMessageId,
    }, { $set: { status: "missing", missingAt: new Date() } });
    return { state: "missing" };
  }
}
export async function findCustomizableHouses(guild, ownerId) {
  const candidates = await HouseListing.find({
    guildId: guild.id, ownerId, status: "active",
    postChannelId: { $ne: "" }, postMessageId: { $ne: "" },
  }).sort({ createdAt: -1, _id: -1 }).lean();
  const available = [];
  let unavailable = 0;
  for (const listing of candidates) {
    const result = await checkHousePost(guild, listing);
    if (result.state === "present") available.push(listing);
    else if (result.state === "unavailable") unavailable++;
  }
  return { available, unavailable };
}

export function houseNeedsFormatUpgrade(listing, message) {
  const art = Array.from(message.attachments?.values?.() ?? [])
    .some(asset => asset.name === "house-style-card.png");
  const buttons = (message.components ?? []).flatMap(row => row.components ?? [])
    .map(button => button.customId || button.custom_id || "");
  const ids = ["sold", "interest", "notify"];
  return !art || ids.some(name => !buttons.includes(`house:${name}:${listing._id}`)) ||
    Boolean(message.embeds?.length);
}

/** Repairs old house embeds on startup. Stops only the listing that fails. */
export async function reconcileHousesForGuild(guild, {
  records = null, check = checkHousePost, refresh = refreshHouseStyleCard,
} = {}) {
  const listings = records ?? await HouseListing.find({
    guildId: guild.id, status: "active",
    postChannelId: { $ne: "" }, postMessageId: { $ne: "" },
  }).sort({ createdAt: 1, _id: 1 });
  const stats = { scanned: 0, converted: 0, missing: 0, current: 0, unavailable: 0, failed: 0 };
  for (const listing of listings) {
    stats.scanned++;
    try {
      const result = await check(guild, listing);
      if (result.state === "missing") { stats.missing++; continue; }
      if (result.state !== "present") { stats.unavailable++; continue; }
      if (!houseNeedsFormatUpgrade(listing, result.message)) { stats.current++; continue; }
      await refresh(guild, listing);
      stats.converted++;
    } catch (error) {
      stats.failed++;
      console.warn("[House reconciliation] Cannot safely reformat", String(listing._id), error);
    }
  }
  console.log(`[House reconciliation] Guild ${guild.id}: ${stats.scanned} checked, ${stats.converted} reformatted, ${stats.missing} deleted, ${stats.current} current, ${stats.unavailable} unavailable, ${stats.failed} failed.`);
  return stats;
}
