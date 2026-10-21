import { UserFacingError } from "./errors.js";
import GuildConfig from "../models/GuildConfig.js";

export function requireGuild(interaction) {
  if (!interaction.inGuild()) {
    throw new UserFacingError("Use this command inside a server.");
  }
}

export function getAttachments(interaction, prefix, count = 5) {
  return Array.from({ length: count }, (_, index) =>
    interaction.options.getAttachment(`${prefix}_${index + 1}`),
  ).filter(Boolean);
}

export function isVideoAttachment(attachment) {
  const type = attachment.contentType?.split(";")[0].toLowerCase();
  const name = attachment.name.toLowerCase();
  return type?.startsWith("video/") ||
    /\.(mp4|webm|mov|m4v)$/i.test(name);
}

export function validateAttachments(attachments, { imagesOnly = false } = {}) {
  for (const attachment of attachments) {
    const type = attachment.contentType?.split(";")[0].toLowerCase();
    const name = attachment.name.toLowerCase();
    const isImage = type?.startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|avif)$/i.test(name);
    const isVideo = isVideoAttachment(attachment);

    if (imagesOnly && !isImage) {
      throw new UserFacingError("This upload must be an image file.");
    }
    if (!imagesOnly && !isImage && !isVideo) {
      throw new UserFacingError("Upload image or video files only.");
    }
  }
}

export function validateVideoAttachment(attachment) {
  if (!isVideoAttachment(attachment)) {
    throw new UserFacingError(
      "Upload a video file such as MP4 or WebM to play it in the inventory channel.",
    );
  }
}

export function prepareFiles(attachments, prefix) {
  const files = attachments.map((attachment, index) => {
    const safeName = attachment.name
      .split(/[\\/]/)
      .pop()
      .replace(/[^\w.-]/g, "_")
      .slice(-80);
    return {
      attachment: attachment.url,
      name: `${prefix}-${index + 1}-${safeName || "upload"}`,
    };
  });

  const firstImageName = files.find((_, index) => {
    const attachment = attachments[index];
    return attachment.contentType?.toLowerCase().startsWith("image/") ||
      /\.(png|jpe?g|gif|webp|avif)$/i.test(attachment.name);
  })?.name;

  return { files, firstImageName };
}

export function getMessageMedia(message) {
  return Array.from(message?.attachments?.values?.() ?? []).map((attachment) => ({
    attachmentId: attachment.id,
    url: attachment.url,
    name: attachment.name,
    contentType: attachment.contentType ?? "",
    size: attachment.size ?? 0,
  }));
}

export function validateWebUrl(value, label) {
  if (!value) return "";

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported URL protocol");
    }
    return url.toString();
  } catch {
    throw new UserFacingError(`${label} must be a valid http or https URL.`);
  }
}

export async function getConfiguredTextChannel(interaction, field, purpose) {
  const config = await GuildConfig.findOne({ guildId: interaction.guildId });
  const channelId = config?.[field];
  if (!channelId) {
    throw new UserFacingError(
      `An admin needs to configure the ${purpose} channel with \`/setup channels\` first.`,
    );
  }

  const channel = await interaction.guild.channels.fetch(channelId);
  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    throw new UserFacingError(
      `The configured ${purpose} channel is unavailable. Ask an admin to run \`/setup channels\` again.`,
    );
  }
  return channel;
}

export function discordMessageUrl(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
