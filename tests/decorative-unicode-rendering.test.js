import test from "node:test";
import assert from "node:assert/strict";
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { registerAppearanceFonts, withUnicodeFallback } from "../services/font-library.js";
import { renderPostImage } from "../services/post-renderer.js";
import { drawUnicodeText, unicodeRuns, preloadEmojiArtwork } from "../services/unicode-text.js";
import { bundledTextSupported, hasBundledGlyph } from "../services/unicode-glyph-coverage.js";

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
  assert.match(unicodeFontForGrapheme("✧", family), /^"AM Noto Math"/, "unsupported star uses a drawable star glyph");
  assert.match(unicodeFontForGrapheme("𝓛", family), /^"AM Noto Math"/);
  assert.equal(unicodeFontForGrapheme("🐷", family), family, "emoji displays its readable text fallback");
  assert.equal(unicodeFontForGrapheme("❤️", family), family, "color emoji artwork does not override the purchased text face");
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

test("decorative graphemes preserve real emoji artwork and readable typography", async () => {
  registerAppearanceFonts();
  await preloadEmojiArtwork();
  const family = '"AM Caveat", cursive';
  const mixedNames = [
    "YOR ♡", "ʏᴏʀ ♡", "γμρρε ᶻ ᶻ", "a·°✧isabella✧°·",
    "🦇", "🐷", "ℓεττ 𓂃 ୨୧ 𝒶", "𝓛𝓲𝓵𝓵𝔂 ✧",
    "𐙚 ⋆ 𓆩 𓆪", "♱ ☾ ᶻ z", "✿ 🌙 🎀 🦋",
  ];
  for (const original of mixedNames) {
    const runs = unicodeRuns(original, family);
    assert.ok(runs.length, original + " should have visible content");
    for (const run of runs) {
      if (run.type === "emoji") {
        assert.match(run.emojiId, /^[0-9a-f]+$/);
        continue;
      }
      const nonAscii = [...run.text].filter(ch => ch.codePointAt(0) > 126);
      if (!nonAscii.length) continue;
      const match = /^"(AM [^"]+)"$/.exec(run.family);
      assert.ok(match, original + ": non-ASCII must use an explicitly bundled font");
      assert.ok(bundledTextSupported(match[1], run.text),
        original + ": missing font glyph for " + run.text);
    }
  }
  assert.deepEqual(unicodeRuns("🦇", family).map(run => run.emojiId), ["1f987"]);
  assert.deepEqual(unicodeRuns("🐷", family).map(run => run.emojiId), ["1f437"]);
  assert.equal(unicodeRuns("ʏᴏʀ", family).map(run => run.text).join(""), "yor");
  assert.ok(!unicodeRuns("✧", family).map(run => run.text).join("").includes("?"));
  assert.equal(hasBundledGlyph("AM Noto Math", "♡".codePointAt(0)), true);
  assert.equal(hasBundledGlyph("AM Noto Math", "✧".codePointAt(0)), false);
});

test("bat and pig images render as artwork rather than their word labels", async () => {
  registerAppearanceFonts();
  await preloadEmojiArtwork();
  const ctx = createCanvas(240, 100).getContext("2d");
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#303030";
  for (const [emoji, id] of [["🦇", "1f987"], ["🐷", "1f437"], ["🦋", "1f98b"]]) {
    const run = unicodeRuns(emoji, '"AM Nunito", sans-serif');
    assert.equal(run.length, 1);
    assert.equal(run[0].type, "emoji");
    assert.equal(run[0].emojiId, id);
    drawUnicodeText(ctx, emoji, 16, 60, {
      size: 56, weight: "normal", family: '"AM Nunito", sans-serif',
    });
    const imageData = ctx.getImageData(0, 0, 240, 100).data;
    assert.ok(imageData.some((x, i) => i % 4 === 3 && x > 0),
      "must paint artwork pixels for " + emoji);
    ctx.clearRect(0, 0, 240, 100);
  }
});

test("offline decorative profiles render without runtime symbol-font downloads", async () => {
  for (const displayName of ["🐷", "YOR ♡", "𐙚 ⋆ 𓆩 𓆪", "a·°✧isabella✧°·"]) {
    const png = await renderPostImage({ type: "profile",
      data: { displayName, bio: "I like 🦋 butterflies and ✧ sparkles" },
    });
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 800);
  }
});
