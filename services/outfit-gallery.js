import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import OutfitGalleryImage from "../models/OutfitGalleryImage.js";
import OutfitListing from "../models/OutfitListing.js";
import { UserFacingError } from "../commands/errors.js";
import { discordMessageUrl } from "../commands/shared.js";
import {
  GALLERY_HEIGHT, GALLERY_WIDTH, GALLERY_JPEG_QUALITY, GALLERY_PAGE_NAME,
  MAX_IMAGE_BYTES, MAX_GALLERY_MEDIA, galleryNavigationButtons, isGalleryPhoto,
  isGalleryMedia, mergeOriginalMedia, safePageIndex,
} from "./outfit-gallery-utils.js";

const activeUpdates = new Map();
const fileName = GALLERY_PAGE_NAME;

function safeDiscordSource(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      (parsed.hostname === "cdn.discordapp.com" ||
       parsed.hostname === "media.discordapp.net" ||
       parsed.hostname.endsWith(".discordapp.com") ||
       parsed.hostname.endsWith(".discordapp.net"));
  } catch {
    return false;
  }
}

async function fetchOriginalPhoto(asset) {
  if (!safeDiscordSource(asset.url)) {
    throw new UserFacingError("A saved outfit photo does not have a valid Discord attachment URL.");
  }
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Could not access outfit photo ${asset.name}: HTTP ${response.status}`);
  if (Number(response.headers.get("content-length") || 0) > MAX_IMAGE_BYTES) {
    throw new UserFacingError("Outfit images must be no larger than 24 MB before resizing.");
  }
  const raw = Buffer.from(await response.arrayBuffer());
  if (!raw.length || raw.length > MAX_IMAGE_BYTES) {
    throw new UserFacingError("An outfit photo is too large to resize safely.");
  }
  return raw;
}

export async function resizeOutfitImage(bytes) {
  const image = await loadImage(bytes);
  if (!image.width || !image.height || image.width > 12000 || image.height > 12000) {
    throw new UserFacingError("An outfit image has unsupported dimensions.");
  }
  const factor = Math.min(1, GALLERY_WIDTH / image.width, GALLERY_HEIGHT / image.height);
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return Buffer.from(await canvas.encode("jpeg", GALLERY_JPEG_QUALITY));
}

export async function saveOutfitGalleryImages(guildId, listing, sources) {
  const candidates = sources.filter(isGalleryPhoto);
  const seen = new Set();
  let nextIndex = (await OutfitGalleryImage.findOne({
    guildId, listingId: listing._id,
  }).sort({ originalIndex: -1 }).select("originalIndex").lean())?.originalIndex + 1 || 0;

  for (const asset of candidates) {
    const sourceId = String(asset.attachmentId || asset.id || "");
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    if (await OutfitGalleryImage.exists({ guildId, listingId: listing._id, sourceId })) continue;
    const current = await OutfitGalleryImage.countDocuments({ guildId, listingId: listing._id });
    if (current >= MAX_GALLERY_MEDIA) throw new UserFacingError("Outfit listings can hold up to ten photos/videos.");
    const encoded = await resizeOutfitImage(await fetchOriginalPhoto(asset));
    // Save BEFORE removing any raw attachment. A failed write leaves original
    // media untouched, including on legacy multi-photo listings.
    await OutfitGalleryImage.updateOne({
      guildId, listingId: listing._id, sourceId,
    }, {
      $setOnInsert: {
        guildId, listingId: listing._id, ownerId: listing.ownerId,
        sourceId, name: asset.name || "Outfit photo",
        imageData: encoded, originalIndex: nextIndex,
      },
    }, { upsert: true });
    nextIndex += 1;
  }
  const stored = await OutfitGalleryImage.countDocuments({ guildId, listingId: listing._id });
  // Check all candidate photo IDs have their own saved image. Never remove
  // even one original photo if any conversion was unsuccessful.
  const distinctIds = [...seen];
  const saved = await OutfitGalleryImage.countDocuments({
    guildId, listingId: listing._id, sourceId: { $in: distinctIds },
  });
  if (saved !== distinctIds.length) {
    throw new Error("Not all outfit photos were archived. Original Discord photos must be retained.");
  }
  return stored;
}

export async function outfitGalleryCount(guildId, listingId) {
  return OutfitGalleryImage.countDocuments({ guildId, listingId });
}

export function galleryMessagePayload(listing, page, total) {
  const index = safePageIndex(page, total);
  const buttons = galleryNavigationButtons(index, total);
  return {
    content: `**📷 ${String(listing.title).slice(0, 88)} · Outfit gallery**\nPhoto **${index + 1} / ${total}** · [Back to styled listing](${discordMessageUrl(listing.guildId, listing.postChannelId, listing.postMessageId)})`,
    embeds: [new EmbedBuilder().setColor(0x819287).setImage(`attachment://${fileName}`)],
    components: total > 1 ? [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`outfit:gallery:prev:${listing._id}`)
        .setLabel("◀ Previous").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`outfit:gallery:next:${listing._id}`)
        .setLabel("Next ▶").setStyle(ButtonStyle.Primary),
    )] : [],
    files: [], attachments: [], allowedMentions: { parse: [], repliedUser: false },
  };
}

async function galleryImage(guildId, listingId, page) {
  const images = await OutfitGalleryImage.find({ guildId, listingId })
    .sort({ originalIndex: 1, _id: 1 })
    .select("imageData name").lean();
  const doc = images[safePageIndex(page, images.length)];
  return { doc, count: images.length };
}

export async function ensureOutfitGallery(guild, listing) {
  const key = `${guild.id}:${listing._id}`;
  if (activeUpdates.has(key)) return activeUpdates.get(key);
  const task = (async () => {
    const channel = await guild.channels.fetch(listing.postChannelId);
    if (!channel?.messages) throw new Error("Outfit gallery channel is unavailable.");
    const { doc, count } = await galleryImage(guild.id, listing._id, listing.galleryPageIndex || 0);
    if (!count || !doc?.imageData) return null;
    const page = safePageIndex(listing.galleryPageIndex || 0, count);
    const payload = galleryMessagePayload(listing, page, count);
    payload.files = [new AttachmentBuilder(doc.imageData, { name: fileName })];
    let existing = null;
    if (listing.galleryMessageId) {
      existing = await channel.messages.fetch(listing.galleryMessageId).catch(() => null);
    }
    let message;
    if (existing?.author?.id === guild.client.user.id) {
      message = await existing.edit(payload);
    } else {
      message = await channel.send({
        ...payload, reply: { messageReference: listing.postMessageId, failIfNotExists: true },
      });
    }
    if (listing.galleryMessageId !== message.id || listing.galleryPageIndex !== page) {
      await OutfitListing.updateOne({
        _id: listing._id, guildId: guild.id, ownerId: listing.ownerId,
        status: "active",
      }, { $set: { galleryMessageId: message.id, galleryPageIndex: page } });
      listing.galleryMessageId = message.id;
      listing.galleryPageIndex = page;
    }
    return message;
  })();
  activeUpdates.set(key, task);
  try { return await task; }
  finally { if (activeUpdates.get(key) === task) activeUpdates.delete(key); }
}

export async function handleOutfitGalleryButton(interaction) {
  const [, area, direction, id] = interaction.customId.split(":");
  if (area !== "gallery" || !["prev", "next"].includes(direction) ||
      !/^[a-f\d]{24}$/i.test(id || "")) {
    throw new UserFacingError("This outfit photo control is invalid.");
  }
  await interaction.deferUpdate();
  if (!interaction.guildId) throw new UserFacingError("The outfit gallery belongs to a server.");
  const listing = await OutfitListing.findOne({
    _id: id, guildId: interaction.guildId, status: "active",
    galleryMessageId: interaction.message.id,
  });
  if (!listing) throw new UserFacingError("That outfit gallery is no longer active.");
  const count = await outfitGalleryCount(interaction.guildId, listing._id);
  if (!count) throw new UserFacingError("There are no gallery photos.");
  // Atomic increment avoids losing rapid user clicks; modulo normalizes
  // the result before rendering the shared gallery message.
  const result = await OutfitListing.findOneAndUpdate({
    _id: listing._id, guildId: interaction.guildId, status: "active",
  }, { $inc: { galleryPageIndex: direction === "next" ? 1 : -1 } }, { new: true });
  if (!result) return true;
  const page = safePageIndex(result.galleryPageIndex, count);
  result.galleryPageIndex = page;
  await OutfitListing.updateOne({ _id: result._id }, { $set: { galleryPageIndex: page } });
  await ensureOutfitGallery(interaction.guild, result);
  return true;
}

export async function deleteOutfitGallery(guild, listing) {
  if (listing.galleryMessageId) {
    try {
      const channel = await guild.channels.fetch(listing.postChannelId);
      const msg = await channel?.messages?.fetch(listing.galleryMessageId);
      if (msg?.author?.id === guild.client.user.id) await msg.delete();
    } catch (error) {
      if (![10003, 10008].includes(Number(error?.code))) console.warn("Outfit gallery cleanup failed:", error);
    }
  }
  // Images may be removed once the listing has been sold/removed and is no
  // longer accessible through the public gallery.
  await OutfitGalleryImage.deleteMany({ guildId: guild.id, listingId: listing._id });
}

export async function migrateStoredOutfitPhotos(guild, listing, originalMessage) {
  const originalPhotos = mergeOriginalMedia(
    listing.mediaAttachments, Array.from(originalMessage.attachments.values()),
  ).filter(isGalleryPhoto);
  await saveOutfitGalleryImages(guild.id, listing, originalPhotos);
  await ensureOutfitGallery(guild, listing);
}
