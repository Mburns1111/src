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
  .setDescription("Showcase a house for sale")
  .addSubcommand((command) =>
    command
      .setName("list")
      .setDescription("Post a house listing to the marketplace")
      .addStringOption((option) =>
        option
          .setName("title")
          .setDescription("Name or short title for the house")
          .setRequired(true)
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName("description")
          .setDescription("Describe the house")
          .setRequired(true)
          .setMaxLength(1000),
      )
      .addStringOption((option) =>
        option
          .setName("asking_price")
          .setDescription("Your asking price; include the currency")
          .setRequired(true)
          .setMaxLength(80),
      )
      .addStringOption((option) =>
        option
          .setName("estimated_value")
          .setDescription("Your estimate of the house's value; include currency")
          .setRequired(true)
          .setMaxLength(80),
      )
      .addStringOption((option) =>
        option
          .setName("video_url")
          .setDescription("Optional link to a house tour video")
          .setMaxLength(500),
      ),
  );

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
      { name: "Seller", value: listing.ownerName, inline: true },
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

export async function execute(interaction) {
  requireGuild(interaction);
  const title = interaction.options.getString("title", true).trim();
  const description = interaction.options.getString("description", true).trim();
  const askingPrice = interaction.options.getString("asking_price", true).trim();
  const estimatedValue = interaction.options.getString("estimated_value", true).trim();
  const videoUrl = validateWebUrl(
    interaction.options.getString("video_url"),
    "House video",
  );

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = await getConfiguredTextChannel(
    interaction,
    "houseChannelId",
    "house listings",
  );
  const listing = await HouseListing.create({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    ownerName: interaction.user.globalName ?? interaction.user.username,
    title,
    description,
    askingPrice,
    estimatedValue,
    videoUrl,
  });
  let post;
  try {
    post = await channel.send({
      content: `House listing from ${interaction.user.username}`,
      embeds: [makeHouseEmbed(listing)],
      components: makeHouseComponents(listing),
      allowedMentions: { parse: [] },
    });
    listing.postChannelId = post.channelId;
    listing.postMessageId = post.id;
    await listing.save();
  } catch (error) {
    if (post) await post.delete().catch(() => {});
    await HouseListing.deleteOne({ _id: listing._id }).catch(() => {});
    throw error;
  }

  await interaction.editReply({
    content: `Your house listing was posted: ${post.url}`,
    allowedMentions: { parse: [] },
  });
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
}
