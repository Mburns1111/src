import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { safePageIndex } from "./outfit-gallery-utils.js";

/**
 * The styled card, selected outfit photo and all actions share ONE message.
 * Discord renders each button row under the image, giving one cohesive post.
 * The disabled count label is informational and cannot trigger an action.
 */
export function outfitActionComponents(listing, photoCount = 0) {
  const rows = [];
  if (photoCount > 1) {
    const page = safePageIndex(listing.galleryPageIndex ?? 0, photoCount);
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`outfit:page:prev:${String(listing._id)}`)
        .setLabel("◀ Previous").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`outfit:page:label:${String(listing._id)}`)
        .setLabel(`Photo ${page + 1} / ${photoCount}`)
        .setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`outfit:page:next:${String(listing._id)}`)
        .setLabel("Next ▶").setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`outfit:page:choose:${String(listing._id)}`)
        .setLabel("Choose photo").setStyle(ButtonStyle.Secondary),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`outfit:interest:${String(listing._id)}`)
      .setLabel(`Interested (${listing.interestedUserIds?.length ?? 0})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`outfit:notify:${String(listing._id)}`)
      .setLabel(`Interest DMs: ${listing.notifyOnInterest ? "On" : "Off"}`)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`outfit:sold:${String(listing._id)}`)
      .setLabel("Remove listing").setStyle(ButtonStyle.Danger),
  ));
  return rows;
}
