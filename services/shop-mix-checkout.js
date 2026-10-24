import { normalizeShopMix } from "./shop-preview-mix.js";
import { shopItems } from "./shop-catalog.js";
import { ownsAppearanceItem } from "./appearance-ownership.js";

// Only explicit try-on selections are considered. The user's already-equipped
// profile is not part of the shopping cart. Fonts may appear in two profile
// slots, but they must be purchased only once.
export function previewPurchasePlan(rawMix, ownership, availableItems = shopItems()) {
  const mix = normalizeShopMix(rawMix);
  const selected = [
    ...["backgrounds", "panels", "frames", "fontColors", "stickers"]
      .filter(category => mix[category] &&
        !(category === "panels" && mix[category] === "match") &&
        !(category === "stickers" && mix[category] === "none"))
      .map(category => ({ category, id: mix[category] })),
    ...[mix.headerFont, mix.bodyFont]
      .filter(Boolean).map(id => ({ category: "fonts", id })),
  ];
  const products = new Map(availableItems.map(item => [`${item.category}:${item.id}`, item]));
  const unique = new Set();
  const entries = [];
  for (const choice of selected) {
    const key = `${choice.category}:${choice.id}`;
    if (unique.has(key)) continue;
    unique.add(key);
    const item = products.get(key);
    const owned = ownsAppearanceItem(ownership, choice.category, choice.id);
    // A previously purchased seasonal/retired item can still be tried on.
    // An unowned item removed from sale is never silently assigned a price.
    const unavailable = !owned && !item;
    entries.push({
      category: choice.category,
      id: choice.id,
      name: item?.name || choice.id,
      price: owned ? 0 : item?.price ?? 0,
      catalogPrice: item?.price ?? null,
      owned,
      unavailable,
      free: Boolean(item?.included || item?.price === 0),
    });
  }
  const purchasable = entries.filter(item => !item.owned && !item.unavailable &&
    !item.free && item.price > 0);
  return {
    entries,
    purchasable,
    total: purchasable.reduce((total, item) => total + item.price, 0),
    unavailable: entries.filter(item => item.unavailable),
  };
}

// A confirmation is bound to exact stable product IDs and current prices.
// Prices and availability may change before a click: recompute in a transaction
// and reject an outdated quote instead of charging the wrong amount.
export function previewPurchaseFingerprint(plan) {
  return JSON.stringify({
    items: plan.purchasable.map(item => [item.category, item.id, item.price])
      .sort((a, b) => `${a[0]}:${a[1]}`.localeCompare(`${b[0]}:${b[1]}`)),
    total: plan.total,
    unavailable: plan.unavailable.map(item => `${item.category}:${item.id}`).sort(),
  });
}
