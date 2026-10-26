import { GlobalFonts } from "@napi-rs/canvas";
import { bundledTextSupported } from "./unicode-glyph-coverage.js";

// Only rendering substitutes characters. Usernames remain untouched in MongoDB.
// The fallback is intentionally deterministic, even on an offline Wispbyte host.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const emojiPresentation = /\p{Emoji_Presentation}/u;
const pictograph = /\p{Extended_Pictographic}/u;
const emojiSequence = /[\u200d\uFE0F]/u;
const mathAlphabet = /[\u{1D400}-\u{1D7FF}]/u;
const specialSymbols = /[\p{Sm}\p{Sk}\p{So}]/u;
const fancyFaces = ["AM Noto Math", "AM Noto Symbols"];
const regularFaces = ["AM Nunito", "AM Noto Math", "AM Noto Symbols"];
const faces = new Set([
  "AM Nunito", "AM Silkscreen", "AM Cinzel", "AM Caveat",
  "AM Dancing Script", "AM Noto Math", "AM Noto Symbols",
]);
const invisibleOnly = /^[\u200b-\u200f\u2060\uFE0E\uFE0F\u034f]+$/u;
const heartCodepoints = new Set([0x2764, 0x1f9e1, 0x1f49b, 0x1f49a, 0x1f49c,
  0x1f90d, 0x1f5a4, 0x1f497, 0x1f496, 0x1f495, 0x1f498, 0x1fa77, 0x1fa75,
  0x1fa76, 0x1f49d, 0x1f49e, 0x1f49f]);
const emojiNames = new Map([
  [0x1f437, "pig"], [0x1f416, "pig"], [0x1f431, "cat"],
  [0x1f408, "cat"], [0x1f436, "dog"], [0x1f415, "dog"],
  [0x1f430, "rabbit"], [0x1f98b, "butterfly"], [0x1f380, "bow"],
  [0x1f9f8, "teddy"], [0x1f338, "flower"], [0x1f33a, "flower"],
  [0x1f339, "rose"], [0x1f319, "moon"], [0x1f31b, "moon"],
  [0x1f31f, "star"], [0x1f525, "fire"], [0x1f48e, "gem"],
  [0x1f3b5, "music"], [0x1f48b, "kiss"], [0x1f47b, "ghost"],
  [0x1f383, "pumpkin"], [0x1f308, "rainbow"], [0x1f984, "unicorn"],
  [0x1f409, "dragon"], [0x1f42f, "tiger"], [0x1f43b, "bear"],
  [0x1f31e, "sun"], [0x1f60a, "smile"], [0x1f60d, "love"],
  [0x1f602, "laugh"], [0x1f62d, "cry"], [0x1f973, "party"],
  [0x1f970, "love"], [0x1f3c6, "prize"], [0x1f381, "gift"],
  [0x1f389, "party"], [0x1f43e, "paws"], [0x1f98a, "fox"],
]);

function registeredFace(face, value) {
  return faces.has(face) && GlobalFonts.has(face) && bundledTextSupported(face, value);
}

function chooseFace(value, family) {
  const requested = [...String(family).matchAll(/"(AM [^"]+)"/g)]
    .map(match => match[1]).filter(face => faces.has(face));
  const decorated = mathAlphabet.test(value) || specialSymbols.test(value);
  const order = decorated
    ? [...fancyFaces, ...requested, ...regularFaces]
    : [...requested, ...regularFaces];
  for (const face of new Set(order)) {
    if (registeredFace(face, value)) return '"' + face + '"';
  }
  return null;
}

function displayGrapheme(segment, family) {
  if (invisibleOnly.test(segment)) return null;
  const codepoints = [...segment].map(ch => ch.codePointAt(0));
  if (codepoints.every(cp => cp >= 32 && cp <= 126))
    return { text: segment, family };
  const first = codepoints[0];
  if (heartCodepoints.has(first) || segment === "❤️") {
    if (registeredFace("AM Noto Math", "♥"))
      return { text: "♥", family: '"AM Noto Math"' };
    return { text: "<3", family };
  }
  // Avoid offline-font dependencies for emoji-only or emoji-rich names.
  if (emojiPresentation.test(segment) ||
      (pictograph.test(segment) && emojiSequence.test(segment)) ||
      codepoints.some(cp => cp >= 0x1f300 && cp <= 0x1faff)) {
    return { text: "[" + (emojiNames.get(first) || "emoji") + "]", family };
  }
  const available = chooseFace(segment, family);
  if (available) return { text: segment, family: available };
  // Compatibility decompositions recover superscripts and stylized alphabets.
  const decomposed = segment.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "");
  if (decomposed && [...decomposed].every(ch => ch.codePointAt(0) < 127))
    return { text: decomposed, family };
  if (decomposed !== segment) {
    const alternate = chooseFace(decomposed, family);
    if (alternate) return { text: decomposed, family: alternate };
  }
  // Canvas never receives an unsupported grapheme: substitute visible ASCII.
  return { text: /[\p{L}\p{N}]/u.test(segment) ? "?" : "*", family };
}

export function unicodeFontForGrapheme(grapheme, family = "sans-serif") {
  return displayGrapheme(grapheme, family)?.family ?? family;
}

export function trimLastGrapheme(value) {
  const segments = Array.from(segmenter.segment(String(value)), item => item.segment);
  segments.pop();
  return segments.join("");
}

export function unicodeRuns(value, family = "sans-serif") {
  const runs = [];
  for (const { segment } of segmenter.segment(String(value ?? ""))) {
    const shown = displayGrapheme(segment, family);
    if (!shown) continue;
    const last = runs[runs.length - 1];
    if (last && last.family === shown.family) last.text += shown.text;
    else runs.push({ text: shown.text, family: shown.family });
  }
  return runs;
}

function measureRuns(ctx, runs, { size, weight }) {
  return runs.map(run => {
    ctx.font = weight + " " + size + "px " + run.family;
    return { ...run, width: ctx.measureText(run.text).width };
  });
}

export function measureUnicodeText(ctx, value, options) {
  ctx.save();
  try {
    return measureRuns(ctx, unicodeRuns(value, options.family), options)
      .reduce((sum, run) => sum + run.width, 0);
  } finally {
    ctx.restore();
  }
}

export function drawUnicodeText(ctx, value, x, y, { size, weight, family, maxWidth } = {}) {
  const runs = unicodeRuns(value, family);
  if (!runs.length) return;
  ctx.save();
  try {
    const align = ctx.textAlign;
    const sizes = measureRuns(ctx, runs, { size, weight });
    const naturalWidth = sizes.reduce((sum, run) => sum + run.width, 0);
    const ratio = maxWidth && naturalWidth > maxWidth ? maxWidth / naturalWidth : 1;
    const visibleWidth = naturalWidth * ratio;
    const left = align === "center" ? x - visibleWidth / 2 :
      align === "right" || align === "end" ? x - visibleWidth : x;
    ctx.translate(left, y);
    if (ratio < 1) ctx.scale(ratio, 1);
    ctx.textAlign = "left";
    let position = 0;
    for (const run of sizes) {
      ctx.font = weight + " " + size + "px " + run.family;
      ctx.fillText(run.text, position, 0);
      position += run.width;
    }
  } finally {
    ctx.restore();
  }
}
