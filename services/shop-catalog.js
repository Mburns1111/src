import {
  CLASSIC_COLOR_OPTIONS, CLASSIC_BACKGROUND_PRICES, CLASSIC_PANEL_PRICES,
} from "./classic-colors.js";
import { APPEARANCE_CATALOG } from "./post-appearance.js";
import { CUSTOM_COLOR_SHOP_ID, CUSTOM_COLOR_PRICES } from "./custom-colors.js";
import { FREE_APPEARANCE } from "./appearance-ownership.js";
import { SHOP_FONT_STYLES } from "./font-library.js";
import { STICKER_CATALOG, isStickerForSale } from "./sticker-catalog.js";

// Classic colors are in color-wheel order: Pastel, Normal, Dark within each
// family. The original free Starter Sage background is NOT a shop item;
// all 27 Classic backgrounds cost Points. Custom HEX colors cost three times the normal price. Only Classic Gray panel
// is included at 0 Points. Retired paid starter styles remain renderable.
const prices = {
  backgrounds: { ...CLASSIC_BACKGROUND_PRICES, [CUSTOM_COLOR_SHOP_ID]: CUSTOM_COLOR_PRICES.backgrounds },
  panels: { ...CLASSIC_PANEL_PRICES, [CUSTOM_COLOR_SHOP_ID]: CUSTOM_COLOR_PRICES.panels },
  // ID order is shop browsing order. 'default' is free but never purchased.
  frames: {
    default: 0,
    doubleLine: 125,
    softRounded: 125,
    silverFloral: 300,
    goldCelestial: 300,
    blackKnight: 300,
  },
  // Standard Clean is free. Older purchased Classic Serif remains a supported
  // equipped style but is retired from new shop sales.
  fonts: {
    default: 0,
    ...Object.fromEntries(Object.entries(SHOP_FONT_STYLES).map(([id, item]) => [id, item.price])),
  },
  // Old Plum remains renderable for existing profiles but was test-only, not for sale.
  fontColors: { [CUSTOM_COLOR_SHOP_ID]: CUSTOM_COLOR_PRICES.fontColors },
  stickers: Object.fromEntries(Object.entries(STICKER_CATALOG).map(([id, item]) => [id, item.price])),
};
const names = {
  ...Object.fromEntries(CLASSIC_COLOR_OPTIONS.map(item => [item.id, item.name])),
  default: "Classic Thin", doubleLine: "Double Line", softRounded: "Soft Rounded",
  silverFloral: "Silver Floral", goldCelestial: "Golden Celestial",
  blackKnight: "Black Knight", classic: "Classic Serif",
  ...Object.fromEntries(Object.entries(SHOP_FONT_STYLES).map(([id, item]) => [id, item.name])),
  ...Object.fromEntries(Object.entries(STICKER_CATALOG).map(([id, item]) => [id, item.name])),
  [CUSTOM_COLOR_SHOP_ID]: "Custom HEX Color",
};
export function shopItems() {
  return Object.entries(prices).flatMap(([category, entries]) =>
    Object.entries(entries)
      .filter(([id]) => (id === CUSTOM_COLOR_SHOP_ID || Boolean(APPEARANCE_CATALOG[category]?.[id])) &&
        (category !== "stickers" || isStickerForSale(id)))
      .map(([id, price]) => ({
        category, id, name: names[id] || id, price,
        included: FREE_APPEARANCE[category]?.includes(id) || false,
      })),
  );
}
export function shopItem(category, id) {
  return shopItems().find(item => item.category === category && item.id === id);
}
