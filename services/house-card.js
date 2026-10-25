import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import HouseListing from "../models/HouseListing.js";
import UserProfile from "../models/UserProfile.js";
import { displayListingAppearance } from "./listing-appearance.js";
import { getAppearanceOwnership } from "./appearance-ownership.js";
import { houseCardData, HOUSE_ART_NAME, mergeOriginalMedia } from "./house-style.js";
import { houseActionComponents } from "./house-components.js";
import { archiveExistingHousePhotos, getHouseGalleryPage } from "./house-gallery.js";
import { houseVideoAssets, deleteHouseMediaMessage, mergedHouseMediaMetadata } from "./house-media.js";
import { prepareMediaFiles } from "../commands/video-compression.js";
import { renderPostImage } from "./post-renderer.js";

const refreshQueue = new Map();

/** Native video attachments render above the styled embed image on the same post. */
export function houseCardPayload(listing, photoPage, image, videos = [], videoFiles = []) {
  const videoLink = listing.videoUrl ? `\n[House tour link](${listing.videoUrl})` : "";
  return {
    content: `House listing from ${listing.ownerName}${videoLink}`,
    embeds: [new EmbedBuilder().setColor(0x819287)
      .setImage(`attachment://${HOUSE_ART_NAME}`)],
    // Existing videos are kept in place by ID; legacy tour videos are
    // uploaded with the PNG before the old tour reply can be removed.
    attachments: videos.map(asset => ({ id: asset.id })),
    files: [...videoFiles, new AttachmentBuilder(image, { name: HOUSE_ART_NAME })],
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

    // Store original photos before editing their Discord attachments.
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

    const onCard = houseVideoAssets(original.attachments?.values?.());
    const saved = houseVideoAssets(current.mediaAttachments || []);
    let onReply = [];
    if (current.mediaMessageId) {
      try {
        const legacyReply = await channel.messages.fetch(current.mediaMessageId);
        if (legacyReply?.author?.id !== guild.client.user.id) {
          throw new Error("The saved house tour belongs to another author.");
        }
        onReply = houseVideoAssets(legacyReply.attachments?.values?.());
      } catch (error) {
        // Already migrated cards may have had their legacy reply deleted,
        // but never discard an only copy of a video just because it vanished.
        if (![10003, 10008].includes(Number(error?.code))) throw error;
        if (!onCard.length) throw new Error("House tour reply missing; native videos cannot be recovered safely.");
      }
    }
    const expectedVideos = Math.max(current.expectedVideoCount ?? 0,
      onCard.length, saved.length, onReply.length);
    if (expectedVideos > 9) throw new Error("A maximum of nine videos may share the house card.");

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

    // If this is an older separate-video listing, copy the files onto the
    // original post. Never delete the reply until all files are confirmed.
    const needsCopy = onCard.length < expectedVideos;
    const sourceVideos = onReply.length >= expectedVideos ? onReply : saved;
    if (needsCopy && sourceVideos.length < expectedVideos) {
      throw new Error("A house video source is unavailable. The original post was left unchanged.");
    }
    let prepared = null;
    try {
      if (needsCopy) {
        prepared = await prepareMediaFiles(sourceVideos,
          `house-${String(current._id).slice(-8)}-card`);
      }
      const updated = await original.edit(houseCardPayload(
        current, photos, image, needsCopy ? [] : onCard, prepared?.files ?? [],
      ));
      const actualVideos = houseVideoAssets(updated.attachments?.values?.());
      const actualIds = new Set(actualVideos.map(item => item.id));
      if (actualVideos.length < expectedVideos ||
          (!needsCopy && !onCard.every(item => actualIds.has(item.id)))) {
        throw new Error("Discord did not confirm every native house video. Old tour retained.");
      }
      if (!Array.from(updated.attachments?.values?.() ?? [])
        .some(item => item.name === HOUSE_ART_NAME)) {
        throw new Error("Discord did not confirm the styled house artwork attachment.");
      }

      // Save original-message metadata BEFORE retiring a legacy video reply.
      const metadata = mergedHouseMediaMetadata(current.mediaAttachments, actualVideos);
      const savedChange = await HouseListing.updateOne({
        _id: current._id, guildId: guild.id, status: "active",
        postMessageId: current.postMessageId,
      }, { $set: { cardLayoutVersion: 2, mediaAttachments: metadata } });
      if (!savedChange.matchedCount) {
        throw new Error("House card was edited, but its metadata could not be saved. Tour reply retained.");
      }

      if (current.mediaMessageId) {
        await deleteHouseMediaMessage(guild, current);
        await HouseListing.updateOne({
          _id: current._id, guildId: guild.id, status: "active",
          postMessageId: current.postMessageId, mediaMessageId: current.mediaMessageId,
        }, { $set: { mediaMessageId: "" } });
      }
      return updated;
    } finally {
      if (prepared) await prepared.cleanup().catch(error =>
        console.warn("[House] Could not clean temporary card videos:", error));
    }
  });
  refreshQueue.set(key, job);
  try { return await job; }
  finally { if (refreshQueue.get(key) === job) refreshQueue.delete(key); }
}
