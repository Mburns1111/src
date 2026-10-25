import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import OutfitListing from "../models/OutfitListing.js";
import UserProfile from "../models/UserProfile.js";
import { displayListingAppearance } from "./listing-appearance.js";
import { getAppearanceOwnership } from "./appearance-ownership.js";
import { outfitCardData } from "./outfit-style.js";
import { renderPostImage } from "./post-renderer.js";
import {
  OUTFIT_BANNER_NAME, isGalleryPhoto, isGalleryVideo, mergeOriginalMedia,
} from "./outfit-gallery-utils.js";
import {
  saveOutfitGalleryImages, ensureOutfitGallery, outfitGalleryCount,
} from "./outfit-gallery.js";

const activeRefreshes = new Map();

/**
 * The original outfit post is its decorated advertisement banner.
 * Photos live in a dedicated bot gallery reply, NOT inside the banner.
 * Videos remain playable as original Discord attachments.
 *
 * Migration is intentionally fail-closed: all original photos must have
 * been saved to Mongo and the flipbook reply must exist before an edit
 * is allowed to remove any photo attachment from the original message.
 */
export function outfitBannerPayload(listing, videos, png) {
  const videoLink = listing.videoUrl ? `\n[Outfit video](${listing.videoUrl})` : "";
  return {
    content: `**Outfit listing from ${listing.ownerName}**${videoLink}`,
    embeds: [new EmbedBuilder().setColor(0x819287)
      .setImage(`attachment://${OUTFIT_BANNER_NAME}`)],
    // Preserve every original video by ID without mixing the photo flipbook
    // into the decorative banner, and leave original listing buttons intact.
    attachments: videos.map(({ id, attachmentId }) => ({ id: id || attachmentId })),
    files: [new AttachmentBuilder(png, { name: OUTFIT_BANNER_NAME })],
    allowedMentions: { parse: [] },
  };
}

export async function refreshOutfitStyleCard(guild, listing) {
  const key = `${guild.id}:${listing._id}`;
  if (activeRefreshes.has(key)) return activeRefreshes.get(key);
  const task = (async () => {
    if (listing.status !== "active" || !listing.postChannelId || !listing.postMessageId) {
      throw new Error("This outfit listing is not active or has no public post.");
    }
    const channel = await guild.channels.fetch(listing.postChannelId);
    if (!channel?.messages) throw new Error("The outfit listing channel is unavailable.");
    const message = await channel.messages.fetch(listing.postMessageId);
    if (message.author?.id !== guild.client.user.id) {
      throw new Error("Cannot edit an outfit listing that another user authored.");
    }

    // Historical media metadata is important: a broken previous edit may
    // already have removed some visible photos. Never discard those sources.
    const sources = mergeOriginalMedia(
      listing.mediaAttachments, Array.from(message.attachments.values()),
    );
    const photos = sources.filter(isGalleryPhoto);
    const liveVideos = Array.from(message.attachments.values()).filter(isGalleryVideo);
    if (photos.length) {
      await saveOutfitGalleryImages(guild.id, listing, photos);
    }
    const stored = await outfitGalleryCount(guild.id, listing._id);
    // Never hide the visible originals if even one image has not been safely
    // archived. This also handles expired CDN URLs for old deleted images.
    if (stored && photos.length) {
      const imageSources = new Set(photos.map(asset => String(asset.attachmentId || asset.id)));
      // saveOutfitGalleryImages only returns once every source has been saved.
      if (imageSources.size > 10) throw new Error("Too many original outfit images to safely migrate.");
    }
    if (stored) await ensureOutfitGallery(guild, listing);

    // Preserve source metadata in Mongo BEFORE Discord's public attachment
    // list is reduced to the banner and videos. This is also needed for
    // reliable 10-file limits when migrating listings from older versions.
    const merged = mergeOriginalMedia(listing.mediaAttachments, sources);
    if (merged.length !== (listing.mediaAttachments?.length || 0)) {
      listing.mediaAttachments = merged;
      await listing.save();
    }

    const [profile, ownership] = await Promise.all([
      UserProfile.findOne({ guildId: guild.id, discordUserId: listing.ownerId }),
      getAppearanceOwnership(guild.id, listing.ownerId),
    ]);
    const png = await renderPostImage({
      type: "outfit", data: outfitCardData(listing),
      appearance: displayListingAppearance(listing, profile, ownership),
    });
    const updated = await message.edit(outfitBannerPayload(listing, liveVideos, png));
    const actualVideos = new Set(Array.from(updated.attachments.values())
      .filter(isGalleryVideo).map(asset => asset.id));
    if (!liveVideos.every(video => actualVideos.has(video.id))) {
      throw new Error("Discord failed to preserve all existing outfit videos.");
    }

    // Keep original stored media metadata for ownership, counting and
    // recovery; it is NOT repopulated with only the banner attachment.
    if (listing.styleCardMessageId) {
      await deleteOutfitStyleCard(guild, listing);
      await OutfitListing.updateOne({
        _id: listing._id, guildId: guild.id, ownerId: listing.ownerId,
      }, { $set: { styleCardMessageId: "" } });
      listing.styleCardMessageId = "";
    }
    return updated;
  })();
  activeRefreshes.set(key, task);
  try { return await task; }
  finally { if (activeRefreshes.get(key) === task) activeRefreshes.delete(key); }
}

/** Only old, now-redundant style replies are deleted. Never delete the gallery. */
export async function deleteOutfitStyleCard(guild, listing) {
  if (!listing.styleCardMessageId) return;
  try {
    const channel = await guild.channels.fetch(listing.postChannelId);
    const message = await channel?.messages?.fetch(listing.styleCardMessageId);
    if (message?.author?.id === guild.client.user.id) await message.delete();
  } catch (error) {
    if (![10003, 10008].includes(Number(error?.code))) {
      console.warn("Could not remove old outfit style reply:", error);
    }
  }
}
