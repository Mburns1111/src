import { CLASSIC_COLOR_FAMILIES } from "./classic-colors.js";
import { CUSTOM_COLOR_SHOP_ID } from "./custom-colors.js";

/**
 * Pure shop-directory navigation helpers. The indexed view intentionally
 * excludes full Canvas image rendering so browsing a category stays quick.
 */
export const SHOP_INDEX_PAGE_SIZE = 20;

export function shopDirectorySlice(entries, requestedPage = 0) {
  const count = Math.max(1, Math.ceil(entries.length / SHOP_INDEX_PAGE_SIZE));
  const page = Math.max(0, Math.min(count - 1,
    Number.isSafeInteger(requestedPage) ? requestedPage : 0));
  const start = page * SHOP_INDEX_PAGE_SIZE;
  return {
    page,
    count,
    start,
    visible: entries.slice(start, start + SHOP_INDEX_PAGE_SIZE),
  };
}

// Item IDs are stable even when Halloween offers expire and indices shift.
export function shopItemIndexById(entries, itemId) {
  return entries.findIndex(entry => entry.id === itemId);
}

// Group the 27 purchasable color shades into nine stable family choices.
// Individual shades remain distinct inventory items with their original prices.
// Custom HEX stays as its own entry because it has a separate purchase flow.
export function shopColorFamilyDirectory(items) {
  const lookup = new Map(items.map(item => [item.id, item]));
  const families = CLASSIC_COLOR_FAMILIES.flatMap(family => {
    const shades = ["Pastel", "Normal", "Dark"]
      .map(variant => lookup.get(`${family.id}${variant}`))
      .filter(Boolean);
    if (!shades.length) return [];
    return [{
      id: family.id,
      name: family.name,
      itemIds: shades.map(item => item.id),
      minPrice: Math.min(...shades.map(item => item.price)),
      maxPrice: Math.max(...shades.map(item => item.price)),
      isCustom: false,
    }];
  });
  const custom = lookup.get(CUSTOM_COLOR_SHOP_ID);
  if (custom) {
    families.push({
      id: custom.id,
      name: custom.name,
      itemIds: [custom.id],
      minPrice: custom.price,
      maxPrice: custom.price,
      isCustom: true,
    });
  }
  return families;
}

// From an index choose Normal as the representative shade, where members can
// select Pastel/Normal/Dark separately. Continue accepting old index messages
// carrying individual shade IDs so existing Discord DMs don't become broken.
export function shopColorDirectorySelection(items, selectedId) {
  const exactIndex = shopItemIndexById(items, selectedId);
  if (exactIndex !== -1) return exactIndex;
  const family = CLASSIC_COLOR_FAMILIES.find(entry => entry.id === selectedId);
  return family ? shopItemIndexById(items, `${family.id}Normal`) : -1;
}
