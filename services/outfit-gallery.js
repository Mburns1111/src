import { createCanvas, loadImage } from "@napi-rs/canvas";
import OutfitGalleryImage from "../models/OutfitGalleryImage.js";
import { UserFacingError } from "../commands/errors.js";
import { readDiscordAttachment } from "./media-transfer.js";
import {
  GALLERY_HEIGHT, GALLERY_WIDTH, GALLERY_JPEG_QUALITY,
  MAX_IMAGE_BYTES, MAX_GALLERY_MEDIA, isGalleryPhoto,
  mergeOriginalMedia, safePageIndex,
} from "./outfit-gallery-utils.js";


async function fetchOriginalPhoto(asset) {
  try {
    return await readDiscordAttachment(asset.url, {
      maxBytes: MAX_IMAGE_BYTES, timeoutMs: 20_000,
    });
  } catch (error) {
    if (error?.code === "TOO_LARGE") {
      throw new UserFacingError("Outfit images must be no larger than 24 MB before resizing.");
    }
    throw error;
  }
}

export async function resizeOutfitImage(bytes) {
  const image = await loadImage(bytes);
  if (!image.width || !image.height || image.width > 12000 || image.height > 12000) {
    throw new UserFacingError("An outfit image has unsupported dimensions.");
  }
  const factor = Math.min(1, GALLERY_WIDTH / image.width, GALLERY_HEIGHT / image.height);
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return Buffer.from(await canvas.encode("jpeg", GALLERY_JPEG_QUALITY));
}

export async function saveOutfitGalleryImages(guildId, listing, sources) {
  const candidates = sources.filter(isGalleryPhoto);
  const seen = new Set();
  let nextIndex = (await OutfitGalleryImage.findOne({
    guildId, listingId: listing._id,
  }).sort({ originalIndex: -1 }).select("originalIndex").lean())?.originalIndex + 1 || 0;

  for (const asset of candidates) {
    const sourceId = String(asset.attachmentId || asset.id || "");
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    if (await OutfitGalleryImage.exists({ guildId, listingId: listing._id, sourceId })) continue;
    const current = await OutfitGalleryImage.countDocuments({ guildId, listingId: listing._id });
    if (current >= MAX_GALLERY_MEDIA) throw new UserFacingError("Outfit listings can hold up to ten photos/videos.");
    const encoded = await resizeOutfitImage(await fetchOriginalPhoto(asset));
    // Save BEFORE removing any raw attachment. A failed write leaves original
    // media untouched, including on legacy multi-photo listings.
    await OutfitGalleryImage.updateOne({
      guildId, listingId: listing._id, sourceId,
    }, {
      $setOnInsert: {
        guildId, listingId: listing._id, ownerId: listing.ownerId,
        sourceId, name: asset.name || "Outfit photo",
        imageData: encoded, originalIndex: nextIndex,
      },
    }, { upsert: true });
    nextIndex += 1;
  }
  const stored = await OutfitGalleryImage.countDocuments({ guildId, listingId: listing._id });
  // Check all candidate photo IDs have their own saved image. Never remove
  // even one original photo if any conversion was unsuccessful.
  const distinctIds = [...seen];
  const saved = await OutfitGalleryImage.countDocuments({
    guildId, listingId: listing._id, sourceId: { $in: distinctIds },
  });
  if (saved !== distinctIds.length) {
    throw new Error("Not all outfit photos were archived. Original Discord photos must be retained.");
  }
  return stored;
}

export async function outfitGalleryCount(guildId, listingId) {
  return OutfitGalleryImage.countDocuments({ guildId, listingId });
}

/**
 * Mongoose hydrates Schema Buffer fields as Buffers, but lean() exposes BSON
 * Binary wrappers. Discord AttachmentBuilder accepts neither BSON Binary nor
 * JSON Buffer objects. Normalize explicitly and reject corrupt data.
 */
export function galleryImageBuffer(value) {
  let bytes = value;
  if (value?._bsontype === "Binary" && typeof value.value === "function") {
    bytes = value.value(true);
  } else if (value?.type === "Buffer" && Array.isArray(value.data)) {
    bytes = Buffer.from(value.data);
  }
  if (!Buffer.isBuffer(bytes) && bytes instanceof Uint8Array) {
    bytes = Buffer.from(bytes);
  }
  if (!Buffer.isBuffer(bytes) || !bytes.length) {
    throw new Error("The saved outfit gallery image is not a valid Buffer.");
  }
  return Buffer.from(bytes);
}

/**
 * Outfit photos are now rendered into the original listing card. Read the
 * saved JPEG without sending a second Discord gallery message.
 */
export async function getOutfitGalleryPage(guildId, listingId, requestedPage = 0) {
  const query = { guildId, listingId };
  const count = await OutfitGalleryImage.countDocuments(query);
  if (!count) return { imageBuffer: null, count: 0, page: 0 };
  const page = safePageIndex(Number(requestedPage) || 0, count);
  const selected = await OutfitGalleryImage.findOne(query)
    .sort({ originalIndex: 1, _id: 1 })
    .skip(page).select("imageData name originalIndex").lean();
  if (!selected) throw new Error("Outfit gallery changed during pagination; retry.");
  return { imageBuffer: galleryImageBuffer(selected.imageData), count, page };
}

/**
 * Archive all original photos before ANY message attachment gets replaced.
 * A missing/expired old CDN URL throws so migration leaves existing Discord
 * posts and gallery replies alone instead of silently discarding photos.
 */
export async function ensureGalleryArchived(guild, listing, originalMessage) {
  const sources = mergeOriginalMedia(
    listing.mediaAttachments,
    Array.from(originalMessage.attachments.values()),
  );
  const photos = sources.filter(isGalleryPhoto);
  if (photos.length) await saveOutfitGalleryImages(guild.id, listing, photos);
  let count = await outfitGalleryCount(guild.id, listing._id);

  // Recovery for older listings whose original uploads are no longer in
  // Mongo metadata or the public post, but whose old gallery reply still
  // carries the currently visible resized photo. This only recovers ONE
  // frame; do not pretend that other lost photos were restored.
  if (!count && !photos.length && listing.galleryMessageId) {
    try {
      const channel = await guild.channels.fetch(listing.postChannelId);
      const oldGallery = await channel?.messages?.fetch(listing.galleryMessageId);
      if (oldGallery?.author?.id === guild.client.user.id) {
        const displayed = Array.from(oldGallery.attachments.values())
          .find(asset => asset.name === "outfit-gallery-page.jpg");
        if (displayed) {
          await saveOutfitGalleryImages(guild.id, listing, [{
            id: displayed.id, url: displayed.url, size: displayed.size,
            name: "recovered-outfit-photo.jpg", contentType: "image/jpeg",
          }]);
          count = await outfitGalleryCount(guild.id, listing._id);
          console.warn("[Outfit] Recovered one photo from older gallery reply for", String(listing._id));
        }
      }
    } catch (error) {
      console.warn("[Outfit] Legacy gallery frame could not be recovered:", error);
    }
  }
  return { count, sources };
}

export async function deleteOutfitGallery(guild, listing) {
  // The legacy gallery reply is handled separately by the post migration
  // cleaner. Only delete stored photos when the user removes the listing.
  await OutfitGalleryImage.deleteMany({ guildId: guild.id, listingId: listing._id });
}
