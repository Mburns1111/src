import { CLASSIC_COLOR_OPTIONS } from "./classic-colors.js";
import { SHOP_FONT_STYLES } from "./font-library.js";
import { STICKER_CATALOG } from "./sticker-catalog.js";
import { CUSTOM_COLOR_SHOP_ID } from "./custom-colors.js";

/**
 * Classic shop categories use one category showcase image and a direct item index.
 * Complex or premium items may use different preview and layout rules later.
 *
 * These explicit, stable item IDs deliberately do NOT auto-enroll future catalog
 * additions. A new item can use its own storefront artwork without changing
 * today's shared classic presentation or its existing ownership keys.
 */
export const CLASSIC_SHOP_ITEMS = Object.freeze({
  backgrounds: Object.freeze(CLASSIC_COLOR_OPTIONS.map(item => item.id)),
  panels: Object.freeze(CLASSIC_COLOR_OPTIONS.map(item => item.id)),
  frames: Object.freeze([
    "default", "doubleLine", "softRounded", "silverFloral", "goldCelestial", "blackKnight",
  ]),
  fonts: Object.freeze(["default", ...Object.keys(SHOP_FONT_STYLES)]),
  fontColors: Object.freeze(["default", "black", "white", "plum"]),
  stickers: Object.freeze(Object.keys(STICKER_CATALOG)),
});

export const SHOP_PRESENTATION_RULES = Object.freeze(
  Object.fromEntries(Object.keys(CLASSIC_SHOP_ITEMS).map(category =>
    [category, Object.freeze({
      classic: "category-sheet",
      classicNavigation: "direct-index",
      complex: "standalone", // opt-in presentation for future items
    })])),
);

export function isClassicShopItem(category, itemId) {
  return CLASSIC_SHOP_ITEMS[category]?.includes(itemId) ?? false;
}

export function classicShowcaseItems(category, items) {
  return items.filter(item => item.category === category &&
    isClassicShopItem(category, item.id));
}

export function complexShowcaseItems(category, items) {
  return items.filter(item => item.category === category &&
    !isClassicShopItem(category, item.id) && !item.included &&
    item.id !== CUSTOM_COLOR_SHOP_ID);
}
