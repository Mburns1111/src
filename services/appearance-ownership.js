import AppearanceInventory from "../models/AppearanceInventory.js";
import { APPEARANCE_CATALOG, resolveAppearance } from "./post-appearance.js";

// Free starter options. All other catalog entries require an owned item.
// Adjust this curated list when the free starter catalog is finalized.
export const FREE_APPEARANCE = Object.freeze({
  backgrounds: ["default", "sagePreview"],
  panels: ["default"],
  frames: ["default"],
  fonts: ["default"],
  fontColors: ["default"],
  stickers: [],
});
export const APPEARANCE_FIELD_CATEGORY = Object.freeze({
  background: "backgrounds",
  panelColor: "panels",
  frame: "frames",
  font: "fonts",
  fontColor: "fontColors",
});
export async function getAppearanceOwnership(guildId, discordUserId) {
  const record = await AppearanceInventory.findOne({ guildId, discordUserId }).lean();
  return Object.fromEntries(Object.keys(FREE_APPEARANCE).map(category => [
    category,
    new Set([
      ...FREE_APPEARANCE[category],
      ...(record?.owned?.[category] || []).filter(id => Boolean(APPEARANCE_CATALOG[category][id])),
    ]),
  ]));
}
export function ownsAppearanceItem(ownership, category, id) {
  return Boolean(APPEARANCE_CATALOG[category]?.[id] && ownership[category]?.has(id));
}
export function filterOwnedAppearance(input, ownership) {
  const appearance = resolveAppearance(input);
  for (const [field, category] of Object.entries(APPEARANCE_FIELD_CATEGORY)) {
    if (field === "panelColor" && appearance[field] === "match") continue;
    if (!ownsAppearanceItem(ownership, category, appearance[field])) {
      appearance[field] = field === "background" ? "sagePreview" : field === "panelColor" ? "match" : "default";
    }
  }
  appearance.stickers = appearance.stickers.filter(sticker =>
    ownsAppearanceItem(ownership, "stickers", sticker.id));
  return appearance;
}
// Shop fulfillment can call this only after validating a completed purchase.
export async function grantAppearanceItem(guildId, discordUserId, category, id) {
  if (!APPEARANCE_CATALOG[category]?.[id]) throw new Error("Unknown appearance catalog item.");
  return AppearanceInventory.findOneAndUpdate(
    { guildId, discordUserId },
    { $addToSet: { [`owned.${category}`]: id } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
}
