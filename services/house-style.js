import { safePageIndex, isGalleryPhoto, isGalleryVideo, mergeOriginalMedia } from "./outfit-gallery-utils.js";
export { safePageIndex, isGalleryPhoto, isGalleryVideo, mergeOriginalMedia };
export const HOUSE_ART_NAME = "house-style-card.png";
export const HOUSE_MAX_MEDIA = 10;
export function houseCardData(listing) {
  return {
    title: listing.title,
    seller: [listing.ownerName, listing.ownerRobloxUsername].filter(Boolean).join(" · "),
    askingPrice: listing.askingPrice,
    estimatedValue: listing.estimatedValue,
    description: listing.description,
  };
}
export function housePickerOptions(listings) {
  return listings.map(listing => ({
    label: String(listing.title || "Untitled house").slice(0, 100),
    value: String(listing._id),
    description: `House ${String(listing._id).slice(-8)} · ${String(listing.askingPrice || "No asking price").slice(0, 55)}`,
  }));
}
export function houseComponents(listing, count = 0) {
  // Components are built separately in commands/house.js to avoid a cycle.
  return { count, index: safePageIndex(listing.galleryPageIndex ?? 0, count) };
}
