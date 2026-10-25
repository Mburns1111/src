import { AttachmentBuilder, EmbedBuilder } from "discord.js";
import OutfitListing from "../models/OutfitListing.js";
import UserProfile from "../models/UserProfile.js";
import { displayListingAppearance } from "./listing-appearance.js";
import { getAppearanceOwnership } from "./appearance-ownership.js";
import { outfitCardData } from "./outfit-style.js";
import { outfitActionComponents } from "./outfit-controls.js";
import { renderListingCardCached } from "./listing-render-cache.js";
import { isGalleryVideo, mergeOriginalMedia } from "./outfit-gallery-utils.js";
import { ensureGalleryArchived, getOutfitGalleryPage } from "./outfit-gallery.js";

const CARD_FILE = "outfit-style-card.png";
const activeRefreshes = new Map();

export function unifiedOutfitPayload(listing, photoPage, videos, png) {
  const videoLink = listing.videoUrl ? `\n[Outfit video](${listing.videoUrl})` : "";
  return {
    content: `Outfit listing from ${listing.ownerName}${videoLink}`,
    embeds: [new EmbedBuilder().setColor(0x819287)
      .setImage(`attachment://${CARD_FILE}`)],
    files: [new AttachmentBuilder(png, { name: CARD_FILE })],
    // Never remove videos to make space for the decorated photo card.
    attachments: videos.map(item => ({ id: item.id })),
    components: outfitActionComponents(listing, photoPage.count),
    allowedMentions: { parse: [] },
  };
}

/**
 * Delete old bot-owned gallery, controls and separate art replies only AFTER
 * the original message has been successfully rendered and edited.
 *
 * Keep IDs for cleanup retries if deletion fails or the message belongs to
 * another bot. Never erase evidence of a legacy message that is still present.
 */
export async function deleteLegacyOutfitMessages(guild, listing) {
  const fields = ["galleryMessageId", "controlsMessageId", "styleCardMessageId"];
  const channel = await guild.channels.fetch(listing.postChannelId);
  if (!channel?.messages) return;
  const updates = {};
  const visited = new Set();
  for (const field of fields) {
    const id = listing[field];
    if (!id || id === listing.postMessageId) continue;
    if (visited.has(id)) {
      updates[field] = "";
      continue;
    }
    visited.add(id);
    try {
      const old = await channel.messages.fetch(id);
      if (old.author?.id !== guild.client.user.id) {
        console.warn("[Outfit] Skipping another bot's legacy message", field, id);
        continue;
      }
      await old.delete();
      updates[field] = "";
    } catch (error) {
      if ([10003, 10008].includes(Number(error?.code))) updates[field] = "";
      else console.warn("[Outfit] Could not clean up legacy message", field, id, error);
    }
  }
  if (Object.keys(updates).length) {
    await OutfitListing.updateOne(
      { _id: listing._id, guildId: guild.id, ownerId: listing.ownerId },
      { $set: updates },
    );
    Object.assign(listing, updates);
  }
}

/**
 * Render a COMPLETE outfit advert into the original bot post: styling,
 * one gallery photo (or video placeholder) and buttons. The photo changes
 * on Previous/Next, not the member's saved appearance.
 *
 * Calls for the same listing are serialized. This keeps rapid button clicks
 * and restyles from overwriting each other with an older gallery page.
 */
export async function refreshOutfitStyleCard(guild, listing) {
  const key = `${guild.id}:${String(listing._id)}`;
  const previous = activeRefreshes.get(key) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(async () => {
    // Load latest page and appearance; queued requests must not use a stale
    // object captured before another gallery navigation or style save.
    const current = await OutfitListing.findOne({
      _id: listing._id, guildId: guild.id, ownerId: listing.ownerId,
      status: "active",
    });
    if (!current?.postChannelId || !current.postMessageId) {
      throw new Error("Outfit listing is not active or has no published message.");
    }
    const channel = await guild.channels.fetch(current.postChannelId);
    if (!channel?.messages) throw new Error("Outfit listing channel is unavailable.");
    const message = await channel.messages.fetch(current.postMessageId);
    if (message.author?.id !== guild.client.user.id) {
      throw new Error("Cannot edit an outfit listing not authored by this bot.");
    }

    // Fail CLOSED on inaccessible historical source photos. The existing
    // banner, controls, old gallery and attachments must remain untouched.
    const { sources } = await ensureGalleryArchived(guild, current, message);
    const photoPage = await getOutfitGalleryPage(
      guild.id, current._id, current.galleryPageIndex ?? 0,
    );
    if ((current.galleryPageIndex ?? 0) !== photoPage.page) {
      current.galleryPageIndex = photoPage.page;
      await OutfitListing.updateOne({ _id: current._id, guildId: guild.id },
        { $set: { galleryPageIndex: photoPage.page } });
    }
    const merged = mergeOriginalMedia(current.mediaAttachments, sources);
    if (merged.length > (current.mediaAttachments?.length ?? 0)) {
      current.mediaAttachments = merged;
      await current.save();
    }

    const videos = Array.from(message.attachments.values()).filter(isGalleryVideo);
    if (videos.length > 9) {
      throw new Error("This listing has ten videos; cannot replace attachments safely.");
    }

    const [profile, ownership] = await Promise.all([
      UserProfile.findOne({ guildId: guild.id, discordUserId: current.ownerId }),
      getAppearanceOwnership(guild.id, current.ownerId),
    ]);
    const png = await renderListingCardCached({
      type: "outfit",
      data: {
        ...outfitCardData(current),
        galleryIndex: photoPage.count ? photoPage.page + 1 : 0,
        galleryCount: photoPage.count,
      },
      images: { photo: photoPage.imageBuffer },
      appearance: displayListingAppearance(current, profile, ownership),
    });

    // A single Discord edit is the transition boundary. Only videos are
    // kept as native attachments; source photos are safe in Mongo by now.
    const updated = await message.edit(unifiedOutfitPayload(current, photoPage, videos, png));
    const retainedIds = new Set(Array.from(updated.attachments.values())
      .filter(isGalleryVideo).map(item => item.id));
    if (!videos.every(item => retainedIds.has(item.id))) {
      throw new Error("Discord failed to preserve existing outfit videos.");
    }
    await deleteLegacyOutfitMessages(guild, current);
    return updated;
  });
  activeRefreshes.set(key, job);
  try { return await job; }
  finally { if (activeRefreshes.get(key) === job) activeRefreshes.delete(key); }
}

// Maintains compatibility with older callers of the separate style reply.
export const deleteOutfitStyleCard = deleteLegacyOutfitMessages;
