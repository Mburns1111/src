import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { safePageIndex } from "./house-style.js";
export function houseActionComponents(listing, photoCount = 0) {
  const rows = [];
  if (photoCount > 1) {
    const current = safePageIndex(listing.galleryPageIndex ?? 0, photoCount);
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`house:page:prev:${String(listing._id)}`)
        .setLabel("◀ Previous").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`house:page:label:${String(listing._id)}`)
        .setLabel(`Photo ${current + 1} / ${photoCount}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId(`house:page:next:${String(listing._id)}`)
        .setLabel("Next ▶").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`house:page:choose:${String(listing._id)}`)
        .setLabel("Choose photo").setStyle(ButtonStyle.Secondary),
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`house:sold:${String(listing._id)}`)
      .setLabel("Mark sold").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`house:interest:${String(listing._id)}`)
      .setLabel(`Interested (${listing.interestedUserIds?.length ?? 0})`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`house:notify:${String(listing._id)}`)
      .setLabel(`Interest DMs: ${listing.notifyOnInterest ? "On" : "Off"}`).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`house:edit:${String(listing._id)}`)
      .setLabel("Edit details").setStyle(ButtonStyle.Secondary),
  ));
  return rows;
}
