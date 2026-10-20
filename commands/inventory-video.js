import { MessageFlags, SlashCommandBuilder } from "discord.js";
import UserProfile from "../models/UserProfile.js";
import {
  getConfiguredTextChannel,
  getMessageMedia,
  prepareFiles,
  requireGuild,
  validateVideoAttachment,
} from "./shared.js";

export const data = new SlashCommandBuilder()
  .setName("inventory-video")
  .setDescription("Upload a video that plays in the inventory showcase channel")
  .addAttachmentOption((option) =>
    option
      .setName("video")
      .setDescription("Upload an MP4, WebM, or other supported video file")
      .setRequired(true),
  );

export async function execute(interaction) {
  requireGuild(interaction);
  const video = interaction.options.getAttachment("video", true);
  validateVideoAttachment(video);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
  const { files } = prepareFiles([video], `inventory-video-${interaction.user.id}`);

  const videoPost = await channel.send({
    content: `Inventory video from ${displayName}\nAdopt Me username: ${adoptMeUsername}`,
    files,
    allowedMentions: { parse: [] },
  });

  try {
    await UserProfile.findOneAndUpdate(
      profileFilter,
      {
        $set: {
          discordUsername: interaction.user.username,
          displayName,
          inventoryVideoUrl: videoPost.url,
          inventoryVideoAsset: getMessageMedia(videoPost)[0] ?? null,
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

  await interaction.editReply({
    content: `Your video is posted and playable in the inventory channel: ${videoPost.url}`,
    allowedMentions: { parse: [] },
  });
}
