import test from "node:test";
import assert from "node:assert/strict";
import { data,ownerCardOptions } from "../commands/cards.js";
import CardEggArtwork from "../models/CardEggArtwork.js";
import CardRelease from "../models/CardRelease.js";
import { CARD_EGG_BUCKET, TEST_EGG_SOURCE } from "../services/card-egg-artwork-upload.js";
import { EGG_ART_BUCKETS } from "../services/card-egg-artwork.js";

test("staff egg-art-upload command asks for a Discord attachment", () => {
  const sub = data.toJSON().options.find(o => o.name === "egg-art-upload");
  assert.ok(sub);
  assert.equal(sub.options.length, 1);
  assert.equal(sub.options[0].name, "image");
  assert.equal(sub.options[0].required, true);
  assert.equal(sub.options[0].type, 11);
});
test("Release 1 artwork uses the existing source registry ID and artist credit", () => {
  assert.equal(TEST_EGG_SOURCE.artworkId, "egg-drop-001");
  assert.equal(TEST_EGG_SOURCE.sourceArtist, "stux");
  assert.equal(TEST_EGG_SOURCE.sourcePlatform, "Pixabay");
  assert.equal(TEST_EGG_SOURCE.sourceAssetId, "1255730");
  assert.equal(TEST_EGG_SOURCE.licenseReviewStatus, "needs-review");
});
test("dedicated GridFS egg storage has permanent release and attribution mapping", () => {
  assert.equal(CARD_EGG_BUCKET, "cardEggArtwork");
  assert.ok(EGG_ART_BUCKETS.includes(CARD_EGG_BUCKET));
  for (const field of ["artworkId","releaseId","fileId","creditText","creatorName","sourceArtist","sourcePlatform","sourceAssetId","uploadedBy"]) {
    assert.ok(CardEggArtwork.schema.path(field));
  }
  assert.ok(CardEggArtwork.schema.path("artworkId").options.unique);
  assert.ok(CardEggArtwork.schema.path("releaseId").options.unique);
  for (const field of ["eggArtworkId","eggImageFileId","eggImageBucket"]) {
    assert.ok(CardRelease.schema.path(field));
  }
});
