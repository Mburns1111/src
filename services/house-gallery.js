import HouseGalleryImage from "../models/HouseGalleryImage.js";
import { resizeOutfitImage, galleryImageBuffer } from "./outfit-gallery.js";
import { isGalleryPhoto, mergeOriginalMedia, safePageIndex } from "./house-style.js";
import { UserFacingError } from "../commands/errors.js";
import { readDiscordAttachment } from "./media-transfer.js";

const MAX_BYTES = 24 * 1024 * 1024;
async function downloadPhoto(item) {
  try {
    return await readDiscordAttachment(item.url, {
      maxBytes: MAX_BYTES, timeoutMs: 20_000,
    });
  } catch (error) {
    if (error?.code === "TOO_LARGE") {
      throw new UserFacingError("A house photo exceeds the 24 MB conversion limit.");
    }
    throw error;
  }
}

export async function archiveHousePhotos(guildId, listing, sources) {
  const candidates = sources.filter(isGalleryPhoto);
  const unique = new Set();
  let last = (await HouseGalleryImage.findOne({ guildId, listingId: listing._id })
    .sort({ originalIndex: -1 }).select("originalIndex").lean())?.originalIndex ?? -1;
  for (const item of candidates) {
    const sourceId = String(item.attachmentId || item.id || "");
    if (!sourceId || unique.has(sourceId)) continue;
    unique.add(sourceId);
    if (await HouseGalleryImage.exists({ guildId, listingId: listing._id, sourceId })) continue;
    const bytes = await resizeOutfitImage(await downloadPhoto(item));
    await HouseGalleryImage.updateOne({ guildId, listingId: listing._id, sourceId }, {
      $setOnInsert: {
        guildId, listingId: listing._id, ownerId: listing.ownerId, sourceId,
        name: item.name || "House photo", imageData: bytes, originalIndex: ++last,
      },
    }, { upsert: true });
  }
  const saved = await HouseGalleryImage.countDocuments({
    guildId, listingId: listing._id, sourceId: { $in: [...unique] },
  });
  if (saved !== unique.size) throw new Error("Could not safely archive every original house photo.");
  return HouseGalleryImage.countDocuments({ guildId, listingId: listing._id });
}
export async function houseGalleryCount(guildId, listingId) {
  return HouseGalleryImage.countDocuments({ guildId, listingId });
}
export async function getHouseGalleryPage(guildId, listingId, index = 0) {
  const query = { guildId, listingId };
  const count = await HouseGalleryImage.countDocuments(query);
  if (!count) return { imageBuffer: null, count: 0, page: 0 };
  const page = safePageIndex(Number(index) || 0, count);
  const photo = await HouseGalleryImage.findOne(query)
    .sort({ originalIndex: 1, _id: 1 }).skip(page).select("imageData").lean();
  if (!photo) throw new Error("House gallery changed during pagination; retry.");
  return { imageBuffer: galleryImageBuffer(photo.imageData), count, page };
}
export async function archiveExistingHousePhotos(guild, listing, message) {
  const sources = mergeOriginalMedia(
    listing.mediaAttachments || [], Array.from(message.attachments.values()),
  );
  await archiveHousePhotos(guild.id, listing, sources);
  return sources;
}
export async function deleteHouseGallery(guildId, listingId) {
  return HouseGalleryImage.deleteMany({ guildId, listingId });
}
