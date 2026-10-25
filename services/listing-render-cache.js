import { createHash } from "node:crypto";
import { renderPostImage } from "./post-renderer.js";

// Only finished outfit and house cards are cached. Profile cards and live
// shop drafts are deliberately excluded, so avatars and live previews never
// accidentally show an older image. Entries are kept in memory only.
export const LISTING_RENDER_CACHE_MAX_BYTES = 24 * 1024 * 1024;
export const LISTING_RENDER_CACHE_MAX_ENTRIES = 24;
export const LISTING_RENDER_CACHE_TTL_MS = 10 * 60 * 1000;

const saved = new Map();
const inFlight = new Map();
let retainedBytes = 0;

function keyFor(options) {
  if (!["outfit", "house"].includes(options?.type)) return null;
  const images = options.images ?? {};
  const allowedKeys = Object.keys(images);
  if (allowedKeys.some(name => name !== "photo")) return null;
  const photo = images.photo;
  if (photo != null && !Buffer.isBuffer(photo)) return null;
  // Include every variable input to the Canvas renderer. An appearance
  // purchase, change to the listing copy, page number, or replacement image
  // changes this digest. No raw names or image bytes appear in the key.
  let fields;
  try {
    fields = JSON.stringify({
      revision: 1, type: options.type,
      data: options.data ?? {}, style: options.style ?? {},
      appearance: options.appearance ?? {},
      hasPhoto: photo != null,
    });
  } catch {
    return null;
  }
  if (!fields) return null;
  const hash = createHash("sha256").update(fields);
  if (photo) hash.update(photo);
  return hash.digest("hex");
}

function evict(key) {
  const item = saved.get(key);
  if (!item) return;
  saved.delete(key);
  retainedBytes -= item.image.length;
}
function put(key, image, at) {
  if (image.length > LISTING_RENDER_CACHE_MAX_BYTES || !image.length) return;
  evict(key);
  saved.set(key, { image: Buffer.from(image), createdAt: at });
  retainedBytes += image.length;
  while (saved.size > LISTING_RENDER_CACHE_MAX_ENTRIES ||
    retainedBytes > LISTING_RENDER_CACHE_MAX_BYTES) {
    evict(saved.keys().next().value);
  }
}

/**
 * Safe, content-addressed memoization for listing art only.
 * - Same inputs: reuse PNG or the current in-flight render.
 * - Different image, text, page, styling: render anew.
 * - Failed renders: no cached fallback, preserve caller's error.
 * - Results are copied to avoid mutable Buffer corruption between callers.
 */
export async function renderListingCardCached(options, {
  render = renderPostImage, now = Date.now,
} = {}) {
  const key = keyFor(options);
  if (!key) return render(options);
  const at = now();
  const existing = saved.get(key);
  if (existing) {
    if (at - existing.createdAt < LISTING_RENDER_CACHE_TTL_MS) {
      saved.delete(key);
      saved.set(key, existing); // LRU
      return Buffer.from(existing.image);
    }
    evict(key);
  }
  if (inFlight.has(key)) return Buffer.from(await inFlight.get(key));
  const task = Promise.resolve().then(() => render(options)).then(result => {
    if (!Buffer.isBuffer(result)) throw new TypeError("The listing renderer did not return a PNG Buffer.");
    put(key, result, now());
    return result;
  });
  inFlight.set(key, task);
  try {
    return Buffer.from(await task);
  } finally {
    if (inFlight.get(key) === task) inFlight.delete(key);
  }
}

export function listingRenderCacheStats() {
  return { entries: saved.size, bytes: retainedBytes, pending: inFlight.size };
}

// Exposed for deterministic tests and emergency local cache reset. Does not
// alter the saved MongoDB images or the public Discord post.
export function clearListingRenderCache() {
  saved.clear();
  retainedBytes = 0;
}
