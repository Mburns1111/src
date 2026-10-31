import test from "node:test";
import assert from "node:assert/strict";
import { ownerCardOptions } from "../commands/cards.js";
import CardArtwork from "../models/CardArtwork.js";
import CardArtworkReview from "../models/CardArtworkReview.js";
import { validateCardArtworkKey, CARD_ARTWORK_KINDS } from "../services/card-artwork-assets.js";

test("Discord artwork library commands have required typed options", () => {
  const options = ownerCardOptions.toJSON().options;
  for (const name of ["art-list", "art-info", "art-review", "art-assign", "art-upload"]) {
    assert.ok(options.find(o => o.name === name), name);
  }
  const review = options.find(o => o.name === "art-review");
  assert.ok(review.options.find(o => o.name === "note" && o.required));
  const upload = options.find(o => o.name === "art-upload");
  assert.ok(upload.options.find(o => o.name === "replaces"));
  assert.ok(upload.options.find(o => o.name === "revision_note"));
  assert.ok(options.find(o => o.name === "art-list").options.find(o => o.name === "page"));
});

test("Review records are append-only and revisions use new asset keys", () => {
  for (const field of ["artworkKey", "action", "previousStatus", "reviewerId", "note"]) {
    assert.ok(CardArtworkReview.schema.path(field), field);
  }
  for (const field of ["replacesKey", "revisionNote", "reviewedBy", "reviewedAt"]) {
    assert.ok(CardArtwork.schema.path(field), field);
  }
  assert.deepEqual(CardArtwork.schema.path("licenseReviewStatus").enumValues,
    ["needs-review", "approved", "rejected"]);
  assert.equal(CardArtwork.schema.path("key").options.immutable, true);
  assert.equal(CARD_ARTWORK_KINDS.length, 3);
  assert.equal(validateCardArtworkKey("Cat-Art-v2"), "cat-art-v2");
});
