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

export async function getProfileMedia(guild, profile, limit = 10) {
  const sources = [];
  if (profile.inventoryVideoPostChannelId && profile.inventoryVideoPostMessageId) {
    sources.push({
      channelId: profile.inventoryVideoPostChannelId,
      messageId: profile.inventoryVideoPostMessageId,
      attachments: profile.inventoryVideoAsset ? [profile.inventoryVideoAsset] : [],
    });
  } else if (profile.inventoryVideoAsset) {
    sources.push({ attachments: [profile.inventoryVideoAsset] });
  }
  sources.push(...[...profile.albumPosts].reverse());

  const media = [];
  const seen = new Set();
  for (const source of sources) {
    for (const attachment of await getCurrentAttachments(guild, source)) {
      if (!attachment.url || !attachment.name) continue;
      const identity = attachment.attachmentId || attachment.url;
      if (seen.has(identity)) continue;
      seen.add(identity);
      media.push(attachment);
      if (media.length >= limit) return media;
    }
  }
  return media;
}
