import {
  CLASSIC_COLOR_OPTIONS, CLASSIC_BACKGROUND_PRICES, CLASSIC_PANEL_PRICES,
} from "./classic-colors.js";
import { APPEARANCE_CATALOG } from "./post-appearance.js";
import { FREE_APPEARANCE } from "./appearance-ownership.js";

// Classic colors are in color-wheel order: Pastel, Normal, Dark within each
// family. The original free Starter Sage background is NOT a shop item;
// all 27 Classic backgrounds cost Points. Only the standard Classic Gray panel
// is included at 0 Points. Retired paid starter styles remain renderable.
const prices = {
  backgrounds: CLASSIC_BACKGROUND_PRICES,
  panels: CLASSIC_PANEL_PRICES,
  frames: { doubleLine: 125 },
  fonts: { classic: 100 },
  fontColors: { plum: 75 },
  stickers: { flower: 50, star: 50 },
};
const names = {
  ...Object.fromEntries(CLASSIC_COLOR_OPTIONS.map(item => [item.id, item.name])),
  doubleLine: "Double Line", classic: "Classic Serif", plum: "Plum",
  flower: "Flower", star: "Star",
};
export function shopItems() {
  return Object.entries(prices).flatMap(([category, entries]) =>
    Object.entries(entries)
      .filter(([id]) => Boolean(APPEARANCE_CATALOG[category]?.[id]))
      .map(([id, price]) => ({
        category, id, name: names[id] || id, price,
        included: FREE_APPEARANCE[category]?.includes(id) || false,
      })),
  );
}
export function shopItem(category, id) {
  return shopItems().find(item => item.category === category && item.id === id);
}
