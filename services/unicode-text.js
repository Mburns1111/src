import { GlobalFonts, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import { bundledTextSupported } from "./unicode-glyph-coverage.js";

// Never change the member's stored Discord name. Only choose how its
// graphemes are drawn onto generated cards.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const emojiPresentation = /\p{Emoji_Presentation}/u;
const extendedPictographic = /\p{Extended_Pictographic}/u;
const mathematicalLetters = /[\u{1D400}-\u{1D7FF}]/u;
const specialSymbols = /[\p{Sm}\p{Sk}\p{So}]/u;
const markOnly = /^[\u200b-\u200f\u2060\uFE0E\uFE0F\u034f]+$/u;
const installedFaces = new Set([
  "AM Nunito", "AM Silkscreen", "AM Cinzel", "AM Caveat",
  "AM Dancing Script", "AM Noto Math", "AM Noto Symbols",
]);
const standardFallbackFaces = ["AM Nunito", "AM Noto Math", "AM Noto Symbols"];
const decorativeFallbackFaces = ["AM Noto Math", "AM Noto Symbols"];

// Apache-2 licensed Noto Emoji vector artwork is bundled locally. These
// images work even when Wispbyte has no installed emoji fonts or HTTP access.
const bundledEmojiIds = new Set([
  "1f987", "1f437", "1f98b", "1f431", "1f436", "1f380",
  "1f383", "1f47b", "1f381", "1f525", "1f9f8", "1f31f",
  "2728", "2764", "1f49c", "1f494", "1f319", "1f31e",
  "1f98a", "1f984", "1f409", "1f338", "1f339", "1f43e",
  "1f60a", "1f60d", "1f970", "1f602", "1f62d", "1f973",
  "1f389", "1f3b5", "1f308", "1f48b", "1f48e", "1f49e",
  "1f495", "1f31a", "1f42f", "1f43b", "1f408", "1f3c6", "1f4ab",
]);
const emojiImages = new Map();
let emojiLoadPromise;
export function preloadEmojiArtwork() {
  if (!emojiLoadPromise) {
    emojiLoadPromise = Promise.all([...bundledEmojiIds].map(async id => {
      try {
        const data = await readFile(new URL("../assets/emoji/" + id + ".svg", import.meta.url));
        const loaded = await loadImage(data);
        emojiImages.set(id, loaded);
      } catch (error) {
        console.warn("[unicode] Emoji artwork not available:", id, error.message);
      }
    }));
  }
  return emojiLoadPromise;
}

const emojiNames = new Map([
  [0x1f987, "bat"], [0x1f437, "pig"], [0x1f431, "cat"],
  [0x1f436, "dog"], [0x1f98b, "butterfly"], [0x1f380, "bow"],
  [0x1f383, "pumpkin"], [0x1f47b, "ghost"], [0x1f381, "gift"],
  [0x1f43e, "paws"], [0x1f9f8, "teddy"], [0x1f984, "unicorn"],
  [0x1f409, "dragon"], [0x1f338, "flower"], [0x1f60a, "smile"],
]);
const phoneticLatin = new Map(Object.entries({
  "ᴀ":"a","ʙ":"b","ᴄ":"c","ᴅ":"d","ᴇ":"e","ꜰ":"f",
  "ɢ":"g","ʜ":"h","ɪ":"i","ᴊ":"j","ᴋ":"k","ʟ":"l",
  "ᴍ":"m","ɴ":"n","ᴏ":"o","ᴘ":"p","ʀ":"r","ꜱ":"s",
  "ᴛ":"t","ᴜ":"u","ᴠ":"v","ᴡ":"w","ʏ":"y","ᴢ":"z",
  "ᴐ":"o","ꭰ":"a","ɹ":"r","ɐ":"a","ɘ":"e","ꞁ":"l",
  "ツ":":D","꒰":"(","꒱":")","୨":"<","୧":">",
}));

function availableFace(face, value) {
  return installedFaces.has(face) && GlobalFonts.has(face) &&
    bundledTextSupported(face, value);
}
function chooseFace(value, family) {
  const requested = [...String(family).matchAll(/"(AM [^"]+)"/g)]
    .map(match => match[1]).filter(face => installedFaces.has(face));
  const decorated = mathematicalLetters.test(value) || specialSymbols.test(value);
  const candidates = decorated
    ? [...decorativeFallbackFaces, ...requested, ...standardFallbackFaces]
    : [...requested, ...standardFallbackFaces];
  for (const face of new Set(candidates)) {
    if (availableFace(face, value)) return '"' + face + '"';
  }
  return null;
}
function emojiIdFor(segment) {
  const cp = segment.codePointAt(0);
  if (cp === undefined || !(
    emojiPresentation.test(segment) ||
    (extendedPictographic.test(segment) && segment.includes("\uFE0F")) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  )) return null;
  const id = cp.toString(16);
  return bundledEmojiIds.has(id) ? id : null;
}
function emojiRun(segment, family) {
  const id = emojiIdFor(segment);
  if (id && emojiImages.has(id))
    return { type: "emoji", emojiId: id, text: "", family };
  const cp = segment.codePointAt(0);
  return { type: "text", text: "[" + (emojiNames.get(cp) || "emoji") + "]", family };
}

function displayGrapheme(segment, family) {
  if (markOnly.test(segment)) return null;
  if (/^[\x20-\x7E]+$/.test(segment))
    return { type: "text", text: segment, family };
  const first = segment.codePointAt(0);
  const hasEmoji = emojiPresentation.test(segment) ||
    (extendedPictographic.test(segment) && segment.includes("\uFE0F")) ||
    (first >= 0x1f300 && first <= 0x1faff);
  if (hasEmoji) return emojiRun(segment, family);
  const font = chooseFace(segment, family);
  if (font) return { type: "text", text: segment, family: font };
  // Avoid '?' for common small-cap display names (e.g. ʏᴏʀ) and kaomoji.
  const mapped = [...segment].map(ch => phoneticLatin.get(ch) || ch).join("");
  if (mapped !== segment) {
    if (/^[\x20-\x7E]+$/.test(mapped))
      return { type: "text", text: mapped, family };
    const otherFace = chooseFace(mapped, family);
    if (otherFace) return { type: "text", text: mapped, family: otherFace };
  }
  const decomposed = segment.normalize("NFKD").replace(/[\p{M}\p{Cf}]/gu, "");
  if (decomposed && /^[\x20-\x7E]+$/.test(decomposed))
    return { type: "text", text: decomposed, family };
  if (decomposed !== segment) {
    const otherFace = chooseFace(decomposed, family);
    if (otherFace) return { type: "text", text: decomposed, family: otherFace };
  }
  // Prefer a similar decorative star over meaningless '?' and '*'.
  if (!/[\p{L}\p{N}]/u.test(segment)) {
    const starFace = chooseFace("⋆", family);
    if (starFace) return { type: "text", text: "⋆", family: starFace };
    return { type: "text", text: "*", family };
  }
  return { type: "text", text: "?", family };
}

export function unicodeFontForGrapheme(segment, family = "sans-serif") {
  return displayGrapheme(segment, family)?.family ?? family;
}
export function trimLastGrapheme(value) {
  const segments = Array.from(segmenter.segment(String(value)), entry => entry.segment);
  segments.pop();
  return segments.join("");
}
export function unicodeRuns(value, family = "sans-serif") {
  const runs = [];
  for (const { segment } of segmenter.segment(String(value ?? ""))) {
    const part = displayGrapheme(segment, family);
    if (!part) continue;
    const previous = runs[runs.length - 1];
    if (part.type === "text" && previous?.type === "text" &&
        previous.family === part.family) {
      previous.text += part.text;
    } else {
      runs.push(part);
    }
  }
  return runs;
}
function measureRuns(ctx, runs, { size, weight }) {
  return runs.map(run => {
    if (run.type === "emoji") {
      return { ...run, width: size * 1.04 };
    }
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
    const totalWidth = sizes.reduce((sum, run) => sum + run.width, 0);
    const ratio = maxWidth && totalWidth > maxWidth ? maxWidth / totalWidth : 1;
    const left = align === "center" ? x - (totalWidth * ratio) / 2 :
      align === "right" || align === "end" ? x - totalWidth * ratio : x;
    ctx.translate(left, y);
    if (ratio < 1) ctx.scale(ratio, 1);
    ctx.textAlign = "left";
    let position = 0;
    for (const run of sizes) {
      if (run.type === "emoji") {
        const image = emojiImages.get(run.emojiId);
        if (image) {
          const baseline = ctx.textBaseline;
          const top = baseline === "middle" ? -size / 2 :
            baseline === "top" || baseline === "hanging" ? 0 : -size * .84;
          ctx.drawImage(image, position, top, size, size);
        }
      } else {
        ctx.font = weight + " " + size + "px " + run.family;
        ctx.fillText(run.text, position, 0);
      }
      position += run.width;
    }
  } finally {
    ctx.restore();
  }
}
