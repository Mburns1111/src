import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { loadImageSource } from "../services/post-renderer.js";
import { deletePhotoFilesBeforeRecords } from "../services/profile-photo-deletion.js";

test("stored profile photos with huge dimensions are rejected before Canvas decodes them", async () => {
  const png = Buffer.from(createCanvas(12, 12).toBuffer("image/png"));
  png.writeUInt32BE(8000, 16);
  png.writeUInt32BE(8000, 20);
  await assert.rejects(loadImageSource(png), /too many pixels to process safely/);
  await assert.rejects(loadImageSource({ buffer: png }), /too many pixels to process safely/);
});
test("a normal stored profile PNG can still be rendered", async () => {
  const png = Buffer.from(createCanvas(12, 12).toBuffer("image/png"));
  const loaded = await loadImageSource(png);
  assert.equal(loaded.width, 12);
  assert.equal(loaded.height, 12);
});
test("stored photo files are deleted before metadata", async () => {
  const sequence = [];
  await deletePhotoFilesBeforeRecords(["a","b"],async ids => {
    assert.deepEqual(ids,["a","b"]);
    sequence.push("GridFS");
  },async()=>sequence.push("records"));
  assert.deepEqual(sequence,["GridFS","records"]);
});
test("a failed GridFS delete preserves metadata and the member's ability to retry",async()=>{
  let recordsDeleted = false;
  await assert.rejects(
    deletePhotoFilesBeforeRecords(["a"],async()=>{throw new Error("Mongo network unavailable");},
      async()=>{ recordsDeleted = true; }),
    /Mongo network unavailable/,
  );
  assert.equal(recordsDeleted,false);
});
test("empty stored file albums still allow removal of stale profile records",async()=>{
  let called = false;
  await deletePhotoFilesBeforeRecords([],async()=>{throw new Error("should not run");},
    async()=>{called=true;});
  assert.equal(called,true);
});
