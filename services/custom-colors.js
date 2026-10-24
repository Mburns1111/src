// Hex colors bought by a member are immutable IDs in AppearanceInventory:
// owned.backgrounds / owned.panels / owned.fontColors contain customHexRRGGBB.
// Since the hex is
// encoded in the ID, every purchase survives restarts and can be re-equipped
// without storing a separate, mutable color slot.
export const CUSTOM_COLOR_SHOP_ID = "customHex";
export const CUSTOM_COLOR_PRICES = Object.freeze({
  backgrounds: 225, // 3 x a regular 75-Point background
  panels: 150,      // 3 x a regular 50-Point panel
  fontColors: 100,  // User-selected price for custom profile text colors
});

export function normalizeHexColor(value) {
  if (typeof value !== "string") return null;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? `#${match[1].toUpperCase()}` : null;
}

export function customColorId(hex) {
  const normalized = normalizeHexColor(hex);
  return normalized ? `${CUSTOM_COLOR_SHOP_ID}${normalized.slice(1)}` : null;
}

export function customColorHex(id) {
  if (typeof id !== "string") return null;
  const match = /^customHex([0-9A-F]{6})$/.exec(id);
  return match ? `#${match[1]}` : null;
}

function isDark(hex) {
  const channels = [1, 3, 5].map(offset =>
    parseInt(hex.slice(offset, offset + 2), 16) / 255
  ).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722 < 0.18;
}

export function customColorDefinition(category, id) {
  if (!["backgrounds", "panels", "fontColors"].includes(category)) return null;
  const color = customColorHex(id);
  if (!color) return null;
  const dark = isDark(color);
  // A chosen text HEX controls all text shades. Unlike "default" text,
  // explicitly chosen colors are never changed automatically on dark panels.
  if (category === "fontColors") {
    return { text: color, mutedText: color, accentDark: color };
  }
  return category === "backgrounds"
    ? { kind: "solid", color, dark,
        palette: { panel: color, panelAlt: color, accent: color } }
    : { dark, palette: { panel: color, panelAlt: color } };
}

export function customColorLabel(id) {
  const hex = customColorHex(id);
  return hex ? `Custom ${hex}` : null;
}
