import {
  FileUploadBuilder, LabelBuilder, MessageFlags, ModalBuilder,
  PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { validateHouseCreationUploads, publishHouseListing, ensureHouseEntry } from "./house.js";
import {
  validateOutfitCreationUploads, publishOutfitListing, ensureOutfitEntry,
} from "./outfit.js";
import { getConfiguredTextChannel, requireGuild, validateOptionalWebUrl } from "./shared.js";
import { UserFacingError } from "./errors.js";
import { refreshTradingPostCard, importTradingPostForMember } from "./trading-post.js";
import { importInventoryForMember } from "./inventory-video.js";
import { ensureProfileCard } from "./profile.js";

const TICKET_LIFETIME_MS = 20 * 60 * 1000;
const importTickets = new Map();
const TYPE_INFO = Object.freeze({
  house: { channelField: "houseChannelId", label: "house listings", mediaField: "house_media" },
  outfit: { channelField: "outfitChannelId", label: "outfit listings", mediaField: "outfit_media" },
  inventory: { channelField: "inventoryChannelId", label: "inventory showcase", mediaField: "inventory_media" },
  trading: { channelField: "tradingPostChannelId", label: "Trading Post" },
});
const SCOPE = /^[0-9a-f]{12}$/i;

export const data = new SlashCommandBuilder()
  .setName("admin-import")
  .setDescription("Import a house, outfit, inventory video, or Trading Post for a member")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(command => command.setName("house")
    .setDescription("Post a house listing owned and managed by another member")
    .addUserOption(option => option.setName("member")
      .setDescription("Member who will own and control the house listing")
      .setRequired(true)))
  .addSubcommand(command => command.setName("outfit")
    .setDescription("Post an outfit listing owned and managed by another member")
    .addUserOption(option => option.setName("member")
      .setDescription("Member who will own and control the outfit listing")
      .setRequired(true)))
  .addSubcommand(command => command.setName("inventory")
    .setDescription("Import an inventory video or video link for a member")
    .addUserOption(option => option.setName("member")
      .setDescription("Member who will own the inventory entry")
      .setRequired(true)))
  .addSubcommand(command => command.setName("trading")
    .setDescription("Import a Trading Post card for a member")
    .addUserOption(option => option.setName("member")
      .setDescription("Member who will own the Trading Post")
      .setRequired(true)));

function requireAdmin(interaction) {
  requireGuild(interaction);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserFacingError("Only a server manager can import a listing for another member.");
  }
}

export function buildAdminImportModal(type, token, memberName) {
  if (!Object.hasOwn(TYPE_INFO, type) || !SCOPE.test(token ?? "")) {
    throw new UserFacingError("That migration form is not valid.");
  }
  const house = type === "house";
  const label = { house: "House", outfit: "Outfit", inventory: "Inventory", trading: "Trading Post" }[type];
  const modal = new ModalBuilder()
    .setCustomId("admin-import:" + type + ":" + token)
    .setTitle(("Import " + label + " for " +
      String(memberName || "member").slice(0, 24)).slice(0, 45));
  const text = (id, label, max, required, style) =>
    new LabelBuilder().setLabel(label).setTextInputComponent(
      new TextInputBuilder().setCustomId(id).setMaxLength(max)
        .setRequired(required).setStyle(style),
    );
  if (type === "inventory") {
    modal.addLabelComponents(
      text("video_url", "Video link (leave blank if uploading)", 500, false, TextInputStyle.Short),
      new LabelBuilder()
        .setLabel("Video file (leave blank if using a link)")
        .setFileUploadComponent(new FileUploadBuilder()
          .setCustomId("inventory_media").setRequired(false).setMinValues(0).setMaxValues(1)),
    );
    return modal;
  }
  if (type === "trading") {
    modal.addLabelComponents(
      text("looking_for", "Looking for (optional)", 1000, false, TextInputStyle.Paragraph),
      text("willing_to_trade", "Willing to trade (optional)", 1000, false, TextInputStyle.Paragraph),
    );
    return modal;
  }
  modal.addLabelComponents(
    text("title", house ? "House name" : "Outfit name", 100, true, TextInputStyle.Short),
    text("description", "Description", 1000, true, TextInputStyle.Paragraph),
  );
  if (house) {
    modal.addLabelComponents(
      text("asking_price", "Asking price (with currency)", 80, true, TextInputStyle.Short),
      text("estimated_value", "Estimated value (with currency)", 80, true, TextInputStyle.Short),
    );
  } else {
    modal.addLabelComponents(
      text("cost", "Cost (optional)", 80, false, TextInputStyle.Short),
      text("video_url", "Video link (optional)", 500, false, TextInputStyle.Short),
    );
  }
  modal.addLabelComponents(new LabelBuilder()
    .setLabel(house ? "House photos / videos (1–10)" : "Outfit photos / videos (1–10)")
    .setFileUploadComponent(new FileUploadBuilder()
      .setCustomId(house ? "house_media" : "outfit_media")
      .setMinValues(1).setMaxValues(10)));
  return modal;
}

export async function execute(interaction) {
  requireAdmin(interaction);
  const type = interaction.options.getSubcommand();
  if (!Object.hasOwn(TYPE_INFO, type)) {
    throw new UserFacingError("Choose house or outfit to import.");
  }
  const target = interaction.options.getUser("member", true);
  if (!target || target.bot || target.id === interaction.client.user.id) {
    throw new UserFacingError("Choose a real server member to own the imported listing.");
  }
  // A slash command must display its modal within Discord's short
  // acknowledgement window. Do not block on network membership requests
  // here; membership is checked before any upload/post on submission.

  // Each form is bound to its admin, guild, member and a one-use nonce.
  // The ticket is consumed on submission so double-clicks cannot duplicate imports.
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  for (const [key, ticket] of importTickets) {
    if (ticket.expiresAt <= Date.now()) importTickets.delete(key);
  }
  importTickets.set(token, {
    guildId: interaction.guildId, adminId: interaction.user.id,
    ownerId: target.id, type, expiresAt: Date.now() + TICKET_LIFETIME_MS,
  });
  try {
    await interaction.showModal(buildAdminImportModal(type, token, target.username));
  } catch (error) {
    importTickets.delete(token);
    throw error;
  }
}

export function claimAdminImportTicket(customId, interaction, now = Date.now()) {
  const parts = String(customId ?? "").split(":");
  const [prefix, type, token] = parts;
  if (parts.length !== 3 || prefix !== "admin-import" ||
      !Object.hasOwn(TYPE_INFO, type) || !SCOPE.test(token ?? "")) {
    throw new UserFacingError("That import form is invalid.");
  }
  requireAdmin(interaction);
  const ticket = importTickets.get(token);
  if (!ticket || ticket.type !== type ||
      ticket.adminId !== interaction.user.id ||
      ticket.guildId !== interaction.guildId || ticket.expiresAt <= now) {
    throw new UserFacingError("This import form expired or has already been submitted. Start a fresh /admin-import command.");
  }
  importTickets.delete(token);
  return ticket;
}

export function adminImportValues(type, fields) {
  if (!Object.hasOwn(TYPE_INFO, type)) throw new UserFacingError("Choose a valid listing type.");
  const get = key => {
    const value = fields.getTextInputValue(key);
    if (typeof value !== "string") throw new UserFacingError("An import field is missing.");
    return value.trim();
  };
  if (type === "inventory") {
    return { videoUrl: validateOptionalWebUrl(get("video_url"), "Inventory video") };
  }
  if (type === "trading") {
    const lookingFor = get("looking_for"), willingToTrade = get("willing_to_trade");
    if (lookingFor.length > 1000 || willingToTrade.length > 1000) {
      throw new UserFacingError("Trading Post text must be at most 1000 characters per field.");
    }
    if (!lookingFor && !willingToTrade) {
      throw new UserFacingError("Enter something the member is looking for or willing to trade.");
    }
    return { lookingFor, willingToTrade };
  }
  const title = get("title"), description = get("description");
  if (!title || title.length > 100 || !description || description.length > 1000) {
    throw new UserFacingError("Enter a title (up to 100 characters) and description (up to 1000 characters).");
  }
  if (type === "house") {
    const askingPrice = get("asking_price"), estimatedValue = get("estimated_value");
    if (!askingPrice || !estimatedValue || askingPrice.length > 80 || estimatedValue.length > 80) {
      throw new UserFacingError("Enter both house prices with a currency, up to 80 characters each.");
    }
    return { title, description, askingPrice, estimatedValue, videoUrl: "" };
  }
  const cost = get("cost");
  if (cost.length > 80) throw new UserFacingError("Outfit cost must be at most 80 characters.");
  return {
    title, description, cost,
    videoUrl: validateOptionalWebUrl(get("video_url"), "Outfit video"),
  };
}

export async function handleAdminImportModal(interaction) {
  const ticket = claimAdminImportTicket(interaction.customId, interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { type, ownerId } = ticket;
  const info = TYPE_INFO[type];
  // Recheck membership after the form was opened: ownership must never
  // be assigned to a missing member.
  const owner = await interaction.guild.members.fetch(ownerId).catch(error => {
    if (Number(error?.code) === 10007) return null;
    throw error;
  });
  if (!owner || owner.user?.bot) {
    throw new UserFacingError("The intended owner is no longer a human member of this server. Nothing was posted.");
  }
  const values = adminImportValues(type, interaction.fields);
  if (type === "inventory") {
    const uploaded = Array.from(
      interaction.fields.getUploadedFiles("inventory_media", false)?.values() ?? []);
    if (uploaded.length > 1 || (uploaded.length === 1) === Boolean(values.videoUrl)) {
      throw new UserFacingError("Choose exactly one video file or one video link for the inventory import.");
    }
    const post = await importInventoryForMember(interaction, {
      owner, video: uploaded[0] ?? null,
      videoUrl: values.videoUrl, importedById: interaction.user.id,
    });
    await Promise.allSettled([
      ensureProfileCard(interaction.guild, owner.user, { refresh: true }),
      refreshTradingPostCard(interaction.guild, ownerId),
    ]).then(results => results.forEach((result, index) => {
      if (result.status === "rejected") {
        console.warn("[Admin import] Could not refresh member " +
          (index === 0 ? "profile" : "Trading Post") + " card:", result.reason);
      }
    }));
    await interaction.editReply({
      content: "Imported inventory video for <@" + ownerId + ">: " + post.url +
        "\nTheir profile and Trading Post can link to it. They retain control of their inventory entry.",
      allowedMentions: { parse: [] },
    });
    return true;
  }
  if (type === "trading") {
    const post = await importTradingPostForMember(interaction, {
      owner, ...values, importedById: interaction.user.id,
    });
    await ensureProfileCard(interaction.guild, owner.user, { refresh: true }).catch(error =>
      console.warn("[Admin import] Could not refresh member profile:", error));
    await interaction.editReply({
      content: "Imported Trading Post for <@" + ownerId + ">: " + post.url +
        "\nThey now own the card and can edit it, manage interest DMs, or delete it.",
      allowedMentions: { parse: [] },
    });
    return true;
  }

  const uploads = Array.from(
    interaction.fields.getUploadedFiles(info.mediaField, true)?.values() ?? [],
  );
  if (type === "house") validateHouseCreationUploads(uploads);
  else validateOutfitCreationUploads(uploads);

  const channel = await getConfiguredTextChannel(interaction, info.channelField, info.label);
  let post;
  try {
    post = await channel.send({
      content: typeName(type) + " listing for " + owner.displayName + " — preparing import...",
      allowedMentions: { parse: [] },
    });
    const result = type === "house"
      ? await publishHouseListing(interaction, values, post, uploads, {
        ownerId, importedById: interaction.user.id,
      })
      : await publishOutfitListing(interaction, values, post, uploads, {
        ownerId, importedById: interaction.user.id,
      });
    // The normal creation renderer places user-selected videos ABOVE the card.
    const complete = type === "house"
      ? result.styled && result.metadataSaved && result.videosSaved
      : result.galleryReady;
    const ensure = type === "house" ? ensureHouseEntry : ensureOutfitEntry;
    await ensure(interaction.guild, channel, { moveToBottom: true }).catch(error =>
      console.warn("[Admin import] Could not reposition channel entry:", error));
    // A member's existing Trading Post should reflect the imported listing
    // just as it does after the member posts normally. A refresh failure is
    // optional and must not invalidate a successfully published import.
    await refreshTradingPostCard(interaction.guild, ownerId).catch(error =>
      console.warn("[Admin import] Could not refresh member Trading Post:", error));
    await interaction.editReply({
      content: complete
        ? "Imported " + type + " listing for <@" + ownerId + ">: " + post.url +
          "\nThey now own the listing and can edit, customize, receive interest and remove it."
        : "The " + type + " was posted for <@" + ownerId + ">: " + post.url +
          "\n⚠️ One or more media or card checks need review. The saved post and archived files were preserved. Check logs before retrying.",
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    if (!post) throw error;
    // A Discord timeout or crashed upload may have reached the server already.
    // Never automatically delete or reset a post that may contain the only
    // valid copy of imported media.
    console.error("[Admin import] Publication interrupted; retained post for review:", post.id, error);
    await interaction.editReply({
      content: "⚠️ The " + type + " import was interrupted. The pending post was retained at " +
        post.url + " to protect possible saved media. Have a manager check that post and " +
        "the bot logs before trying another import; do not submit the same uploads twice.",
      allowedMentions: { parse: [] },
    });
  }
  return true;
}

function typeName(type) {
  return type === "house" ? "House" : "Outfit";
}
