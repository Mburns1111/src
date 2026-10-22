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
import {
  getConfiguredTextChannel,
  getMessageMedia,
  requireGuild,
  validateAttachments,
  validateWebUrl,
} from "./shared.js";
import { UserFacingError } from "./errors.js";
import { prepareMediaFiles } from "./video-compression.js";

export const data = new SlashCommandBuilder()
  .setName("house")
  .setDescription("Open the form to post a house listing");

const activeHouseSubmissions = new Set();
const pendingHouseForms = new Map();
const creatingHouseForms = new Set();

function makeCreateListingButton(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`house:new:${userId}`)
      .setLabel("Create house listing")
      .setStyle(ButtonStyle.Primary),
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

function makeHouseComponents(listing) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`house:sold:${String(listing._id)}`)
        .setLabel("Mark sold")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`house:media:${String(listing._id)}`)
        .setLabel("Add pictures/video")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

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
  const listing = await getActiveListing(interaction, listingId);
  const message = await fetchListingMessage(interaction, listing);

  const uploads = Array.from(
    interaction.fields.getUploadedFiles("media", true).values(),
  );
  validateAttachments(uploads);
  if (listing.mediaAttachments.length + uploads.length > 10) {
    throw new UserFacingError("A house listing can have up to 10 media files.");
  }

  const previousAttachmentIds = Array.from(message.attachments.keys());
  const {
    files,
    firstImageName: uploadedFirstImageName,
    cleanup,
  } = await prepareMediaFiles(uploads, `house-${String(listing._id).slice(-8)}`);
  let updatedMessage;
  try {
    updatedMessage = await message.edit({
      attachments: previousAttachmentIds.map((id) => ({ id })),
      files,
      embeds: [
        makeHouseEmbed(
          listing,
          getFirstImageName(listing.mediaAttachments) ?? uploadedFirstImageName,
        ),
      ],
    });
  } finally {
    await cleanup();
  }

  const previousMedia = listing.mediaAttachments;
  listing.mediaAttachments = getMessageMedia(updatedMessage);
  try {
    await listing.save();
  } catch (error) {
    await updatedMessage.edit({
      attachments: previousAttachmentIds.map((id) => ({ id })),
      embeds: message.embeds,
    }).catch(console.error);
    listing.mediaAttachments = previousMedia;
    throw error;
  }

  await interaction.editReply({
    content: `Added ${uploads.length} media file(s) to the house listing.`,
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
            .setStyle(ButtonStyle.Primary)
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
    pendingHouseForms.delete(formKey);
  } catch (error) {
    if (post && claimed) {
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
  const pendingForm = pendingHouseForms.get(formKey);
  if (pendingForm || creatingHouseForms.has(formKey)) {
    const response = {
      content: pendingForm
        ? `You already have a house form waiting in <#${pendingForm.channelId}>. Finish that one before starting another: ${pendingForm.url}`
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
    pendingHouseForms.set(formKey, {
      channelId: post.channelId,
      messageId: post.id,
      url: post.url,
    });
    const response = {
      content: `I added your house listing form in ${channel}. Use the button there to enter your details privately. Only you can use it. ${post.url}`,
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
  } catch (error) {
    await HouseListing.deleteOne({ _id: listing._id }).catch(() => {});
    throw error;
  }
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
