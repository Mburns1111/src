import { resolveAppearance, APPEARANCE_CATALOG } from "./post-appearance.js";
import { shopItem } from "./shop-catalog.js";

// Private, unpurchased dress-up selections. These are NEVER saved to the
// equipped profile or inventory and cannot cause a Points transaction.
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

export function isShopMixChoice(category, id) {
  if (!SHOP_MIX_CATEGORIES.includes(category) || typeof id !== "string") return false;
  if (category === "panels" && id === "match") return true;
  if (category === "stickers" && id === "none") return true;
  // Allows free standard font/text colors and a previous paid starter color in
  // an older persisted mix without making either a new purchasable shop item.
  return Object.prototype.hasOwnProperty.call(APPEARANCE_CATALOG[category], id);
}

export function normalizeShopMix(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const mix = {};
  for (const category of SHOP_MIX_CATEGORIES) {
    if (isShopMixChoice(category, value[category])) mix[category] = value[category];
  }
  return mix;
}

export function tryOnShopMix(savedAppearance, savedMix = {}, candidate = null) {
  const appearance = resolveAppearance(savedAppearance);
  const mix = normalizeShopMix(savedMix);
  // Individual item previews are transient; the live dress-up editor saves a
  // new mix selection as soon as the user chooses it.
  if (candidate && shopItem(candidate.category, candidate.id)) {
    mix[candidate.category] = candidate.id;
  }

  for (const category of SHOP_MIX_CATEGORIES) {
    const id = mix[category];
    if (!id) continue;

    if (category === "stickers") {
      appearance.stickers = id === "none" ? [] : [
        { id, x: 0.8, y: 0.72, scale: 1.4, rotation: 0 },
      ];
    } else {
      appearance[APPEARANCE_FIELD[category]] = id;
    }
  }

  if (APPEARANCE_CATALOG.panels[appearance.panelColor]?.dark ||
      (appearance.panelColor === "match" &&
       APPEARANCE_CATALOG.backgrounds[appearance.background]?.dark)) {
    appearance.panelOpacity = 0.9;
  }

  return resolveAppearance(appearance);
}
