import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import HouseListing from "../models/HouseListing.js";
import {
  getAttachments,
  getConfiguredTextChannel,
  getMessageMedia,
  prepareFiles,
  requireGuild,
  validateAttachments,
  validateWebUrl,
} from "./shared.js";
import { UserFacingError } from "./errors.js";

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
      )
      .addAttachmentOption((option) =>
        option.setName("media_1").setDescription("Screenshot or video"),
      )
      .addAttachmentOption((option) =>
        option.setName("media_2").setDescription("Another screenshot or video"),
      )
      .addAttachmentOption((option) =>
        option.setName("media_3").setDescription("Another screenshot or video"),
      )
      .addAttachmentOption((option) =>
        option.setName("media_4").setDescription("Another screenshot or video"),
      )
      .addAttachmentOption((option) =>
        option.setName("media_5").setDescription("Another screenshot or video"),
      ),
  );

function makeHouseComponents(listing) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`house:sold:${String(listing._id)}`)
        .setLabel("Mark sold")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function getDirectVideoFileAttachment(videoUrl, listingId, title) {
  if (!videoUrl) return null;

  try {
    const parsed = new URL(videoUrl);
    const extension = parsed.pathname.split(".").pop()?.toLowerCase();
    const supported = ["mp4", "webm", "mov", "m4v", "avi", "mkv"];
    if (!supported.includes(extension || "")) {
      return null;
    }

    const safeTitle = title
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "house";

    return {
      attachment: videoUrl,
      name: `house-${String(listingId).slice(-8)}-${safeTitle}.${extension}`,
    };
  } catch {
    return null;
  }
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
  const attachments = getAttachments(interaction, "media");
  validateAttachments(attachments);

  if (!videoUrl && attachments.length === 0) {
    throw new UserFacingError("Add at least one video link or image/video attachment.");
  }

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
  const { files, firstImageName } = prepareFiles(
    attachments,
    `house-${String(listing._id).slice(-8)}`,
  );
  const directVideoFile = getDirectVideoFileAttachment(videoUrl, listing._id, title);
  const postFiles = directVideoFile ? [...files, directVideoFile] : files;

  let post;
  try {
    post = await channel.send({
      content: `House listing from ${interaction.user.username}`,
      embeds: [makeHouseEmbed(listing, firstImageName)],
      components: makeHouseComponents(listing),
      files: postFiles,
      allowedMentions: { parse: [] },
    });
    listing.postChannelId = post.channelId;
    listing.postMessageId = post.id;
    listing.mediaAttachments = getMessageMedia(post);
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
