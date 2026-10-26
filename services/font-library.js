import { GlobalFonts } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";

// These five open-licensed fonts ship with the bot, so the same face renders
// on Replit and Wispbyte even when the hosts have different system fonts.
// Each OFL.txt is bundled under assets/fonts/licenses/.
export const SHOP_FONT_STYLES = Object.freeze({
  nunito: {
    name: "Cozy Rounded", price: 125,
    family: '"AM Nunito", sans-serif', titleFamily: '"AM Nunito", sans-serif',
    weight: "normal", asset: "../assets/fonts/Nunito.ttf", registeredFamily: "AM Nunito",
  },
  silkscreen: {
    name: "Retro Arcade", price: 175,
    family: '"AM Silkscreen", monospace', titleFamily: '"AM Silkscreen", monospace',
    weight: "normal", asset: "../assets/fonts/Silkscreen-Regular.ttf", registeredFamily: "AM Silkscreen",
  },
  cinzel: {
    name: "Royal Fantasy", price: 300,
    family: '"AM Cinzel", serif', titleFamily: '"AM Cinzel", serif',
    weight: "normal", asset: "../assets/fonts/Cinzel.ttf", registeredFamily: "AM Cinzel",
  },
  caveat: {
    name: "Handwritten", price: 250,
    family: '"AM Caveat", cursive', titleFamily: '"AM Caveat", cursive',
    weight: "normal", asset: "../assets/fonts/Caveat.ttf", registeredFamily: "AM Caveat",
  },
  dancingBold: {
    name: "Elegant Cursive (Bold)", price: 600,
    family: '"AM Dancing Script", cursive', titleFamily: '"AM Dancing Script", cursive',
    // The bundled Dancing Script TTF has a weight axis. Canvas requests 700
    // to match the approved bold preview instead of the delicate variant.
    weight: "bold", asset: "../assets/fonts/DancingScript.ttf", registeredFamily: "AM Dancing Script",
  },
});

// Local Unicode coverage prevents tofu squares on hosts without system fonts.
// The optional Noto Sans Symbols 2 download in the renderer is extra coverage.
export const UNICODE_FALLBACK_FONTS = Object.freeze([
  { id: "math", family: "AM Noto Math", asset: "../assets/fonts/NotoSansMath-Regular.ttf" },
  { id: "symbols", family: "AM Noto Symbols", asset: "../assets/fonts/NotoSansSymbols.ttf" },
]);

// Put our bundled fallbacks before the generic family, without taking precedence
// over a member's selected shop font (or the default serif/sans-serif).
export function withUnicodeFallback(family = "sans-serif") {
  const selected = String(family || "sans-serif").trim();
  const fallbacks = '"AM Noto Math", "AM Noto Symbols", "AM Unicode Symbols"';
  const generic = /,\s*(sans-serif|serif|monospace|cursive)\s*$/i.exec(selected);
  if (generic) {
    return selected.slice(0, generic.index) + ", " + fallbacks + ", " + generic[1];
  }
  return selected + ", " + fallbacks + ", sans-serif";
}

let fontsRegistered = false;

export function registerAppearanceFonts() {
  if (fontsRegistered) return;
  fontsRegistered = true;
  for (const [id, entry] of Object.entries(SHOP_FONT_STYLES)) {
    try {
      const path = fileURLToPath(new URL(entry.asset, import.meta.url));
      if (!GlobalFonts.registerFromPath(path, entry.registeredFamily)) {
        console.warn(`[fonts] Could not register ${id}; using a legible fallback.`);
      }
    } catch (error) {
      console.warn(`[fonts] ${id} unavailable; using a fallback:`, error.message);
    }
  }
  for (const entry of UNICODE_FALLBACK_FONTS) {
    try {
      const path = fileURLToPath(new URL(entry.asset, import.meta.url));
      if (!GlobalFonts.registerFromPath(path, entry.family)) {
        console.warn(`[fonts] Could not register local Unicode font ${entry.id}.`);
      }
    } catch (error) {
      console.warn(`[fonts] Unicode font ${entry.id} unavailable:`, error.message);
    }
  }
}
