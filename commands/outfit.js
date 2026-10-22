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
import OutfitListing from "../models/OutfitListing.js";
import UserProfile from "../models/UserProfile.js";
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
  .setName("outfit")
  .setDescription("Open the form to post an outfit listing");

const activeSubmissions = new Set();
const pendingForms = new Map();
const creatingForms = new Set();

export async function ensureOutfitEntry(guild, channel, { moveToBottom = false } = {}) {
  return ensureChannelEntry(guild, channel, {
    channelField: "outfitEntryChannelId",
    messageField: "outfitEntryMessageId",
    customId: "outfit:entry",
    label: "Start an outfit listing",
    description: "Use the button to add an outfit to your listings.",
    moveToBottom,
  });
}

export async function handleOutfitEntryButton(interaction) {
  if (interaction.customId !== "outfit:entry") return false;
  await execute(interaction);
  return true;
}

function makeCreateListingButton(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`outfit:new:${userId}`)
      .setLabel("Create outfit listing")
      .setStyle(ButtonStyle.Success),
  );
}

function makeCreateListingModal(userId, message) {
  return new ModalBuilder()
    .setCustomId(`outfit:create:${userId}:${message.channelId}:${message.id}`)
    .setTitle("Create an outfit listing")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Outfit name")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("title")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(100)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("Describe your outfit")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("description")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(1000)
            .setRequired(true),
        ),
      new LabelBuilder()
        .setLabel("Cost (optional; include currency)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("cost")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(80)
            .setRequired(false),
        ),
      new LabelBuilder()
        .setLabel("Outfit video link (optional)")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("video_url")
            .setStyle(TextInputStyle.Short)
            .setMaxLength(500)
            .setRequired(false),
        ),
    );
}

function makeListingComponents(listing) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`outfit:sold:${String(listing._id)}`)
        .setLabel("Remove listing")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`outfit:media:${String(listing._id)}`)
        .setLabel("Add pictures/video")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`outfit:interest:${String(listing._id)}`)
        .setLabel(`Interested (${listing.interestedUserIds.length})`)
        .setStyle(ButtonStyle.Success),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`outfit:notify:${String(listing._id)}`)
        .setLabel(`Interest DMs: ${listing.notifyOnInterest ? "On" : "Off"}`)
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function makeMediaModal(listing) {
  const remainingUploads = Math.max(0, 10 - (listing.mediaAttachments?.length ?? 0));
  if (!remainingUploads) {
    throw new UserFacingError("This listing already has the maximum of 10 media files.");
  }

  return new ModalBuilder()
    .setCustomId(`outfit:media:${String(listing._id)}`)
    .setTitle("Add outfit pictures or video")
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

function makeListingEmbed(listing, firstImageName) {
  const fields = [];
  if (listing.cost) fields.push({ name: "Cost", value: listing.cost, inline: true });
  fields.push({
    name: "Seller",
    value: [
      `Discord: ${listing.ownerName}`,
      `Roblox: ${listing.ownerRobloxUsername || "Not added yet"}`,
    ].join("\n"),
    inline: true,
  });

  const embed = new EmbedBuilder()
    .setColor(0xe879a8)
    .setTitle(listing.title)
    .setDescription(listing.description)
    .addFields(fields)
    .setFooter({ text: `Listing ${String(listing._id).slice(-8)}` })
    .setTimestamp(listing.createdAt);

  if (listing.videoUrl) {
    embed.addFields({ name: "Outfit video", value: `<${listing.videoUrl}>` });
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

export async function refreshOutfitListingPost(guild, listing) {
  const channel = await guild.channels.fetch(listing.postChannelId);
  if (!channel?.messages) {
    throw new Error(`Outfit listing channel ${listing.postChannelId} is unavailable.`);
  }
  const message = await channel.messages.fetch(listing.postMessageId);
  const attachments = Array.from(message.attachments.values());
  await message.edit({
    content: `Outfit listing from ${listing.ownerName}`,
    embeds: [
      makeListingEmbed(
        listing,
        getFirstImageName(attachments) ??
          getFirstImageName(listing.mediaAttachments ?? []),
      ),
    ],
    components: makeListingComponents(listing),
    attachments: attachments.map(({ id }) => ({ id })),
    allowedMentions: { parse: [] },
  });
}

function canManageListing(interaction, listing) {
  return listing.ownerId === interaction.user.id ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

async function getActiveListing(interaction, listingId) {
  requireGuild(interaction);
  if (!/^[a-f\d]{24}$/i.test(listingId)) {
    throw new UserFacingError("That outfit listing is not valid.");
  }

  const listing = await OutfitListing.findOne({
    _id: listingId,
    guildId: interaction.guildId,
    status: "active",
  });
  if (!listing) throw new UserFacingError("This outfit listing is no longer active.");
  if (!canManageListing(interaction, listing)) {
    throw new UserFacingError("Only the seller or a server manager can edit this outfit listing.");
  }
  return listing;
}

async function fetchListingMessage(interaction, listing) {
  const channel = await interaction.guild.channels.fetch(listing.postChannelId);
  const message = await channel?.messages?.fetch(listing.postMessageId);
  if (!message) throw new UserFacingError("I couldn't find this outfit listing post.");
  return message;
}

export async function handleOutfitButton(interaction) {
  const [, action, listingId] = interaction.customId.split(":");
  if (action === "interest" || action === "notify") {
    return handleListingInterest(interaction, {
      ListingModel: OutfitListing,
      listingType: "outfit",
      makeComponents: makeListingComponents,
    });
  }
  if (action !== "media") return false;
  const listing = await getActiveListing(interaction, listingId);
  if (interaction.message.id !== listing.postMessageId) {
    throw new UserFacingError("That button doesn't belong to this outfit listing.");
  }
  await interaction.showModal(makeMediaModal(listing));
  return true;
}

export async function handleOutfitCreateButton(interaction) {
  const [, action, ownerId] = interaction.customId.split(":");
  if (action !== "new" || ownerId !== interaction.user.id) {
    throw new UserFacingError("That outfit form is not yours to use.");
  }
  await interaction.showModal(makeCreateListingModal(ownerId, interaction.message));
}

export async function handleOutfitModal(interaction) {
  const [, action, listingId] = interaction.customId.split(":");
  if (action !== "media") return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const listing = await getActiveListing(interaction, listingId);
  const message = await fetchListingMessage(interaction, listing);
  const uploads = Array.from(interaction.fields.getUploadedFiles("media", true).values());
  validateAttachments(uploads);
  if (listing.mediaAttachments.length + uploads.length > 10) {
    throw new UserFacingError("An outfit listing can have up to 10 media files.");
  }

  const previousAttachmentIds = Array.from(message.attachments.keys());
  const {
    files,
    firstImageName: uploadedFirstImageName,
    cleanup,
  } = await prepareMediaFiles(uploads, `outfit-${String(listing._id).slice(-8)}`);
  let updatedMessage;
  try {
    updatedMessage = await message.edit({
      attachments: previousAttachmentIds.map((id) => ({ id })),
      files,
      embeds: [
        makeListingEmbed(
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

  await interaction.editReply({ content: `Added ${uploads.length} media file(s) to the outfit listing.` });
  return true;
}

export async function handleOutfitCreateModal(interaction) {
  const [, action, ownerId, channelId, messageId] = interaction.customId.split(":");
  if (
    action !== "create" ||
    ownerId !== interaction.user.id ||
    !/^\d{17,20}$/.test(channelId ?? "") ||
    !/^\d{17,20}$/.test(messageId ?? "")
  ) {
    throw new UserFacingError("That outfit form is not yours to use.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const formKey = `${interaction.guildId}:${ownerId}`;
  const pendingForm = pendingForms.get(formKey);
  if (pendingForm?.messageId !== messageId) {
    throw new UserFacingError("This outfit form is no longer active. Run `/outfit` to start a new one.");
  }
  const submissionKey = `${interaction.guildId}:${channelId}:${messageId}`;
  if (activeSubmissions.has(submissionKey)) {
    throw new UserFacingError("This outfit listing is already being submitted.");
  }
  activeSubmissions.add(submissionKey);

  let post;
  let claimed = false;
  let published = false;
  try {
    const channel = await interaction.guild.channels.fetch(channelId);
    post = await channel?.messages?.fetch(messageId);
    const buttonId = `outfit:new:${ownerId}`;
    const button = post?.components
      .flatMap((row) => row.components)
      .find((component) => component.customId === buttonId);
    if (!post || post.author?.id !== interaction.client.user.id || !button || button.disabled) {
      throw new UserFacingError("This outfit form has expired or was already submitted.");
    }
    await post.edit({
      content: `Outfit listing from ${interaction.user.username} — submitting...`,
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
      cost: interaction.fields.getTextInputValue("cost").trim(),
      videoUrl: validateWebUrl(
        interaction.fields.getTextInputValue("video_url").trim(),
        "Outfit video",
      ),
    };
    await publishListing(interaction, values, post);
    published = true;
    pendingForms.delete(formKey);
    await clearPendingForm(interaction.guildId, channelId, messageId);
  } catch (error) {
    if (post && claimed && !published) {
      await post.edit({
        content: `Outfit listing from ${interaction.user.username} — finish your listing using the button below.`,
        components: [makeCreateListingButton(ownerId)],
        embeds: [],
        attachments: [],
      }).catch((restoreError) => {
        console.error("Could not restore the outfit listing form post:", restoreError);
      });
    }
    throw error;
  } finally {
    activeSubmissions.delete(submissionKey);
  }

  await interaction.editReply({
    content: `Your outfit listing was posted: ${post.url}`,
    allowedMentions: { parse: [] },
  });
}

export async function execute(interaction) {
  requireGuild(interaction);
  const formKey = `${interaction.guildId}:${interaction.user.id}`;
  let pendingForm = pendingForms.get(formKey);
  let pendingStatus = pendingForm
    ? await getPendingFormStatus(interaction.guild, {
        ...pendingForm,
        ownerId: interaction.user.id,
        type: "outfit",
      })
    : "stale";
  if (pendingStatus === "stale") {
    pendingForms.delete(formKey);
    pendingForm = null;
  } else if (pendingStatus === "active") {
    await discardPendingForm(interaction.guild, {
      ...pendingForm,
      ownerId: interaction.user.id,
      type: "outfit",
    });
    pendingForms.delete(formKey);
    pendingForm = null;
  }
  if (pendingForm || creatingForms.has(formKey)) {
    const response = {
      content: pendingForm
        ? pendingStatus === "submitting"
          ? "Your outfit listing is being submitted. Please wait a moment."
          : [
              `You already have an outfit form waiting in <#${pendingForm.channelId}>.`,
              `Finish that one before starting another: ${pendingForm.url}`,
            ].join(" ")
        : "Your outfit form is being created. Please wait a moment before trying again.",
      allowedMentions: { parse: [] },
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(response);
    } else {
      await interaction.reply({ ...response, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  creatingForms.add(formKey);
  try {
    const channel = await getConfiguredTextChannel(
      interaction,
      "outfitChannelId",
      "outfit listings",
    );
    const post = await channel.send({
      content: `Outfit listing from ${interaction.user.username} — waiting for details.`,
      components: [makeCreateListingButton(interaction.user.id)],
      allowedMentions: { parse: [] },
    });
    try {
      await trackPendingForm({
        guildId: interaction.guildId,
        ownerId: interaction.user.id,
        channelId: post.channelId,
        messageId: post.id,
        type: "outfit",
      });
    } catch (error) {
      await post.delete().catch((cleanupError) => {
        console.error("Could not remove an untracked outfit form post:", cleanupError);
      });
      throw error;
    }
    pendingForms.set(formKey, {
      channelId: post.channelId,
      messageId: post.id,
      url: post.url,
    });
    await ensureOutfitEntry(interaction.guild, channel, {
      moveToBottom: true,
    });
    const response = {
      content: [
        `I added your outfit listing form in ${channel}.`,
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
    creatingForms.delete(formKey);
  }
}

async function publishListing(interaction, values, post) {
  const profile = await UserProfile.findOne({
    guildId: interaction.guildId,
    discordUserId: interaction.user.id,
  });
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const listing = await OutfitListing.create({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    ownerName: member.displayName,
    ownerRobloxUsername: profile?.adoptMeUsername ?? "",
    ...values,
  });
  try {
    const updatedPost = await post.edit({
      content: `Outfit listing from ${member.displayName}`,
      embeds: [makeListingEmbed(listing)],
      components: makeListingComponents(listing),
      allowedMentions: { parse: [] },
    });
    listing.postChannelId = updatedPost.channelId;
    listing.postMessageId = updatedPost.id;
    await listing.save();
  } catch (error) {
    await OutfitListing.deleteOne({ _id: listing._id }).catch(() => {});
    throw error;
  }
}

export async function handleOutfitSold(interaction) {
  requireGuild(interaction);
  const [, action, id] = interaction.customId.split(":");
  if (action !== "sold" || !id) {
    throw new UserFacingError("That outfit listing action is not valid.");
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const listing = await OutfitListing.findOne({
    _id: id,
    guildId: interaction.guildId,
    status: "active",
  });
  if (!listing || listing.postMessageId !== interaction.message.id) {
    throw new UserFacingError("This outfit listing is no longer active.");
  }
  if (!canManageListing(interaction, listing)) {
    throw new UserFacingError("Only the seller or a server manager can remove this outfit listing.");
  }

  const result = await OutfitListing.updateOne(
    { _id: id, guildId: interaction.guildId, status: "active" },
    { $set: { status: "sold", soldAt: new Date() } },
  );
  if (!result.matchedCount) {
    throw new UserFacingError("This outfit listing has already been removed.");
  }
  try {
    await interaction.message.delete();
  } catch {
    await OutfitListing.updateOne(
      { _id: id, guildId: interaction.guildId, status: "sold" },
      { $set: { status: "active" }, $unset: { soldAt: 1 } },
    ).catch(() => {});
    throw new UserFacingError(
      "I couldn't remove the outfit listing. Check that the bot can delete its own posts " +
        "in that channel, then try again.",
    );
  }

  await interaction.editReply({ content: "Outfit listing removed." });
  return listing.ownerId;
}
