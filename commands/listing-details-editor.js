import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle,
  LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import MemberDmPanel from "../models/MemberDmPanel.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";
import UserProfile from "../models/UserProfile.js";
import { getOrCreateDmPanel, dmPanelUrl } from "../services/member-dm-panels.js";
import { newListingEditorToken, isListingEditorToken } from "../services/listing-editor-token.js";
import { getAppearanceOwnership, filterOwnedAppearance } from "../services/appearance-ownership.js";
import { displayListingAppearance } from "../services/listing-appearance.js";
import { getHouseGalleryPage } from "../services/house-gallery.js";
import { getOutfitGalleryPage } from "../services/outfit-gallery.js";
import { houseCardData } from "../services/house-style.js";
import { outfitCardData } from "../services/outfit-style.js";
import { renderListingCardCached } from "../services/listing-render-cache.js";
import { refreshHouseStyleCard } from "../services/house-card.js";
import { refreshOutfitStyleCard } from "../services/outfit-card.js";
import { sendTemporaryDmNotice } from "../services/temporary-dm-notice.js";
import { UserFacingError } from "./errors.js";

const KIND = "listingDetails";
const ID = /^[0-9a-f]{24}$/i;
const MODELS = { house: HouseListing, outfit: OutfitListing };
const PRICE_FIELDS = {
  house: ["askingPrice", "estimatedValue"],
  outfit: ["cost"],
};
const PREVIEW_FILE = { house: "house-details-preview.png", outfit: "outfit-details-preview.png" };

function typeName(type) {
  return type === "house" ? "House" : "Outfit";
}

export function currentListingDetails(type, listing) {
  if (!Object.hasOwn(MODELS, type)) throw new UserFacingError("Invalid listing type.");
  const result = { title: listing.title, description: listing.description };
  for (const field of PRICE_FIELDS[type]) result[field] = listing[field] ?? "";
  return result;
}

export function validateListingDetails(type, draft) {
  if (!Object.hasOwn(MODELS, type) || !draft || typeof draft !== "object") {
    throw new UserFacingError("Invalid listing details.");
  }
  const result = {};
  const fields = [
    ["title", 100, true], ["description", 1000, true],
    ...PRICE_FIELDS[type].map(field => [field, 80, type === "house"]),
  ];
  for (const [field, max, required] of fields) {
    if (typeof draft[field] !== "string") {
      throw new UserFacingError("Enter text for " + field + ".");
    }
    const text = draft[field].trim();
    if ((required && !text) || text.length > max) {
      throw new UserFacingError(field + " must be " + (required ? "1–" : "0–") + max + " characters.");
    }
    result[field] = text;
  }
  return result;
}

export function listingDetailsControls(token) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("listing:details:edit:" + token)
      .setLabel("Edit details").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("listing:details:save:" + token)
      .setLabel("Save changes").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("listing:details:discard:" + token)
      .setLabel("Discard").setStyle(ButtonStyle.Danger),
  )];
}

export function listingDetailsModal(type, token, draft) {
  if (!isListingEditorToken(token) || !Object.hasOwn(MODELS, type)) {
    throw new UserFacingError("This editor is no longer valid.");
  }
  const fields = [
    ["title", type === "house" ? "House name" : "Outfit name", 100, true, TextInputStyle.Short],
    ["description", "Description", 1000, true, TextInputStyle.Paragraph],
    ...PRICE_FIELDS[type].map(key => [
      key,
      key === "askingPrice" ? "Asking price (with currency)"
        : key === "estimatedValue" ? "Estimated value (with currency)"
        : "Cost (optional, with currency)",
      80, type === "house", TextInputStyle.Short,
    ]),
  ];
  const modal = new ModalBuilder().setCustomId("listing:details:modal:" + token)
    .setTitle("Edit " + typeName(type) + " Details");
  for (const [field, label, max, required, style] of fields) {
    const value = String(draft[field] ?? "").slice(0, max);
    const input = new TextInputBuilder().setCustomId(field)
      .setStyle(style).setMaxLength(max).setRequired(required);
    if (value) input.setValue(value);
    modal.addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(input));
  }
  return modal;
}

/** Preview uses the same saved image, styling and dimensions as the published card. */
export async function listingDetailsPreview(type, listing, draft, token, {
  profile, ownership, loadGallery, render = renderListingCardCached,
} = {}) {
  const values = validateListingDetails(type, draft);
  const previewListing = {
    ...(typeof listing.toObject === "function" ? listing.toObject() : listing),
    ...values,
  };
  const gallery = loadGallery
    ? await loadGallery(type, listing)
    : type === "house"
      ? await getHouseGalleryPage(listing.guildId, listing._id, listing.galleryPageIndex ?? 0)
      : await getOutfitGalleryPage(listing.guildId, listing._id, listing.galleryPageIndex ?? 0);
  const data = type === "house" ? houseCardData(previewListing) : outfitCardData(previewListing);
  data.galleryIndex = gallery.count ? gallery.page + 1 : 0;
  data.galleryCount = gallery.count;
  const image = await render({
    type,
    data,
    images: { photo: gallery.imageBuffer },
    appearance: filterOwnedAppearance(
      displayListingAppearance(listing, profile, ownership), ownership),
  });
  return {
    content: "**Edit " + typeName(type) + " Listing · " + values.title + "**\n" +
      "This is your **private preview**. Choose **Edit details** to change the text " +
      "or prices, then **Save changes** to update this listing only. " +
      "**Discard** leaves the public post unchanged. Your photos, videos and purchased style stay as they are.",
    embeds: [],
    files: [new AttachmentBuilder(image, { name: PREVIEW_FILE[type] })],
    attachments: [],
    components: listingDetailsControls(token),
    allowedMentions: { parse: [] },
  };
}

async function appearanceContext(guildId, ownerId) {
  const [profile, ownership] = await Promise.all([
    UserProfile.findOne({ guildId, discordUserId: ownerId }),
    getAppearanceOwnership(guildId, ownerId),
  ]);
  return { profile, ownership };
}

async function activeListing(type, guildId, ownerId, listingId, models = MODELS) {
  const listing = await models[type].findOne({
    _id: listingId, guildId, ownerId, status: "active",
    publicationState: { $ne: "staging" },
  });
  if (!listing || !listing.postChannelId || !listing.postMessageId) {
    throw new UserFacingError("This listing is no longer active or available to edit.");
  }
  return listing;
}

export async function openListingDetailsDM(interaction) {
  const parts = String(interaction.customId).split(":");
  const fromDirectory = parts[0] === "member";
  const type = fromDirectory ? parts[2] : parts[0];
  const id = fromDirectory ? interaction.values?.[0] : parts[2];
  if (!Object.hasOwn(MODELS, type) || !ID.test(id ?? "") || !interaction.guildId ||
      (fromDirectory
        ? parts.length !== 4 || parts[1] !== "edit" ||
          parts[3] !== interaction.user.id || !interaction.isStringSelectMenu()
        : parts.length !== 3 || parts[1] !== "edit" || !interaction.isButton())) {
    throw new UserFacingError("That listing edit control is invalid or belongs to another member.");
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const listing = await activeListing(type, interaction.guildId, interaction.user.id, id);
  if (!fromDirectory && (
      listing.postMessageId !== interaction.message?.id ||
      listing.postChannelId !== interaction.channelId ||
      interaction.message.author?.id !== interaction.client.user.id)) {
    throw new UserFacingError("Use Edit details on your original listing post.");
  }
  const { profile, ownership } = await appearanceContext(interaction.guildId, interaction.user.id);
  const result = await getOrCreateDmPanel({
    guildId: interaction.guildId, user: interaction.user, kind: KIND,
    makeInitial: async () => {
      const token = newListingEditorToken();
      const draft = currentListingDetails(type, listing);
      return {
        payload: await listingDetailsPreview(type, listing, draft, token, { profile, ownership }),
        fields: {
          token, detailsDraft: draft,
          appearanceTargetType: type, appearanceTargetId: String(listing._id),
        },
      };
    },
  });
  if (!result.created) {
    if (result.panel.appearanceTargetType !== type ||
        result.panel.appearanceTargetId !== String(listing._id)) {
      await interaction.editReply({
        content: "You already have a different listing editor open. " +
          "[Open it](" + dmPanelUrl(result.message.channelId, result.message.id) +
          ") and Save or Discard before opening another.",
        allowedMentions: { parse: [] },
      });
      return true;
    }
    await result.message.edit(await listingDetailsPreview(
      type, listing, result.panel.detailsDraft ?? currentListingDetails(type, listing),
      result.panel.token, { profile, ownership }));
  }
  await interaction.editReply({
    content: "[**Open your private " + typeName(type) + " details editor**](" +
      dmPanelUrl(result.message.channelId, result.message.id) +
      "). Nothing changes on the public listing until you save.",
    allowedMentions: { parse: [] },
  });
  return true;
}

async function closeDetailsPanel(interaction, panel, text) {
  await MemberDmPanel.deleteOne({ _id: panel._id, token: panel.token });
  const dm = await interaction.user.createDM();
  const message = await dm.messages.fetch(panel.messageId).catch(() => null);
  if (message?.author?.id === interaction.client.user.id) {
    await message.delete().catch(async () => {
      await message.edit({ content: text, embeds: [], attachments: [], components: [] }).catch(() => {});
    });
  }
  await sendTemporaryDmNotice(interaction.user, text);
}

export async function handleListingDetailsDM(interaction) {
  const [prefix, section, action, token] = String(interaction.customId).split(":");
  if (prefix !== "listing" || section !== "details" ||
      !["edit", "modal", "save", "discard"].includes(action) ||
      !isListingEditorToken(token)) {
    throw new UserFacingError("That listing editor action is invalid.");
  }
  const modal = action === "modal";
  const panel = await MemberDmPanel.findOne({
    botUserId: interaction.client.user.id,
    discordUserId: interaction.user.id, kind: KIND,
    token, channelId: interaction.channelId,
  });
  if (!panel || (!modal && panel.messageId !== interaction.message?.id) ||
      !Object.hasOwn(MODELS, panel.appearanceTargetType) ||
      !ID.test(panel.appearanceTargetId)) {
    throw new UserFacingError("This listing editor has expired. Open it again from your listing.");
  }
  const type = panel.appearanceTargetType;
  if (action === "edit") {
    if (!interaction.isButton()) throw new UserFacingError("Use the editor button.");
    await interaction.showModal(listingDetailsModal(type, token, panel.detailsDraft));
    return true;
  }
  if (modal) {
    if (!interaction.isModalSubmit()) throw new UserFacingError("Submit the details form.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } else {
    if (!interaction.isButton()) throw new UserFacingError("Use the editor buttons.");
    await interaction.deferUpdate();
  }
  if (action === "discard") {
    await closeDetailsPanel(interaction, panel, "↩️ **Changes discarded.** Your public " + type + " was not changed.");
    return true;
  }

  const guild = await interaction.client.guilds.fetch(panel.guildId);
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) throw new UserFacingError("You must still belong to this server to edit the listing.");
  const listing = await activeListing(type, panel.guildId, interaction.user.id, panel.appearanceTargetId);
  if (modal) {
    const proposed = {};
    for (const key of ["title", "description", ...PRICE_FIELDS[type]]) {
      proposed[key] = interaction.fields.getTextInputValue(key);
    }
    const draft = validateListingDetails(type, proposed);
    const { profile, ownership } = await appearanceContext(panel.guildId, interaction.user.id);
    const payload = await listingDetailsPreview(type, listing, draft, token, { profile, ownership });
    const dm = await interaction.user.createDM();
    const message = await dm.messages.fetch(panel.messageId);
    if (message?.author?.id !== interaction.client.user.id) {
      throw new UserFacingError("I couldn't find your private editor. Reopen it from your listing.");
    }
    await message.edit(payload);
    await MemberDmPanel.updateOne({ _id: panel._id, token }, { $set: { detailsDraft: draft } });
    await interaction.editReply({
      content: "Your private preview is updated. Choose Save changes to publish or Discard to cancel.",
    });
    return true;
  }

  const draft = validateListingDetails(type, panel.detailsDraft);
  if (action !== "save") throw new UserFacingError("Unknown listing edit action.");
  // Verify the public post still exists and belongs to this bot BEFORE the
  // record is changed. The media-safe card renderer handles all attachments.
  let original;
  try {
    const channel = await guild.channels.fetch(listing.postChannelId);
    original = await channel?.messages?.fetch(listing.postMessageId);
  } catch (error) {
    if (![10003, 10008].includes(Number(error?.code))) throw error;
  }
  if (!original || original.author?.id !== interaction.client.user.id) {
    throw new UserFacingError("I couldn't verify the original public post, so no changes were saved.");
  }
  const updated = await MODELS[type].findOneAndUpdate({
    _id: listing._id, guildId: panel.guildId, ownerId: interaction.user.id,
    status: "active", publicationState: { $ne: "staging" },
    postMessageId: listing.postMessageId,
  }, { $set: draft }, { returnDocument: "after", runValidators: true });
  if (!updated) throw new UserFacingError("This listing changed while you were editing. No changes were saved.");
  try {
    if (type === "house") await refreshHouseStyleCard(guild, updated);
    else await refreshOutfitStyleCard(guild, updated);
  } catch (error) {
    console.error("[Listing details] Saved fields, public card refresh needs retry:", error);
    await sendTemporaryDmNotice(interaction.user,
      "⚠️ Your details were saved, but the public card couldn't be refreshed. " +
      "Your photos and videos were not intentionally changed. Try Save changes again or ask a server manager.");
    return true;
  }
  await closeDetailsPanel(interaction, panel,
    "✅ **" + typeName(type) + " listing updated!** Only this listing's text and price fields changed.");
  return true;
}
