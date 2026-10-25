import { yieldAfterMaintenanceBatch } from "./maintenance-batches.js";
import OutfitListing from "../models/OutfitListing.js";
import { refreshOutfitStyleCard } from "./outfit-card.js";

const UNKNOWN_MESSAGE = 10008;
const UNKNOWN_CHANNEL = 10003;

export function isDeletedDiscordMessage(error) {
  return Number(error?.code) === UNKNOWN_MESSAGE;
}

export function isDeletedDiscordChannel(error) {
  return Number(error?.code) === UNKNOWN_CHANNEL;
}

/**
 * Recheck the ORIGINAL outfit message, never the old gallery/action replies.
 * Only an unambiguous Discord Unknown Message / Unknown Channel response
 * changes the record to "missing". Permissions, outages and timeouts remain
 * temporary failures: none of those may remove a seller's listing.
 */
export async function checkOutfitListingMessage(
  guild, listing, { ListingModel = OutfitListing } = {},
) {
  if ((listing.status !== "active" || listing.publicationState === "staging") || !listing.postChannelId || !listing.postMessageId) {
    return { state: "unavailable", reason: "The original outfit message is not published." };
  }
  const markMissing = async () => {
    const result = await ListingModel.updateOne({
      _id: listing._id,
      guildId: guild.id,
      status: "active",
      postChannelId: listing.postChannelId,
      postMessageId: listing.postMessageId,
    }, { $set: { status: "missing", missingAt: new Date() } });
    // Only the saved record is archived. Never delete photos or old replies
    // when the main post vanished while the bot was offline.
    return { state: "missing", changed: Boolean(result.modifiedCount) };
  };

  let channel;
  try {
    channel = await guild.channels.fetch(listing.postChannelId);
  } catch (error) {
    if (isDeletedDiscordChannel(error)) return markMissing();
    return { state: "unavailable", error };
  }
  if (!channel?.messages?.fetch) {
    return { state: "unavailable", reason: "Outfit channel cannot be accessed." };
  }

  try {
    const message = await channel.messages.fetch(listing.postMessageId);
    if (!message) return { state: "unavailable", reason: "Discord returned no outfit message." };
    if (message.author?.id !== guild.client.user.id) {
      return { state: "unavailable", reason: "Original outfit message belongs to another bot." };
    }
    return { state: "present", message };
  } catch (error) {
    if (isDeletedDiscordMessage(error)) return markMissing();
    return { state: "unavailable", error };
  }
}

/** Embedded outfit artwork may not appear in Discord's attachment array. */
export function outfitArtworkIsEmbedded(message) {
  return (message?.embeds ?? []).some(embed => {
    const image = embed?.image ?? embed?.data?.image;
    return [image?.url, image?.proxyURL, image?.proxy_url].some(raw => {
      if (typeof raw !== "string" || !raw) return false;
      try { return decodeURIComponent(raw).includes("outfit-style-card.png"); }
      catch { return raw.includes("outfit-style-card.png"); }
    });
  });
}

export function outfitNeedsFormatUpgrade(listing, message) {
  if (listing.galleryMessageId || listing.controlsMessageId || listing.styleCardMessageId) {
    return true;
  }
  const styleImage = outfitArtworkIsEmbedded(message);
  const controls = (message.components || []).flatMap(row => row.components || []);
  const ids = controls.map(button => button.customId || button.custom_id || button.data?.custom_id || "");
  const hasActions = ["interest", "notify", "sold"].every(action =>
    ids.includes(`outfit:${action}:${listing._id}`));
  return !styleImage || !hasActions;
}

/**
 * Called once per connected guild when the bot starts, after MongoDB is ready.
 * This makes old outfit posts upgrade automatically without asking an owner to
 * save their style again. A failure on one outfit never stops the others.
 */
export async function reconcileOutfitsForGuild(guild, {
  records = null,
  check = checkOutfitListingMessage,
  refresh = refreshOutfitStyleCard,
} = {}) {
  const listings = records ?? await OutfitListing.find({
    guildId: guild.id, status: "active", publicationState: { $ne: "staging" },
    postChannelId: { $type: "string", $ne: "" },
    postMessageId: { $type: "string", $ne: "" },
  }).sort({ createdAt: 1, _id: 1 });
  const stats = { scanned: 0, converted: 0, missing: 0, current: 0, unavailable: 0, failed: 0 };
  for (const listing of listings) {
    stats.scanned += 1;
    try {
      const presence = await check(guild, listing);
      if (presence.state === "missing") {
        stats.missing += 1;
        continue;
      }
      if (presence.state !== "present") {
        stats.unavailable += 1;
        if (presence.error) console.warn("[Outfit reconciliation] Message check unavailable:", String(listing._id), presence.error);
        continue;
      }
      if (!outfitNeedsFormatUpgrade(listing, presence.message)) {
        stats.current += 1;
        continue;
      }
      await refresh(guild, listing);
      stats.converted += 1;
    } catch (error) {
      stats.failed += 1;
      console.warn("[Outfit reconciliation] Couldn't upgrade listing", String(listing._id), error);
    } finally {
      await yieldAfterMaintenanceBatch(stats.scanned);
    }
  }
  console.log(`[Outfit reconciliation] Guild ${guild.id}: ${stats.scanned} checked, ${stats.converted} reformatted, ${stats.missing} deleted, ${stats.current} current, ${stats.unavailable} unavailable, ${stats.failed} failed.`);
  return stats;
}

/**
 * The picker must verify live message existence too: a seller might delete an
 * outfit after the startup pass. Validate the final selected outfit separately
 * to handle a deletion between opening the dropdown and choosing an option.
 */
export async function findCustomizableOutfits(guild, ownerId, {
  records = null,
  check = checkOutfitListingMessage,
} = {}) {
  const candidates = records ?? await OutfitListing.find({
    guildId: guild.id, ownerId, status: "active", publicationState: { $ne: "staging" },
    postChannelId: { $type: "string", $ne: "" },
    postMessageId: { $type: "string", $ne: "" },
  }).sort({ createdAt: -1, _id: -1 }).lean();

  const available = [];
  let unavailable = 0;
  let missing = 0;
  for (const outfit of candidates) {
    const result = await check(guild, outfit);
    if (result.state === "present") available.push(outfit);
    else if (result.state === "missing") missing++;
    else unavailable++;
  }
  return { available, unavailable, missing };
}
