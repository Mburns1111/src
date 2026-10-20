import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import UserProfile from "../models/UserProfile.js";
import {
  discordMessageUrl,
  getAttachments,
  getConfiguredTextChannel,
  getMessageMedia,
  prepareFiles,
  requireGuild,
  validateAttachments,
  validateVideoAttachment,
  validateWebUrl,
} from "./shared.js";
import { UserFacingError } from "./errors.js";
import { getProfileMedia } from "./profile-media.js";

export const data = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("Create, edit, and view member showcase profiles")
  .addSubcommand((command) =>
    command
      .setName("show")
      .setDescription("View a member's showcase profile")
      .addUserOption((option) =>
        option.setName("user").setDescription("Member to view"),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("edit")
      .setDescription("Create or update your showcase profile")
      .addStringOption((option) =>
        option
          .setName("adopt_me_username")
          .setDescription("Your Adopt Me username")
          .setMaxLength(64),
      )
      .addStringOption((option) =>
        option
          .setName("about")
          .setDescription("A short introduction")
          .setMaxLength(500),
      )
      .addBooleanOption((option) =>
        option
          .setName("looking_for_trades")
          .setDescription("Whether you are looking for trades"),
      )
      .addStringOption((option) =>
        option
          .setName("inventory_video")
          .setDescription("External video link; upload a file for reliable inline playback")
          .setMinLength(1)
          .setMaxLength(500),
      )
      .addAttachmentOption((option) =>
        option
          .setName("inventory_video_file")
          .setDescription("Upload MP4, WebM, or another video file for inline playback"),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("album_add")
      .setDescription("Add screenshots to your photo album")
      .addAttachmentOption((option) =>
        option
          .setName("image_1")
          .setDescription("First screenshot")
          .setRequired(true),
      )
      .addAttachmentOption((option) =>
        option.setName("image_2").setDescription("Another screenshot"),
      )
      .addAttachmentOption((option) =>
        option.setName("image_3").setDescription("Another screenshot"),
      )
      .addAttachmentOption((option) =>
        option.setName("image_4").setDescription("Another screenshot"),
      )
      .addAttachmentOption((option) =>
        option.setName("image_5").setDescription("Another screenshot"),
      ),
  );

function makeProfileEmbed(profile, target, guildId, firstImageName) {
  const inventoryPostUrl =
    profile.inventoryVideoPostChannelId && profile.inventoryVideoPostMessageId
      ? discordMessageUrl(
          guildId,
          profile.inventoryVideoPostChannelId,
          profile.inventoryVideoPostMessageId,
        )
      : profile.inventoryVideoUrl;
  const albumLinks = profile.albumPosts
    .slice(-8)
    .map((post, index) => {
      const url = discordMessageUrl(guildId, post.channelId, post.messageId);
      return `[Album post ${index + 1}](${url})`;
    });

  const embed = new EmbedBuilder()
    .setColor(0x57a773)
    .setTitle(`${profile.displayName}'s Adopt Me Profile`)
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .addFields(
      {
        name: "Adopt Me username",
        value: profile.adoptMeUsername || "Not added yet",
        inline: true,
      },
      {
        name: "Looking for trades",
        value: profile.lookingForTrades ? "Yes" : "No",
        inline: true,
      },
      {
        name: "Inventory video",
        value: inventoryPostUrl
          ? `[Watch inventory video](${inventoryPostUrl})`
          : "Not added yet",
      },
      {
        name: "Photo album",
        value: albumLinks.length ? albumLinks.join("\n") : "No screenshots added yet",
      },
    )
    .setFooter({ text: `Discord member: ${profile.discordUsername}` })
    .setTimestamp(profile.updatedAt);

  if (profile.bio) {
    embed.setDescription(profile.bio.slice(0, 4096));
  }
  if (firstImageName) embed.setImage(`attachment://${firstImageName}`);
  return embed;
}

export async function execute(interaction) {
  requireGuild(interaction);
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "show") {
    const target = interaction.options.getUser("user") ?? interaction.user;
    const profile = await UserProfile.findOne({
      guildId: interaction.guildId,
      discordUserId: target.id,
    });

    if (!profile) {
      throw new UserFacingError(
        "That member has not made a profile yet. Use `/profile edit` to create yours.",
      );
    }

    const media = await getProfileMedia(interaction.guild, profile);
    const { files, firstImageName } = prepareFiles(media, `profile-${target.id}`);
    await interaction.reply({
      embeds: [
        makeProfileEmbed(profile, target, interaction.guildId, firstImageName),
      ],
      files,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === "edit") {
    const updates = {
      discordUsername: interaction.user.username,
      displayName: interaction.user.globalName ?? interaction.user.username,
    };
    const adoptMeUsername = interaction.options.getString("adopt_me_username");
    const about = interaction.options.getString("about");
    const lookingForTrades = interaction.options.getBoolean("looking_for_trades");
    const inventoryVideo = interaction.options.getString("inventory_video")?.trim() ?? null;
    const inventoryVideoFile = interaction.options.getAttachment("inventory_video_file");
    const hasInventoryVideoUrl = Boolean(inventoryVideo);
    const hasInventoryVideoFile = Boolean(inventoryVideoFile);

    if (hasInventoryVideoUrl && hasInventoryVideoFile) {
      throw new UserFacingError(
        "Choose either an inventory video URL or an uploaded video file, not both.",
      );
    }
    if (hasInventoryVideoFile) validateVideoAttachment(inventoryVideoFile);

    if (adoptMeUsername !== null) {
      updates.adoptMeUsername = adoptMeUsername.trim();
    }
    if (about !== null) updates.bio = about.trim();
    if (lookingForTrades !== null) {
      updates.lookingForTrades = lookingForTrades;
    }
    if (hasInventoryVideoUrl) {
      updates.inventoryVideoUrl = validateWebUrl(
        inventoryVideo,
        "Inventory video",
      );
      updates.inventoryVideoAsset = null;
    }

    if (
      adoptMeUsername === null &&
      about === null &&
      lookingForTrades === null &&
      !hasInventoryVideoUrl &&
      !hasInventoryVideoFile
    ) {
      throw new UserFacingError("Enter at least one profile field to update.");
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const profileFilter = {
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
    };
    let previousVideoPost = null;
    let newVideoPost = null;

    if (hasInventoryVideoUrl || hasInventoryVideoFile) {
      const inventoryChannel = await getConfiguredTextChannel(
        interaction,
        "inventoryChannelId",
        "inventory showcase",
      );
      const existingProfile = await UserProfile.findOne(profileFilter);
      previousVideoPost = existingProfile?.inventoryVideoPostChannelId &&
        existingProfile?.inventoryVideoPostMessageId
        ? {
            channelId: existingProfile.inventoryVideoPostChannelId,
            messageId: existingProfile.inventoryVideoPostMessageId,
          }
        : null;
      const adoptMeName =
        updates.adoptMeUsername ?? existingProfile?.adoptMeUsername ?? "Not added yet";
      const inventoryPostContent =
        `Inventory video from ${interaction.user.username}\nAdopt Me username: ${adoptMeName}`;

      if (inventoryVideoFile) {
        const { files } = prepareFiles(
          [inventoryVideoFile],
          `inventory-video-${interaction.user.id}`,
        );
        newVideoPost = await inventoryChannel.send({
          content: inventoryPostContent,
          files,
          allowedMentions: { parse: [] },
        });
        updates.inventoryVideoAsset = getMessageMedia(newVideoPost)[0] ?? null;
        // Link the profile to the durable channel message, not the temporary upload URL.
        updates.inventoryVideoUrl = newVideoPost.url;
      } else {
        newVideoPost = await inventoryChannel.send({
          content: `${inventoryPostContent}\n${updates.inventoryVideoUrl}`,
          allowedMentions: { parse: [] },
        });
      }
      updates.inventoryVideoPostChannelId = newVideoPost.channelId;
      updates.inventoryVideoPostMessageId = newVideoPost.id;
    }

    let profile;
    try {
      profile = await UserProfile.findOneAndUpdate(
        profileFilter,
        { $set: updates },
        {
          returnDocument: "after",
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );
    } catch (error) {
      if (newVideoPost) await newVideoPost.delete().catch(() => {});
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
        // Keep the profile update even if an old showcase post was already removed.
      }
    }

    const media = await getProfileMedia(interaction.guild, profile);
    const { files, firstImageName } = prepareFiles(
      media,
      `profile-${interaction.user.id}`,
    );
    await interaction.editReply({
      content: "Your profile was saved.",
      embeds: [
        makeProfileEmbed(
          profile,
          interaction.user,
          interaction.guildId,
          firstImageName,
        ),
      ],
      files,
      allowedMentions: { parse: [] },
    });
    return;
  }

  if (subcommand === "album_add") {
    const attachments = getAttachments(interaction, "image");
    validateAttachments(attachments, { imagesOnly: true });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = await getConfiguredTextChannel(
      interaction,
      "inventoryChannelId",
      "inventory showcase",
    );
    const { files } = prepareFiles(attachments, `album-${interaction.user.id}`);
    const archiveMessage = await channel.send({
      content: `Photo album from ${interaction.user.username} (${interaction.user.id})`,
      files,
      allowedMentions: { parse: [] },
    });

    await UserProfile.findOneAndUpdate(
      {
        guildId: interaction.guildId,
        discordUserId: interaction.user.id,
      },
      {
        $set: {
          discordUsername: interaction.user.username,
          displayName: interaction.user.globalName ?? interaction.user.username,
        },
        $push: {
          albumPosts: {
            channelId: archiveMessage.channelId,
            messageId: archiveMessage.id,
            attachments: getMessageMedia(archiveMessage),
            addedAt: new Date(),
          },
        },
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    await interaction.editReply({
      content: `Added ${attachments.length} screenshot(s) to your profile album: ${archiveMessage.url}`,
      allowedMentions: { parse: [] },
    });
  }
}
