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
