import { resolveAppearance, APPEARANCE_CATALOG } from "./post-appearance.js";
import { shopItem } from "./shop-catalog.js";

// A mix is just the IDs of one shop item in each category. It is NOT owned
// inventory and never changes the member's equipped appearance or Points.
export const SHOP_MIX_CATEGORIES = Object.freeze([
  "backgrounds", "panels", "frames", "fonts", "fontColors", "stickers",
]);

const APPEARANCE_FIELD = Object.freeze({
  backgrounds: "background",
  panels: "panelColor",
  frames: "frame",
  fonts: "font",
  fontColors: "fontColor",
});

// Ignore removed/invalid catalog items in previously saved mix documents.
export function normalizeShopMix(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const mix = {};
  for (const category of SHOP_MIX_CATEGORIES) {
    const id = value[category];
    if (typeof id === "string" && shopItem(category, id)) mix[category] = id;
  }
  return mix;
}

export function tryOnShopMix(savedAppearance, savedMix = {}, candidate = null) {
  const appearance = resolveAppearance(savedAppearance);
  const mix = normalizeShopMix(savedMix);
  // Current item is shown on top of the mix *without* adding it until the
  // member chooses Add to Mix. One selected item per category is kept.
  if (candidate && shopItem(candidate.category, candidate.id)) {
    mix[candidate.category] = candidate.id;
  }

  for (const category of SHOP_MIX_CATEGORIES) {
    const id = mix[category];
    if (!id) continue;

    if (category === "stickers") {
      // The shop previews one sticker from this category; the profile editor
      // remains responsible for placing multiple owned stickers.
      appearance.stickers = [
        { id, x: 0.8, y: 0.72, scale: 1.4, rotation: 0 },
      ];
      continue;
    }
    appearance[APPEARANCE_FIELD[category]] = id;
    if (category === "panels" && APPEARANCE_CATALOG.panels[id]?.dark) {
      // Dark panels are genuinely dark in a try-on even with the starter
      // 34% opacity. The live editor uses the same dark-panel preset.
      appearance.panelOpacity = 0.9;
    }
  }

  return resolveAppearance(appearance);
}
