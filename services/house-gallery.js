import HouseGalleryImage from "../models/HouseGalleryImage.js";
import { resizeOutfitImage, galleryImageBuffer } from "./outfit-gallery.js";
import { isGalleryPhoto, mergeOriginalMedia, safePageIndex } from "./house-style.js";
import { UserFacingError } from "../commands/errors.js";

const MAX_BYTES = 24 * 1024 * 1024;
function safeSource(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" &&
      ["cdn.discordapp.com", "media.discordapp.net"].includes(u.hostname);
  } catch { return false; }
}
async function downloadPhoto(item) {
  if (!safeSource(item.url)) throw new UserFacingError("A house photo has an invalid Discord attachment URL.");
  const response = await fetch(item.url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Could not retrieve house photo ${item.name}: HTTP ${response.status}`);
  if (Number(response.headers.get("content-length") || 0) > MAX_BYTES) {
    throw new UserFacingError("A house photo exceeds the safe 24 MB conversion limit.");
  }
  const raw = Buffer.from(await response.arrayBuffer());
  if (!raw.length || raw.length > MAX_BYTES) throw new UserFacingError("A house photo is too large.");
  return raw;
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
  const photos = await HouseGalleryImage.find({ guildId, listingId })
    .sort({ originalIndex: 1, _id: 1 }).select("imageData").lean();
  if (!photos.length) return { imageBuffer: null, count: 0, page: 0 };
  const page = safePageIndex(Number(index) || 0, photos.length);
  return { imageBuffer: galleryImageBuffer(photos[page].imageData), count: photos.length, page };
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
