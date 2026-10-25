import { yieldAfterMaintenanceBatch } from "./maintenance-batches.js";
import HouseListing from "../models/HouseListing.js";
import { refreshHouseStyleCard } from "./house-card.js";
import { isGalleryVideo } from "./house-style.js";
import { houseArtworkIsEmbedded } from "./house-artwork.js";
export async function checkHousePost(guild, listing) {
  if (!listing?.postChannelId || !listing?.postMessageId || (listing.status !== "active" || listing.publicationState === "staging")) {
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
      _id: listing._id, guildId: guild.id, status: "active", publicationState: { $ne: "staging" },
      postMessageId: listing.postMessageId,
    }, { $set: { status: "missing", missingAt: new Date() } });
    return { state: "missing" };
  }
}
export async function findCustomizableHouses(guild, ownerId) {
  const candidates = await HouseListing.find({
    guildId: guild.id, ownerId, status: "active", publicationState: { $ne: "staging" },
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
  // Artwork used by an image embed is not always returned as a separate
  // message attachment. Check what Discord actually renders instead.
  const imageEmbed = houseArtworkIsEmbedded(message);
  const buttons = (message.components ?? []).flatMap(row => row.components ?? [])
    .map(button => button.customId || button.custom_id || "");
  const ids = ["sold", "interest", "notify"];
  const nativeVideos = Array.from(message.attachments?.values?.() ?? []).filter(isGalleryVideo);
  const storedVideos = (listing.mediaAttachments ?? []).filter(isGalleryVideo);
  return (listing.cardLayoutVersion ?? 0) < 2 || !imageEmbed ||
    ids.some(name => !buttons.includes(`house:${name}:${listing._id}`)) ||
    buttons.includes(`house:media:${listing._id}`) ||
    Boolean(listing.mediaMessageId) ||
    nativeVideos.length < (listing.expectedVideoCount ?? storedVideos.length);
}

/** Repairs old house embeds on startup. Stops only the listing that fails. */
export async function reconcileHousesForGuild(guild, {
  records = null, check = checkHousePost, refresh = refreshHouseStyleCard,
} = {}) {
  const listings = records ?? await HouseListing.find({
    guildId: guild.id, status: "active", publicationState: { $ne: "staging" },
    postChannelId: { $ne: "" }, postMessageId: { $ne: "" },
  }).sort({ createdAt: 1, _id: 1 });
  const stats = { scanned: 0, converted: 0, missing: 0, current: 0, unavailable: 0, failed: 0 };
  for (const listing of listings) {
    stats.scanned++;
    try {
      const result = await check(guild, listing);
      if (result.state === "missing") { stats.missing++; continue; }
      if (result.state !== "present") { stats.unavailable++; continue; }
      const needsUpgrade = houseNeedsFormatUpgrade(listing, result.message);
      if (!needsUpgrade) { stats.current++; continue; }
      await refresh(guild, listing);
      stats.converted++;
    } catch (error) {
      stats.failed++;
      console.warn("[House reconciliation] Cannot safely reformat", String(listing._id), error);
    } finally {
      await yieldAfterMaintenanceBatch(stats.scanned);
    }
  }
  console.log(`[House reconciliation] Guild ${guild.id}: ${stats.scanned} checked, ${stats.converted} reformatted, ${stats.missing} deleted, ${stats.current} current, ${stats.unavailable} unavailable, ${stats.failed} failed.`);
  return stats;
}
