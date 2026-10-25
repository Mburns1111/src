import test from "node:test";
import assert from "node:assert/strict";
import { renderPostImage } from "../services/post-renderer.js";
import { POST_LAYOUTS } from "../services/post-layouts.js";

test("profile gives About Me the reclaimed Discord-name row without overlapping photo", () => {
  const regions = POST_LAYOUTS.profile.regions;
  assert.equal(POST_LAYOUTS.profile.width, 1200);
  assert.equal(POST_LAYOUTS.profile.height, 800);
  assert.equal(Object.hasOwn(regions, "subtitle"), false, "Discord subtitle region removed");
  assert.equal(regions.title.y, 70);
  assert.ok(regions.robloxLine.y >= regions.title.y + 75);
  assert.ok(regions.bioLabel.y > regions.robloxLine.y + 40);
  assert.ok(regions.bio.height >= 200, "Bio grows from its previous 126px box");
  assert.ok(regions.bio.y + regions.bio.height <= regions.photo.y - 10);
  assert.equal(regions.photo.y, 492, "Member photo remains in the original area");
  assert.equal(regions.photo.height, 248, "Member photo remains the same size");
});

test("default and customized profile cards omit duplicate Discord username, keeping name and bio", async () => {
  const base = {
    displayName: "🌸 LILLY 🌸",
    discordUsername: "hidden-account-name-A",
    robloxUsername: "RobloxCharacter",
    bio: "I really enjoy Adopt Me and helping other players. I love trading, collecting, decorating, and spending time in our community. ".repeat(3),
    serverRoles: ["Admin", "Test role 1", "Test role 2"],
    lookingForTrades: true,
    footer: "Photo 1 of 2",
  };
  for (const background of ["default", "sagePreview"]) {
    const opts = { type: "profile", appearance: { background } };
    const first = await renderPostImage({ ...opts, data: base });
    const second = await renderPostImage({
      ...opts, data: { ...base, discordUsername: "a-different-login-only" },
    });
    assert.deepEqual(second, first,
      background + " must not draw the redundant Discord login name anywhere");
    assert.deepEqual(Array.from(first.subarray(0, 8)),
      [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(first.readUInt32BE(16), 1200);
    assert.equal(first.readUInt32BE(20), 800);
    const changedBio = await renderPostImage({
      ...opts, data: { ...base, bio: "Short new bio" },
    });
    assert.notDeepEqual(changedBio, first, "About Me remains visible in both styles");
  }
});
