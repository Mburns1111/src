import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } from "discord.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";
import { UserFacingError } from "./errors.js";

export const MEMBER_LISTING_PAGE_SIZE = 8;
const SNOWFLAKE = /^\d{17,20}$/;
const SAFE_TITLE = /[\\`*_{}\[\]()~>|#]/g;

function cleanTitle(raw) {
  const title = String(raw || "Untitled listing")
    .replace(/[\r\n\t]+/g, " ").slice(0, 75);
  return title.replace(SAFE_TITLE, "\\$&").replace(/@/g, "@\u200b");
}

export function directoryQuery(guildId, ownerId) {
  if (!SNOWFLAKE.test(String(guildId ?? "")) ||
      !SNOWFLAKE.test(String(ownerId ?? ""))) {
    throw new UserFacingError("Open My listings from your server.");
  }
  return {
    guildId, ownerId, status: "active",
    publicationState: { $ne: "staging" },
    postChannelId: { $type: "string", $ne: "" },
    postMessageId: { $type: "string", $ne: "" },
  };
}

export function makeMemberListingDirectory(type, guildId, ownerId, entries, count, page) {
  if (!["house", "outfit"].includes(type) ||
      !Number.isSafeInteger(count) || count < 0 ||
      !Number.isSafeInteger(page) || page < 0 ||
      !Array.isArray(entries)) {
    throw new UserFacingError("Unable to display your listing directory.");
  }
  const totalPages = Math.max(1, Math.ceil(count / MEMBER_LISTING_PAGE_SIZE));
  const shownPage = Math.min(page, totalPages - 1);
  const rows = entries.map((entry, offset) => {
    const title = cleanTitle(entry.title);
    const ordinal = shownPage * MEMBER_LISTING_PAGE_SIZE + offset + 1;
    if (!SNOWFLAKE.test(String(entry.postChannelId ?? "")) ||
        !SNOWFLAKE.test(String(entry.postMessageId ?? ""))) {
      return ordinal + ". **" + title + "** — post link unavailable";
    }
    const link = "https://discord.com/channels/" + guildId + "/" +
      entry.postChannelId + "/" + entry.postMessageId;
    return ordinal + ". [" + title + "](" + link + ")";
  });
  const heading = "**My " + (type === "house" ? "house" : "outfit") +
    " listings** — " + count + " active";
  const content = [
    heading,
    "",
    rows.length ? rows.join("\n") : "You don't have any active published listings yet.",
    "",
    "Open a post to browse photos, or use the Edit menu below to change its details privately.",
    "Page " + (shownPage + 1) + " of " + totalPages,
  ].join("\n");
  const components = [];
  const editable = entries.filter(entry => /^[0-9a-f]{24}$/i.test(String(entry._id ?? "")));
  if (editable.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("member:edit:" + type + ":" + ownerId)
        .setPlaceholder("Edit one of these listings in DMs")
        .addOptions(editable.map(entry => ({
          label: String(entry.title || "Untitled listing").replace(/[\r\n\t]/g, " ").slice(0, 100),
          value: String(entry._id),
        }))),
    ));
  }
  if (totalPages > 1) components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(type + ":mine:" + (shownPage - 1) + ":" + ownerId)
        .setLabel("◀ Previous page").setStyle(ButtonStyle.Secondary)
        .setDisabled(shownPage === 0),
      new ButtonBuilder()
        .setCustomId(type + ":mine:" + (shownPage + 1) + ":" + ownerId)
        .setLabel("Next page ▶").setStyle(ButtonStyle.Primary)
        .setDisabled(shownPage >= totalPages - 1),
    ),
  );
  return { content, components, allowedMentions: { parse: [] } };
}

export async function handleMemberListingDirectory(interaction, {
  models = { house: HouseListing, outfit: OutfitListing },
} = {}) {
  const parts = String(interaction.customId).split(":");
  const [type, action, pageStr, ownerId] = parts;
  if (!["house", "outfit"].includes(type) || action !== "mine" ||
      !(parts.length === 2 || parts.length === 4)) {
    throw new UserFacingError("That listing directory control is invalid.");
  }
  const changingPage = parts.length === 4;
  if (changingPage && (
      ownerId !== interaction.user.id ||
      !/^(0|[1-9]\d*)$/.test(pageStr) ||
      !Number.isSafeInteger(Number(pageStr)))) {
    throw new UserFacingError("That listing directory belongs to someone else or has expired.");
  }
  const requestedPage = changingPage ? Number(pageStr) : 0;
  const query = directoryQuery(interaction.guildId, interaction.user.id);
  if (changingPage) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const Model = models[type];
  const count = await Model.countDocuments(query);
  const lastPage = Math.max(0, Math.ceil(count / MEMBER_LISTING_PAGE_SIZE) - 1);
  const page = Math.min(requestedPage, lastPage);
  const entries = count ? await Model.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .skip(page * MEMBER_LISTING_PAGE_SIZE)
    .limit(MEMBER_LISTING_PAGE_SIZE)
    .select("_id title postChannelId postMessageId")
    .lean() : [];
  await interaction.editReply(makeMemberListingDirectory(
    type, interaction.guildId, interaction.user.id, entries, count, page));
  return true;
}
