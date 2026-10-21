import { MessageFlags, SlashCommandBuilder } from "discord.js";
import UserProfile from "../models/UserProfile.js";
import { UserFacingError } from "./errors.js";
import {
  getConfiguredTextChannel,
  getMessageMedia,
  requireGuild,
  validateVideoAttachment,
  validateWebUrl,
} from "./shared.js";
import { prepareMediaFiles } from "./video-compression.js";

export const data = new SlashCommandBuilder()
  .setName("inventory-video")
  .setDescription("Upload a video that plays in the inventory showcase channel")
  .addAttachmentOption((option) =>
    option
      .setName("video")
      .setDescription("Upload an MP4, WebM, or other supported video file")
      .setRequired(true),
  );

async function replaceInventoryVideo(interaction, { video = null, videoUrl = "" } = {}) {
  const channel = await getConfiguredTextChannel(
    interaction,
    "inventoryChannelId",
    "inventory showcase",
  );
  const profileFilter = {
    guildId: interaction.guildId,
    discordUserId: interaction.user.id,
  };
  const existingProfile = await UserProfile.findOne(profileFilter);
  const previousVideoPost =
    existingProfile?.inventoryVideoPostChannelId &&
    existingProfile?.inventoryVideoPostMessageId
      ? {
          channelId: existingProfile.inventoryVideoPostChannelId,
          messageId: existingProfile.inventoryVideoPostMessageId,
        }
      : null;
  const displayName = interaction.user.globalName ?? interaction.user.username;
  const adoptMeUsername = existingProfile?.adoptMeUsername || "Not added yet";
  let files = [];
  let cleanup = async () => {};
  if (video) {
    const prepared = await prepareMediaFiles(
      [video],
      `inventory-video-${interaction.user.id}`,
    );
    files = prepared.files;
    cleanup = prepared.cleanup;
  }
  let videoPost;
  try {
    videoPost = await channel.send({
      content: [
        `Inventory video from ${displayName}`,
        `Adopt Me username: ${adoptMeUsername}`,
        videoUrl,
      ].filter(Boolean).join("\n"),
      files,
      allowedMentions: { parse: [] },
    });
  } finally {
    await cleanup();
  }

  try {
    await UserProfile.findOneAndUpdate(
      profileFilter,
      {
        $set: {
          discordUsername: interaction.user.username,
          displayName,
          inventoryVideoUrl: videoPost.url,
          inventoryVideoAsset: video ? getMessageMedia(videoPost)[0] ?? null : null,
          inventoryVideoPostChannelId: videoPost.channelId,
          inventoryVideoPostMessageId: videoPost.id,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );
  } catch (error) {
    await videoPost.delete().catch(() => {});
    throw error;
  }

  if (previousVideoPost) {
    try {
      const oldChannel = await interaction.guild.channels.fetch(
        previousVideoPost.channelId,
      );
      const oldMessage = await oldChannel?.messages.fetch(
        previousVideoPost.messageId,
      );
      await oldMessage?.delete();
    } catch {
      // Keep the new playable post if the previous post was already removed.
    }
  }

  return videoPost;
}

export async function saveInventoryVideoFile(interaction, video) {
  validateVideoAttachment(video);
  return replaceInventoryVideo(interaction, { video });
}

export async function saveInventoryVideoLink(interaction, value) {
  const videoUrl = validateWebUrl(value, "Inventory video");
  if (!videoUrl) {
    throw new UserFacingError("Add a video link or upload a video file.");
  }
  return replaceInventoryVideo(interaction, { videoUrl });
}

export async function execute(interaction) {
  requireGuild(interaction);
  const video = interaction.options.getAttachment("video", true);
  validateVideoAttachment(video);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const videoPost = await saveInventoryVideoFile(interaction, video);
  await interaction.editReply({
    content: `Your video is posted and playable in the inventory channel: ${videoPost.url}`,
    allowedMentions: { parse: [] },
  });
}
