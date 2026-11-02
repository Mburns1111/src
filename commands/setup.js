import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import { HATCHEM_GUIDE } from "../services/hatchem-text-commands.js";
import { requireGuild } from "./shared.js";
import { UserFacingError } from "./errors.js";
import { ensureHouseEntry } from "./house.js";
import { ensureOutfitEntry } from "./outfit.js";
import { ensureInventoryEntry } from "./inventory-video.js";
import { ensureProfileEntry } from "./profile.js";
import { ensureTradeVoteEntry } from "./trade.js";
import { ensureTradingPostEntry } from "./trading-post.js";
import { ensureShopEntry } from "./shop.js";

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configure the server's command and showcase channels")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((command) =>
    command
      .setName("channels")
      .setDescription("Choose where commands and server posts should go")
      .addChannelOption((option) =>
        option
          .setName("commands")
          .setDescription("Channel where members can use bot slash commands")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("house_listings")
          .setDescription("Channel for house ads")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("outfit_listings")
          .setDescription("Channel for outfit listings")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("inventory_showcase")
          .setDescription("Channel for member inventory albums and video links")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("profiles")
          .setDescription("Channel where member profile cards are kept")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("trade_voting")
          .setDescription("Dedicated channel for trade posts and votes")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("trading_post")
          .setDescription("Channel for permanent member Trading Post cards")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("hatchem")
          .setDescription("Hatchem collectible-card game channel")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("party_games")
          .setDescription("Dedicated channel for staff-hosted Party Games")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("shop")
          .setDescription("Channel for the permanent shop catalog")
          .addChannelTypes(ChannelType.GuildText),
      )
      .addChannelOption((option) =>
        option
          .setName("giveaways")
          .setDescription("Permanent channel for standard giveaways and winners")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      )
      .addChannelOption((option) =>
        option
          .setName("survival_trials")
          .setDescription("Separate channel for Court's Trial signups and eliminations")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      )
      .addRoleOption((option) =>
        option.setName("giveaway_ping")
          .setDescription("Role to notify when a regular giveaway is first posted"),
      )
      .addRoleOption((option) =>
        option.setName("trial_ping")
          .setDescription("Role to notify when a Court's Trial signup is first posted"),
      )
      .addBooleanOption((option) =>
        option.setName("clear_giveaway_ping")
          .setDescription("Disable the regular giveaway notification role"),
      )
      .addBooleanOption((option) =>
        option.setName("clear_trial_ping")
          .setDescription("Disable the Court's Trial notification role"),
      ),
  );

export async function execute(interaction) {
  requireGuild(interaction);
  const commandsChannel = interaction.options.getChannel("commands");
  const houseListings = interaction.options.getChannel("house_listings");
  const outfitListings = interaction.options.getChannel("outfit_listings");
  const inventoryShowcase = interaction.options.getChannel("inventory_showcase");
  const tradeVoting = interaction.options.getChannel("trade_voting");
  const profilesChannel = interaction.options.getChannel("profiles");
  const tradingPostChannel = interaction.options.getChannel("trading_post");
  const shopChannel = interaction.options.getChannel("shop");
  const hatchemChannel = interaction.options.getChannel("hatchem");
  const partyGamesChannel = interaction.options.getChannel("party_games");
  const giveawayChannel = interaction.options.getChannel("giveaways");
  const survivalTrialChannel = interaction.options.getChannel("survival_trials");
  const giveawayPingRole = interaction.options.getRole("giveaway_ping");
  const trialPingRole = interaction.options.getRole("trial_ping");
  const clearGiveawayPing = interaction.options.getBoolean("clear_giveaway_ping") === true;
  const clearTrialPing = interaction.options.getBoolean("clear_trial_ping") === true;
  if ((giveawayPingRole && clearGiveawayPing) || (trialPingRole && clearTrialPing)) {
    throw new UserFacingError("Choose a ping role or clear it, not both for the same event type.");
  }

  if (
    !commandsChannel &&
    !houseListings &&
    !outfitListings &&
    !inventoryShowcase &&
    !tradeVoting &&
    !profilesChannel &&
    !tradingPostChannel &&
    !shopChannel &&
    !hatchemChannel &&
    !partyGamesChannel &&
    !giveawayChannel &&
    !survivalTrialChannel &&
    !giveawayPingRole &&
    !trialPingRole &&
    !clearGiveawayPing &&
    !clearTrialPing
  ) {
    throw new UserFacingError("Choose at least one channel to configure.");
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  // The two event modes must never share an assigned channel. When only one
  // setting changes, compare it with the currently saved other channel.
  if (giveawayChannel || survivalTrialChannel) {
    const prior = await GuildConfig.findOne({ guildId: interaction.guildId })
      .select("giveawayChannelId survivalTrialChannelId").lean();
    const nextGiveaways = giveawayChannel?.id || prior?.giveawayChannelId || "";
    const nextTrials = survivalTrialChannel?.id || prior?.survivalTrialChannelId || "";
    if (nextGiveaways && nextGiveaways === nextTrials) {
      throw new UserFacingError("Standard giveaways and Court's Trials need two different channels.");
    }
  }
  const updates = {};
  if (commandsChannel) updates.commandChannelId = commandsChannel.id;
  if (houseListings) updates.houseChannelId = houseListings.id;
  if (outfitListings) updates.outfitChannelId = outfitListings.id;
  if (inventoryShowcase) updates.inventoryChannelId = inventoryShowcase.id;
  if (tradeVoting) updates.tradeVoteChannelId = tradeVoting.id;
  if (profilesChannel) updates.profileChannelId = profilesChannel.id;
  if (tradingPostChannel) updates.tradingPostChannelId = tradingPostChannel.id;
  if (hatchemChannel) updates.hatchemChannelId = hatchemChannel.id;
  if (partyGamesChannel) updates.partyGamesChannelId = partyGamesChannel.id;
  if (giveawayChannel) updates.giveawayChannelId = giveawayChannel.id;
  if (survivalTrialChannel) updates.survivalTrialChannelId = survivalTrialChannel.id;
  if (giveawayPingRole || clearGiveawayPing) updates.giveawayPingRoleId = clearGiveawayPing ? "" : giveawayPingRole.id;
  if (trialPingRole || clearTrialPing) updates.survivalTrialPingRoleId = clearTrialPing ? "" : trialPingRole.id;

  // Ensure the shop before updating channel settings so its existing message IDs
  // are checked against the previous channel when a shop is moved.
  if (shopChannel) await ensureShopEntry(interaction.guild, shopChannel);
  const previousHatchem = hatchemChannel
    ? await GuildConfig.findOne({ guildId: interaction.guildId }).select("hatchemChannelId hatchemGuideMessageId").lean()
    : null;

  await GuildConfig.findOneAndUpdate(
    { guildId: interaction.guildId },
    { $set: updates },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  if (houseListings) await ensureHouseEntry(interaction.guild, houseListings);
  if (outfitListings) await ensureOutfitEntry(interaction.guild, outfitListings);
  if (inventoryShowcase) await ensureInventoryEntry(interaction.guild, inventoryShowcase);
  if (profilesChannel) await ensureProfileEntry(interaction.guild, profilesChannel);
  if (tradeVoting) await ensureTradeVoteEntry(interaction.guild, tradeVoting);
  if (tradingPostChannel) {
    await ensureTradingPostEntry(interaction.guild, tradingPostChannel);
  }

  if (hatchemChannel) {
    let guide = null;
    if (previousHatchem?.hatchemChannelId === hatchemChannel.id && previousHatchem.hatchemGuideMessageId) {
      guide = await hatchemChannel.messages.fetch(previousHatchem.hatchemGuideMessageId).catch(() => null);
      if (guide?.author?.id !== interaction.client.user.id) guide = null;
    }
    if (guide) await guide.edit({ content: HATCHEM_GUIDE, allowedMentions: { parse: [] } });
    else {
      guide = await hatchemChannel.send({ content: HATCHEM_GUIDE, allowedMentions: { parse: [] } });
      await GuildConfig.updateOne({ guildId: interaction.guildId },
        { $set: { hatchemGuideMessageId: guide.id } });
    }
  }

  const configured = [];
  if (commandsChannel) configured.push(`Bot commands: ${commandsChannel}`);
  if (houseListings) {
    configured.push(`House listings and create button: ${houseListings}`);
  }
  if (outfitListings) {
    configured.push(`Outfit listings and create button: ${outfitListings}`);
  }
  if (inventoryShowcase) {
    configured.push(`Inventory showcase and video button: ${inventoryShowcase}`);
  }
  if (tradeVoting) configured.push(`Trade voting and create button: ${tradeVoting}`);
  if (profilesChannel) {
    configured.push(`Member profiles and profile button: ${profilesChannel}`);
  }
  if (tradingPostChannel) {
    configured.push(`Trading Post cards and pinned create button: ${tradingPostChannel}`);
  }
  if (shopChannel) {
    configured.push(`Shop catalog and Points button: ${shopChannel}`);
  }
  if (giveawayChannel) {
    configured.push(`Standard giveaways: ${giveawayChannel}`);
  }
  if (survivalTrialChannel) {
    configured.push(`Court's Trial survival giveaways: ${survivalTrialChannel}`);
  }
  if (giveawayPingRole) configured.push(`Regular giveaway notifications: <@&${giveawayPingRole.id}>`);
  if (trialPingRole) configured.push(`Court's Trial notifications: <@&${trialPingRole.id}>`);
  if (clearGiveawayPing) configured.push("Regular giveaway notifications: disabled");
  if (clearTrialPing) configured.push("Court's Trial notifications: disabled");
  if (hatchemChannel) configured.push(`Hatchem card-game commands: ${hatchemChannel}`);
  if (partyGamesChannel) configured.push(`Party Games: ${partyGamesChannel}`);

  await interaction.editReply({
    content: `Channel settings saved.\n${configured.join("\n")}`,
    allowedMentions: { parse: [] },
  });
}
