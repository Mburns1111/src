/**
 * Sticker definitions. Member inventory owns the stable ID, not the color.
 * All colors/position/scale are saved per placed sticker instance instead.
 *
 * Seasonal rotation hides designs from the storefront ONLY. Previously owned
 * seasonal stickers remain visible in Customize and remain renderable forever.
 *
 * Halloween automatically runs Oct 1–31 in America/New_York each year.
 * To manually control seasons set STICKER_SEASONS_OVERRIDE=off or =halloween
 * (comma-separated keys); unset to return to automatic annual windows.
 */
export const STICKER_CATALOG = Object.freeze({
  heart:        { name: "Heart",         price: 50, seasonal: false, colors: 1, color: "#E68EAB" },
  star:         { name: "Star",          price: 50, seasonal: false, colors: 1, color: "#F2C969" },
  // 'flower' is the old purchased ID. Keep it so earlier Flower owners
  // automatically own Daisy without needing a migration or repurchase.
  flower:       { name: "Daisy",         price: 75, seasonal: false, colors: 2, color: "#F7F7F2", accentColor: "#F2C969" },
  crescent:     { name: "Crescent",      price: 50, seasonal: false, colors: 1, color: "#A4B5DC" },
  sparkle:      { name: "Sparkle",       price: 50, seasonal: false, colors: 1, color: "#E0B1E7" },
  spookyBat:    { name: "Spooky Bat",    price: 50, seasonal: true, seasonKey: "halloween", colors: 1, color: "#363046" },
  littleGhost:  { name: "Little Ghost",  price: 75, seasonal: true, seasonKey: "halloween", colors: 2, color: "#F9F9FF", accentColor: "#303043" },
  pumpkinPatch: { name: "Pumpkin Patch", price: 75, seasonal: true, seasonKey: "halloween", colors: 2, color: "#EC8C39", accentColor: "#587E42" },
});

export const STICKER_OUTLINES = Object.freeze(["auto", "black", "white", "none"]);

export function isStickerForSale(id, now = new Date(), override = process.env.STICKER_SEASONS_OVERRIDE) {
  const item = STICKER_CATALOG[id];
  if (!item) return false;
  if (!item.seasonal) return true;
  if (override !== undefined && override !== "") {
    return override.toLowerCase().split(",").map(s => s.trim()).includes(item.seasonKey);
  }
  const month = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "numeric",
  }).format(now);
  return item.seasonKey === "halloween" && month === "10";
}

export function stickerDefaults(id, x = 0.8, y = 0.72) {
  const item = STICKER_CATALOG[id];
  if (!item) return null;
  return {
    id, x, y, scale: 1, rotation: 0,
    color: item.color,
    accentColor: item.colors === 2 ? item.accentColor : null,
    outline: "auto",
  };
}

export function validStickerHex(value) {
  if (typeof value !== "string") return null;
  const match = /^#?([a-fA-F0-9]{6})$/.exec(value.trim());
  return match ? "#" + match[1].toUpperCase() : null;
}
