import HouseListing from "../models/HouseListing.js";
import { prepareMediaFiles } from "../commands/video-compression.js";
import { getMessageMedia } from "../commands/shared.js";
import { isGalleryVideo } from "./house-style.js";

const activeMedia = new Map();

export function houseVideoAssets(assets) {
  return Array.from(assets || []).filter(isGalleryVideo);
}

/** Separate Discord message: never attach member videos to the styled PNG. */
export function houseMediaPayload(listing, files) {
  return {
    content: `**House video tour · ${String(listing.title || "House").slice(0, 85)}**`,
    files,
    allowedMentions: { parse: [], repliedUser: false },
    reply: {
      messageReference: listing.postMessageId,
      failIfNotExists: true,
    },
  };
}

export function houseMediaNeedsRepair(listing, original) {
  const oldVideos = houseVideoAssets(original?.attachments?.values?.());
  const savedVideos = houseVideoAssets(listing.mediaAttachments || []);
  return oldVideos.length > 0 || savedVideos.length > 0 || Boolean(listing.mediaMessageId);
}

/**
 * New uploads and legacy video migrations both create the media reply BEFORE
 * they remove native video attachments from the decorated original post.
 *
 * If the original video still exists, that attachment is the most reliable
 * source. Otherwise, historical Mongo metadata can restore a missing video
 * reply when its Discord CDN URLs are still accessible.
 */
export async function ensureHouseMediaMessage(guild, listing, original, {
  videoSources = null,
  channel = null,
  Model = HouseListing,
} = {}) {
  const key = `${guild.id}:${listing._id}`;
  if (activeMedia.has(key)) return activeMedia.get(key);
  const job = (async () => {
    const target = channel ?? await guild.channels.fetch(listing.postChannelId);
    if (!target?.messages?.fetch || !target.send) {
      throw new Error("House media channel is unavailable.");
    }
    const onCard = houseVideoAssets(original?.attachments?.values?.());
    const recorded = houseVideoAssets(listing.mediaAttachments || []);
    const supplied = houseVideoAssets(videoSources ?? []);
    const expected = Math.max(onCard.length, recorded.length, supplied.length);
    if (!expected && !listing.mediaMessageId) {
      return { message: null, videos: [], created: false };
    }
    if (listing.mediaMessageId) {
      let stored;
      try {
        stored = await target.messages.fetch(listing.mediaMessageId);
      } catch (error) {
        if (![10008, 10003].includes(Number(error?.code))) throw error;
      }
      if (stored) {
        if (stored.author?.id !== guild.client.user.id) {
          throw new Error("Recorded house media message belongs to another user.");
        }
        const videos = houseVideoAssets(stored.attachments.values());
        if (videos.length >= expected) {
          return { message: stored, videos, created: false };
        }
        // Fail closed rather than losing a playable video or replacing the
        // message while it still contains partially accessible attachments.
        throw new Error("Saved house media reply is missing one or more videos.");
      }
    }
    const sources = supplied.length ? supplied : onCard.length ? onCard : recorded;
    if (!sources.length) {
      return { message: null, videos: [], created: false };
    }
    const { files, cleanup } = await prepareMediaFiles(
      sources, `house-${String(listing._id).slice(-8)}-tour`,
    );
    let posted;
    try {
      posted = await target.send(houseMediaPayload(listing, files));
    } finally {
      await cleanup();
    }
    const videos = houseVideoAssets(posted.attachments.values());
    if (videos.length !== sources.length) {
      // The original still has its videos during migration, or this is a new
      // listing awaiting publication. Avoid leaving partial duplicate posts.
      await posted.delete().catch(error => console.warn("Partial house media cleanup:", error));
      throw new Error("Discord did not retain every house video in its separate media message.");
    }
    try {
      const update = await Model.updateOne({
        _id: listing._id, guildId: guild.id, status: "active",
        postMessageId: listing.postMessageId,
      }, { $set: { mediaMessageId: posted.id } });
      if (!update.matchedCount) throw new Error("House record changed while saving its video message.");
      listing.mediaMessageId = posted.id;
    } catch (error) {
      await posted.delete().catch(cleanupError =>
        console.warn("Could not remove untracked house video post:", cleanupError));
      throw error;
    }
    return { message: posted, videos, created: true };
  })();
  activeMedia.set(key, job);
  try { return await job; }
  finally { if (activeMedia.get(key) === job) activeMedia.delete(key); }
}

export async function deleteHouseMediaMessage(guild, listing) {
  if (!listing.mediaMessageId || listing.mediaMessageId === listing.postMessageId) return;
  try {
    const channel = await guild.channels.fetch(listing.postChannelId);
    const message = await channel?.messages?.fetch(listing.mediaMessageId);
    if (message?.author?.id === guild.client.user.id) await message.delete();
    else if (message) console.warn("Skipping non-bot house media message:", listing.mediaMessageId);
  } catch (error) {
    if (![10003, 10008].includes(Number(error?.code))) throw error;
  }
}

/**
 * Persist the new video's permanent Discord URL/ID, replacing old video
 * attachment records. Keep every original photo for gallery recovery.
 */
export function mergedHouseMediaMetadata(oldItems, actualVideos) {
  const photos = (oldItems || []).filter(item => !isGalleryVideo(item));
  return [...photos, ...getMessageMedia({ attachments: new Map(
    actualVideos.map((asset, i) => [asset.id ?? i, asset]),
  ) })];
}
