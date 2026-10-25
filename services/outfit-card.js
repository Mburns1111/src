import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import OutfitListing from "../models/OutfitListing.js";
import UserProfile from "../models/UserProfile.js";
import { displayListingAppearance } from "./listing-appearance.js";
import { getAppearanceOwnership } from "./appearance-ownership.js";
import { outfitCardData, outfitPhotoUrl } from "./outfit-style.js";
import { renderPostImage } from "./post-renderer.js";
import { discordMessageUrl } from "../commands/shared.js";

const activeRefreshes = new Map();
const STYLE_IMAGE_NAME = "outfit-style-card.png";

/**
 * A style card is sent as a BOT REPLY to the original outfit listing.
 * The original listing retains all its photos/videos (up to 10) and its
 * sold/interest/media controls, without spending an attachment slot on PNG art.
 * One saved reply ID per outfit guarantees each outfit can look different.
 */
export async function refreshOutfitStyleCard(guild, listing) {
  const key = `${guild.id}:${String(listing._id)}`;
  if (activeRefreshes.has(key)) return activeRefreshes.get(key);
  const task = (async () => {
    if (listing.status !== "active" || !listing.postChannelId || !listing.postMessageId) {
      throw new Error("This outfit listing has not been published or is no longer active.");
    }
    const channel = await guild.channels.fetch(listing.postChannelId);
    if (!channel?.messages || typeof channel.send !== "function") {
      throw new Error("The outfit listing channel is not available.");
    }
    // Do not create orphaned style cards for deleted or old listing messages.
    await channel.messages.fetch(listing.postMessageId);
    const [ownership, profile] = await Promise.all([
      getAppearanceOwnership(guild.id, listing.ownerId),
      UserProfile.findOne({ guildId: guild.id, discordUserId: listing.ownerId }),
    ]);
    const png = await renderPostImage({
      type: "outfit",
      data: outfitCardData(listing),
      images: { photo: outfitPhotoUrl(listing) },
      appearance: displayListingAppearance(listing, profile, ownership),
    });
    const payload = {
      content: `**Outfit style card · ${String(listing.title).slice(0, 90)}**\n[View original listing & gallery](${discordMessageUrl(guild.id, listing.postChannelId, listing.postMessageId)})`,
      embeds: [new EmbedBuilder().setColor(0x819287).setImage(`attachment://${STYLE_IMAGE_NAME}`)],
      files: [new AttachmentBuilder(png, { name: STYLE_IMAGE_NAME })],
      attachments: [],
      allowedMentions: { parse: [], repliedUser: false },
    };
    let message = null;
    if (listing.styleCardMessageId) {
      try {
        const existing = await channel.messages.fetch(listing.styleCardMessageId);
        if (existing.author?.id === guild.client.user.id) {
          message = await existing.edit(payload);
        }
      } catch (error) {
        if (![10003, 10008].includes(Number(error?.code))) throw error;
      }
    }
    if (!message) {
      message = await channel.send({
        ...payload,
        reply: { messageReference: listing.postMessageId, failIfNotExists: true },
      });
    }
    if (listing.styleCardMessageId !== message.id) {
      await OutfitListing.updateOne({
        _id: listing._id, guildId: guild.id, ownerId: listing.ownerId,
        postMessageId: listing.postMessageId, status: "active",
      }, { $set: { styleCardMessageId: message.id } });
      listing.styleCardMessageId = message.id;
    }
    return message;
  })();
  activeRefreshes.set(key, task);
  try {
    return await task;
  } finally {
    if (activeRefreshes.get(key) === task) activeRefreshes.delete(key);
  }
}

export async function deleteOutfitStyleCard(guild, listing) {
  if (!listing.styleCardMessageId) return;
  try {
    const channel = await guild.channels.fetch(listing.postChannelId);
    const message = await channel?.messages?.fetch(listing.styleCardMessageId);
    if (message?.author?.id === guild.client.user.id) await message.delete();
  } catch (error) {
    if (![10003, 10008].includes(Number(error?.code))) {
      console.warn("Could not delete outfit style card:", error);
    }
  }
}
