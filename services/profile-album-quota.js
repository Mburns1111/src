import ProfileAlbumUploadLock from "../models/ProfileAlbumUploadLock.js";
import { UserFacingError } from "../commands/errors.js";

export const PROFILE_ALBUM_QUOTA_BYTES = 250 * 1024 * 1024;
export const PROFILE_PHOTO_LIMIT_BYTES = 24 * 1024 * 1024;
export const PROFILE_BATCH_LIMIT_BYTES = 80 * 1024 * 1024;
// Ten uploads of up to 45 seconds each fit inside this lease, with
// additional room for MongoDB writes. Crashed workers recover after expiry.
const LEASE_MS = 15 * 60 * 1000;

export function formatAlbumMegabytes(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function validateProfileUploadSizes(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) {
    throw new UserFacingError("Select at least one profile photo.");
  }
  const sizes = attachments.map(item => Number(item?.size));
  if (sizes.some(size => !Number.isSafeInteger(size) || size < 1)) {
    throw new UserFacingError("Discord did not provide a valid photo size. Try uploading the photo again.");
  }
  const batchBytes = sizes.reduce((total, size) => total + size, 0);
  if (sizes.some(size => size > PROFILE_PHOTO_LIMIT_BYTES) ||
      batchBytes > PROFILE_BATCH_LIMIT_BYTES) {
    throw new UserFacingError(
      "Each profile photo must be at most 24 MB, and each upload batch at most 80 MB.",
    );
  }
  return batchBytes;
}

export function assertAlbumQuota(usedBytes, incomingBytes) {
  if (!Number.isSafeInteger(usedBytes) || usedBytes < 0) {
    throw new Error("Unable to verify the amount of profile album storage used.");
  }
  if (usedBytes + incomingBytes > PROFILE_ALBUM_QUOTA_BYTES) {
    const used = formatAlbumMegabytes(usedBytes);
    const remaining = formatAlbumMegabytes(Math.max(0, PROFILE_ALBUM_QUOTA_BYTES - usedBytes));
    throw new UserFacingError(
      "Your profile photo album uses " + used + " MB of its 250 MB limit (" +
      remaining + " MB remaining). Remove some album photos before uploading more.",
    );
  }
}

/**
 * Actual GridFS file lengths, including older albums created before quota
 * enforcement, are the source of truth. Legacy Discord-hosted photo URLs do
 * not take up GridFS storage and are not counted.
 */
export async function getProfileAlbumStorageBytes(guildId, ownerId, filesCollection) {
  const results = await filesCollection.aggregate([
    { $match: { "metadata.guildId": guildId, "metadata.ownerId": ownerId } },
    { $group: { _id: null, bytes: { $sum: "$length" } } },
  ]).toArray();
  const size = results[0]?.bytes ?? 0;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("Stored profile album sizes could not be verified.");
  }
  return size;
}

/**
 * An expiring, unique Mongo lease serializes uploads from the same member,
 * even if Replit and Wispbyte share MongoDB. No photo or quota is deleted.
 * On crash, the lease expires instead of blocking the member permanently.
 */
export async function beginProfileAlbumUpload(guildId, ownerId, attachments, {
  LockModel = ProfileAlbumUploadLock,
  filesCollection,
  now = () => Date.now(),
} = {}) {
  const requestedBytes = validateProfileUploadSizes(attachments);
  if (!filesCollection) throw new Error("Profile GridFS files collection is required.");
  await LockModel.init();
  const token = new (await import("node:crypto")).randomUUID();
  const acquiredAt = now();
  try {
    await LockModel.updateOne({
      guildId, ownerId,
      $or: [
        { expiresAt: { $exists: false } },
        { expiresAt: { $lte: new Date(acquiredAt) } },
      ],
    }, {
      $set: {
        guildId, ownerId, token,
        expiresAt: new Date(acquiredAt + LEASE_MS),
      },
    }, { upsert: true });
  } catch (error) {
    if (Number(error?.code) === 11000) {
      throw new UserFacingError(
        "An album upload is already running for you. Try again after it finishes.",
      );
    }
    throw error;
  }

  let released = false;
  const release = async () => {
    if (released) return;
    await LockModel.deleteOne({ guildId, ownerId, token });
    released = true;
  };
  try {
    const usedBytes = await getProfileAlbumStorageBytes(guildId, ownerId, filesCollection);
    assertAlbumQuota(usedBytes, requestedBytes);
    return { release, usedBytes, requestedBytes };
  } catch (error) {
    await release().catch(releaseError => console.error(
      "[Album quota] Could not release failed upload lease:", releaseError));
    throw error;
  }
}
