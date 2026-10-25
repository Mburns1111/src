import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";
import HouseGalleryImage from "../models/HouseGalleryImage.js";
import OutfitGalleryImage from "../models/OutfitGalleryImage.js";
import { houseVideoAssets } from "./house-media.js";
import { isGalleryVideo } from "./outfit-gallery-utils.js";

const actionIds = (message) => (message?.components ?? [])
  .flatMap(row => row.components ?? [])
  .map(button => button.customId || button.custom_id || button.data?.custom_id || "");

export function isFinishedListingMessage(type, listing, message, botId) {
  if (!message || message.author?.id !== botId) return false;
  const ids = actionIds(message);
  return ["interest", "notify", "sold"].every(action =>
    ids.includes(`${type}:${action}:${listing._id}`));
}

/**
 * A crash can happen after Discord accepts a public edit, but before Mongo
 * records that publication completed. Promote ONLY a post with this bot's
 * actual listing controls and verifiably retained photo/video counts.
 * Unfinished forms and uncertain uploads remain untouched for inspection.
 */
export async function recoverStagedListingPosts(guild, {
  records = null,
  models = { house: HouseListing, outfit: OutfitListing },
  countPhotos = async (type, record) => (type === "house"
    ? HouseGalleryImage : OutfitGalleryImage).countDocuments({
    guildId: guild.id, listingId: record._id,
  }),
} = {}) {
  const results = { scanned: 0, recovered: 0, pending: 0, unavailable: 0 };
  for (const type of ["house", "outfit"]) {
    const Model = models[type];
    const pending = records?.[type] ?? await Model.find({
      guildId: guild.id, status: "active", publicationState: "staging",
    }).lean();
    for (const listing of pending) {
      results.scanned++;
      try {
        const channel = await guild.channels.fetch(listing.postChannelId);
        const message = await channel?.messages?.fetch(listing.postMessageId);
        if (!isFinishedListingMessage(type, listing, message, guild.client.user.id)) {
          results.pending++;
          console.warn("[Publication recovery] Unfinished or unrecognized listing preserved",
            type, String(listing._id));
          continue;
        }

        const photos = await countPhotos(type, listing);
        if (photos < (listing.expectedPhotoCount || 0)) {
          results.pending++;
          console.warn("[Publication recovery] Missing saved photos; no automatic promotion",
            type, String(listing._id));
          continue;
        }

        const expectedVideos = listing.expectedVideoCount || 0;
        if (expectedVideos) {
          let actualVideos = [];
          if (type === "house") {
            if (!listing.mediaMessageId) {
              results.pending++;
              continue;
            }
            const media = await channel.messages.fetch(listing.mediaMessageId);
            if (media.author?.id !== guild.client.user.id) {
              results.pending++;
              continue;
            }
            actualVideos = houseVideoAssets(media.attachments?.values?.());
          } else {
            actualVideos = [...(message.attachments?.values?.() ?? [])]
              .filter(isGalleryVideo);
          }
          if (actualVideos.length < expectedVideos) {
            results.pending++;
            console.warn("[Publication recovery] Video count not confirmed",
              type, String(listing._id));
            continue;
          }
        }

        const updated = await Model.updateOne({
          _id: listing._id, guildId: guild.id,
          status: "active", publicationState: "staging",
          postMessageId: listing.postMessageId,
        }, { $set: { publicationState: "published" } });
        if (updated.matchedCount) {
          results.recovered++;
          console.log("[Publication recovery] Resumed published listing",
            type, String(listing._id));
        } else results.pending++;
      } catch (error) {
        // Do not destroy archived media or falsely mark an inaccessible post
        // as deleted. The next restart or admin repair can retry safely.
        results.unavailable++;
        console.warn("[Publication recovery] Listing needs a later retry",
          type, String(listing._id), error);
      }
    }
  }
  return results;
}
