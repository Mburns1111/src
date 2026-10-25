import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import HouseListing from "../models/HouseListing.js";
import { snapshotOwnedListingAppearance } from "../services/listing-appearance.js";
import { refreshHouseStyleCard } from "../services/house-card.js";
import { houseActionComponents } from "../services/house-components.js";
import { houseGalleryCount, archiveHousePhotos, deleteHouseGallery } from "../services/house-gallery.js";
import { isGalleryPhoto, isGalleryVideo, mergeOriginalMedia, HOUSE_ART_NAME } from "../services/house-style.js";
import UserProfile from "../models/UserProfile.js";
import { awardMilestoneSafely } from "../services/points-rewards.js";
import {
  getConfiguredTextChannel,
  getMessageMedia,
  requireGuild,
  validateAttachments,
  validateWebUrl,
} from "./shared.js";
import { UserFacingError } from "./errors.js";
import { prepareMediaFiles } from "./video-compression.js";
import { ensureChannelEntry } from "./channel-entry.js";
import { handleListingInterest } from "./listing-interest.js";
import {
  clearPendingForm,
  discardPendingForm,
  getPendingFormStatus,
  trackPendingForm,
} from "./pending-forms.js";

export const data = new SlashCommandBuilder()
  .setName("house")
  .setDescription("Open the form to post a house listing");

const activeHouseSubmissions = new Set();
const pendingHouseForms = new Map();
const creatingHouseForms = new Set();

export async function ensureHouseEntry(guild, channel, { moveToBottom = false } = {}) {
  return ensureChannelEntry(guild, channel, {
    channelField: "houseEntryChannelId",
    messageField: "houseEntryMessageId",
    customId: "house:entry",
    label: "Start a house listing",
    description: "Use the button to add your house listing.",
    moveToBottom,
  });
}

export async function handleHouseEntryButton(interaction) {
  if (interaction.customId !== "house:entry") return false;
  await execute(interaction);
  return true;
}

function makeCreateListingButton(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`house:new:${userId}`)
      .setLabel("Create house listing")
      .setStyle(ButtonStyle.Success),
  );
}

function makeCreateListingModal(userId, message) {
  return new ModalBuilder()
    .setCustomId(
      `house:create:${userId}:${message.channelId}:${message.id}`,
    )
    .setTitle("Create a house listing")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("House name")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("title")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("Describe your house")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("description")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("Asking price (include currency)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("asking_price")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(80)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("Estimated value (include currency)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("estimated_value")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(80)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("House tour video link (optional)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("video_url")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(500)
            .setRequired(false),
        ),
    );
}

export const makeHouseComponents = houseActionComponents;

function makeMediaModal(listing) {
  const remainingUploads = Math.max(0, 10 - (listing.mediaAttachments?.length ?? 0));
  if (remainingUploads === 0) {
    throw new UserFacingError("This listing already has the maximum of 10 media files.");
  }

  return new ModalBuilder()
    .setCustomId(`house:media:${String(listing._id)}`)
    .setTitle("Add listing pictures or video")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`Choose up to ${remainingUploads} picture(s) or video(s)`)
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("media")
            .setMinValues(1)
            .setMaxValues(remainingUploads),
        ),
    );
}

function makeHouseEmbed(listing, firstImageName) {
  const embed = new EmbedBuilder()
    .setColor(0x8c6ad9)
    .setTitle(listing.title)
    .setDescription(listing.description)
    .addFields(
      { name: "Asking price", value: listing.askingPrice, inline: true },
      { name: "Estimated value", value: listing.estimatedValue, inline: true },
      {
        name: "Seller",
        value: [
          `Discord: ${listing.ownerName}`,
          `Roblox: ${listing.ownerRobloxUsername || "Not added yet"}`,
        ].join("\n"),
        inline: true,
      },
    )
    .setFooter({ text: `Listing ${String(listing._id).slice(-8)}` })
    .setTimestamp(listing.createdAt);

  if (listing.videoUrl) {
    embed.addFields({ name: "House tour video", value: `<${listing.videoUrl}>` });
  }
  if (firstImageName) embed.setImage(`attachment://${firstImageName}`);
  return embed;
}

function getFirstImageName(attachments) {
  return attachments.find((attachment) =>
    attachment.contentType?.toLowerCase().startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|avif)$/i.test(attachment.name)
  )?.name;
}

export async function refreshHouseListingPost(guild, listing) {
  return refreshHouseStyleCard(guild, listing);
}

function canManageListing(interaction, listing) {
  return listing.ownerId === interaction.user.id ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

async function getActiveListing(interaction, listingId) {
  requireGuild(interaction);
  if (!/^[a-f\d]{24}$/i.test(listingId)) {
    throw new UserFacingError("That house listing is not valid.");
  }

  const listing = await HouseListing.findOne({
    _id: listingId,
    guildId: interaction.guildId,
    status: "active",
  });
  if (!listing) {
    throw new UserFacingError("This house listing is no longer active.");
  }
  if (!canManageListing(interaction, listing)) {
    throw new UserFacingError("Only the seller or a server manager can edit this house listing.");
  }
  return listing;
}

async function fetchListingMessage(interaction, listing) {
  const channel = await interaction.guild.channels.fetch(listing.postChannelId);
  const message = await channel?.messages?.fetch(listing.postMessageId);
  if (!message) {
    throw new UserFacingError("I couldn't find this house listing post.");
  }
  return message;
}

export async function handleHouseButton(interaction) {
  const [, action, listingId] = interaction.customId.split(":");
  if (action === "interest" || action === "notify") {
    return handleListingInterest(interaction, {
      ListingModel: HouseListing,
      listingType: "house",
      makeComponents: async current => makeHouseComponents(current,
        await houseGalleryCount(current.guildId, current._id)),
    });
  }
  if (action !== "media") return false;

  const listing = await getActiveListing(interaction, listingId);
  if (interaction.message.id !== listing.postMessageId) {
    throw new UserFacingError("That button doesn't belong to this house listing.");
  }

  await interaction.showModal(makeMediaModal(listing));
  return true;
}

export async function handleHouseCreateButton(interaction) {
  const [, action, ownerId] = interaction.customId.split(":");
  if (action !== "new" || ownerId !== interaction.user.id) {
    throw new UserFacingError("That house form is not yours to use.");
  }
  await interaction.showModal(makeCreateListingModal(ownerId, interaction.message));
}

export async function handleHouseModal(interaction) {
  const [, action, listingId] = interaction.customId.split(":");
  if (action !== "media") return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let listing = await getActiveListing(interaction, listingId);
  const uploads = Array.from(interaction.fields.getUploadedFiles("media", true).values());
  validateAttachments(uploads);
  if (!uploads.length || listing.mediaAttachments.length + uploads.length > 10) {
    throw new UserFacingError("House listings support up to ten total uploaded photos/videos.");
  }
  const photos = uploads.filter(isGalleryPhoto);
  const videos = uploads.filter(isGalleryVideo);
  if (photos.length + videos.length !== uploads.length) {
    throw new UserFacingError("Only images or videos can be added to a house listing.");
  }

  // Legacy listings are upgraded before the new media is attached. A failed
  // archive leaves the old Discord post and its attachments intact.
  await refreshHouseStyleCard(interaction.guild, listing);
  listing = await HouseListing.findOne({
    _id: listing._id, guildId: interaction.guildId, status: "active",
  });
  const message = await fetchListingMessage(interaction, listing);
  const oldVideos = Array.from(message.attachments.values()).filter(isGalleryVideo);
  if (oldVideos.length + videos.length > 9) {
    throw new UserFacingError("A styled house can have at most nine video attachments, leaving room for its card.");
  }
  if (photos.length) {
    await archiveHousePhotos(interaction.guildId, listing, photos);
  }

  let newVideoAssets = [];
  if (videos.length) {
    const art = Array.from(message.attachments.values()).find(asset =>
      asset.name === HOUSE_ART_NAME);
    if (!art) throw new UserFacingError("This house's styled artwork is unavailable. Please retry.");
    const { files, cleanup } = await prepareMediaFiles(
      videos, `house-${String(listing._id).slice(-8)}`,
    );
    let updated;
    try {
      updated = await message.edit({
        attachments: [...oldVideos, art].map(asset => ({ id: asset.id })),
        files,
      });
    } finally {
      await cleanup();
    }
    const currentVideos = getMessageMedia(updated).filter(isGalleryVideo);
    const oldIds = new Set(oldVideos.map(asset => asset.id));
    if (!oldVideos.every(video => currentVideos.some(asset => asset.attachmentId === video.id))) {
      throw new UserFacingError("Some original house videos were not preserved. Ask a server manager to review.");
    }
    newVideoAssets = currentVideos.filter(asset => !oldIds.has(asset.attachmentId));
    if (newVideoAssets.length !== videos.length) {
      throw new UserFacingError("Some new videos are missing from Discord. Do not reupload before an admin checks.");
    }
  }
  listing.mediaAttachments = mergeOriginalMedia(
    listing.mediaAttachments,
    [...photos, ...newVideoAssets],
  );
  await listing.save();
  let previewReady = true;
  await refreshHouseStyleCard(interaction.guild, listing).catch(error => {
    previewReady = false;
    console.warn("[House] Photos/videos saved but styled card could not refresh:", error);
  });
  await interaction.editReply({
    content: previewReady
      ? `Added ${uploads.length} house photo/video file(s). Photos appear in the listing's in-card gallery.`
      : "Your media was saved, but the house card could not refresh. Please ask a server manager to check the bot logs before reuploading.",
  });
  return true;
}

export async function handleHouseCreateModal(interaction) {
  const [, action, ownerId, channelId, messageId] = interaction.customId.split(":");
  if (
    action !== "create" ||
    ownerId !== interaction.user.id ||
    !/^\d{17,20}$/.test(channelId ?? "") ||
    !/^\d{17,20}$/.test(messageId ?? "")
  ) {
    throw new UserFacingError("That house form is not yours to use.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const formKey = `${interaction.guildId}:${ownerId}`;
  const pendingForm = pendingHouseForms.get(formKey);
  if (pendingForm?.messageId !== messageId) {
    throw new UserFacingError("This house form is no longer active. Run `/house` to start a new one.");
  }
  const submissionKey = `${interaction.guildId}:${channelId}:${messageId}`;
  if (activeHouseSubmissions.has(submissionKey)) {
    throw new UserFacingError("This house listing is already being submitted.");
  }
  activeHouseSubmissions.add(submissionKey);

  let post;
  let claimed = false;
  let published = false;
  try {
    const channel = await interaction.guild.channels.fetch(channelId);
    post = await channel?.messages?.fetch(messageId);
    const buttonId = `house:new:${ownerId}`;
    const button = post?.components
      .flatMap((row) => row.components)
      .find((component) => component.customId === buttonId);
    if (!post || post.author?.id !== interaction.client.user.id || !button || button.disabled) {
      throw new UserFacingError("This house form has expired or was already submitted.");
    }
    await post.edit({
      content: `House listing from ${interaction.user.username} — submitting...`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(buttonId)
            .setLabel("Submitting...")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        ),
      ],
    });
    claimed = true;

    const values = {
      title: interaction.fields.getTextInputValue("title").trim(),
      description: interaction.fields.getTextInputValue("description").trim(),
      askingPrice: interaction.fields.getTextInputValue("asking_price").trim(),
      estimatedValue: interaction.fields.getTextInputValue("estimated_value").trim(),
      videoUrl: validateWebUrl(
        interaction.fields.getTextInputValue("video_url").trim(),
        "House video",
      ),
    };
    await publishHouseListing(interaction, values, post);
    published = true;
    pendingHouseForms.delete(formKey);
    await clearPendingForm(interaction.guildId, channelId, messageId);
  } catch (error) {
    if (post && claimed && !published) {
      await post.edit({
        content: `House listing from ${interaction.user.username} — finish your listing using the button below.`,
        components: [makeCreateListingButton(ownerId)],
        embeds: [],
        attachments: [],
      }).catch((restoreError) => {
        console.error("Could not restore the house listing form post:", restoreError);
      });
    }
    throw error;
  } finally {
    activeHouseSubmissions.delete(submissionKey);
  }

  await interaction.editReply({
    content: `Your house listing was posted: ${post.url}`,
    allowedMentions: { parse: [] },
  });
}

export async function execute(interaction) {
  requireGuild(interaction);
  const formKey = `${interaction.guildId}:${interaction.user.id}`;
  let pendingForm = pendingHouseForms.get(formKey);
  let pendingStatus = pendingForm
    ? await getPendingFormStatus(interaction.guild, {
        ...pendingForm,
        ownerId: interaction.user.id,
        type: "house",
      })
    : "stale";
  if (pendingStatus === "stale") {
    pendingHouseForms.delete(formKey);
    pendingForm = null;
  } else if (pendingStatus === "active") {
    await discardPendingForm(interaction.guild, {
      ...pendingForm,
      ownerId: interaction.user.id,
      type: "house",
    });
    pendingHouseForms.delete(formKey);
    pendingForm = null;
  }
  if (pendingForm || creatingHouseForms.has(formKey)) {
    const response = {
      content: pendingForm
        ? pendingStatus === "submitting"
          ? "Your house listing is being submitted. Please wait a moment."
          : [
              `You already have a house form waiting in <#${pendingForm.channelId}>.`,
              `Finish that one before starting another: ${pendingForm.url}`,
            ].join(" ")
        : "Your house form is being created. Please wait a moment before trying again.",
      allowedMentions: { parse: [] },
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(response);
    } else {
      await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
    }
    return;
  }
  creatingHouseForms.add(formKey);
  try {
    const channel = await getConfiguredTextChannel(
      interaction,
      "houseChannelId",
      "house listings",
    );
    const post = await channel.send({
      content: `House listing from ${interaction.user.username} — waiting for details.`,
      components: [makeCreateListingButton(interaction.user.id)],
      allowedMentions: { parse: [] },
    });
    try {
      await trackPendingForm({
        guildId: interaction.guildId,
        ownerId: interaction.user.id,
        channelId: post.channelId,
        messageId: post.id,
        type: "house",
      });
    } catch (error) {
      await post.delete().catch((cleanupError) => {
        console.error("Could not remove an untracked house form post:", cleanupError);
      });
      throw error;
    }
    pendingHouseForms.set(formKey, {
      channelId: post.channelId,
      messageId: post.id,
      url: post.url,
    });
    await ensureHouseEntry(interaction.guild, channel, {
      moveToBottom: true,
    });
    const response = {
      content: [
        `I added your house listing form in ${channel}.`,
        `Use the button there to enter your details privately. Only you can use it. ${post.url}`,
      ].join(" "),
      components: [],
      allowedMentions: { parse: [] },
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(response);
    } else {
      await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
    }
  } finally {
    creatingHouseForms.delete(formKey);
  }
}

async function publishHouseListing(interaction, values, post) {
  const profile = await UserProfile.findOne({
    guildId: interaction.guildId,
    discordUserId: interaction.user.id,
  });
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const discordDisplayName = member.displayName;
  const listing = await HouseListing.create({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    ownerName: discordDisplayName,
    ownerRobloxUsername: profile?.adoptMeUsername ?? "",
    postAppearance: await snapshotOwnedListingAppearance(interaction.guildId, interaction.user.id, profile),
    ...values,
  });
  try {
    const updatedPost = await post.edit({
      content: `House listing from ${discordDisplayName}`,
      embeds: [makeHouseEmbed(listing)],
      components: makeHouseComponents(listing),
      allowedMentions: { parse: [] },
    });
    listing.postChannelId = updatedPost.channelId;
    listing.postMessageId = updatedPost.id;
    await listing.save();
    // Convert the newly published listing to purchased styling immediately.
    // If rendering fails, keep its original embed, data and controls intact.
    await refreshHouseStyleCard(interaction.guild, listing).catch(error =>
      console.warn("[House] Published, but styled card needs refresh:", error));
  } catch (error) {
    await HouseListing.deleteOne({ _id: listing._id }).catch(() => {});
    throw error;
  }
  await awardMilestoneSafely(interaction.guildId, interaction.user.id,
    "houseFirstListing", String(listing._id));
}

export async function handleSold(interaction) {
  requireGuild(interaction);
  const [, action, id] = interaction.customId.split(":");
  if (action !== "sold" || !id) {
    throw new UserFacingError("That house action is not valid.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const listing = await HouseListing.findOne({
    _id: id,
    guildId: interaction.guildId,
    status: "active",
  });
  if (!listing || listing.postMessageId !== interaction.message.id) {
    throw new UserFacingError("This house ad is no longer active.");
  }

  const canManageListings = interaction.memberPermissions?.has(
    PermissionFlagsBits.ManageGuild,
  );
  if (listing.ownerId !== interaction.user.id && !canManageListings) {
    throw new UserFacingError("Only the seller or a server manager can mark this house sold.");
  }

  const result = await HouseListing.updateOne(
    { _id: id, guildId: interaction.guildId, status: "active" },
    { $set: { status: "sold", soldAt: new Date() } },
  );
  if (!result.matchedCount) {
    throw new UserFacingError("This house ad is already marked sold.");
  }

  try {
    await interaction.message.delete();
  } catch {
    await HouseListing.updateOne(
      { _id: id, guildId: interaction.guildId, status: "sold" },
      { $set: { status: "active" }, $unset: { soldAt: 1 } },
    ).catch(() => {});
    throw new UserFacingError(
      "I couldn't remove the house ad. Check that the bot can delete its own posts in that channel, then try again.",
    );
  }

  await interaction.editReply({
    content: "Marked as sold. The house advertisement has been removed.",
  });
  return listing.ownerId;
}
