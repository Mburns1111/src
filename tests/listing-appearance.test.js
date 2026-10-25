import test from "node:test";
import assert from "node:assert/strict";
import { snapshotListingAppearance, displayListingAppearance } from "../services/listing-appearance.js";
import { FREE_APPEARANCE } from "../services/appearance-ownership.js";
import { STANDARD_BACKGROUND_ID } from "../services/classic-colors.js";
import { stickerDefaults } from "../services/sticker-catalog.js";

function ownership(extra = {}) {
  return Object.fromEntries(Object.entries(FREE_APPEARANCE).map(([category, ids]) =>
    [category, new Set([...ids, ...(extra[category] ?? [])])]));
}

test("new listings copy the owner's equipped profile appearance", () => {
  const profile = { profileAppearance: { background: "rosePastel", frame: "doubleLine" } };
  const original = structuredClone(profile);
  const result = snapshotListingAppearance(profile, ownership({
    backgrounds: ["rosePastel"], frames: ["doubleLine"],
  }));
  assert.equal(result.background, "rosePastel");
  assert.equal(result.frame, "doubleLine");
  result.background = STANDARD_BACKGROUND_ID;
  assert.deepEqual(profile, original, "saving a listing must not mutate the profile");
});

test("each listing snapshot is independent of the others", () => {
  const profile = { profileAppearance: { background: "rosePastel" } };
  const owned = ownership({ backgrounds: ["rosePastel"] });
  const trading = snapshotListingAppearance(profile, owned);
  const house = snapshotListingAppearance(profile, owned);
  trading.background = STANDARD_BACKGROUND_ID;
  profile.profileAppearance.background = STANDARD_BACKGROUND_ID;
  assert.equal(house.background, "rosePastel");
});

test("unowned choices cannot be inherited from a stale or invalid profile", () => {
  const result = snapshotListingAppearance({
    profileAppearance: { background: "rosePastel", frame: "doubleLine" },
  }, ownership());
  assert.equal(result.background, STANDARD_BACKGROUND_ID);
  assert.equal(result.frame, "default");
});

test("legacy listings start from profile without changing their database value", () => {
  const post = { postAppearance: null };
  const profile = { profileAppearance: { background: "rosePastel" } };
  const result = displayListingAppearance(post, profile, ownership({ backgrounds: ["rosePastel"] }));
  assert.equal(result.background, "rosePastel");
  assert.equal(post.postAppearance, null);
});

test("a saved listing look overrides later profile changes", () => {
  const post = { postAppearance: { background: "rosePastel" } };
  const profile = { profileAppearance: { background: STANDARD_BACKGROUND_ID } };
  const result = displayListingAppearance(post, profile, ownership({ backgrounds: ["rosePastel"] }));
  assert.equal(result.background, "rosePastel");
});

test("new listings never inherit stickers from a decorated profile", () => {
  const flower = stickerDefaults("flower");
  const ghost = stickerDefaults("littleGhost");
  const profile = {
    profileAppearance: {
      background: "rosePastel", frame: "doubleLine",
      stickers: [flower, ghost],
    },
  };
  const before = structuredClone(profile);
  const owned = ownership({
    backgrounds: ["rosePastel"], frames: ["doubleLine"],
    stickers: ["flower", "littleGhost"],
  });
  for (const type of ["tradingPost", "house", "outfit"]) {
    const listingStyle = snapshotListingAppearance(profile, owned);
    assert.equal(listingStyle.background, "rosePastel", type);
    assert.equal(listingStyle.frame, "doubleLine", type);
    assert.deepEqual(listingStyle.stickers, [], type);
  }
  assert.deepEqual(profile, before, "inheriting a style does not remove profile stickers");
});

test("legacy listings without a saved style start without stickers", () => {
  const profile = { profileAppearance: {
    background: "rosePastel", stickers: [stickerDefaults("star")],
  } };
  const listing = { postAppearance: null };
  const inherited = displayListingAppearance(listing, profile, ownership({
    backgrounds: ["rosePastel"], stickers: ["star"],
  }));
  assert.equal(inherited.background, "rosePastel");
  assert.deepEqual(inherited.stickers, []);
  assert.equal(listing.postAppearance, null, "reading a legacy listing does not persist a change");
});

test("existing explicitly saved stickers remain attached even when the profile changes", () => {
  const savedSticker = stickerDefaults("flower");
  const listing = { postAppearance: {
    background: "rosePastel", stickers: [savedSticker],
  } };
  const profile = { profileAppearance: { background: STANDARD_BACKGROUND_ID, stickers: [] } };
  const owned = ownership({ backgrounds: ["rosePastel"], stickers: ["flower"] });
  const display = displayListingAppearance(listing, profile, owned);
  assert.deepEqual(display.stickers, [savedSticker]);
  assert.deepEqual(listing.postAppearance.stickers, [savedSticker]);
});
