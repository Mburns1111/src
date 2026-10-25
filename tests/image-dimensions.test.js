import test from "node:test";
import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import { assertImageSafeToDecode, imageHeaderDimensions } from "../services/image-dimensions.js";
import { resizeOutfitImage } from "../services/outfit-gallery.js";

test("PNG pixel limits are checked before a decode",async()=>{
  const canvas=createCanvas(16,16);
  const png=Buffer.from(canvas.toBuffer("image/png"));
  assert.deepEqual(imageHeaderDimensions(png),{width:16,height:16});
  png.writeUInt32BE(10_000,16);png.writeUInt32BE(10_000,20);
  assert.throws(()=>assertImageSafeToDecode(png),/too many pixels/);
  await assert.rejects(resizeOutfitImage(png),/too many pixels/);
});
test("large GIF dimensions are rejected from header bytes",()=>{
  const gif=Buffer.alloc(10);
  gif.write("GIF89a");gif.writeUInt16LE(12_000,6);gif.writeUInt16LE(11_000,8);
  assert.deepEqual(imageHeaderDimensions(gif),{width:12_000,height:11_000});
  assert.throws(()=>assertImageSafeToDecode(gif),/too many pixels/);
});
test("large JPEG SOF dimensions are rejected without expanding the bitmap",()=>{
  const jpeg=Buffer.from([0xff,0xd8, 0xff,0xc0, 0,17,8, 0x27,0x10,0x27,0x10, 3,1,0x11,0,2,0x11,0,3,0x11,0]);
  assert.deepEqual(imageHeaderDimensions(jpeg),{width:10000,height:10000});
  assert.throws(()=>assertImageSafeToDecode(jpeg),/too many pixels/);
});
test("WebP VP8X dimensions are checked before decoding",()=>{
  const webp=Buffer.alloc(30);webp.write("RIFF");webp.write("WEBP",8);webp.write("VP8X",12);
  webp.writeUIntLE(10000-1,24,3);webp.writeUIntLE(10000-1,27,3);
  assert.deepEqual(imageHeaderDimensions(webp),{width:10000,height:10000});
  assert.throws(()=>assertImageSafeToDecode(webp),/too many pixels/);
});
test("ordinary small images remain permitted",()=>{
  const gif=Buffer.alloc(10);gif.write("GIF87a");gif.writeUInt16LE(400,6);gif.writeUInt16LE(300,8);
  assert.deepEqual(assertImageSafeToDecode(gif),{width:400,height:300});
});
