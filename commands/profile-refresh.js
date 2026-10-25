import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import UserProfile from "../models/UserProfile.js";
import { ensureProfileCard } from "./profile.js";
import { refreshHouseListingPost } from "./house.js";
import { refreshOutfitListingPost } from "./outfit.js";
import { refreshTradeListingPost } from "./trade.js";
import { refreshTradingPostCard } from "./trading-post.js";
import HouseListing from "../models/HouseListing.js";
import OutfitListing from "../models/OutfitListing.js";
import TradeListing from "../models/TradeListing.js";
import TradingPost from "../models/TradingPost.js";
import { UserFacingError } from "./errors.js";
import { requireGuild } from "./shared.js";

export const data = new SlashCommandBuilder()
  .setName("profile-refresh")
  .setDescription("Refresh all existing profile, listing, and Trading Post cards")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function getDiscordErrorCode(error) {
  return Number(error?.code ?? error?.rawError?.code);
}

async function refreshBatch(interaction, { type, records, refresh }, state, total) {
  for (const record of records) {
    const recordId = record.discordUserId ?? record.ownerId ?? String(record._id);
    try {
      await refresh(record);
      state.refreshed[type] += 1;
    } catch (error) {
      if ([10003, 10007, 10008].includes(getDiscordErrorCode(error))) {
        state.skipped[type] += 1;
      } else {
        state.failures.push(`${type}: ${recordId}`);
        console.error(`Could not refresh ${type} post ${recordId}:`, error);
      }
    }

    state.processed += 1;
    if (state.processed % 10 === 0 && state.processed < total) {
      await interaction.editReply({
        content: `Refreshing posts: ${state.processed}/${total} processed.`,
        allowedMentions: { parse: [] },
      });
    }
  }
}

export async function execute(interaction) {
  requireGuild(interaction);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserFacingError("Only server admins can refresh posts.");
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const guildQuery = (status) => ({
    guildId: interaction.guildId,
    status,
    postChannelId: { $type: "string", $ne: "" },
    postMessageId: { $type: "string", $ne: "" },
  });
  const [profiles, houses, outfits, trades, tradingPosts] = await Promise.all([
    UserProfile.find({
      guildId: interaction.guildId,
      profileCardChannelId: { $type: "string", $ne: "" },
      profileCardMessageId: { $type: "string", $ne: "" },
    })
      .select("discordUserId")
      .lean(),
    HouseListing.find({ ...guildQuery("active"), publicationState: { $ne: "staging" } }),
    OutfitListing.find({ ...guildQuery("active"), publicationState: { $ne: "staging" } }),
    TradeListing.find(guildQuery("open")),
    TradingPost.find({
      guildId: interaction.guildId,
      postChannelId: { $type: "string", $ne: "" },
      postMessageId: { $type: "string", $ne: "" },
    })
      .select("ownerId")
      .lean(),
  ]);
  const total =
    profiles.length +
    houses.length +
    outfits.length +
    trades.length +
    tradingPosts.length;

  if (!total) {
    await interaction.editReply({
      content: "There are no existing profile, listing, or Trading Post posts to refresh.",
      allowedMentions: { parse: [] },
    });
    return;
  }

  const state = {
    processed: 0,
    refreshed: { profile: 0, house: 0, outfit: 0, trade: 0, tradingPost: 0 },
    skipped: { profile: 0, house: 0, outfit: 0, trade: 0, tradingPost: 0 },
    failures: [],
  };

  await interaction.editReply({
    content: `Refreshing ${total} profile card(s) and listing post(s)...`,
    allowedMentions: { parse: [] },
  });

  await refreshBatch(
    interaction,
    {
      type: "profile",
      records: profiles,
      refresh: (profile) =>
        ensureProfileCard(
          interaction.guild,
          { id: profile.discordUserId },
          { refresh: true },
        ),
    },
    state,
    total,
  );
  await refreshBatch(
    interaction,
    {
      type: "house",
      records: houses,
      refresh: (listing) =>
        refreshHouseListingPost(interaction.guild, listing),
    },
    state,
    total,
  );
  await refreshBatch(
    interaction,
    {
      type: "outfit",
      records: outfits,
      refresh: (listing) =>
        refreshOutfitListingPost(interaction.guild, listing),
    },
    state,
    total,
  );
  await refreshBatch(
    interaction,
    {
      type: "trade",
      records: trades,
      refresh: (listing) =>
        refreshTradeListingPost(interaction.guild, listing),
    },
    state,
    total,
  );
  await refreshBatch(
    interaction,
    {
      type: "tradingPost",
      records: tradingPosts,
      refresh: (post) =>
        refreshTradingPostCard(interaction.guild, post.ownerId),
    },
    state,
    total,
  );

  const summary = [
    `Post refresh complete (${state.processed} processed):`,
    `Profiles: ${state.refreshed.profile} refreshed, ${state.skipped.profile} skipped.`,
    `Houses: ${state.refreshed.house} refreshed, ${state.skipped.house} skipped.`,
    `Outfits: ${state.refreshed.outfit} refreshed, ${state.skipped.outfit} skipped.`,
    `Trades: ${state.refreshed.trade} refreshed, ${state.skipped.trade} skipped.`,
    `Trading Posts: ${state.refreshed.tradingPost} refreshed, ${state.skipped.tradingPost} skipped.`,
    `${state.failures.length} failed.`,
  ];
  if (state.failures.length) {
    summary.push(`Failed post IDs: ${state.failures.slice(0, 10).join(", ")}`);
    if (state.failures.length > 10) {
      summary.push(`and ${state.failures.length - 10} more`);
    }
  }

  await interaction.editReply({
    content: summary.join("\n"),
    allowedMentions: { parse: [] },
  });
}
