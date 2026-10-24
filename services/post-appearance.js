/**
 * Appearance catalog for Canvas posts. IDs are stable shop inventory keys.
 * A later shop can add approved image assets without accepting arbitrary URLs.
 */
export const APPEARANCE_CATALOG = Object.freeze({
  backgrounds: {
    default: { kind: 'solid' },
    sagePreview: { kind: 'solid', color: '#DCE9D7', palette: { panel: '#F3F7EF', panelAlt: '#E9F1E5', accent: '#79977C' } },
    // Affordable classic solid backgrounds; matching palettes are automatic.
    paleSage: { kind: 'solid', color: '#CADFC4', palette: { panel: '#EDF3E8', panelAlt: '#D4E3CF', accent: '#779A78' } },
    warmCream: { kind: 'solid', color: '#F1EBDD', palette: { panel: '#FBF7EC', panelAlt: '#EBE1CD', accent: '#9C8E75' } },
    dustyBlue: { kind: 'solid', color: '#DCE4EC', palette: { panel: '#EDF3F8', panelAlt: '#CBD8E5', accent: '#7C99B3' } },
    sageDots: { kind: 'dots', color: '#708779' },
    garden: { kind: 'image', asset: 'assets/backgrounds/garden.svg', palette: { panel: '#E7E4D5', panelAlt: '#D1DAC4', accent: '#708779' } },
  },
  panels: {
    default: { palette: null },
    moss: { palette: { panel: '#C9D8C2', panelAlt: '#A8BFA5' } },
    lavender: { palette: { panel: '#E4D9E9', panelAlt: '#CAB7D3' } },
    sagePanel: { palette: { panel: '#EDF3E8', panelAlt: '#D4E3CF' } },
    creamPanel: { palette: { panel: '#FBF7EC', panelAlt: '#EBE1CD' } },
    bluePanel: { palette: { panel: '#EDF3F8', panelAlt: '#CBD8E5' } },
    // Dark starter panels. Renderer ensures contrast when default text is used.
    charcoal: { dark: true, palette: { panel: '#353535', panelAlt: '#353535' } },
    forest: { dark: true, palette: { panel: '#355241', panelAlt: '#355241' } },
    navy: { dark: true, palette: { panel: '#33465D', panelAlt: '#33465D' } },
  },
  frames: {
    default: { kind: 'standard' },
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
  background: 'default',
  frame: 'default',
  font: 'default',
  fontColor: 'default',
  stickers: [],
  panelColor: 'match',
  panelOpacity: 0.34,
});

const select = (category, id) => APPEARANCE_CATALOG[category][id]
  ? id : 'default';

/** Resolve approved appearance IDs and bounded normalized sticker transforms. */
export function resolveAppearance(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const clamp = (n, min, max, fallback) =>
    Number.isFinite(Number(n)) ? Math.min(max, Math.max(min, Number(n))) : fallback;
  return {
    background: select('backgrounds', value.background),
    frame: select('frames', value.frame),
    font: select('fonts', value.font),
    fontColor: select('fontColors', value.fontColor),
    panelColor: value.panelColor === 'match' ? 'match' : select('panels', value.panelColor),
    panelOpacity: Number.isFinite(value.panelOpacity) ? Math.min(1, Math.max(0.2, value.panelOpacity)) : 0.34,
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
