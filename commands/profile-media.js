import mongoose from "mongoose";
import { streamDiscordAttachment } from "../services/media-transfer.js";
import { recordMediaOperation } from "../services/media-telemetry.js";
import {
  beginProfileAlbumUpload, PROFILE_PHOTO_LIMIT_BYTES,
  PROFILE_BATCH_LIMIT_BYTES, validateProfileUploadSizes,
} from "../services/profile-album-quota.js";
import { getMessageMedia } from "./shared.js";
import ProfilePhoto from "../models/ProfilePhoto.js";
import { UserFacingError } from "./errors.js";

const profilePhotoBucketName = "profilePhotos";

function getProfilePhotoBucket() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("MongoDB must be connected before accessing profile photos.");
  }
  return new mongoose.mongo.GridFSBucket(database, {
    bucketName: profilePhotoBucketName,
  });
}

function getProfilePhotoFilesCollection() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("MongoDB must be connected before accessing profile photos.");
  }
  return database.collection(`${profilePhotoBucketName}.files`);
}

async function deleteStoredPhoto(bucket, fileId) {
  try {
    await bucket.delete(fileId);
  } catch (error) {
    // An interrupted GridFS upload may leave orphan chunks without a files
    // document. bucket.delete cannot remove those and reports FileNotFound.
    // Remove only chunks for this exact upload ID, never another photo.
    if (Number(error?.code) === 26 ||
        ["FileNotFound", "MongoGridFSFileNotFoundError"].includes(error?.name) ||
        error?.message === "FileNotFound") {
      try {
        await mongoose.connection.db.collection(`${profilePhotoBucketName}.chunks`)
          .deleteMany({ files_id: fileId });
      } catch (cleanupError) {
        console.error("[Media] Could not remove interrupted GridFS chunks:", cleanupError);
      }
      return;
    }
    console.error(`Could not clean up profile photo ${fileId}:`, error);
  }
}

async function deleteStoredPhotoFiles(fileIds) {
  if (!fileIds.length) return;
  const bucket = getProfilePhotoBucket();
  const files = getProfilePhotoFilesCollection();
  const existingFiles = await files
    .find({ _id: { $in: fileIds } }, { projection: { _id: 1 } })
    .toArray();
  for (const file of existingFiles) {
    try {
      await bucket.delete(file._id);
    } catch (error) {
      if (
        Number(error?.code) !== 26 &&
        error?.name !== "FileNotFound" &&
        error?.name !== "MongoGridFSFileNotFoundError" &&
        error?.message !== "FileNotFound"
      ) {
        throw error;
      }
    }
  }
}

export async function saveProfilePhotos(guildId, ownerId, attachments) {
  // Fail before opening a GridFS stream if the sizes are invalid, the
  // member is over their 250 MB limit, or another upload holds the lease.
  validateProfileUploadSizes(attachments);
  const { release, usedBytes, requestedBytes } = await beginProfileAlbumUpload(
    guildId, ownerId, attachments, {
      filesCollection: getProfilePhotoFilesCollection(),
    },
  );
  const bucket = getProfilePhotoBucket();
  const fileIds = [];
  const photos = [];
  const startedAt = Date.now();
  let totalStoredBytes = 0;

  try {
    for (const attachment of attachments) {
      const upload = bucket.openUploadStream(attachment.name, {
        metadata: { guildId, ownerId, contentType: attachment.contentType ?? "" },
      });
      fileIds.push(upload.id);
      let transferred;
      try {
        // Discord's advertised size is used to reserve quota space. Do not
        // allow a mismatched response to exceed that reservation, even when
        // a CDN Content-Length header is absent or inaccurate.
        transferred = await streamDiscordAttachment(attachment.url, upload, {
          maxBytes: Math.min(PROFILE_PHOTO_LIMIT_BYTES, Number(attachment.size)),
          timeoutMs: 45_000,
        });
      } catch (error) {
        if (error?.code === "TOO_LARGE") {
          throw new UserFacingError(
            "This photo exceeds its declared size or the 24 MB limit. Please upload it again.",
          );
        }
        throw error;
      }
      totalStoredBytes += transferred;
      photos.push({
        guildId,
        ownerId,
        fileId: upload.id,
        name: attachment.name,
        contentType: attachment.contentType || "image/unknown",
        size: transferred,
      });
    }

    const saved = await ProfilePhoto.insertMany(photos);
    recordMediaOperation("profileAlbum", {
      bytes: totalStoredBytes, durationMs: Date.now() - startedAt,
    });
    console.info("[Media] Profile photo upload complete", {
      photoCount: saved.length,
      bytes: totalStoredBytes,
      durationMs: Date.now() - startedAt,
      albumBytesAfter: usedBytes + totalStoredBytes,
    });
    return saved;
  } catch (error) {
    try {
      await ProfilePhoto.deleteMany({ fileId: { $in: fileIds } });
    } catch (cleanupError) {
      console.error("Could not remove profile photo records after an upload failure:", cleanupError);
    }
    await Promise.all(fileIds.map((fileId) => deleteStoredPhoto(bucket, fileId)));
    recordMediaOperation("profileAlbum", {
      outcome: error?.code || error?.name || "error",
      durationMs: Date.now() - startedAt,
    });
    console.warn("[Media] Profile photo upload failed; attempted GridFS cleanup", {
      photoCount: attachments.length,
      reservedBytes: requestedBytes,
      durationMs: Date.now() - startedAt,
      failure: error?.code || error?.name || "UnknownError",
    });
    throw error;
  } finally {
    // A failed upload never permanently consumes the quota; actual GridFS
    // lengths are counted fresh on the next upload. A worker crash releases
    // this short-lived lease on expiration.
    await release().catch(error => {
      console.error("[Album quota] Failed to release upload lease:", error);
    });
  }
}

export function getProfilePhotoStream(fileId) {
  return getProfilePhotoBucket().openDownloadStream(fileId);
}

export async function removeProfilePhotos(guild, profile, photoNumbers) {
  const images = await getProfileAlbumImages(guild, profile);
  const selectedImages = photoNumbers.map((number) => {
    const image = images[number - 1];
    if (!image) {
      throw new UserFacingError(
        `Photo number ${number} does not exist. Your album currently has ${images.length} photo(s).`,
      );
    }
    return image;
  });

  const legacyGroups = new Map();
  for (const image of selectedImages) {
    if (image.profilePhotoFileId) continue;
    const key = `${image.sourceChannelId}:${image.sourceMessageId}`;
    const group = legacyGroups.get(key) ?? {
      channelId: image.sourceChannelId,
      messageId: image.sourceMessageId,
      attachmentIds: new Set(),
    };
    group.attachmentIds.add(image.attachmentId);
    legacyGroups.set(key, group);
  }

  for (const group of legacyGroups.values()) {
    let message;
    try {
      if (group.channelId && group.messageId) {
        const channel = await guild.channels.fetch(group.channelId);
        message = await channel?.messages?.fetch(group.messageId);
      }
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) throw error;
    }
    if (!message) {
      for (const source of profile.albumPosts) {
        if (
          source.channelId === group.channelId &&
          source.messageId === group.messageId
        ) {
          source.attachments = Array.from(source.attachments ?? []).filter(
            (attachment) => !group.attachmentIds.has(attachment.attachmentId),
          );
        }
      }
      continue;
    }
    const remainingAttachments = Array.from(message.attachments.values())
      .filter((attachment) => !group.attachmentIds.has(attachment.id))
      .map((attachment) => ({ id: attachment.id }));
    const updatedMessage = await message.edit({
      attachments: remainingAttachments,
      files: [],
    });
    for (const source of profile.albumPosts) {
      if (
        source.channelId === group.channelId &&
        source.messageId === group.messageId
      ) {
        source.attachments = getMessageMedia(updatedMessage).filter(
          (attachment) => !group.attachmentIds.has(attachment.attachmentId),
        );
      }
    }
  }

  const storedFileIds = selectedImages
    .filter((image) => image.profilePhotoFileId)
    .map((image) => image.profilePhotoFileId);
  if (storedFileIds.length) {
    await ProfilePhoto.deleteMany({
      guildId: profile.guildId,
      ownerId: profile.discordUserId,
      fileId: { $in: storedFileIds },
    });
    await deleteStoredPhotoFiles(storedFileIds);
  }

  if (legacyGroups.size) await profile.save();
  return selectedImages.length;
}

export async function removeAllProfilePhotos(guild, profile) {
  const photoCount = (await getProfileAlbumImages(guild, profile)).length;
  for (const source of profile.albumPosts ?? []) {
    let message;
    try {
      const channel = await guild.channels.fetch(source.channelId);
      message = await channel?.messages?.fetch(source.messageId);
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) throw error;
    }
    if (!message) continue;

    const imageAttachmentIds = new Set(
      Array.from(source.attachments ?? []).map(
        (attachment) => attachment.attachmentId,
      ),
    );
    const remainingAttachments = Array.from(message.attachments.values())
      .filter(
        (attachment) =>
          !imageAttachmentIds.has(attachment.id) &&
          !isImageAttachment(attachment),
      )
      .map((attachment) => ({ id: attachment.id }));
    await message.edit({ attachments: remainingAttachments, files: [] });
  }

  const photoFiles = await getProfilePhotoFilesCollection()
    .find(
      {
        "metadata.guildId": profile.guildId,
        "metadata.ownerId": profile.discordUserId,
      },
      { projection: { _id: 1 } },
    )
    .toArray();
  const fileIds = photoFiles.map((file) => file._id);

  await ProfilePhoto.deleteMany({
    guildId: profile.guildId,
    ownerId: profile.discordUserId,
  });
  profile.albumPosts = [];
  await profile.save();
  await deleteStoredPhotoFiles(fileIds);

  return photoCount;
}

async function getCurrentAttachments(guild, source) {
  const saved = Array.from(source.attachments ?? []);
  if (!source.channelId || !source.messageId) return saved;

  try {
    const channel = await guild.channels.fetch(source.channelId);
    const message = await channel?.messages.fetch(source.messageId);
    return message ? getMessageMedia(message) : saved;
  } catch {
    return saved;
  }
}

function isImageAttachment(attachment) {
  return attachment.contentType?.toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|avif)$/i.test(attachment.name ?? "");
}

function getInventoryVideoSource(profile) {
  if (profile.inventoryVideoPostChannelId && profile.inventoryVideoPostMessageId) {
    return {
      channelId: profile.inventoryVideoPostChannelId,
      messageId: profile.inventoryVideoPostMessageId,
      attachments: profile.inventoryVideoAsset ? [profile.inventoryVideoAsset] : [],
    };
  }
  return profile.inventoryVideoAsset
    ? { attachments: [profile.inventoryVideoAsset] }
    : null;
}

export async function getProfileAlbumImages(guild, profile) {
  const photoQuery = {
    guildId: profile.guildId,
    ownerId: profile.discordUserId,
  };
  const storedPhotos = await ProfilePhoto.find(photoQuery)
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const storedFileIds = storedPhotos.map((photo) => photo.fileId);
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("MongoDB must be connected before accessing profile photos.");
  }
  const existingFiles = storedFileIds.length
    ? await getProfilePhotoFilesCollection()
        .find(
          { _id: { $in: storedFileIds } },
          { projection: { _id: 1, length: 1, chunkSize: 1 } },
        )
        .toArray()
    : [];
  const chunkCounts = storedFileIds.length
    ? await database
        .collection(`${profilePhotoBucketName}.chunks`)
        .aggregate([
          { $match: { files_id: { $in: storedFileIds } } },
          { $group: { _id: "$files_id", count: { $sum: 1 } } },
        ])
        .toArray()
    : [];
  const chunksByFileId = new Map(
    chunkCounts.map((entry) => [String(entry._id), entry.count]),
  );
  const existingFileIds = new Set(
    existingFiles
      .filter(
        (file) =>
          file.length > 0 &&
          chunksByFileId.get(String(file._id)) ===
          Math.ceil(file.length / file.chunkSize),
      )
      .map((file) => String(file._id)),
  );
  const validStoredPhotos = storedPhotos.filter((photo) =>
    existingFileIds.has(String(photo.fileId)),
  );
  const missingPhotoIds = storedPhotos
    .filter((photo) => !existingFileIds.has(String(photo.fileId)))
    .map((photo) => photo._id);
  if (missingPhotoIds.length) {
    console.warn(
      `Removing ${missingPhotoIds.length} profile photo record(s) with missing or incomplete stored files for member ${profile.discordUserId}.`,
    );
    await ProfilePhoto.deleteMany({ _id: { $in: missingPhotoIds } });
    await deleteStoredPhotoFiles(
      storedPhotos
        .filter((photo) => !existingFileIds.has(String(photo.fileId)))
        .map((photo) => photo.fileId),
    );
  }
  const images = validStoredPhotos.map((photo) => ({
    ...photo,
    profilePhotoFileId: photo.fileId,
  }));
  const seen = new Set();

  for (const source of [...profile.albumPosts].reverse()) {
    for (const attachment of await getCurrentAttachments(guild, source)) {
      if (!attachment.url || !isImageAttachment(attachment)) continue;
      const identity = attachment.attachmentId || attachment.url;
      if (seen.has(identity)) continue;
      seen.add(identity);
      images.push({
        ...attachment,
        addedAt: source.addedAt,
        sourceChannelId: source.channelId,
        sourceMessageId: source.messageId,
      });
    }
  }

  return images.sort(
    (first, second) =>
      new Date(first.addedAt ?? first.createdAt).getTime() -
      new Date(second.addedAt ?? second.createdAt).getTime(),
  );
}

export async function getProfileInventoryVideo(guild, profile) {
  const source = getInventoryVideoSource(profile);
  if (!source) return [];
  return (await getCurrentAttachments(guild, source)).filter(
    (attachment) => !isImageAttachment(attachment),
  );
}
