import { UserFacingError } from "../commands/errors.js";

export const MAX_DECODE_SIDE = 12_000;
export const MAX_DECODE_PIXELS = 24_000_000;

/** Inspect common image headers without allocating/decoding their pixels. */
export function imageHeaderDimensions(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (b.length >= 24 &&
      b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
      b.toString("ascii",12,16) === "IHDR") {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length >= 10 && ["GIF87a", "GIF89a"].includes(b.toString("ascii",0,6))) {
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  if (b.length >= 30 && b.toString("ascii",0,4) === "RIFF" &&
      b.toString("ascii",8,12) === "WEBP") {
    const kind = b.toString("ascii",12,16);
    if (kind === "VP8X") {
      return {
        width: 1 + b.readUIntLE(24,3),
        height: 1 + b.readUIntLE(27,3),
      };
    }
    if (kind === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    if (kind === "VP8L" && b[20] === 0x2f) {
      return {
        width: 1 + (b[21] | ((b[22] & 0x3f) << 8)),
        height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)),
      };
    }
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 4 <= b.length) {
      if (b[at++] !== 0xff) continue;
      while (at < b.length && b[at] === 0xff) at++;
      const marker = b[at++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (at + 2 > b.length) break;
      const length = b.readUInt16BE(at);
      if (length < 2 || at + length > b.length) break;
      if ((marker >= 0xc0 && marker <= 0xcf) &&
          ![0xc4,0xc8,0xcc].includes(marker) && length >= 7) {
        return { width: b.readUInt16BE(at+5), height: b.readUInt16BE(at+3) };
      }
      at += length;
    }
  }
  return null; // For other formats Canvas still validates decoded dimensions.
}

export function assertImageSafeToDecode(bytes) {
  const d = imageHeaderDimensions(bytes);
  if (d && (!d.width || !d.height || d.width > MAX_DECODE_SIDE ||
      d.height > MAX_DECODE_SIDE || d.width * d.height > MAX_DECODE_PIXELS)) {
    throw new UserFacingError(
      "This image has too many pixels to process safely. Use a smaller image (24 megapixels maximum).",
    );
  }
  return d;
}
