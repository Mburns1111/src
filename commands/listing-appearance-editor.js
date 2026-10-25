import { newListingEditorToken, isListingEditorToken } from "../services/listing-editor-token.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  AttachmentBuilder, EmbedBuilder, LabelBuilder, MessageFlags, ModalBuilder,
  TextInputBuilder, TextInputStyle,
} from "discord.js";
import MemberDmPanel from "../models/MemberDmPanel.js";
import TradingPost from "../models/TradingPost.js";
import OutfitListing from "../models/OutfitListing.js";
import UserProfile from "../models/UserProfile.js";
import { getOrCreateDmPanel, dmPanelUrl } from "../services/member-dm-panels.js";
import { sendTemporaryDmNotice } from "../services/temporary-dm-notice.js";
import { displayListingAppearance } from "../services/listing-appearance.js";
import {
  getAppearanceOwnership, ownsAppearanceItem, filterOwnedAppearance,
  APPEARANCE_FIELD_CATEGORY,
} from "../services/appearance-ownership.js";
import { resolveAppearance, appearanceCatalogItem } from "../services/post-appearance.js";
import { STICKER_CATALOG, STICKER_OUTLINES, stickerDefaults, validStickerHex } from "../services/sticker-catalog.js";
import { renderPostImage } from "../services/post-renderer.js";
import { refreshOutfitStyleCard } from "../services/outfit-card.js";
import { OUTFIT_PICK_PAGE_SIZE, outfitPickerOptions, outfitCardData } from "../services/outfit-style.js";
import {
  APPEARANCE_PAGES, makeAppearanceControls, availableAppearanceChoices,
  appearanceChoicePage, adjustDraftSticker, clearDraftStickers,
} from "./profile.js";
import { refreshTradingPostCard } from "./trading-post.js";
import { UserFacingError } from "./errors.js";

const EDITOR_KIND = "postAppearance";
const TARGET_TYPE = "tradingPost";
const OUTFIT_TARGET_TYPE = "outfit";
const OUTFIT_EDITOR_KIND = "outfitAppearance";

function isOutfitTarget(type) { return type === OUTFIT_TARGET_TYPE; }
function targetLabel(type) { return isOutfitTarget(type) ? "Outfit" : "Trading Post"; }
function targetKind(type) { return isOutfitTarget(type) ? OUTFIT_EDITOR_KIND : EDITOR_KIND; }

function editorControls(post, draft, ownership, type = TARGET_TYPE) {
  return makeAppearanceControls(
    { discordUserId: post.ownerId, profileAppearance: draft.appearance },
    draft.page, draft.selected, ownership, draft.token, draft.optionPages,
    draft.stickerMode, "listing:dm", `Save ${targetLabel(type)} Style`,
  );
}

async function editorPayload(post, draft, ownership, type = TARGET_TYPE) {
  const outfit = isOutfitTarget(type);
  const filename = outfit ? "outfit-preview.png" : "trading-post-preview.png";
  const png = await renderPostImage({
    type: outfit ? "outfit" : "tradingPost",
    data: outfit ? outfitCardData(post) : {
      discordName: post.discordName, robloxName: post.robloxName,
      lookingFor: post.lookingFor, willingToTrade: post.willingToTrade,
    },
    images: {},
    appearance: filterOwnedAppearance(draft.appearance, ownership),
  });
  return {
    content: outfit
      ? `**Customize Outfit: ${String(post.title).slice(0, 90)}** — private preview. Save only this outfit's style, or discard. Other outfits and your profile will not change. Photos appear in a separate flipbook below your decorated banner; videos remain attached to the listing.`
      : "**Customize Trading Post** — choose your owned shop styles. This is a private preview. **Save Trading Post Style** updates only your Trading Post, not your profile or other listings. **Discard Changes** leaves the public post unchanged.",
    embeds: [new EmbedBuilder().setColor("#819287").setImage(`attachment://${filename}`)],
    files: [new AttachmentBuilder(png, { name: filename })],
    attachments: [],
    components: editorControls(post, draft, ownership, type),
    allowedMentions: { parse: [] },
  };
}

async function saveDraft(panel, draft) {
  panel.appearanceDraft = draft.appearance;
  panel.appearancePage = draft.page;
  panel.selectedSticker = draft.selected;
  panel.appearanceStickerMode = draft.stickerMode;
  panel.appearanceOptionPages = draft.optionPages;
  panel.markModified("appearanceDraft");
  panel.markModified("appearanceOptionPages");
  await panel.save();
}

function readDraft(panel, post, profile, ownership) {
  return {
    token: panel.token,
    appearance: filterOwnedAppearance(
      panel.appearanceDraft ?? displayListingAppearance(post, profile, ownership),
      ownership,
    ),
    page: Object.hasOwn(APPEARANCE_PAGES, panel.appearancePage) ? panel.appearancePage : "colors",
    selected: panel.selectedSticker ?? 0,
    stickerMode: panel.appearanceStickerMode || "position",
    optionPages: panel.appearanceOptionPages || {},
  };
}

export async function openTradingPostAppearanceDM(interaction, guild) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const post = await TradingPost.findOne({ guildId: guild.id, ownerId: interaction.user.id });
  if (!post) {
    throw new UserFacingError(
      "Create your Trading Post card in the server first, then return here to customize it.",
    );
  }
  const profile = await UserProfile.findOne({
    guildId: guild.id, discordUserId: interaction.user.id,
  });
  const ownership = await getAppearanceOwnership(guild.id, interaction.user.id);
  const result = await getOrCreateDmPanel({
    guildId: guild.id, user: interaction.user, kind: EDITOR_KIND,
    makeInitial: async () => {
      const draft = {
        token: newListingEditorToken(),
        appearance: displayListingAppearance(post, profile, ownership),
        page: "colors", selected: 0, stickerMode: "position", optionPages: {},
      };
      return {
        payload: await editorPayload(post, draft, ownership),
        fields: {
          token: draft.token, appearanceDraft: draft.appearance,
          appearancePage: draft.page, selectedSticker: draft.selected,
          appearanceStickerMode: draft.stickerMode,
          appearanceOptionPages: draft.optionPages,
          appearanceTargetType: TARGET_TYPE, appearanceTargetId: String(post._id),
        },
      };
    },
  });
  // Reuse the one unfinished editor DM rather than silently discarding drafts.
  if (!result.created) {
    if (result.panel.appearanceTargetType !== TARGET_TYPE ||
        result.panel.appearanceTargetId !== String(post._id)) {
      throw new UserFacingError(
        "Another post's appearance editor is open. Save or discard that editor before opening this one.",
      );
    }
    await result.message.edit(await editorPayload(
      post, readDraft(result.panel, post, profile, ownership), ownership,
    ));
  }
  await interaction.editReply({
    content: `[**Open your Trading Post appearance editor**](${dmPanelUrl(result.message.channelId, result.message.id)}). Your purchased designs work here at no extra cost.`,
    allowedMentions: { parse: [] },
  });
  return true;
}

// Outfit selection is scoped to the member, server and listing ID.
export async function showOutfitAppearancePicker(interaction, guild, requestedPage = 0) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const filter = {
    guildId: guild.id, ownerId: interaction.user.id, status: "active",
    postChannelId: { $ne: "" }, postMessageId: { $ne: "" },
  };
  const count = await OutfitListing.countDocuments(filter);
  if (!count) {
    await interaction.editReply({
      content: "You do not have any active outfit listings yet. Create one using the Outfit channel first, then return here to style it.",
      components: [], allowedMentions: { parse: [] },
    });
    return true;
  }
  const lastPage = Math.max(0, Math.ceil(count / OUTFIT_PICK_PAGE_SIZE) - 1);
  const page = Math.max(0, Math.min(lastPage, Number(requestedPage) || 0));
  const outfits = await OutfitListing.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip(page * OUTFIT_PICK_PAGE_SIZE).limit(OUTFIT_PICK_PAGE_SIZE).lean();
  const selector = new StringSelectMenuBuilder()
    .setCustomId(`listing:pick:${guild.id}:${interaction.user.id}:${page}`)
    .setPlaceholder("Choose one outfit to customize")
    .addOptions(outfitPickerOptions(outfits));
  const controls = [new ActionRowBuilder().addComponents(selector)];
  if (lastPage > 0) {
    controls.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`listing:pickpage:${guild.id}:${interaction.user.id}:${page - 1}`)
        .setLabel("◀ Previous").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(`listing:pickpage:${guild.id}:${interaction.user.id}:${page + 1}`)
        .setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(page === lastPage),
    ));
  }
  await interaction.editReply({
    content: `**Customize Outfits** — select the exact listing you want to style.\nEach outfit saves its own appearance independently, including stickers. **${count} active listing(s)** · Page ${page + 1}/${lastPage + 1}.`,
    components: controls, allowedMentions: { parse: [] },
  });
  return true;
}

export async function handleOutfitAppearancePicker(interaction) {
  const [, action, guildId, ownerId, page] = interaction.customId.split(":");
  if (!["pick", "pickpage"].includes(action) ||
      !/^\d{17,21}$/.test(guildId) || ownerId !== interaction.user.id ||
      !/^\d+$/.test(page || "")) {
    throw new UserFacingError("That outfit selection is not yours.");
  }
  if (action === "pick" && !interaction.isStringSelectMenu()) {
    throw new UserFacingError("Use the outfit listing dropdown.");
  }
  if (action === "pickpage" && !interaction.isButton()) {
    throw new UserFacingError("That outfit page control is invalid.");
  }
  if (action === "pick") {
    const id = interaction.values[0];
    if (!/^[a-f\d]{24}$/i.test(id || "")) {
      throw new UserFacingError("Select a valid outfit listing.");
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = await interaction.client.guilds.fetch(guildId);
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) throw new UserFacingError("You must belong to this server to edit outfits.");
    const listing = await OutfitListing.findOne({
      _id: id, guildId, ownerId: interaction.user.id, status: "active",
      postChannelId: { $ne: "" }, postMessageId: { $ne: "" },
    });
    if (!listing) throw new UserFacingError("That outfit is no longer active or belongs to someone else.");
    return openOutfitAppearanceDM(interaction, guild, listing);
  }
  await interaction.deferUpdate();
  const guild = await interaction.client.guilds.fetch(guildId);
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) throw new UserFacingError("You must belong to this server to edit outfits.");
  return showOutfitAppearancePicker(interaction, guild, Number(page));
}

async function openOutfitAppearanceDM(interaction, guild, listing) {
  const [profile, ownership] = await Promise.all([
    UserProfile.findOne({ guildId: guild.id, discordUserId: interaction.user.id }),
    getAppearanceOwnership(guild.id, interaction.user.id),
  ]);
  const result = await getOrCreateDmPanel({
    guildId: guild.id, user: interaction.user, kind: OUTFIT_EDITOR_KIND,
    makeInitial: async () => {
      const draft = {
        token: newListingEditorToken(),
        appearance: displayListingAppearance(listing, profile, ownership),
        page: "colors", selected: 0, stickerMode: "position", optionPages: {},
      };
      return {
        payload: await editorPayload(listing, draft, ownership, OUTFIT_TARGET_TYPE),
        fields: {
          token: draft.token, appearanceDraft: draft.appearance,
          appearancePage: draft.page, selectedSticker: draft.selected,
          appearanceStickerMode: draft.stickerMode,
          appearanceOptionPages: draft.optionPages,
          appearanceTargetType: OUTFIT_TARGET_TYPE,
          appearanceTargetId: String(listing._id),
        },
      };
    },
  });
  if (!result.created) {
    if (result.panel.appearanceTargetType !== OUTFIT_TARGET_TYPE ||
        result.panel.appearanceTargetId !== String(listing._id)) {
      await interaction.editReply({
        content: `You already have another outfit editor open. [Open that editor](${dmPanelUrl(result.message.channelId, result.message.id)}) and **Save** or **Discard** its changes, then select this outfit again.`,
        allowedMentions: { parse: [] },
      });
      return true;
    }
    await result.message.edit(await editorPayload(
      listing, readDraft(result.panel, listing, profile, ownership),
      ownership, OUTFIT_TARGET_TYPE,
    ));
  }
  await interaction.editReply({
    content: `[**Open the editor for ${String(listing.title).slice(0, 75)}**](${dmPanelUrl(result.message.channelId, result.message.id)}). Only this outfit will change when you save.`,
    allowedMentions: { parse: [] },
  });
  return true;
}

async function closeEditor(interaction, panel, messageText) {
  await MemberDmPanel.deleteOne({ _id: panel._id, token: panel.token });
  const channel = await interaction.user.createDM();
  const message = await channel.messages.fetch(panel.messageId).catch(() => null);
  if (message?.author.id === interaction.client.user.id) {
    await message.delete().catch(async () => {
      await message.edit({
        content: messageText, embeds: [], attachments: [], components: [],
      }).catch(() => {});
    });
  }
  await sendTemporaryDmNotice(interaction.user, messageText);
}

function colorInput(id, current, label) {
  return new LabelBuilder().setLabel(label).setTextInputComponent(
    new TextInputBuilder()
      .setCustomId(id).setStyle(TextInputStyle.Short)
      .setRequired(true).setMinLength(6).setMaxLength(7)
      .setValue(current).setPlaceholder("#E68EAB"),
  );
}

export async function handleListingAppearanceDM(interaction) {
  const [, , kind, token, field, stickerIndex] = interaction.customId.split(":");
  if (!["button", "select", "modal"].includes(kind) || !isListingEditorToken(token)) {
    throw new UserFacingError("That listing editor action is not valid.");
  }
  // Modals must be presented before acknowledging the button interaction.
  if (kind === "button" && field === "stickerColors") {
    const panel = await MemberDmPanel.findOne({
      botUserId: interaction.client.user.id, discordUserId: interaction.user.id,
      kind: { $in: [EDITOR_KIND, OUTFIT_EDITOR_KIND] }, token, channelId: interaction.channelId,
      messageId: interaction.message?.id,
    });
    if (!panel) throw new UserFacingError("This editor is no longer active.");
    const ownership = await getAppearanceOwnership(panel.guildId, interaction.user.id);
    const draft = filterOwnedAppearance(panel.appearanceDraft, ownership);
    const sticker = draft.stickers[panel.selectedSticker ?? 0];
    if (!sticker) throw new UserFacingError("Choose a placed sticker first.");
    const info = STICKER_CATALOG[sticker.id];
    const modal = new ModalBuilder()
      .setCustomId(`listing:dm:modal:${token}:stickerColors:${panel.selectedSticker ?? 0}`)
      .setTitle(`Recolor ${info.name}`)
      .addLabelComponents(colorInput("sticker_main", sticker.color, "Main color · #RRGGBB"));
    if (info.colors === 2) {
      modal.addLabelComponents(colorInput("sticker_accent", sticker.accentColor, "Accent color · #RRGGBB"));
    }
    await interaction.showModal(modal);
    return true;
  }

  if (kind === "modal") await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  else await interaction.deferUpdate();
  const panel = await MemberDmPanel.findOne({
    botUserId: interaction.client.user.id, discordUserId: interaction.user.id,
    kind: { $in: [EDITOR_KIND, OUTFIT_EDITOR_KIND] }, token, channelId: interaction.channelId,
  });
  if (!panel || (kind !== "modal" && panel.messageId !== interaction.message?.id) ||
      ![TARGET_TYPE, OUTFIT_TARGET_TYPE].includes(panel.appearanceTargetType) ||
      panel.kind !== targetKind(panel.appearanceTargetType)) {
    throw new UserFacingError("This listing editor expired. Reopen it from your permanent shop DM.");
  }
  const type = panel.appearanceTargetType;
  const guild = await interaction.client.guilds.fetch(panel.guildId);
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) throw new UserFacingError("You must belong to this server to customize a listing.");
  const model = isOutfitTarget(type) ? OutfitListing : TradingPost;
  const post = await model.findOne({
    _id: panel.appearanceTargetId, guildId: panel.guildId, ownerId: interaction.user.id,
    ...(isOutfitTarget(type) ? { status: "active" } : {}),
  });
  if (!post) throw new UserFacingError(`Your ${targetLabel(type)} is no longer available.`);
  const [profile, ownership] = await Promise.all([
    UserProfile.findOne({ guildId: panel.guildId, discordUserId: interaction.user.id }),
    getAppearanceOwnership(panel.guildId, interaction.user.id),
  ]);
  const draft = readDraft(panel, post, profile, ownership);

  if (kind === "modal") {
    if (field !== "stickerColors" || !interaction.isModalSubmit()) {
      throw new UserFacingError("Unknown sticker color action.");
    }
    const index = Number(stickerIndex);
    if (index !== draft.selected || !draft.appearance.stickers[index]) {
      throw new UserFacingError("That sticker selection has changed.");
    }
    const sticker = draft.appearance.stickers[index];
    const main = validStickerHex(interaction.fields.getTextInputValue("sticker_main"));
    const accent = STICKER_CATALOG[sticker.id].colors === 2
      ? validStickerHex(interaction.fields.getTextInputValue("sticker_accent")) : null;
    if (!main || (STICKER_CATALOG[sticker.id].colors === 2 && !accent)) {
      throw new UserFacingError("Enter valid #RRGGBB colors.");
    }
    sticker.color = main; sticker.accentColor = accent;
    draft.appearance = filterOwnedAppearance(draft.appearance, ownership);
    await saveDraft(panel, draft);
    const dm = await interaction.user.createDM();
    const message = await dm.messages.fetch(panel.messageId);
    await message.edit(await editorPayload(post, draft, ownership, type));
    await interaction.editReply({ content: "Updated the sticker colors in your private preview. Save to publish the change." });
    return true;
  }

  if (kind === "button" && field === "cancel") {
    await closeEditor(interaction, panel, `↩️ **Changes discarded.** Your ${targetLabel(type)} was not changed.`);
    return true;
  }
  if (kind === "button" && field === "confirm") {
    post.postAppearance = filterOwnedAppearance(draft.appearance, ownership);
    post.markModified("postAppearance");
    await post.save();
    if (isOutfitTarget(type)) await refreshOutfitStyleCard(guild, post);
    else await refreshTradingPostCard(guild, interaction.user.id);
    await closeEditor(interaction, panel, `✅ **${targetLabel(type)} updated!** Your profile and other listings were not changed.`);
    return true;
  }
  if (kind === "button" && ["stickerStyle", "stickerPosition"].includes(field)) {
    if (draft.page !== "stickers" || !draft.appearance.stickers[draft.selected]) {
      throw new UserFacingError("Choose a sticker first.");
    }
    draft.stickerMode = field === "stickerStyle" ? "style" : "position";
    await saveDraft(panel, draft);
    await interaction.editReply({ components: editorControls(post, draft, ownership, type) });
    return true;
  }
  if (kind === "button" && field === "refresh") {
    await interaction.editReply(await editorPayload(post, draft, ownership, type));
    return true;
  }
  if (kind === "button" && field === "clearStickers") {
    clearDraftStickers(draft);
    draft.appearance = filterOwnedAppearance(resolveAppearance(draft.appearance), ownership);
    await saveDraft(panel, draft);
    await interaction.editReply(await editorPayload(post, draft, ownership, type));
    return true;
  }
  if (kind === "button" && field === "fontBoth") {
    if (!ownsAppearanceItem(ownership, "fonts", draft.appearance.headerFont)) {
      throw new UserFacingError("That font is not unlocked.");
    }
    draft.appearance.bodyFont = draft.appearance.headerFont;
  } else if (kind === "button" && ["stickerOutline", "stickerResetColors"].includes(field)) {
    const sticker = draft.appearance.stickers[draft.selected];
    if (!sticker) throw new UserFacingError("Choose a sticker first.");
    if (field === "stickerOutline") {
      const i = STICKER_OUTLINES.indexOf(sticker.outline || "auto");
      sticker.outline = STICKER_OUTLINES[(i + 1) % STICKER_OUTLINES.length];
    } else {
      const defaults = stickerDefaults(sticker.id, sticker.x, sticker.y);
      sticker.color = defaults.color;
      sticker.accentColor = defaults.accentColor;
      sticker.outline = defaults.outline;
    }
  } else if (kind === "button" && [
    "left", "right", "up", "down", "smaller", "larger", "rotateLeft",
    "rotateRight", "remove",
  ].includes(field)) {
    adjustDraftSticker(draft, field);
  } else if (kind === "select") {
    const value = interaction.values[0];
    if (field === "page") {
      if (!Object.hasOwn(APPEARANCE_PAGES, value)) throw new UserFacingError("Unknown appearance page.");
      draft.page = value;
      draft.selected = 0;
    } else if (field === "stickerPick") {
      const [action, id] = value.split(":");
      if (action === "select") {
        const index = Number(id);
        if (!Number.isSafeInteger(index) || index < 0 || index >= draft.appearance.stickers.length) {
          throw new UserFacingError("Choose a valid sticker.");
        }
        draft.selected = index;
      } else if (action === "add") {
        if (!ownsAppearanceItem(ownership, "stickers", id)) throw new UserFacingError("You do not own that sticker.");
        if (draft.appearance.stickers.length >= 8) throw new UserFacingError("Up to eight stickers per card.");
        draft.appearance.stickers.push(stickerDefaults(id));
        draft.selected = draft.appearance.stickers.length - 1;
      } else {
        throw new UserFacingError("Unknown sticker choice.");
      }
      draft.page = "stickers";
    } else if (field === "opacity") {
      if (![0.2, 0.34, 0.5, 0.7, 0.9].includes(Number(value))) {
        throw new UserFacingError("Invalid panel opacity.");
      }
      draft.appearance.panelOpacity = Number(value);
    } else if (["background", "panelColor", "fontColor"].includes(field) &&
               ["__next__", "__previous__"].includes(value)) {
      const { page, count } = appearanceChoicePage(field, draft.appearance, draft.optionPages, ownership);
      draft.optionPages[field] = Math.max(0, Math.min(count - 1,
        page + (value === "__next__" ? 1 : -1)));
    } else if (availableAppearanceChoices(field, ownership)?.includes(value)) {
      if (value !== "match" && !ownsAppearanceItem(ownership, APPEARANCE_FIELD_CATEGORY[field], value)) {
        throw new UserFacingError("You do not own that appearance choice.");
      }
      draft.appearance[field] = value;
      if (field === "font") {
        draft.appearance.headerFont = value; draft.appearance.bodyFont = value;
      }
      if (field === "panelColor" && appearanceCatalogItem("panels", value)?.dark) {
        draft.appearance.panelOpacity = 0.9;
      }
      if (field === "background" && draft.appearance.panelColor === "match" &&
          appearanceCatalogItem("backgrounds", value)?.dark) {
        draft.appearance.panelOpacity = 0.9;
      }
    } else {
      throw new UserFacingError("Invalid appearance choice.");
    }
  } else {
    throw new UserFacingError("Unknown listing editor action.");
  }
  draft.appearance = filterOwnedAppearance(resolveAppearance(draft.appearance), ownership);
  await saveDraft(panel, draft);
  await interaction.editReply(await editorPayload(post, draft, ownership, type));
  return true;
}
