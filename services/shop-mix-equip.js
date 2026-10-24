import { tryOnShopMix, normalizeShopMix } from "./shop-preview-mix.js";
import { previewPurchasePlan } from "./shop-mix-checkout.js";
import { filterOwnedAppearance } from "./appearance-ownership.js";
import { resolveAppearance } from "./post-appearance.js";

// Equip the exact purchased try-on combination over the member's most recent
// saved profile. Unselected categories retain their current appearance.
export function equipPurchasedShopMix(savedAppearance, purchasedMix, ownership, availableItems) {
  const mix = normalizeShopMix(purchasedMix);
  const quote = previewPurchasePlan(mix, ownership, availableItems);
  if (quote.purchasable.length || quote.unavailable.length) {
    return { ready: false, appearance: null };
  }
  return {
    ready: true,
    appearance: filterOwnedAppearance(
      tryOnShopMix(resolveAppearance(savedAppearance), mix),
      ownership,
    ),
  };
}
