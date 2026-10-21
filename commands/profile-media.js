import { getMessageMedia } from "./shared.js";

async function getCurrentAttachments(guild, source) {
  const saved = Array.from(source.attachments ?? []);
  if (!source.channelId || !source.messageId) return saved;

  try {
    const channel = await guild.channels.fetch(source.channelId);
    const message = await channel?.messages.fetch(source.messageId);
    const current = getMessageMedia(message);
    return current.length ? current : saved;
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
  const images = [];
  const seen = new Set();

  for (const source of [...profile.albumPosts].reverse()) {
    for (const attachment of await getCurrentAttachments(guild, source)) {
      if (!attachment.url || !isImageAttachment(attachment)) continue;
      const identity = attachment.attachmentId || attachment.url;
      if (seen.has(identity)) continue;
      seen.add(identity);
      images.push(attachment);
    }
  }

  return images;
}

export async function getProfileInventoryVideo(guild, profile) {
  const source = getInventoryVideoSource(profile);
  if (!source) return [];
  return (await getCurrentAttachments(guild, source)).filter(
    (attachment) => !isImageAttachment(attachment),
  );
}
