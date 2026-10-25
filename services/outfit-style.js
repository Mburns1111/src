export const OUTFIT_PICK_PAGE_SIZE = 20;

export function outfitPhotoUrl(listing) {
  const images = listing?.mediaAttachments ?? [];
  return images.find(asset =>
    asset?.contentType?.toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|webp|avif)$/i.test(asset?.name ?? "")
  )?.url ?? null;
}

export function outfitCardData(listing) {
  return {
    title: listing.title,
    seller: [listing.ownerName, listing.ownerRobloxUsername]
      .filter(Boolean).join(" · "),
    cost: listing.cost || "Not listed",
    description: listing.description,
  };
}

export function outfitPickerOptions(listings) {
  return listings.map(listing => ({
    label: String(listing.title || "Untitled outfit").slice(0, 100),
    value: String(listing._id),
    description: `Listing ${String(listing._id).slice(-8)} · ${String(listing.cost || "No cost").slice(0, 55)}`,
  }));
}

export const OUTFIT_STYLE_IMAGE_NAME = "outfit-style-card.png";
export const MAX_DISCORD_ATTACHMENTS = 10;

// The decorative PNG is not a buyer-uploaded photo/video.
export function isOutfitMediaAttachment(attachment) {
  return attachment?.name !== OUTFIT_STYLE_IMAGE_NAME;
}

export function outfitGalleryMedia(attachments) {
  return Array.from(attachments ?? []).filter(isOutfitMediaAttachment);
}

// Every upload remains a gallery attachment. Style artwork uses the original
// message when there is room, and an optional reply when all ten slots are full.
export function outfitStylePlacement(mediaCount) {
  if (!Number.isSafeInteger(mediaCount) || mediaCount < 0 || mediaCount > MAX_DISCORD_ATTACHMENTS) {
    throw new RangeError("Invalid outfit media count.");
  }
  return mediaCount < MAX_DISCORD_ATTACHMENTS ? "original" : "reply";
}

export function outfitPhotoUrls(listing, limit = 3) {
  return (listing?.mediaAttachments ?? [])
    .filter(asset =>
      asset?.contentType?.toLowerCase().startsWith("image/") ||
      /\.(png|jpe?g|webp|avif)$/i.test(asset?.name ?? "")
    )
    .slice(0, limit)
    .map(asset => asset.url);
}
