import { ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits } from "discord.js";
import PendingForm from "../models/PendingForm.js";
import TradeListing from "../models/TradeListing.js";
import { UserFacingError } from "./errors.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";


// A form is either being published or removed, never both. The same
// in-memory lock protects all three form types against competing clicks.
const activeFormOperations = new Set();
const formKey = (guildId, channelId, messageId) => `${guildId}:${channelId}:${messageId}`;
export function claimPendingFormOperation(guildId, channelId, messageId) {
  const key = formKey(guildId, channelId, messageId);
  if (activeFormOperations.has(key)) return false;
  activeFormOperations.add(key);
  return true;
}
export function releasePendingFormOperation(guildId, channelId, messageId) {
  activeFormOperations.delete(formKey(guildId, channelId, messageId));
}

export function addRemoveFormButton(row, type, ownerId) {
  if (!["house", "outfit", "trade"].includes(type)) throw new Error("Invalid form type");
  return row.addComponents(
    new ButtonBuilder()
      .setCustomId(`form:remove:${type}:${ownerId}`)
      .setLabel("Remove form")
      .setStyle(ButtonStyle.Danger),
  );
}

export async function handleRemovePendingForm(interaction, {
  FormModel = PendingForm,
  ListingModels = { house: HouseListing, outfit: OutfitListing, trade: TradeListing },
  forget = () => {},
} = {}) {
  const [, action, type, ownerId] = interaction.customId.split(":");
  if (action !== "remove" || !["house", "outfit", "trade"].includes(type) ||
      !/^\d{17,20}$/.test(ownerId ?? "")) {
    throw new UserFacingError("That form removal button is invalid.");
  }
  if (interaction.user.id !== ownerId &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserFacingError("Only the original author or a server manager can remove this form.");
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId, channelId = interaction.channelId;
  const messageId = interaction.message?.id;
  if (!guildId || !channelId || !messageId ||
      !claimPendingFormOperation(guildId, channelId, messageId)) {
    throw new UserFacingError("This form is being submitted or handled right now. Try again after it finishes.");
  }
  try {
    if (interaction.message.author?.id !== interaction.client.user.id) {
      throw new UserFacingError("I can only remove unfinished forms posted by this bot.");
    }
    const pending = await FormModel.findOne({ guildId, channelId, messageId, ownerId, type });
    if (!pending) throw new UserFacingError("This form is no longer awaiting details.");
    const createId = `${type}:new:${ownerId}`;
    const isUnfinished = (interaction.message.components ?? [])
      .flatMap(row => row.components ?? [])
      .some(button => (button.customId || button.custom_id || "").startsWith(createId));
    if (!isUnfinished) throw new UserFacingError("This post is no longer an unfinished form.");
    // Never remove an already-published post or recoverable media staging
    // merely because its original button ID was cached in Mongo.
    const existing = await ListingModels[type].exists({
      guildId, postChannelId: channelId, postMessageId: messageId,
    });
    if (existing) throw new UserFacingError(
      "This post has a saved listing or an interrupted upload. Its media must be reviewed before removal.",
    );
    await interaction.message.delete();
    await FormModel.deleteOne({ _id: pending._id, guildId, channelId, messageId });
    forget(type, guildId, ownerId, messageId, channelId);
    await interaction.editReply({ content: "The unfinished form was removed. You can start a new one whenever you're ready." });
  } finally {
    releasePendingFormOperation(guildId, channelId, messageId);
  }
}

export async function trackPendingForm({
  guildId,
  ownerId,
  channelId,
  messageId,
  type,
  expiresAt = null,
}) {
  return PendingForm.create({
    guildId,
    ownerId,
    channelId,
    messageId,
    type,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  });
}

export async function clearPendingForm(guildId, channelId, messageId) {
  await PendingForm.deleteOne({ guildId, channelId, messageId });
}

export async function getPendingFormStatus(guild, pendingForm) {
  let message;
  try {
    const channel = await guild.channels.fetch(pendingForm.channelId);
    if (!channel?.messages) {
      await clearPendingForm(guild.id, pendingForm.channelId, pendingForm.messageId);
      return "stale";
    }
    message = await channel.messages.fetch(pendingForm.messageId);
  } catch (error) {
    if (![10003, 10008].includes(Number(error?.code))) throw error;
    await clearPendingForm(guild.id, pendingForm.channelId, pendingForm.messageId);
    return "stale";
  }

  if (message.author?.id !== guild.client.user.id) {
    await clearPendingForm(guild.id, pendingForm.channelId, pendingForm.messageId);
    return "stale";
  }
  const prefix = `${pendingForm.type}:new:${pendingForm.ownerId}`;
  const createButton = message.components
    .flatMap((row) => row.components)
    .find((component) => component.customId?.startsWith(prefix));
  if (!createButton) {
    await clearPendingForm(guild.id, pendingForm.channelId, pendingForm.messageId);
    return "stale";
  }
  // Even if a Discord form button was restored, saved photo/video staging
  // takes precedence: a second /house or /outfit must not discard those files.
  const Model = pendingForm.type === "house" ? HouseListing
    : pendingForm.type === "outfit" ? OutfitListing : null;
  if (Model && await Model.exists({
    guildId: guild.id, postChannelId: pendingForm.channelId,
    postMessageId: pendingForm.messageId, publicationState: "staging",
  })) return "submitting";
  return createButton.disabled ? "submitting" : "active";
}

export async function discardPendingForm(guild, pendingForm) {
  const Model = pendingForm.type === "house" ? HouseListing
    : pendingForm.type === "outfit" ? OutfitListing : null;
  if (Model && await Model.exists({
    guildId: guild.id, postChannelId: pendingForm.channelId,
    postMessageId: pendingForm.messageId, publicationState: "staging",
  })) throw new UserFacingError(
    "This form has saved media from an interrupted upload. A server manager must review it before removal.",
  );
  try {
    const channel = await guild.channels.fetch(pendingForm.channelId);
    const message = await channel?.messages?.fetch(pendingForm.messageId);
    const prefix = `${pendingForm.type}:new:${pendingForm.ownerId}`;
    const isFormMessage = message?.components
      .flatMap((row) => row.components)
      .some((component) => component.customId?.startsWith(prefix));
    if (isFormMessage && message.author?.id === guild.client.user.id) await message.delete();
  } catch (error) {
    if (![10003, 10008].includes(Number(error?.code))) throw error;
  }

  await clearPendingForm(guild.id, pendingForm.channelId, pendingForm.messageId);
}

function hasCreateButton(message, pendingForm) {
  const prefix = `${pendingForm.type}:new:${pendingForm.ownerId}`;
  return message?.components
    .flatMap((row) => row.components)
    .some((component) => component.customId?.startsWith(prefix));
}

export async function cleanupPendingForms(guild) {
  const pendingForms = await PendingForm.find({ guildId: guild.id }).lean();
  let removedCount = 0;

  for (const pendingForm of pendingForms) {
    let channel;
    let message;
    try {
      channel = await guild.channels.fetch(pendingForm.channelId);
      message = await channel?.messages?.fetch(pendingForm.messageId);
      if (hasCreateButton(message, pendingForm)) {
        const PublishingModel = pendingForm.type === "house" ? HouseListing
          : pendingForm.type === "outfit" ? OutfitListing : null;
        const staged = PublishingModel
          ? await PublishingModel.exists({
            guildId: guild.id, postChannelId: pendingForm.channelId,
            postMessageId: pendingForm.messageId, publicationState: "staging",
          }) : null;
        if (staged) {
          // A saved staging record may contain archived photos/videos.
          // Never treat it as an ordinary abandoned empty form.
          console.warn("[Pending form] Retaining interrupted submission for manual recovery",
            pendingForm.type, pendingForm.messageId);
          continue;
        }
        if (message.author?.id === guild.client.user.id) await message.delete();
      }
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) {
        console.error(
          `Could not clean up pending ${pendingForm.type} form ${pendingForm.messageId}:`,
          error,
        );
        continue;
      }
    }

    await PendingForm.deleteOne({ _id: pendingForm._id });
    removedCount += 1;
  }

  if (removedCount) {
    console.log(`Removed ${removedCount} unfinished listing or trade form(s) in guild ${guild.id}.`);
  }
}
