import { MessageFlags, SlashCommandBuilder } from "discord.js";
import UserProfile from "../models/UserProfile.js";
import { awardMilestoneSafely } from "../services/points-rewards.js";
import { UserFacingError } from "./errors.js";
import {
  getConfiguredTextChannel,
  getMessageMedia,
  requireGuild,
  validateVideoAttachment,
  validateWebUrl,
} from "./shared.js";
import { prepareMediaFiles } from "./video-compression.js";
import { ensureChannelEntry } from "./channel-entry.js";

export async function ensureInventoryEntry(guild, channel, { moveToBottom = false } = {}) {
  return ensureChannelEntry(guild, channel, {
    channelField: "inventoryEntryChannelId",
    messageField: "inventoryEntryMessageId",
    customId: "inventory:entry",
    label: "Add an inventory video",
    description: "Use the button to upload a playable video or add a video link.",
    moveToBottom,
  });
}

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
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const displayName = member.displayName;
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
        `Discord username: ${displayName}`,
        `Roblox username: ${adoptMeUsername}`,
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

  await ensureInventoryEntry(interaction.guild, channel, { moveToBottom: true });
  await awardMilestoneSafely(interaction.guildId, interaction.user.id,
    "inventoryFirstPost", videoPost.id);
  return videoPost;
}


/**
 * Import an older inventory video/link for a selected member, without replacing
 * a previously managed post. The profile remains owned by discordUserId.
 *
 * On a partially completed send/database write, NEVER delete the published
 * video: it may be the sole surviving copy of the admin's source media.
 */
export async function importInventoryForMember(interaction, {
  owner, video = null, videoUrl = "", importedById,
}) {
  if (!owner?.id || !importedById || (Boolean(video) === Boolean(videoUrl))) {
    throw new UserFacingError("Provide exactly one inventory video file or video link for a valid member.");
  }
  if (video) validateVideoAttachment(video);
  if (videoUrl) videoUrl = validateWebUrl(videoUrl, "Inventory video");
  const channel = await getConfiguredTextChannel(interaction, "inventoryChannelId", "inventory showcase");
  const criteria = { guildId: interaction.guildId, discordUserId: owner.id };
  const profile = await UserProfile.findOne(criteria);
  if (profile?.inventoryVideoPostMessageId || profile?.inventoryVideoUrl) {
    throw new UserFacingError("This member already has an inventory video. Nothing was replaced. They can manage their existing entry themselves.");
  }

  let files = [];
  let cleanup = async () => {};
  if (video) {
    const prepared = await prepareMediaFiles([video], `inventory-import-${owner.id}`);
    files = prepared.files;
    cleanup = prepared.cleanup;
  }
  let post;
  try {
    post = await channel.send({
      content: [
        `Inventory video for ${owner.displayName} (<@${owner.id}>)`,
        `Discord username: ${owner.displayName}`,
        `Roblox username: ${profile?.adoptMeUsername || "Not added yet"}`,
        videoUrl,
      ].filter(Boolean).join("\n"),
      files,
      allowedMentions: { parse: [] },
    });
  } finally {
    await cleanup().catch(error =>
      console.warn("[Admin inventory import] Temporary video cleanup failed:", error));
  }

  if (video && !getMessageMedia(post).some(item =>
    item.contentType?.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(item.name ?? ""))) {
    throw new UserFacingError("Discord did not confirm a playable video. The attempted post was preserved for review: " + post.url);
  }

  try {
    // The conditional filter prevents overwriting an existing video if the
    // user posts one between our initial check and the final Mongo write.
    // A unique guild/user index prevents concurrent upsert duplicates.
    const saved = await UserProfile.findOneAndUpdate({
      ...criteria,
      inventoryVideoPostMessageId: { $in: ["", null] },
      inventoryVideoUrl: { $in: ["", null] },
    }, { $set: {
      discordUsername: owner.user?.username || owner.displayName,
      displayName: owner.displayName,
      inventoryVideoUrl: post.url,
      inventoryVideoAsset: video ? getMessageMedia(post)[0] ?? null : null,
      inventoryVideoPostChannelId: post.channelId,
      inventoryVideoPostMessageId: post.id,
      inventoryVideoImportedById: importedById,
    } }, {
      upsert: true, returnDocument: "after",
      runValidators: true, setDefaultsOnInsert: true,
    });
    if (!saved) throw new Error("Could not confirm imported inventory owner.");
  } catch (error) {
    console.error("[Admin inventory import] Post preserved after profile save failure:", post.id, error);
    throw new UserFacingError("The inventory post was sent, but saving member ownership needs review. Post: " +
      post.url + ". Do not import it again until a manager checks the record.");
  }
  await ensureInventoryEntry(interaction.guild, channel, { moveToBottom: true }).catch(error =>
    console.warn("[Admin inventory import] Could not reposition entry:", error));
  return post;
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

export async function execute(
  interaction,
  { refreshProfileCard, refreshTradingPostCard } = {},
) {
  requireGuild(interaction);
  const video = interaction.options.getAttachment("video", true);
  validateVideoAttachment(video);
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const videoPost = await saveInventoryVideoFile(interaction, video);
  await refreshProfileCard?.();
  await refreshTradingPostCard?.();
  await interaction.editReply({
    content: `Your video is posted and playable in the inventory channel: ${videoPost.url}`,
    allowedMentions: { parse: [] },
  });
}
