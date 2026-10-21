import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import UserProfile from "../models/UserProfile.js";
import {
  discordMessageUrl,
  getConfiguredTextChannel,
  getMessageMedia,
  prepareFiles,
  requireGuild,
  validateAttachments,
} from "./shared.js";
import { UserFacingError } from "./errors.js";
import {
  getProfileAlbumImages,
  getProfileInventoryVideo,
} from "./profile-media.js";
import {
  saveInventoryVideoFile,
  saveInventoryVideoLink,
} from "./inventory-video.js";

export const data = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("View or update your member showcase profile")
  .addUserOption((option) =>
    option.setName("user").setDescription("View another member's profile"),
  );

function makeProfileEmbed(profile, target, guildId, firstImageName, albumPage, albumCount) {
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
  if (albumCount) {
    embed.addFields({
      name: "Photo",
      value: `${albumPage + 1} of ${albumCount}`,
      inline: true,
    });
  }
  if (firstImageName) embed.setImage(`attachment://${firstImageName}`);
  return embed;
}

function makeAlbumButtons(userId, page, count) {
  if (!count) return [];

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`profile:album:${userId}:${page - 1}`)
        .setLabel("◀")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`profile:album:${userId}:${page + 1}`)
        .setLabel("▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= count - 1),
    ),
  ];
}

async function makeProfileShowPayload(guild, profile, target, page) {
  const [albumImages, inventoryVideo] = await Promise.all([
    getProfileAlbumImages(guild, profile),
    getProfileInventoryVideo(guild, profile),
  ]);
  const albumPage = albumImages.length ? Math.min(page, albumImages.length - 1) : 0;
  const currentImage = albumImages[albumPage];
  const { files, firstImageName } = prepareFiles(
    [...inventoryVideo, ...(currentImage ? [currentImage] : [])],
    `profile-${target.id}-page-${albumPage}`,
  );

  return {
    content: "",
    embeds: [
      makeProfileEmbed(
        profile,
        target,
        guild.id,
        firstImageName,
        albumPage,
        albumImages.length,
      ),
    ],
    files,
    attachments: [],
    components: makeAlbumButtons(target.id, albumPage, albumImages.length),
    allowedMentions: { parse: [] },
  };
}

export async function handleProfileAlbumPage(interaction) {
  const [, section, targetUserId, pageValue] = interaction.customId.split(":");
  if (section !== "album" || !/^\d{17,20}$/.test(targetUserId)) {
    throw new UserFacingError("That profile photo button is not valid.");
  }
  const page = Number(pageValue);
  if (!Number.isSafeInteger(page) || page < 0) {
    throw new UserFacingError("That profile photo page is not valid.");
  }

  await interaction.deferUpdate();
  const profile = await UserProfile.findOne({
    guildId: interaction.guildId,
    discordUserId: targetUserId,
  });
  if (!profile) {
    throw new UserFacingError("This member's profile is no longer available.");
  }
  const target = await interaction.client.users.fetch(targetUserId);
  await interaction.message.edit(
    await makeProfileShowPayload(interaction.guild, profile, target, page),
  );
}

function makeProfileMenu(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`profile:menu:view:${userId}`)
        .setLabel("View my card")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`profile:menu:edit:${userId}`)
        .setLabel("Edit my card")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`profile:menu:photos:${userId}`)
        .setLabel("Add photos")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`profile:menu:video:${userId}`)
        .setLabel("Inventory video")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function makeMenuReply(userId, content = "Choose what you want to do with your profile.") {
  return {
    content,
    components: makeProfileMenu(userId),
    embeds: [],
    attachments: [],
    allowedMentions: { parse: [] },
  };
}

async function getOrCreateProfile(user) {
  return await UserProfile.findOne({
    guildId: user.guildId,
    discordUserId: user.id,
  }) ?? new UserProfile({
    guildId: user.guildId,
    discordUserId: user.id,
    discordUsername: user.username,
    displayName: user.globalName ?? user.username,
  });
}

function makeEditProfileModal(profile, userId) {
  const usernameInput = new TextInputBuilder()
    .setCustomId("adopt_me_username")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(64)
    .setRequired(false);
  if (profile.adoptMeUsername) usernameInput.setValue(profile.adoptMeUsername);

  const bioInput = new TextInputBuilder()
    .setCustomId("about")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500)
    .setRequired(false);
  if (profile.bio) bioInput.setValue(profile.bio);

  return new ModalBuilder()
    .setCustomId(`profile:edit:${userId}`)
    .setTitle("Edit your profile")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Adopt Me username")
        .setTextInputComponent(usernameInput),
      new LabelBuilder()
        .setLabel("About you")
        .setTextInputComponent(bioInput),
      new LabelBuilder()
        .setLabel("Are you looking for trades?")
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("looking_for_trades")
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              {
                label: "Yes",
                value: "yes",
                default: profile.lookingForTrades,
              },
              {
                label: "No",
                value: "no",
                default: !profile.lookingForTrades,
              },
            ),
        ),
    );
}

function makeAddPhotosModal(userId) {
  return new ModalBuilder()
    .setCustomId(`profile:photos:${userId}`)
    .setTitle("Add photos to your profile")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Choose 1 to 5 pictures")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("images")
            .setMinValues(1)
            .setMaxValues(5),
        ),
    );
}

function makeInventoryVideoModal(userId) {
  const videoUrlInput = new TextInputBuilder()
    .setCustomId("video_url")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(500)
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId(`profile:video:${userId}`)
    .setTitle("Add an inventory video")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Paste a video link, or upload a file below")
        .setDescription("Choose one option, not both.")
        .setTextInputComponent(videoUrlInput),
      new LabelBuilder()
        .setLabel("Upload a video (optional)")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("video")
            .setMinValues(0)
            .setMaxValues(1)
            .setRequired(false),
        ),
    );
}

export async function handleProfileMenuButton(interaction) {
  const [, section, action, ownerId] = interaction.customId.split(":");
  if (section !== "menu" || ownerId !== interaction.user.id) {
    throw new UserFacingError("That profile menu is not yours to use.");
  }

  if (action === "view") {
    await interaction.deferUpdate();
    const profile = await UserProfile.findOne({
      guildId: interaction.guildId,
      discordUserId: ownerId,
    });
    if (!profile) {
      await interaction.message.edit(
        makeMenuReply(ownerId, "You don't have a profile yet. Choose **Edit my card** to create one."),
      );
      return;
    }
    await interaction.message.edit(
      await makeProfileShowPayload(interaction.guild, profile, interaction.user, 0),
    );
    return;
  }

  if (action === "edit") {
    const user = {
      id: interaction.user.id,
      username: interaction.user.username,
      globalName: interaction.user.globalName,
      guildId: interaction.guildId,
    };
    const profile = await getOrCreateProfile(user);
    await interaction.showModal(makeEditProfileModal(profile, ownerId));
    return;
  }
  if (action === "photos") {
    await interaction.showModal(makeAddPhotosModal(ownerId));
    return;
  }
  if (action === "video") {
    await interaction.showModal(makeInventoryVideoModal(ownerId));
    return;
  }

  throw new UserFacingError("That profile option is not available.");
}

export async function handleProfileModal(interaction) {
  const [, action, ownerId] = interaction.customId.split(":");
  if (!["edit", "photos", "video"].includes(action) || ownerId !== interaction.user.id) {
    throw new UserFacingError("That profile form is not yours to use.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profileFilter = {
    guildId: interaction.guildId,
    discordUserId: interaction.user.id,
  };

  if (action === "edit") {
    const adoptMeUsername = interaction.fields
      .getTextInputValue("adopt_me_username")
      .trim();
    const bio = interaction.fields.getTextInputValue("about").trim();
    const lookingForTrades = interaction.fields
      .getStringSelectValues("looking_for_trades")[0] === "yes";

    await UserProfile.findOneAndUpdate(
      profileFilter,
      {
        $set: {
          discordUsername: interaction.user.username,
          displayName: interaction.user.globalName ?? interaction.user.username,
          adoptMeUsername,
          bio,
          lookingForTrades,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );
    await interaction.editReply(
      makeMenuReply(interaction.user.id, "Your profile card was saved."),
    );
    return;
  }

  if (action === "photos") {
    const uploads = Array.from(
      interaction.fields.getUploadedFiles("images", true).values(),
    );
    validateAttachments(uploads, { imagesOnly: true });
    const channel = await getConfiguredTextChannel(
      interaction,
      "inventoryChannelId",
      "inventory showcase",
    );
    const { files } = prepareFiles(uploads, `album-${interaction.user.id}`);
    const archiveMessage = await channel.send({
      content: `Photo album from ${interaction.user.username} (${interaction.user.id})`,
      files,
      allowedMentions: { parse: [] },
    });

    try {
      await UserProfile.findOneAndUpdate(
        profileFilter,
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
          runValidators: true,
          setDefaultsOnInsert: true,
        },
      );
    } catch (error) {
      await archiveMessage.delete().catch(() => {});
      throw error;
    }

    await interaction.editReply(
      makeMenuReply(
        interaction.user.id,
        `Added ${uploads.length} photo(s) to your album. Choose another option below.`,
      ),
    );
    return;
  }

  const video = interaction.fields.getUploadedFiles("video")?.first();
  const videoUrl = interaction.fields.getTextInputValue("video_url").trim();
  if (video && videoUrl) {
    throw new UserFacingError("Choose either a video link or an uploaded video, not both.");
  }
  if (!video && !videoUrl) {
    throw new UserFacingError("Add a video link or upload a video file.");
  }

  const videoPost = video
    ? await saveInventoryVideoFile(interaction, video)
    : await saveInventoryVideoLink(interaction, videoUrl);
  await interaction.editReply(
    makeMenuReply(
      interaction.user.id,
      `Your inventory video was saved: ${videoPost.url}`,
    ),
  );
}

export async function execute(interaction) {
  requireGuild(interaction);
  const target = interaction.options.getUser("user");

  if (!target) {
    await interaction.reply({
      content: "Welcome to your profile! Pick what you want to do:",
      components: makeProfileMenu(interaction.user.id),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.deferReply();
  const profile = await UserProfile.findOne({
    guildId: interaction.guildId,
    discordUserId: target.id,
  });
  if (!profile) {
    throw new UserFacingError(
      "That member has not made a profile yet.",
    );
  }

  await interaction.editReply(
    await makeProfileShowPayload(interaction.guild, profile, target, 0),
  );
}
