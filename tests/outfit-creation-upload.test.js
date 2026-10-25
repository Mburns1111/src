import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { createCanvas } from "@napi-rs/canvas";
import { AttachmentBuilder } from "discord.js";
import { makeCreateListingModal, makeListingComponents } from "../commands/outfit.js";
import { galleryImageBuffer, resizeOutfitImage } from "../services/outfit-gallery.js";

test("outfit creation form contains an upload picker for 1–10 media files", () => {
  const modal = makeCreateListingModal("123456789012345678", {
    channelId: "123456789012345678", id: "123456789012345678",
  }).toJSON();
  assert.equal(modal.components.length, 5, "Discord permits five modal components");
  const elements = modal.components.map(label => label.component);
  const upload = elements.find(item => item.custom_id === "outfit_media");
  assert.ok(upload, "upload must be in the initial form");
  assert.equal(upload.min_values, 1);
  assert.equal(upload.max_values, 10);
  const fields = elements.filter(item => item.custom_id !== "outfit_media")
    .map(item => item.custom_id);
  assert.deepEqual(fields, ["title", "description", "cost", "video_url"]);
});

test("new public outfit listings do not expose Add pictures/video afterward", () => {
  const rows = makeListingComponents({
    _id: "a".repeat(24), interestedUserIds: [],
    notifyOnInterest: false,
  });
  const labels = rows.flatMap(row => row.toJSON().components.map(component => component.label));
  assert.ok(labels.includes("Remove listing"));
  assert.ok(labels.includes("Interested (0)"));
  assert.ok(labels.includes("Interest DMs: Off"));
  assert.ok(!labels.includes("Add pictures/video"));
  assert.ok(rows.every(row => row.toJSON().components.length <= 5));
});

test("MongoDB lean BSON Binary gallery images become real Discord-supported Buffers", async () => {
  const canvas = createCanvas(60, 60);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#A010FF";
  ctx.fillRect(0, 0, 60, 60);
  const jpeg = await resizeOutfitImage(canvas.toBuffer("image/png"));
  assert.ok(jpeg.length > 50);
  const fromBson = new mongoose.mongo.Binary(jpeg);
  for (const value of [jpeg, fromBson, new Uint8Array(jpeg),
    { type: "Buffer", data: Array.from(jpeg) }]) {
    const converted = galleryImageBuffer(value);
    assert.ok(Buffer.isBuffer(converted));
    assert.deepEqual(converted, jpeg);
    const attachment = new AttachmentBuilder(converted, { name: "page.jpg" });
    assert.ok(Buffer.isBuffer(attachment.attachment));
  }
});

test("invalid MongoDB image objects are rejected instead of sent to Discord", () => {
  for (const invalid of [undefined, null, "", {}, [], new Uint8Array(0)]) {
    assert.throws(() => galleryImageBuffer(invalid), /valid Buffer/);
  }
});
