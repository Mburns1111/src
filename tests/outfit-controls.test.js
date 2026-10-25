import test from "node:test";
import assert from "node:assert/strict";
import { outfitActionComponents } from "../services/outfit-controls.js";
import { unifiedOutfitPayload } from "../services/outfit-card.js";
import { OUTFIT_BANNER_NAME } from "../services/outfit-gallery-utils.js";

const outfit = {
  _id: "a".repeat(24), guildId: "123456789012345678", ownerId: "123456789012345678",
  title: "Autumn outfit", ownerName: "Tester", description: "Pretty cape",
  cost: "5 VAL", interestedUserIds: [], notifyOnInterest: false, galleryPageIndex: 0,
};

test("one outfit message has one styled image embed and all buttons underneath", () => {
  const components = outfitActionComponents(outfit, 3);
  const rows = components.map(row => row.toJSON().components);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].map(b => b.label), ["◀ Previous", "Photo 1 / 3", "Next ▶", "Choose photo"]);
  assert.equal(rows[0][1].disabled, true);
  assert.deepEqual(rows[1].map(b => b.label),
    ["Interested (0)", "Interest DMs: Off", "Remove listing"]);
  const payload = unifiedOutfitPayload(outfit, { count: 3, page: 0 }, [], Buffer.from("fake"));
  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].toJSON().image.url, `attachment://${OUTFIT_BANNER_NAME}`);
  assert.equal(payload.files.length, 1);
  assert.equal(payload.components.length, 2);
  assert.equal(payload.attachments.length, 0);
});

test("Next/Previous button custom IDs target the original outfit, never a gallery reply", () => {
  const rows = outfitActionComponents({ ...outfit, galleryPageIndex: 2 }, 3)
    .map(row => row.toJSON().components);
  assert.equal(rows[0][1].label, "Photo 3 / 3");
  assert.equal(rows[0][0].custom_id, `outfit:page:prev:${outfit._id}`);
  assert.equal(rows[0][2].custom_id, `outfit:page:next:${outfit._id}`);
  assert.equal(rows[0][3].custom_id, `outfit:page:choose:${outfit._id}`);
});

test("single-photo and video-only outfits skip unnecessary page controls", () => {
  for (const count of [0, 1]) {
    const rows = outfitActionComponents(outfit, count).map(row => row.toJSON().components);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].length, 3);
  }
});

test("saved listing controls reflect interest and notification settings", () => {
  const changed = {
    ...outfit, interestedUserIds: ["111", "222"], notifyOnInterest: true,
  };
  const buttons = outfitActionComponents(changed, 2)[1].toJSON().components;
  assert.equal(buttons[0].label, "Interested (2)");
  assert.equal(buttons[1].label, "Interest DMs: On");
});

test("native uploaded videos remain on the same post with the decorated card", () => {
  const payload = unifiedOutfitPayload(outfit, { count: 1, page: 0 }, [
    { id: "video-1", name: "original.mp4" }, { id: "video-2", name: "back.mp4" },
  ], Buffer.from("fake"));
  assert.deepEqual(payload.attachments, [{ id: "video-1" }, { id: "video-2" }]);
  assert.equal(payload.files.length, 1);
  assert.equal(payload.components.length, 1);
});
