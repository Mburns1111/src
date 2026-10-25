import {
  safePageIndex,
  isGalleryPhoto as originalPhoto,
  isGalleryVideo as originalVideo,
  mergeOriginalMedia as mergeMedia,
} from "./outfit-gallery-utils.js";

export const HOUSE_ART_NAME = "house-style-card.png";
export const HOUSE_MAX_MEDIA = 10;
export { safePageIndex };

export function isGalleryPhoto(asset) {
  return asset?.name !== HOUSE_ART_NAME && originalPhoto(asset);
}
export function isGalleryVideo(asset) {
  return asset?.name !== HOUSE_ART_NAME && originalVideo(asset);
}
export function mergeOriginalMedia(databaseItems, messageItems) {
  // The generated PNG MUST NOT be counted or archived as a house photograph.
  return mergeMedia(
    (databaseItems ?? []).filter(item => item.name !== HOUSE_ART_NAME),
    (messageItems ?? []).filter(item => item.name !== HOUSE_ART_NAME),
  );
}
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
