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
import { outfitActionComponents, ensureOutfitControls, deleteOutfitControls } from "../services/outfit-controls.js";
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

export function makeCreateListingModal(userId, message) {
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
      new LabelBuilder()
        .setLabel("Upload outfit photos or videos (1–10)")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("outfit_media")
            .setMinValues(1)
            .setMaxValues(10),
        ),
    );
}

export const makeListingComponents = outfitActionComponents;

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
  await ensureOutfitControls(guild, listing);
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
      messageIdField: "controlsMessageId",
    });
  }
  if (action !== "media") return false;
  // Old public listing messages may still contain the retired button.
  // Reject safely without modifying a single photo or video.
  await interaction.reply({
    content: "Outfit photos and videos are now uploaded when creating a listing. " +
      "Existing outfits and their gallery are preserved; new uploads cannot be added afterward.",
    flags: MessageFlags.Ephemeral,
  });
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
  // Support stale pre-update modal submissions without deleting attachments.
  if (!interaction.customId.startsWith("outfit:media:")) return false;
  await interaction.reply({
    content: "Uploads now happen during outfit creation. This older upload form " +
      "cannot change an existing gallery. Your saved outfit has not been modified.",
    flags: MessageFlags.Ephemeral,
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
  let galleryReady = true;
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

    const uploads = Array.from(
      interaction.fields.getUploadedFiles("outfit_media", true)?.values() ?? [],
    );
    if (!uploads.length) {
      throw new UserFacingError("Upload at least one outfit photo or video when creating the listing.");
    }
    validateAttachments(uploads);
    if (uploads.length > 10 || uploads.filter(isGalleryVideo).length > 9) {
      throw new UserFacingError(
        "Upload up to ten photos/videos when creating an outfit, " +
        "including no more than nine videos to leave room for its banner.",
      );
    }

    const values = {
      title: interaction.fields.getTextInputValue("title").trim(),
      description: interaction.fields.getTextInputValue("description").trim(),
      cost: interaction.fields.getTextInputValue("cost").trim(),
      videoUrl: validateWebUrl(
        interaction.fields.getTextInputValue("video_url").trim(),
        "Outfit video",
      ),
    };
    ({ galleryReady } = await publishListing(interaction, values, post, uploads));
    published = true;
    if (!galleryReady) {
      console.warn("Outfit gallery pending manual inspection for", post.url);
    }
    pendingForms.delete(formKey);
    await clearPendingForm(interaction.guildId, channelId, messageId);
    // The channel's persistent entry must come AFTER banner, gallery and
    // actions. Updating it before the flipbook appears puts it in the middle.
    await ensureOutfitEntry(interaction.guild, post.channel, { moveToBottom: true })
      .catch(error => console.warn("Could not move outfit entry to channel bottom:", error));
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
    content: galleryReady
      ? `Your outfit listing and photo gallery were posted: ${post.url}`
      : `Your outfit listing was posted: ${post.url}\n⚠️ The gallery could not finish displaying. Your uploaded photos were saved before publication. Ask a server manager to check the bot logs and refresh this outfit; do not reupload the files.`,
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

async function publishListing(interaction, values, post, uploads) {
  const photos = uploads.filter(isGalleryPhoto);
  const videos = uploads.filter(isGalleryVideo);
  const profile = await UserProfile.findOne({
    guildId: interaction.guildId, discordUserId: interaction.user.id,
  });
  const member = await interaction.guild.members.fetch(interaction.user.id);

  // Keep the original Discord CDN IDs for the archived gallery images.
  // Uploaded videos are separately attached to the public banner and their
  // permanent attachment IDs are recorded after Discord confirms the edit.
  const photoMetadata = photos.map(asset => ({
    attachmentId: String(asset.id), url: asset.url, name: asset.name,
    contentType: asset.contentType || "", size: asset.size || 0,
  }));
  const listing = await OutfitListing.create({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    ownerName: member.displayName,
    ownerRobloxUsername: profile?.adoptMeUsername ?? "",
    postAppearance: await snapshotOwnedListingAppearance(interaction.guildId, interaction.user.id, profile),
    mediaAttachments: photoMetadata,
    postChannelId: post.channelId,
    postMessageId: post.id,
    ...values,
  });

  let published = false;
  try {
    // Save ALL resized photos before publishing anything. The gallery can
    // recover from a bot restart and requires no post-creation uploads.
    if (photos.length) {
      await saveOutfitGalleryImages(interaction.guildId, listing, photos);
    }
    const { files, cleanup } = await prepareMediaFiles(
      videos, `outfit-${String(listing._id).slice(-8)}`,
    );
    let updatedPost;
    try {
      updatedPost = await post.edit({
        content: `Outfit listing from ${member.displayName}`,
        embeds: [makeListingEmbed(listing)],
        components: makeListingComponents(listing),
        attachments: [],
        files,
        allowedMentions: { parse: [] },
      });
    } finally {
      await cleanup();
    }
    published = true;
    listing.postChannelId = updatedPost.channelId;
    listing.postMessageId = updatedPost.id;
    const postedVideos = getMessageMedia(updatedPost).filter(isGalleryVideo);
    if (postedVideos.length !== videos.length) {
      console.warn("[Outfit] Some videos were not confirmed on public post", String(listing._id));
    }
    listing.mediaAttachments = mergeOriginalMedia(photoMetadata, postedVideos);
    await listing.save();
  } catch (error) {
    if (!published) {
      const { default: OutfitGalleryImage } = await import("../models/OutfitGalleryImage.js");
      await OutfitGalleryImage.deleteMany({ guildId: interaction.guildId, listingId: listing._id })
        .catch(cleanupError => console.error("Cannot clean unfinished outfit gallery:", cleanupError));
      await OutfitListing.deleteOne({ _id: listing._id })
        .catch(cleanupError => console.error("Cannot clean unfinished outfit:", cleanupError));
      throw error;
    }
    // The original post has already been published. Never restore the
    // pending form or delete its attachments because Mongo had a hiccup.
    console.error("Outfit public post saved but final metadata update failed:", error);
  }

  // Style and gallery are cosmetic follow-ups. If a Discord edit fails,
  // preserve the already-published listing and its saved photos/videos;
  // never delete its media merely because a gallery message failed.
  let galleryReady = true;
  await refreshOutfitStyleCard(interaction.guild, listing).catch(error => {
    galleryReady = false;
    console.error("Outfit published, but banner/gallery needs refresh:", error);
  });
  await awardMilestoneSafely(interaction.guildId, interaction.user.id,
    "outfitFirstListing", String(listing._id));
  return { galleryReady };
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
  if (!listing || (listing.controlsMessageId || listing.postMessageId) !== interaction.message.id) {
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
    // Delete the actual banner, not the separate action-controls message.
    const channel = await interaction.guild.channels.fetch(listing.postChannelId);
    const banner = await channel.messages.fetch(listing.postMessageId);
    await banner.delete();
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
  await deleteOutfitControls(interaction.guild, listing);
  await interaction.editReply({ content: "Outfit listing removed." });
  return listing.ownerId;
}
