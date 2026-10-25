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
import { snapshotOwnedListingAppearance } from "../services/listing-appearance.js";
import { refreshOutfitStyleCard, deleteOutfitStyleCard } from "../services/outfit-card.js";
import { isGalleryPhoto, isGalleryVideo, isGalleryMedia, OUTFIT_BANNER_NAME, mergeOriginalMedia } from "../services/outfit-gallery-utils.js";
import { saveOutfitGalleryImages, ensureOutfitGallery, deleteOutfitGallery } from "../services/outfit-gallery.js";
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
  const remainingUploads = Math.max(0, 10 - listing.mediaAttachments.filter(isGalleryMedia).length);
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
  // An admin/profile refresh must not replace the decorated outfit or drop
  // any of the owner's photos when updating the listing details/buttons.
  await refreshOutfitStyleCard(guild, listing);
  const channel = await guild.channels.fetch(listing.postChannelId);
  const message = await channel?.messages?.fetch(listing.postMessageId);
  if (!message) throw new Error("Outfit listing message no longer exists.");
  await message.edit({
    components: makeListingComponents(listing),
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
  const uploads = Array.from(interaction.fields.getUploadedFiles("media", true).values());
  validateAttachments(uploads);
  const oldCount = listing.mediaAttachments.filter(isGalleryMedia).length;
  if (oldCount + uploads.length > 10) {
    throw new UserFacingError("An outfit listing can have up to ten photos or videos.");
  }

  // First archive every historical photo and create the first flipbook page.
  // If even one old photo is not retrievable, leave the original post untouched.
  await refreshOutfitStyleCard(interaction.guild, listing);

  const images = uploads.filter(isGalleryPhoto);
  const videos = uploads.filter(isGalleryVideo);
  if (images.length) {
    await saveOutfitGalleryImages(interaction.guildId, listing, images);
  }

  const message = await fetchListingMessage(interaction, listing);
  const oldAttachments = Array.from(message.attachments.values());
  const oldVideos = oldAttachments.filter(isGalleryVideo);
  if (videos.length) {
    // The original advert reserves one attachment for its banner.
    // Never evict an uploaded video just to squeeze in a styled PNG.
    if (oldVideos.length + videos.length >= 10) {
      throw new UserFacingError(
        "This outfit has too many video files for the banner. The photos already " +
        "saved are preserved; contact a server manager for the video gallery.",
      );
    }
    const banner = oldAttachments.find(item => item.name === OUTFIT_BANNER_NAME);
    if (!banner) throw new UserFacingError("The outfit banner is missing. Please reopen the editor.");

    const { files, cleanup } = await prepareMediaFiles(
      videos, `outfit-${String(listing._id).slice(-8)}`,
    );
    let updated;
    try {
      updated = await message.edit({
        attachments: [...oldVideos, banner].map(item => ({ id: item.id })),
        files,
        // The banner embed and original sold/interest buttons are untouched.
      });
    } finally {
      await cleanup();
    }
    const preserved = new Set(Array.from(updated.attachments.values())
      .filter(isGalleryVideo).map(item => item.id));
    if (!oldVideos.every(item => preserved.has(item.id))) {
      throw new UserFacingError(
        "Discord did not retain all outfit videos. Do not upload again until a manager checks this listing.",
      );
    }
    const newVideos = Array.from(updated.attachments.values())
      .filter(item => isGalleryVideo(item) && !oldVideos.some(old => old.id === item.id));
    if (newVideos.length !== videos.length) {
      throw new UserFacingError("Some uploaded outfit videos were not retained by Discord.");
    }
    // Preserve stable IDs + download links of the newly uploaded video files.
    listing.mediaAttachments = mergeOriginalMedia(listing.mediaAttachments, newVideos);
  }

  // Images have durable resized bytes in Mongo; record the original uploads
  // for ownership and upload capacity without ever counting the banner.
  listing.mediaAttachments = mergeOriginalMedia(listing.mediaAttachments, images);
  try {
    await listing.save();
  } catch (error) {
    console.error("Could not save outfit upload metadata:", error);
    throw new UserFacingError(
      "Some media reached the gallery but the listing could not be saved. " +
      "Do not upload again until a server manager checks the post.",
    );
  }
  if (images.length) await ensureOutfitGallery(interaction.guild, listing);
  await interaction.editReply({
    content: `Added ${uploads.length} outfit media file(s). Open the gallery beneath the banner to flip through photos.`,
  });
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
    postAppearance: await snapshotOwnedListingAppearance(interaction.guildId, interaction.user.id, profile),
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
  // The style now appears on the original outfit post whenever its media
  // count allows; ten-photo galleries use a safe reply instead.
  await refreshOutfitStyleCard(interaction.guild, listing).catch(error =>
    console.warn("Could not publish new outfit style card:", error));
  await awardMilestoneSafely(interaction.guildId, interaction.user.id,
    "outfitFirstListing", String(listing._id));
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

  await deleteOutfitStyleCard(interaction.guild, listing);
  await deleteOutfitGallery(interaction.guild, listing);
  await interaction.editReply({ content: "Outfit listing removed." });
  return listing.ownerId;
}
