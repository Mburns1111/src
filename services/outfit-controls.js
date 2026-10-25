import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import OutfitListing from "../models/OutfitListing.js";
import { discordMessageUrl } from "../commands/shared.js";

/**
 * Outfit-specific actions deliberately live in a separate, LAST message.
 * A decorated banner and a flipbook cannot hold action buttons below each
 * other: Discord buttons always render immediately below their own message.
 */
export function outfitActionComponents(listing) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`outfit:sold:${String(listing._id)}`)
        .setLabel("Remove listing")
        .setStyle(ButtonStyle.Danger),
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

export function outfitActionsPayload(listing) {
  return {
    content: `**Outfit actions · ${String(listing.title).slice(0, 80)}**\n[View outfit banner](${discordMessageUrl(listing.guildId, listing.postChannelId, listing.postMessageId)})`,
    components: outfitActionComponents(listing),
    allowedMentions: { parse: [], repliedUser: false },
  };
}

const activeControls = new Map();

/**
 * Call only AFTER the gallery reply is available. The control message is
 * the third message for photo outfits, or second for video-only outfits.
 * Existing controls are edited in place, so saving an appearance or toggling
 * interest does not create duplicate controls messages.
 */
export async function ensureOutfitControls(guild, listing, { channel = null } = {}) {
  const key = `${guild.id}:${listing._id}`;
  if (activeControls.has(key)) return activeControls.get(key);
  const work = (async () => {
    if (!listing.postChannelId || !listing.postMessageId || listing.status !== "active") {
      throw new Error("Cannot publish controls on an unpublished outfit listing.");
    }
    const target = channel ?? await guild.channels.fetch(listing.postChannelId);
    if (!target?.messages || typeof target.send !== "function") {
      throw new Error("The outfit channel does not allow a controls message.");
    }
    const payload = outfitActionsPayload(listing);
    let existing = null;
    if (listing.controlsMessageId) {
      existing = await target.messages.fetch(listing.controlsMessageId).catch(error => {
        if ([10003, 10008].includes(Number(error?.code))) return null;
        throw error;
      });
    }
    let message;
    if (existing?.author?.id === guild.client.user.id) {
      message = await existing.edit(payload);
    } else {
      message = await target.send({
        ...payload,
        reply: { messageReference: listing.postMessageId, failIfNotExists: true },
      });
    }
    if (listing.controlsMessageId !== message.id) {
      await OutfitListing.updateOne({
        _id: listing._id, guildId: guild.id, ownerId: listing.ownerId,
        postMessageId: listing.postMessageId, status: "active",
      }, { $set: { controlsMessageId: message.id } });
      listing.controlsMessageId = message.id;
    }
    return message;
  })();
  activeControls.set(key, work);
  try { return await work; }
  finally { if (activeControls.get(key) === work) activeControls.delete(key); }
}

export async function deleteOutfitControls(guild, listing) {
  if (!listing.controlsMessageId) return;
  try {
    const channel = await guild.channels.fetch(listing.postChannelId);
    const message = await channel?.messages?.fetch(listing.controlsMessageId);
    if (message?.author?.id === guild.client.user.id) await message.delete();
  } catch (error) {
    if (![10003, 10008].includes(Number(error?.code))) {
      console.warn("Could not remove outfit controls:", error);
    }
  }
}
