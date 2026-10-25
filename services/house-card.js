import { AttachmentBuilder } from "discord.js";
import HouseListing from "../models/HouseListing.js";
import UserProfile from "../models/UserProfile.js";
import { displayListingAppearance } from "./listing-appearance.js";
import { getAppearanceOwnership } from "./appearance-ownership.js";
import { houseCardData, HOUSE_ART_NAME, isGalleryVideo, mergeOriginalMedia } from "./house-style.js";
import { houseActionComponents } from "./house-components.js";
import { archiveExistingHousePhotos, getHouseGalleryPage } from "./house-gallery.js";
import { renderPostImage } from "./post-renderer.js";

const refreshQueue = new Map();

/**
 * Artwork is attached as a normal PNG, not placed in an embed. User-uploaded
 * videos remain native attachments, and original photos are archived in Mongo
 * before their Discord attachments can be removed.
 */
export function houseCardPayload(listing, photoPage, videos, image) {
  const link = listing.videoUrl ? `\n[House tour video](${listing.videoUrl})` : "";
  return {
    content: `House listing from ${listing.ownerName}${link}`,
    embeds: [],
    attachments: videos.map(v => ({ id: v.id })),
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
    // Photo storage must be complete BEFORE editing the original post.
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
    const videos = Array.from(original.attachments.values()).filter(isGalleryVideo);
    if (videos.length > 9) {
      throw new Error("Ten house videos occupy the available Discord slots; cannot safely add artwork.");
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
    const updated = await original.edit(houseCardPayload(current, photos, videos, image));
    const survivingVideos = new Set(Array.from(updated.attachments.values())
      .filter(isGalleryVideo).map(video => video.id));
    if (!videos.every(video => survivingVideos.has(video.id))) {
      throw new Error("Discord failed to preserve original house videos.");
    }
    return updated;
  });
  refreshQueue.set(key, job);
  try { return await job; }
  finally { if (refreshQueue.get(key) === job) refreshQueue.delete(key); }
}
