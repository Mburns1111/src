import { DEFAULT_APPEARANCE } from "./post-appearance.js";
import { filterOwnedAppearance, getAppearanceOwnership } from "./appearance-ownership.js";

/**
 * New listings inherit the member's purchased profile colors, fonts, panels
 * and frame as an independent snapshot. Stickers are deliberately opt-in:
 * members must place them in each listing's editor themselves.
 */
export function snapshotListingAppearance(profile, ownership) {
  const appearance = filterOwnedAppearance(profile?.profileAppearance ?? DEFAULT_APPEARANCE, ownership);
  return { ...appearance, stickers: [] };
}

export async function snapshotOwnedListingAppearance(guildId, ownerId, profile) {
  const ownership = await getAppearanceOwnership(guildId, ownerId);
  return snapshotListingAppearance(profile, ownership);
}

/**
 * Previously saved listing styles—including stickers placed by the owner—stay
 * exactly as saved. Old listings without a style use the same sticker-free
 * profile starting point, but the fallback itself never writes to MongoDB.
 */
export function displayListingAppearance(listing, profile, ownership) {
  if (listing?.postAppearance != null) {
    return filterOwnedAppearance(listing.postAppearance, ownership);
  }
  return snapshotListingAppearance(profile, ownership);
}
