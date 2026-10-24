import { DEFAULT_APPEARANCE } from "./post-appearance.js";
import { filterOwnedAppearance, getAppearanceOwnership } from "./appearance-ownership.js";

/**
 * A new listing starts with a COPY of the member's current profile look.
 * Later profile changes must never mutate already-published listing styles.
 * Saved listing looks are always checked against the member's owned items.
 */
export function snapshotListingAppearance(profile, ownership) {
  return filterOwnedAppearance(profile?.profileAppearance ?? DEFAULT_APPEARANCE, ownership);
}

export async function snapshotOwnedListingAppearance(guildId, ownerId, profile) {
  const ownership = await getAppearanceOwnership(guildId, ownerId);
  return snapshotListingAppearance(profile, ownership);
}

/**
 * Old listings have no style recorded. They can be presented using the member's
 * current profile as a starting point until the owner explicitly saves a look.
 * This fallback must not write to the listing database.
 */
export function displayListingAppearance(listing, profile, ownership) {
  return filterOwnedAppearance(
    listing?.postAppearance ?? profile?.profileAppearance ?? DEFAULT_APPEARANCE,
    ownership,
  );
}
