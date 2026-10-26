// Canvas font cascades vary across hosts. Render mixed Unicode text in
// grapheme-safe runs so a missing decorative glyph does not use the shop font's
// empty-square glyph. Normal characters keep the member's selected font.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const emojiPresentation = /\p{Emoji_Presentation}/u;
const pictograph = /\p{Extended_Pictographic}/u;
const symbolOrMath = /[\p{Sm}\p{Sk}\p{So}]/u;
const mathAlphabet = /[\u{1D400}-\u{1D7FF}]/u;
const variation16 = /\uFE0F/u;

export function unicodeFontForGrapheme(grapheme, family = "sans-serif") {
  // Noto Emoji covers many colored emoji as scalable monochrome glyphs.
  // For text-style hearts and stars, prefer Noto Math instead.
  if (emojiPresentation.test(grapheme) ||
      (pictograph.test(grapheme) && variation16.test(grapheme)) ||
      grapheme.includes("\u200d")) {
    return '"AM Noto Emoji", "AM Unicode Symbols", ' + family;
  }
  if (mathAlphabet.test(grapheme) || symbolOrMath.test(grapheme) ||
      /[\u{13000}-\u{1345F}]/u.test(grapheme)) {
    return '"AM Noto Math", "AM Unicode Symbols", ' + family;
  }
  return family;
}

export function trimLastGrapheme(value) {
  const segments = Array.from(segmenter.segment(String(value)), item => item.segment);
  segments.pop();
  return segments.join("");
}

export function unicodeRuns(value, family) {
  const runs = [];
  for (const { segment } of segmenter.segment(String(value ?? ""))) {
    const face = unicodeFontForGrapheme(segment, family);
    const last = runs[runs.length - 1];
    if (last && last.family === face) last.text += segment;
    else runs.push({ text: segment, family: face });
  }
  return runs;
}

function measureRuns(ctx, runs, { size, weight }) {
  return runs.map(run => {
    ctx.font = `${weight} ${size}px ${run.family}`;
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
      ctx.font = `${weight} ${size}px ${run.family}`;
      ctx.fillText(run.text, position, 0);
      position += run.width;
    }
  } finally {
    ctx.restore();
  }
}
