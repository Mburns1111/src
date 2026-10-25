import { newListingEditorToken, isListingEditorToken } from "../services/listing-editor-token.js";
import {
  AttachmentBuilder, EmbedBuilder, LabelBuilder, MessageFlags, ModalBuilder,
  TextInputBuilder, TextInputStyle,
} from "discord.js";
import MemberDmPanel from "../models/MemberDmPanel.js";
import TradingPost from "../models/TradingPost.js";
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
import {
  APPEARANCE_PAGES, makeAppearanceControls, availableAppearanceChoices,
  appearanceChoicePage, adjustDraftSticker, clearDraftStickers,
} from "./profile.js";
import { refreshTradingPostCard } from "./trading-post.js";
import { UserFacingError } from "./errors.js";

const EDITOR_KIND = "postAppearance";
const TARGET_TYPE = "tradingPost";

function editorControls(post, draft, ownership) {
  return makeAppearanceControls(
    { discordUserId: post.ownerId, profileAppearance: draft.appearance },
    draft.page, draft.selected, ownership, draft.token, draft.optionPages,
    draft.stickerMode, "listing:dm", "Save Trading Post Style",
  );
}

async function editorPayload(post, draft, ownership) {
  const png = await renderPostImage({
    type: "tradingPost",
    data: {
      discordName: post.discordName, robloxName: post.robloxName,
      lookingFor: post.lookingFor, willingToTrade: post.willingToTrade,
    },
    appearance: filterOwnedAppearance(draft.appearance, ownership),
  });
  return {
    content: "**Customize Trading Post** — choose your owned shop styles. This is a private preview. **Save Trading Post Style** updates only your Trading Post, not your profile or other listings. **Discard Changes** leaves the public post unchanged.",
    embeds: [new EmbedBuilder().setColor("#819287").setImage("attachment://trading-post-preview.png")],
    files: [new AttachmentBuilder(png, { name: "trading-post-preview.png" })],
    attachments: [],
    components: editorControls(post, draft, ownership),
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
      kind: EDITOR_KIND, token, channelId: interaction.channelId,
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
    kind: EDITOR_KIND, token, channelId: interaction.channelId,
  });
  if (!panel || (kind !== "modal" && panel.messageId !== interaction.message?.id) ||
      panel.appearanceTargetType !== TARGET_TYPE) {
    throw new UserFacingError("This listing editor expired. Reopen it from your permanent shop DM.");
  }
  const guild = await interaction.client.guilds.fetch(panel.guildId);
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) throw new UserFacingError("You must belong to this server to customize a listing.");
  const post = await TradingPost.findOne({
    _id: panel.appearanceTargetId, guildId: panel.guildId, ownerId: interaction.user.id,
  });
  if (!post) throw new UserFacingError("Your Trading Post is no longer available.");
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
    await message.edit(await editorPayload(post, draft, ownership));
    await interaction.editReply({ content: "Updated the sticker colors in your private preview. Save to publish the change." });
    return true;
  }

  if (kind === "button" && field === "cancel") {
    await closeEditor(interaction, panel, "↩️ **Changes discarded.** Your Trading Post was not changed.");
    return true;
  }
  if (kind === "button" && field === "confirm") {
    post.postAppearance = filterOwnedAppearance(draft.appearance, ownership);
    post.markModified("postAppearance");
    await post.save();
    await refreshTradingPostCard(guild, interaction.user.id);
    await closeEditor(interaction, panel, "✅ **Trading Post updated!** Your profile and other listings were not changed.");
    return true;
  }
  if (kind === "button" && ["stickerStyle", "stickerPosition"].includes(field)) {
    if (draft.page !== "stickers" || !draft.appearance.stickers[draft.selected]) {
      throw new UserFacingError("Choose a sticker first.");
    }
    draft.stickerMode = field === "stickerStyle" ? "style" : "position";
    await saveDraft(panel, draft);
    await interaction.editReply({ components: editorControls(post, draft, ownership) });
    return true;
  }
  if (kind === "button" && field === "refresh") {
    await interaction.editReply(await editorPayload(post, draft, ownership));
    return true;
  }
  if (kind === "button" && field === "clearStickers") {
    clearDraftStickers(draft);
    draft.appearance = filterOwnedAppearance(resolveAppearance(draft.appearance), ownership);
    await saveDraft(panel, draft);
    await interaction.editReply(await editorPayload(post, draft, ownership));
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
  await interaction.editReply(await editorPayload(post, draft, ownership));
  return true;
}
