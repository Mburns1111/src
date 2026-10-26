import test from "node:test";
import assert from "node:assert/strict";
import { GlobalFonts } from "@napi-rs/canvas";
import { registerAppearanceFonts, withUnicodeFallback } from "../services/font-library.js";
import { renderPostImage } from "../services/post-renderer.js";

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
