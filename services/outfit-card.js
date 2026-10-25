import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import OutfitListing from "../models/OutfitListing.js";
import UserProfile from "../models/UserProfile.js";
import { displayListingAppearance } from "./listing-appearance.js";
import { getAppearanceOwnership } from "./appearance-ownership.js";
import {
  outfitCardData, outfitPhotoUrls, outfitGalleryMedia, outfitStylePlacement,
  OUTFIT_STYLE_IMAGE_NAME,
} from "./outfit-style.js";
import { renderPostImage } from "./post-renderer.js";
import { discordMessageUrl } from "../commands/shared.js";

const activeRefreshes = new Map();

function originalListingEmbed(listing, firstImageName = null) {
  const fields = [];
  if (listing.cost) fields.push({ name: "Cost", value: listing.cost, inline: true });
  fields.push({
    name: "Seller",
    value: `Discord: ${listing.ownerName}\nRoblox: ${listing.ownerRobloxUsername || "Not added yet"}`,
    inline: true,
  });
  const embed = new EmbedBuilder()
    .setColor(0xe879a8)
    .setTitle(listing.title).setDescription(listing.description)
    .addFields(fields)
    .setFooter({ text: `Listing ${String(listing._id).slice(-8)}` })
    .setTimestamp(listing.createdAt);
  if (listing.videoUrl) embed.addFields({ name: "Outfit video", value: `<${listing.videoUrl}>` });
  if (firstImageName) embed.setImage(`attachment://${firstImageName}`);
  return embed;
}

const isPhoto = item => item.contentType?.toLowerCase().startsWith("image/") ||
  /\.(png|jpe?g|gif|webp|avif)$/i.test(item.name || "");

// Pure payload builders keep every original attachment ID intact, while
// removing only a previously generated outfit-style-card.png during repaint.
export function originalStyledOutfitEdit(listing, media, png) {
  if (outfitStylePlacement(media.length) !== "original") {
    throw new RangeError("Cannot add style artwork to a full outfit gallery.");
  }
  return {
    content: `Outfit listing from ${listing.ownerName}`,
    embeds: [
      new EmbedBuilder().setColor(0x819287)
        .setImage(`attachment://${OUTFIT_STYLE_IMAGE_NAME}`),
      originalListingEmbed(listing),
    ],
    attachments: media.map(({ id }) => ({ id })),
    files: [new AttachmentBuilder(png, { name: OUTFIT_STYLE_IMAGE_NAME })],
    allowedMentions: { parse: [] },
  };
}

export function fullGalleryOutfitEdit(listing, media) {
  if (outfitStylePlacement(media.length) !== "reply") {
    throw new RangeError("A separate style card is only needed for ten media files.");
  }
  return {
    embeds: [originalListingEmbed(listing, media.find(isPhoto)?.name)],
    attachments: media.map(({ id }) => ({ id })),
    allowedMentions: { parse: [] },
  };
}

async function updateSeparateReply(channel, listing, png, guild) {
  const payload = {
    content: `**Outfit style card · ${String(listing.title).slice(0, 90)}**\n[View original listing & gallery](${discordMessageUrl(guild.id, listing.postChannelId, listing.postMessageId)})`,
    embeds: [new EmbedBuilder().setColor(0x819287).setImage(`attachment://${OUTFIT_STYLE_IMAGE_NAME}`)],
    files: [new AttachmentBuilder(png, { name: OUTFIT_STYLE_IMAGE_NAME })],
    attachments: [],
    allowedMentions: { parse: [], repliedUser: false },
  };
  if (listing.styleCardMessageId) {
    try {
      const existing = await channel.messages.fetch(listing.styleCardMessageId);
      if (existing.author?.id === guild.client.user.id) return await existing.edit(payload);
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) throw error;
    }
  }
  const message = await channel.send({
    ...payload,
    reply: { messageReference: listing.postMessageId, failIfNotExists: true },
  });
  await OutfitListing.updateOne({
    _id: listing._id, guildId: guild.id, ownerId: listing.ownerId,
    postMessageId: listing.postMessageId, status: "active",
  }, { $set: { styleCardMessageId: message.id } });
  listing.styleCardMessageId = message.id;
  return message;
}

/**
 * For 0–9 gallery files, the actual outfit listing displays the decorative PNG
 * AND retains every uploaded media attachment by ID. The original interaction
 * buttons are not touched. For ten files, a separate reply is the safe
 * fallback: Discord's ten-attachment limit must never delete customer uploads.
 */
export async function refreshOutfitStyleCard(guild, listing) {
  const key = `${guild.id}:${String(listing._id)}`;
  if (activeRefreshes.has(key)) return activeRefreshes.get(key);
  const task = (async () => {
    if (listing.status !== "active" || !listing.postChannelId || !listing.postMessageId) {
      throw new Error("This outfit listing is not active or has no public message.");
    }
    const channel = await guild.channels.fetch(listing.postChannelId);
    if (!channel?.messages || typeof channel.send !== "function") {
      throw new Error("The outfit listing channel is unavailable.");
    }
    const original = await channel.messages.fetch(listing.postMessageId);
    if (original.author?.id !== guild.client.user.id) {
      throw new Error("Cannot change an outfit listing not authored by this bot.");
    }
    const media = outfitGalleryMedia(original.attachments.values());
    if (listing.mediaAttachments?.length > media.length) {
      // Never blindly recreate missing files or overwrite archived metadata.
      console.warn(`[Outfit] ${listing._id} has ${listing.mediaAttachments.length} saved media but ${media.length} Discord attachments; inspect the original post before cleanup.`);
    }
    const [ownership, profile] = await Promise.all([
      getAppearanceOwnership(guild.id, listing.ownerId),
      UserProfile.findOne({ guildId: guild.id, discordUserId: listing.ownerId }),
    ]);
    const photos = outfitPhotoUrls({ mediaAttachments: media });
    const png = await renderPostImage({
      type: "outfit",
      data: outfitCardData(listing),
      images: { photo: photos[0], photo2: photos[1], photo3: photos[2] },
      appearance: displayListingAppearance(listing, profile, ownership),
    });
    const savedIds = media.map(item => item.id);
    const placement = outfitStylePlacement(media.length);
    if (placement === "original") {
      const message = await original.edit(originalStyledOutfitEdit(listing, media, png));
      const after = new Set(outfitGalleryMedia(message.attachments.values()).map(item => item.id));
      if (!savedIds.every(id => after.has(id))) {
        throw new Error("Discord did not retain all outfit gallery attachments while updating style.");
      }
      if (listing.styleCardMessageId) {
        await deleteOutfitStyleCard(guild, listing);
        await OutfitListing.updateOne({ _id: listing._id, guildId: guild.id }, {
          $set: { styleCardMessageId: "" },
        });
        listing.styleCardMessageId = "";
      }
      return message;
    }
    // Full gallery: leave all ten buyer uploads on the original and render
    // the decorative style as an attached reply rather than removing a photo.
    await original.edit(fullGalleryOutfitEdit(listing, media));
    return updateSeparateReply(channel, listing, png, guild);
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
      console.warn("Could not delete outfit style reply:", error);
    }
  }
}
