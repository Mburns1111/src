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
import { ensureHouseMediaMessage, deleteHouseMediaMessage, mergedHouseMediaMetadata } from "../services/house-media.js";
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

export function makeCreateListingModal(userId, message) {
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
        .setLabel("Upload house photos or videos (required)")
        .setFileUploadComponent(
          new FileUploadBuilder()
            .setCustomId("house_media")
            .setMinValues(1)
            .setMaxValues(10),
        ),
    );
}

export function validateHouseCreationUploads(uploads) {
  if (!Array.isArray(uploads) || uploads.length < 1) {
    throw new UserFacingError("Upload at least one photo or video of the house when creating the listing.");
  }
  if (uploads.length > 10) {
    throw new UserFacingError("Upload at most ten house photos/videos.");
  }
  validateAttachments(uploads);
  const photos = uploads.filter(isGalleryPhoto);
  const videos = uploads.filter(isGalleryVideo);
  if (photos.length + videos.length !== uploads.length) {
    throw new UserFacingError("Only supported house photos/videos may be uploaded.");
  }
  if (videos.length > 9) {
    throw new UserFacingError("Upload at most nine videos so the styled house card has room.");
  }
  return { photos, videos };
}

export const makeHouseComponents = houseActionComponents;

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

  // Older bot messages can still show the retired upload button until their
  // public card is refreshed. Do not open a modal or alter any saved media.
  await interaction.reply({
    content: "House photos and videos must now be uploaded when creating the listing. " +
      "This older Add pictures/video button cannot change an existing house. " +
      "Your saved photos, videos and purchased style are unchanged.",
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

export async function handleHousePageButton(interaction) {
  const [, area, direction, listingId] = interaction.customId.split(":");
  if (area !== "page" || !["prev", "next"].includes(direction) ||
      !/^[0-9a-f]{24}$/i.test(listingId || "")) {
    throw new UserFacingError("That house photo action is not valid.");
  }
  await interaction.deferUpdate();
  const filter = {
    _id: listingId, guildId: interaction.guildId,
    postMessageId: interaction.message.id, status: "active",
  };
  const listing = await HouseListing.findOne(filter);
  if (!listing) throw new UserFacingError("This house is no longer available.");
  const count = await houseGalleryCount(interaction.guildId, listing._id);
  if (count < 2) return true;
  const updated = await HouseListing.findOneAndUpdate(filter,
    { $inc: { galleryPageIndex: direction === "next" ? 1 : -1 } }, { new: true });
  if (updated) await refreshHouseStyleCard(interaction.guild, updated);
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
  if (!interaction.customId.startsWith("house:media:")) return false;
  // Stale modal submissions from before this deployment are acknowledged
  // without changing the live post, images, videos or MongoDB gallery.
  await interaction.reply({
    content: "House media is now uploaded during listing creation. " +
      "Existing house listings cannot accept additional media. " +
      "Your current listing and its attachments were not modified.",
    flags: MessageFlags.Ephemeral,
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
  let styleReady = false;
  let metadataSaved = true;
  let videosSaved = true;
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

    const uploads = Array.from(
      interaction.fields.getUploadedFiles("house_media", true)?.values() ?? [],
    );
    validateHouseCreationUploads(uploads);
    const values = {
      title: interaction.fields.getTextInputValue("title").trim(),
      description: interaction.fields.getTextInputValue("description").trim(),
      askingPrice: interaction.fields.getTextInputValue("asking_price").trim(),
      estimatedValue: interaction.fields.getTextInputValue("estimated_value").trim(),
      videoUrl: "",
    };
    ({ styled: styleReady, metadataSaved, videosSaved } =
      await publishHouseListing(interaction, values, post, uploads));
    published = true;
    pendingHouseForms.delete(formKey);
    await clearPendingForm(interaction.guildId, channelId, messageId);
    // The permanent channel entry should follow the house card and its
    // playable video reply, rather than interrupting the listing.
    await ensureHouseEntry(interaction.guild, post.channel, { moveToBottom: true })
      .catch(error => console.warn("Could not move house entry to bottom:", error));
  } catch (error) {
    if (post && claimed && !published) {
      // A failed Discord request can still have reached Discord. If a MongoDB
      // staging record exists, restoring the create form would overwrite an
      // already-public post and could erase uploaded videos.
      const staged = await HouseListing.exists({
        guildId: interaction.guildId, postChannelId: channelId,
        postMessageId: messageId, publicationState: "staging",
      }).catch(lookupError => {
        console.error("[house] Cannot verify interrupted publication:", lookupError);
        return true; // fail closed: do not touch the existing Discord message
      });
      if (staged) {
        console.error("[house] Preserved an interrupted listing for restart recovery:", messageId, error);
        throw new UserFacingError(
          "This house submission was interrupted. Any files already archived have been retained for recovery; unconfirmed uploads may require staff assistance. Do not delete the post or retry its files until a server manager reviews it.",
        );
      }
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
    content: styleReady && metadataSaved && videosSaved
      ? `Your styled house listing was posted: ${post.url}`
      : `Your house listing was posted: ${post.url}\n⚠️ The house card or media could not be completely confirmed. The successfully uploaded files were left in place. Ask a server manager to inspect the bot logs before trying again; do not reupload the same files.`,
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

async function publishHouseListing(interaction, values, post, uploads) {
  const { photos, videos } = validateHouseCreationUploads(uploads);
  const [profile, member] = await Promise.all([
    UserProfile.findOne({
      guildId: interaction.guildId,
      discordUserId: interaction.user.id,
    }),
    interaction.guild.members.fetch(interaction.user.id),
  ]);
  const photoMetadata = photos.map(asset => ({
    attachmentId: String(asset.id),
    url: asset.url, name: asset.name,
    contentType: asset.contentType || "", size: asset.size || 0,
  }));
  const listing = await HouseListing.create({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    ownerName: member.displayName,
    ownerRobloxUsername: profile?.adoptMeUsername ?? "",
    postAppearance: await snapshotOwnedListingAppearance(
      interaction.guildId, interaction.user.id, profile),
    mediaAttachments: photoMetadata,
    publicationState: "staging",
    expectedPhotoCount: photos.length,
    expectedVideoCount: videos.length,
    postChannelId: post.channelId,
    postMessageId: post.id,
    ...values,
  });
  let published = false;
  let metadataSaved = true;
  let media;
  try {
    // Save every photo to Mongo BEFORE modifying the original form post.
    if (photos.length) await archiveHousePhotos(interaction.guildId, listing, photos);

    // Video attachments are sent as their own bot-authored reply. Verify
    // EVERY video was accepted by Discord before publishing the house card.
    if (videos.length) {
      media = await ensureHouseMediaMessage(interaction.guild, listing, post, {
        videoSources: videos, channel: post.channel,
      });
      if (!media.message || media.videos.length !== videos.length) {
        throw new Error("The house video post could not be verified.");
      }
      listing.mediaAttachments = mergedHouseMediaMetadata(photoMetadata, media.videos);
      await listing.save();
    }

    // No video is attached to this message: Discord displays a full-size
    // styled card instead of tiling it next to a video preview.
    await post.edit({
      content: `House listing from ${member.displayName}`,
      embeds: [makeHouseEmbed(listing)],
      components: makeHouseComponents(listing),
      attachments: [],
      files: [],
      allowedMentions: { parse: [] },
    });
    published = true;
    // A Discord edit can finish immediately before the process stops. Keep
    // staging in Mongo until the edit actually succeeds, then publish.
    listing.publicationState = "published";
    const saved = await HouseListing.updateOne({
      _id: listing._id, guildId: interaction.guildId,
      publicationState: "staging", postMessageId: post.id,
    }, { $set: { publicationState: "published" } });
    if (!saved.matchedCount) throw new Error("House publication state was not saved.");
  } catch (error) {
    if (!published) {
      // Do NOT erase gallery rows or a verified video reply. A timed-out
      // Discord edit may already have published the post. The startup
      // reconciler checks the actual message and media without guessing.
      console.warn("[House] Unfinished publication preserved for recovery:", String(listing._id), error);
      throw error;
    }
    metadataSaved = false;
    console.warn("[House] Public post preserved; publication state needs recovery:", error);
  }

  // From here onward the house is public: rendering or Mongo failures must
  // never restore a create form and erase uploaded media.
  const videosSaved = videos.length === (media?.videos.length ?? 0);
  try {
    if (!videos.length) {
      listing.mediaAttachments = photoMetadata;
      await listing.save();
    }
  } catch (error) {
    metadataSaved = false;
    console.warn("[House] Published but media metadata could not be saved:", error);
  }
  let styled = true;
  try {
    await refreshHouseStyleCard(interaction.guild, listing);
  } catch (error) {
    styled = false;
    console.warn("[House] Published; styled card needs repair:", error);
  }
  await awardMilestoneSafely(
    interaction.guildId, interaction.user.id, "houseFirstListing", String(listing._id));
  return { styled, metadataSaved, videosSaved };
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

  // A gallery cleanup failure must never roll back a house that has already
  // been deleted from Discord or reactivate a now-missing public listing.
  await deleteHouseMediaMessage(interaction.guild, listing).catch(error =>
    console.warn("House sold; could not delete its separate video post:", error));
  await deleteHouseGallery(interaction.guildId, listing._id).catch(error =>
    console.warn("House sold; could not clean archived photos:", error));

  await interaction.editReply({
    content: "Marked as sold. The house advertisement has been removed.",
  });
  return listing.ownerId;
}
