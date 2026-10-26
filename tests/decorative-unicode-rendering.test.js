import test from "node:test";
import assert from "node:assert/strict";
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { registerAppearanceFonts, withUnicodeFallback } from "../services/font-library.js";
import { renderPostImage } from "../services/post-renderer.js";
import { drawUnicodeText } from "../services/unicode-text.js";

test("Unicode fallback fonts are bundled and shop font stays first", () => {
  registerAppearanceFonts();
  assert.equal(GlobalFonts.has("AM Noto Math"), true);
  assert.equal(GlobalFonts.has("AM Noto Symbols"), true);
  const family = withUnicodeFallback('"AM Caveat", cursive');
  assert.ok(family.startsWith('"AM Caveat", "AM Noto Math", "AM Noto Symbols"'));
  assert.ok(family.endsWith(", cursive"));
  assert.equal(withUnicodeFallback("serif").startsWith("serif, "), true);
});

test("two same-length mathematical-alphabet usernames produce distinct profile images", async () => {
  const data = { displayName: "𝓛𝓲𝓵𝓵𝔂 ✧", robloxUsername: "TestUser", bio: "Hello!" };
  for (const headerFont of ["default", "caveat"]) {
    const opts = { type: "profile", appearance: { headerFont }, data };
    const first = await renderPostImage(opts);
    const second = await renderPostImage({
      ...opts, data: { ...data, displayName: "𝓐𝓲𝓵𝓵𝔂 ✧" },
    });
    assert.notDeepEqual(first, second,
      "distinct supplementary-plane letters must not render as the same missing-glyph squares");
  }
});

test("decorative heart, star, mathematical letters and emoji select explicit Unicode faces", async () => {
  const { unicodeFontForGrapheme, unicodeRuns, trimLastGrapheme,
    measureUnicodeText, drawUnicodeText } = await import("../services/unicode-text.js");
  const family = '"AM Caveat", cursive';
  assert.match(unicodeFontForGrapheme("♡", family), /^"AM Noto Math"/);
  assert.match(unicodeFontForGrapheme("✧", family), /^"AM Noto Math"/);
  assert.match(unicodeFontForGrapheme("𝓛", family), /^"AM Noto Math"/);
  assert.match(unicodeFontForGrapheme("🐷", family), /^"AM Noto Emoji"/);
  assert.match(unicodeFontForGrapheme("❤️", family), /^"AM Noto Emoji"/);
  assert.equal(unicodeFontForGrapheme("Hello", family), family);
  assert.equal(trimLastGrapheme("YOR 🐷"), "YOR ");
  const runs = unicodeRuns("YOR ♡", family);
  assert.equal(runs.length, 2);
  assert.equal(runs[0].text, "YOR ");
  assert.equal(runs[1].text, "♡");
  const { createCanvas } = await import("@napi-rs/canvas");
  const ctx = createCanvas(320, 100).getContext("2d");
  const opts = { size: 36, weight: "normal", family };
  assert.ok(measureUnicodeText(ctx, "YOR ♡", opts) > measureUnicodeText(ctx, "YOR", opts));
  ctx.fillStyle = "#111";
  drawUnicodeText(ctx, "YOR ♡", 3, 10, { ...opts, maxWidth: 120 });
  assert.equal(ctx.canvas.width, 320);
});

test("decorative-only and emoji-only usernames generate valid profile images", async () => {
  for (const displayName of ["♡", "🐷", "𝓛𝓲𝓵𝓵𝔂 ♡", "a·°✧isabella✧°·"]) {
    const image = await renderPostImage({
      type: "profile", data: { displayName, bio: "♡ Hi, my name is ♡" },
    });
    assert.equal(image.readUInt32BE(16), 1200);
    assert.equal(image.readUInt32BE(20), 800);
  }
});

test("standalone heart draws real ink instead of the missing-glyph rectangle", () => {
  // Uses bundled local Noto Math; never depends on optional network emoji fonts.
  registerAppearanceFonts();
  const canvas = createCanvas(80, 80);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "top";
  ctx.fillStyle = "#000";
  drawUnicodeText(ctx, "♡", 10, 10, {
    size: 56, weight: "normal", family: "serif",
  });
  const rendered = Buffer.from(ctx.getImageData(0, 0, 80, 80).data);
  assert.ok(rendered.some((_, i) => i % 4 === 3 && rendered[i] > 0),
    "the heart must draw visible pixels");
  ctx.clearRect(0, 0, 80, 80);
  ctx.font = '56px "AM Noto Math"';
  ctx.fillText("\u{10FFFF}", 10, 10);
  const missing = Buffer.from(ctx.getImageData(0, 0, 80, 80).data);
  assert.notDeepEqual(rendered, missing,
    "the Unicode heart must not use the font's missing-glyph box");
});
