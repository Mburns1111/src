// This image is a BOT-generated decoration, not a member photo.
export const OUTFIT_BANNER_NAME = "outfit-style-card.png";
export const GALLERY_PAGE_NAME = "outfit-gallery-page.jpg";
export const MAX_GALLERY_MEDIA = 10;
export const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
export const GALLERY_WIDTH = 1120;
export const GALLERY_HEIGHT = 840;
export const GALLERY_JPEG_QUALITY = 82;

export function isGalleryPhoto(asset) {
  if (!asset || [OUTFIT_BANNER_NAME, GALLERY_PAGE_NAME].includes(asset.name)) return false;
  return asset.contentType?.toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|avif)$/i.test(asset.name || "");
}

export function isGalleryVideo(asset) {
  if (!asset || [OUTFIT_BANNER_NAME, GALLERY_PAGE_NAME].includes(asset.name)) return false;
  return asset.contentType?.toLowerCase().startsWith("video/") ||
    /\.(mp4|mov|webm|m4v)$/i.test(asset.name || "");
}

export function isGalleryMedia(asset) {
  return isGalleryPhoto(asset) || isGalleryVideo(asset);
}

export function safePageIndex(index, count) {
  return count ? ((index % count) + count) % count : 0;
}

// Original gallery media may be split across historical Mongo metadata and
// Discord attachments. Merge by stable attachment IDs without discarding
// metadata for photos that might still be retrievable by their old CDN URL.
export function mergeOriginalMedia(databaseItems, messageItems) {
  const collected = new Map();
  for (const asset of [...(databaseItems || []), ...(messageItems || [])]) {
    const id = asset.attachmentId || asset.id;
    if (!id || !isGalleryMedia(asset)) continue;
    const old = collected.get(id);
    collected.set(id, {
      ...(old || {}), ...asset,
      attachmentId: id,
      url: asset.url || old?.url,
    });
  }
  return Array.from(collected.values());
}

export function galleryNavigationButtons(index, count) {
  return {
    previous: safePageIndex(index - 1, count),
    next: safePageIndex(index + 1, count),
    count,
  };
}
