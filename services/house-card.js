import { AttachmentBuilder } from "discord.js";
import HouseListing from "../models/HouseListing.js";
import UserProfile from "../models/UserProfile.js";
import { displayListingAppearance } from "./listing-appearance.js";
import { getAppearanceOwnership } from "./appearance-ownership.js";
import { houseCardData, HOUSE_ART_NAME, mergeOriginalMedia } from "./house-style.js";
import { houseActionComponents } from "./house-components.js";
import { archiveExistingHousePhotos, getHouseGalleryPage } from "./house-gallery.js";
import { ensureHouseMediaMessage, mergedHouseMediaMetadata } from "./house-media.js";
import { renderPostImage } from "./post-renderer.js";
import { discordMessageUrl } from "../commands/shared.js";

const refreshQueue = new Map();

/**
 * Discord tiles multiple attachments side by side. The original house post
 * carries ONLY the decorated PNG; all native video files live in the house
 * media reply. House photos rotate inside the decorated image.
 */
export function houseCardPayload(listing, photoPage, image) {
  const mediaLink = listing.mediaMessageId
    ? `\n[Watch house video tour](${discordMessageUrl(
      listing.guildId, listing.postChannelId, listing.mediaMessageId,
    )})`
    : "";
  const videoLink = listing.videoUrl ? `\n[House tour link](${listing.videoUrl})` : "";
  return {
    content: `House listing from ${listing.ownerName}${mediaLink}${videoLink}`,
    embeds: [],
    // Explicitly discard old original media only AFTER videos are present
    // in the verified, separate media reply.
    attachments: [],
    files: [new AttachmentBuilder(image, { name: HOUSE_ART_NAME })],
    components: houseActionComponents(listing, photoPage.count),
    allowedMentions: { parse: [] },
  };
}

export async function refreshHouseStyleCard(guild, listing) {
  const key = `${guild.id}:${String(listing._id)}`;
  const prior = refreshQueue.get(key) ?? Promise.resolve();
  const job = prior.catch(() => {}).then(async () => {
    const current = await HouseListing.findOne({
      _id: listing._id, guildId: guild.id, ownerId: listing.ownerId, status: "active",
    });
    if (!current?.postChannelId || !current.postMessageId) {
      throw new Error("House listing has no active published message.");
    }
    const channel = await guild.channels.fetch(current.postChannelId);
    const original = await channel?.messages?.fetch(current.postMessageId);
    if (!original || original.author?.id !== guild.client.user.id) {
      throw new Error("Cannot edit a house post not authored by this bot.");
    }

    // Historical original images must be archived before they are detached.
    const sources = await archiveExistingHousePhotos(guild, current, original);
    const photos = await getHouseGalleryPage(guild.id, current._id, current.galleryPageIndex ?? 0);
    if (current.galleryPageIndex !== photos.page) {
      current.galleryPageIndex = photos.page;
      await HouseListing.updateOne({ _id: current._id, guildId: guild.id },
        { $set: { galleryPageIndex: photos.page } });
    }
    const merged = mergeOriginalMedia(current.mediaAttachments, sources);
    if (merged.length > (current.mediaAttachments?.length ?? 0)) {
      current.mediaAttachments = merged;
      await current.save();
    }

    // This call is intentionally BEFORE the destructive attachment edit.
    // It creates the separate video message and checks its actual files;
    // on failure the original house image/videos are left as they were.
    const media = await ensureHouseMediaMessage(guild, current, original, { channel });
    if (media.message) {
      const expected = mergedHouseMediaMetadata(current.mediaAttachments, media.videos);
      current.mediaAttachments = expected;
      await current.save();
    }

    const [profile, ownership] = await Promise.all([
      UserProfile.findOne({ guildId: guild.id, discordUserId: current.ownerId }),
      getAppearanceOwnership(guild.id, current.ownerId),
    ]);
    const image = await renderPostImage({
      type: "house",
      data: {
        ...houseCardData(current),
        galleryIndex: photos.count ? photos.page + 1 : 0,
        galleryCount: photos.count,
      },
      images: { photo: photos.imageBuffer },
      appearance: displayListingAppearance(current, profile, ownership),
    });
    const updated = await original.edit(houseCardPayload(current, photos, image));
    // Prevent accidental thumbnail tiling if discord.js edit semantics change.
    if (Array.from(updated.attachments.values()).some(item => item.name !== HOUSE_ART_NAME)) {
      console.warn("[House] Extra attachment remained on decorated card", String(current._id));
    }
    return updated;
  });
  refreshQueue.set(key, job);
  try { return await job; }
  finally { if (refreshQueue.get(key) === job) refreshQueue.delete(key); }
}
