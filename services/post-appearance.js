import {
  CLASSIC_COLOR_OPTIONS, STANDARD_BACKGROUND_ID, STANDARD_PANEL_ID, STANDARD_PANEL_OPACITY,
} from "./classic-colors.js";
import { customColorDefinition } from "./custom-colors.js";

/**
 * Appearance catalog for Canvas posts. IDs are stable shop inventory keys.
 * A later shop can add approved image assets without accepting arbitrary URLs.
 */
export const APPEARANCE_CATALOG = Object.freeze({
  backgrounds: {
    // The new Classic collection is first, in spectrum order.
    ...Object.fromEntries(CLASSIC_COLOR_OPTIONS.map(item => [item.id, {
      kind: "solid",
      color: item.hex,
      dark: item.dark,
      palette: { panel: item.hex, panelAlt: item.hex, accent: item.hex },
    }])),
    // Starter Sage is the free profile background. Keep its original ID,
    // appearance and friendly label; it is never listed as a shop product.
    default: { kind: "solid" },
    sagePreview: { kind: "solid", color: "#DCE9D7", palette: { panel: "#F3F7EF", panelAlt: "#E9F1E5", accent: "#79977C" } },
    // Other retired starter designs remain renderable for past owners,
    // but are no longer sold or offered to new members in Customize.
    paleSage: { kind: "solid", color: "#CADFC4", palette: { panel: "#EDF3E8", panelAlt: "#D4E3CF", accent: "#779A78" } },
    warmCream: { kind: "solid", color: "#F1EBDD", palette: { panel: "#FBF7EC", panelAlt: "#EBE1CD", accent: "#9C8E75" } },
    dustyBlue: { kind: "solid", color: "#DCE4EC", palette: { panel: "#EDF3F8", panelAlt: "#CBD8E5", accent: "#7C99B3" } },
    sageDots: { kind: "dots", color: "#708779" },
    garden: { kind: "image", asset: "assets/backgrounds/garden.svg", palette: { panel: "#E7E4D5", panelAlt: "#D1DAC4", accent: "#708779" } },
  },
  panels: {
    ...Object.fromEntries(CLASSIC_COLOR_OPTIONS.map(item => [item.id, {
      dark: item.dark,
      palette: { panel: item.hex, panelAlt: item.hex },
    }])),
    // Legacy palette IDs remain valid for existing owned/equipped designs.
    default: { palette: null },
    moss: { palette: { panel: "#C9D8C2", panelAlt: "#A8BFA5" } },
    lavender: { palette: { panel: "#E4D9E9", panelAlt: "#CAB7D3" } },
    sagePanel: { palette: { panel: "#EDF3E8", panelAlt: "#D4E3CF" } },
    creamPanel: { palette: { panel: "#FBF7EC", panelAlt: "#EBE1CD" } },
    bluePanel: { palette: { panel: "#EDF3F8", panelAlt: "#CBD8E5" } },
    charcoal: { dark: true, palette: { panel: "#353535", panelAlt: "#353535" } },
    forest: { dark: true, palette: { panel: "#355241", panelAlt: "#355241" } },
    navy: { dark: true, palette: { panel: "#33465D", panelAlt: "#33465D" } },
  },
  frames: {
    default: { kind: 'standard' },
    // Classic, understated outlines rendered directly with Canvas. These
    // don't depend on image assets and work with every profile background.
    fineLine: { kind: 'fineLine' },
    boldOutline: { kind: 'boldOutline' },
    dashedOutline: { kind: 'dashedOutline' },
    dottedOutline: { kind: 'dottedOutline' },
    cornerAccents: { kind: 'cornerAccents' },
    // Legacy purchased Double Line remains unchanged and equippable.
    doubleLine: { kind: 'doubleLine', color: '#354B3E' },
  },
  fonts: {
    default: { family: 'sans-serif', titleFamily: 'serif' },
    classic: { family: 'serif', titleFamily: 'serif' },
  },
  fontColors: {
    default: { text: '#29312C', mutedText: '#566159', accentDark: '#354B3E' },
    black: { text: '#111111', mutedText: '#252525', accentDark: '#111111' },
    white: { text: '#FFFFFF', mutedText: '#F0F0F0', accentDark: '#FFFFFF' },
    plum: { text: '#593C55', mutedText: '#6D5368', accentDark: '#593C55' },
  },
  stickers: {
    flower: { kind: 'flower' },
    star: { kind: 'star' },
    // Future custom artwork: add a catalog entry like
    // blossom: { kind: 'image', asset: 'assets/stickers/blossom.png' },
    // Keep IDs stable: equipped profiles save the ID, not the image bytes.

  },
});

export const DEFAULT_APPEARANCE = Object.freeze({
  background: STANDARD_BACKGROUND_ID,
  frame: 'default',
  font: 'default',
  fontColor: 'default',
  stickers: [],
  panelColor: STANDARD_PANEL_ID,
  panelOpacity: STANDARD_PANEL_OPACITY,
});

// Catalog entries are static, but an individually purchased HEX code has its
// color embedded in its ID; synthesize its safe rendering definition on demand.
export function appearanceCatalogItem(category, id) {
  return APPEARANCE_CATALOG[category]?.[id] || customColorDefinition(category, id);
}

const select = (category, id) => appearanceCatalogItem(category, id) ? id
  : category === "backgrounds" ? STANDARD_BACKGROUND_ID
  : category === "panels" ? STANDARD_PANEL_ID : "default";

/** Resolve approved appearance IDs and bounded normalized sticker transforms. */
export function resolveAppearance(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  // Old untouched Starter Sage profiles originally paired with matching
  // translucent panels. Keep the sage background but upgrade that exact
  // starter combination to the current standard gray panels. Do not change
  // other deliberate appearance selections or previously bought designs.
  const oldFreeStarter = value.background === "sagePreview" &&
    (value.panelColor === "match" || value.panelColor == null) &&
    (value.panelOpacity == null || value.panelOpacity === 0.34);
  const clamp = (n, min, max, fallback) =>
    Number.isFinite(Number(n)) ? Math.min(max, Math.max(min, Number(n))) : fallback;
  return {
    background: select("backgrounds", oldFreeStarter ? STANDARD_BACKGROUND_ID : value.background ?? STANDARD_BACKGROUND_ID),
    frame: select('frames', value.frame),
    font: select('fonts', value.font),
    fontColor: select('fontColors', value.fontColor),
    panelColor: oldFreeStarter ? STANDARD_PANEL_ID :
      value.panelColor === "match" ? "match" : select("panels", value.panelColor ?? STANDARD_PANEL_ID),
    panelOpacity: oldFreeStarter ? STANDARD_PANEL_OPACITY :
      Number.isFinite(value.panelOpacity) ? Math.min(1, Math.max(0.2, value.panelOpacity)) : STANDARD_PANEL_OPACITY,
    stickers: (Array.isArray(value.stickers) ? value.stickers : [])
      .filter(s => s && APPEARANCE_CATALOG.stickers[s.id])
      .slice(0, 8)
      .map(s => ({
        id: s.id,
        x: clamp(s.x, 0.04, 0.96, 0.85),
        y: clamp(s.y, 0.04, 0.96, 0.15),
        scale: clamp(s.scale, 0.3, 3, 1),
        rotation: clamp(s.rotation, -180, 180, 0),
      })),
  };
}
