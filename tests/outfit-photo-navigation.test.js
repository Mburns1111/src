import test from "node:test";
import assert from "node:assert/strict";
import OutfitListing from "../models/OutfitListing.js";
import {
  handleOutfitPageButton,
  handleLegacyOutfitGalleryButton,
} from "../commands/outfit.js";

// These real-world ObjectId shapes were previously rejected because the
// handler used /[a-f\\d]/ instead of /[0-9a-f]/.
const ids = [
  "6add69d69249c7f6f595751d",
  "123456789012345678901234",
  "aaaaaaaaaaaaaaaaaaaaaaaa",
];

function interaction(customId) {
  return {
    customId,
    guildId: "1561372971355086958",
    message: { id: "888888888888888888" },
    deferredUpdate: false,
    deferredReply: false,
    async deferUpdate() { this.deferredUpdate = true; },
    async deferReply() { this.deferredReply = true; },
  };
}

test("Next and Previous accept numeric/mixed MongoDB outfit IDs and reach the lookup", async () => {
  const original = OutfitListing.findOne;
  const queries = [];
  OutfitListing.findOne = async filter => {
    queries.push(filter);
    return null; // Stop after validation: no Discord or database writes.
  };
  try {
    for (const id of ids) {
      for (const direction of ["next", "prev"]) {
        const ctx = interaction(`outfit:page:${direction}:${id}`);
        await assert.rejects(handleOutfitPageButton(ctx),
          /That outfit is no longer available/);
        assert.equal(ctx.deferredUpdate, true,
          "a valid navigation action must reach deferUpdate");
        assert.equal(queries.at(-1)._id, id);
        assert.equal(queries.at(-1).postMessageId, ctx.message.id);
      }
    }
    assert.equal(queries.length, ids.length * 2);
  } finally {
    OutfitListing.findOne = original;
  }
});

test("legacy gallery buttons accept the same valid ObjectIds for safe migration", async () => {
  const original = OutfitListing.findOne;
  const queries = [];
  OutfitListing.findOne = async filter => {
    queries.push(filter);
    return null; // Verify the action passed ID validation.
  };
  try {
    for (const id of ids) {
      for (const direction of ["next", "prev"]) {
        const ctx = interaction(`outfit:gallery:${direction}:${id}`);
        await assert.rejects(handleLegacyOutfitGalleryButton(ctx),
          /This older outfit gallery is no longer available/);
        assert.equal(ctx.deferredReply, true);
        assert.equal(queries.at(-1)._id, id);
        assert.equal(queries.at(-1).galleryMessageId, ctx.message.id);
      }
    }
  } finally {
    OutfitListing.findOne = original;
  }
});

test("invalid photo-navigation IDs are rejected before querying MongoDB", async () => {
  const original = OutfitListing.findOne;
  let queried = false;
  OutfitListing.findOne = async () => { queried = true; return null; };
  try {
    for (const id of ["zzz".repeat(8), "short", "1".repeat(23), "1".repeat(25), "a".repeat(23) + ":"]) {
      const newContext = interaction(`outfit:page:next:${id}`);
      await assert.rejects(handleOutfitPageButton(newContext),
        /That outfit photo action is not valid/);
      assert.equal(newContext.deferredUpdate, false);

      const legacyContext = interaction(`outfit:gallery:prev:${id}`);
      await assert.rejects(handleLegacyOutfitGalleryButton(legacyContext),
        /This old outfit gallery button is invalid/);
      assert.equal(legacyContext.deferredReply, false);
    }
    assert.equal(queried, false);
  } finally {
    OutfitListing.findOne = original;
  }
});
