import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import {sharedGiveawayNotificationFields} from "../services/giveaway-notification-roles.js";
import {startActivityGiveawaySetup,startRegularGiveawaySetup} from "./activity-giveaway-setup.js";
import {startTrialGiveawaySetup} from "./trial-giveaway-setup.js";
import {startGuidedGuildSetup} from "./general-card-setup.js";
import { HATCHEM_GUIDE } from "../services/hatchem-text-commands.js";
import { hatchemTutorialEntryRow } from "./card-tutorial-ui.js";
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
  .setDescription("Guided setup for server channels, giveaways, Trials and cards")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(command=>command.setName("activity-giveaways")
    .setDescription("Guided setup for activity giveaway channels, claim instructions and defaults"))
  .addSubcommand(command=>command.setName("giveaways")
    .setDescription("Guided setup for regular giveaway channels and shared defaults"))
  .addSubcommand(command=>command.setName("trials")
    .setDescription("Guided setup for Court\'s Trial channels, prizes and claim defaults"))
  .addSubcommand(command=>command.setName("cards")
    .setDescription("Guided setup for Hatchem\'s dedicated channel, Collector role and wild eggs"))
  .addSubcommand(command=>command.setName("general")
    .setDescription("Guided setup: commands channel first, other features optional"));

export async function execute(interaction) {
  requireGuild(interaction);
  // Compatibility for Discord's cached /setup archives option. It is no longer registered.
  if(interaction.options.getSubcommand?.()==="archives")
    throw new UserFacingError("Shared Staff Archives are now configured as a required channel in /setup general. The giveaway and Trial setups reuse that channel automatically.");
  if(interaction.options.getSubcommand?.()==="general")
    return startGuidedGuildSetup(interaction,"general");
  if(interaction.options.getSubcommand?.()==="cards")
    return startGuidedGuildSetup(interaction,"cards");
  if(interaction.options.getSubcommand?.()==="giveaways")
    return startRegularGiveawaySetup(interaction);
  if(interaction.options.getSubcommand?.()==="activity-giveaways")
    return startActivityGiveawaySetup(interaction);
  if(interaction.options.getSubcommand?.()==="trials")
    return startTrialGiveawaySetup(interaction);
  // Compatibility for already-queued legacy slash interactions during
  // deployment. /setup channels is no longer registered or advertised;
  // previously saved channel IDs remain valid and untouched.
  if(interaction.options.getSubcommand?.()!=="channels")
    throw new UserFacingError("Use a guided setup option: /setup general, /setup giveaways, /setup activity-giveaways, /setup trials, or /setup cards.");
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
  const activityGiveawayListChannel = interaction.options.getChannel("activity_giveaway_list");
  const activityWinnersChannel = interaction.options.getChannel("activity_winners");
  const activityReviewChannel = interaction.options.getChannel("activity_review");
  const survivalTrialChannel = interaction.options.getChannel("survival_trials");
  const giveawayPingRole = interaction.options.getRole("giveaway_ping");
  const trialPingRole = interaction.options.getRole("trial_ping");
  const clearGiveawayPing = interaction.options.getBoolean("clear_giveaway_ping") === true;
  const clearTrialPing = interaction.options.getBoolean("clear_trial_ping") === true;
  // Old cached /setup channels interactions also update the *one* shared
  // giveaway ping role. Conflicting legacy options cannot create split pings.
  if ((giveawayPingRole && clearGiveawayPing) || (trialPingRole && clearTrialPing) ||
      ((giveawayPingRole||trialPingRole)&&(clearGiveawayPing||clearTrialPing)) ||
      (giveawayPingRole&&trialPingRole&&giveawayPingRole.id!==trialPingRole.id)) {
    throw new UserFacingError("Choose one shared giveaway ping role or clear it, not different roles for giveaways and Trials.");
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
    !activityGiveawayListChannel &&
    !activityWinnersChannel &&
    !activityReviewChannel &&
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
  if (activityReviewChannel && interaction.guild?.roles?.everyone) {
    const everyone=interaction.guild.roles.everyone;
    if(activityReviewChannel.permissionsFor?.(everyone)?.has(PermissionFlagsBits.ViewChannel))
      throw new UserFacingError("The activity review channel must be hidden from @everyone. Restrict its View Channel permission first.");
  }
  if (giveawayChannel || survivalTrialChannel || activityGiveawayListChannel || activityWinnersChannel || activityReviewChannel) {
    const prior = await GuildConfig.findOne({ guildId: interaction.guildId })
      .select("giveawayChannelId survivalTrialChannelId activityGiveawayListChannelId activityGiveawayWinnersChannelId activityGiveawayReviewChannelId").lean();
    const nextGiveaways = giveawayChannel?.id || prior?.giveawayChannelId || "";
    const nextTrials = survivalTrialChannel?.id || prior?.survivalTrialChannelId || "";
    const nextList = activityGiveawayListChannel?.id || prior?.activityGiveawayListChannelId || "";
    const nextWinners = activityWinnersChannel?.id || prior?.activityGiveawayWinnersChannelId || "";
    const nextReview = activityReviewChannel?.id || prior?.activityGiveawayReviewChannelId || "";
    if (nextGiveaways && nextGiveaways === nextTrials)
      throw new UserFacingError("Standard giveaways and Court's Trials need two different channels.");
    if (nextList && nextWinners && nextList === nextWinners)
      throw new UserFacingError("Activity giveaway listings and winner announcements need different channels.");
    if ((nextList && nextList === nextGiveaways) || (nextWinners && nextWinners === nextGiveaways))
      throw new UserFacingError("Use separate channels for standard giveaways, the activity directory, and activity winners.");
    if(nextReview && [nextGiveaways,nextTrials,nextList,nextWinners].includes(nextReview))
      throw new UserFacingError("The staff review channel must be separate from every public giveaway channel.");
    if ((nextList && nextList === nextTrials) || (nextWinners && nextWinners === nextTrials))
      throw new UserFacingError("Keep the activity directory and winners separate from Court's Trial announcements.");
  }
  const updates = {};
  if (commandsChannel) {
    updates.commandChannelId = commandsChannel.id;
    updates.initialSetupCompletedAt = new Date();
  }
  if (houseListings) updates.houseChannelId = houseListings.id;
  if (outfitListings) updates.outfitChannelId = outfitListings.id;
  if (inventoryShowcase) updates.inventoryChannelId = inventoryShowcase.id;
  if (tradeVoting) updates.tradeVoteChannelId = tradeVoting.id;
  if (profilesChannel) updates.profileChannelId = profilesChannel.id;
  if (tradingPostChannel) updates.tradingPostChannelId = tradingPostChannel.id;
  if (hatchemChannel) updates.hatchemChannelId = hatchemChannel.id;
  if (partyGamesChannel) updates.partyGamesChannelId = partyGamesChannel.id;
  if (giveawayChannel) updates.giveawayChannelId = giveawayChannel.id;
  if (activityGiveawayListChannel) updates.activityGiveawayListChannelId = activityGiveawayListChannel.id;
  if (activityWinnersChannel) updates.activityGiveawayWinnersChannelId = activityWinnersChannel.id;
  if (activityReviewChannel) updates.activityGiveawayReviewChannelId = activityReviewChannel.id;
  if (survivalTrialChannel) updates.survivalTrialChannelId = survivalTrialChannel.id;
  if (giveawayPingRole || trialPingRole || clearGiveawayPing || clearTrialPing) {
    Object.assign(updates,sharedGiveawayNotificationFields(
      giveawayPingRole?.id||trialPingRole?.id||""));
  }

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
    if (guide) await guide.edit({ content: HATCHEM_GUIDE, components: [hatchemTutorialEntryRow()], allowedMentions: { parse: [] } });
    else {
      guide = await hatchemChannel.send({ content: HATCHEM_GUIDE, components: [hatchemTutorialEntryRow()], allowedMentions: { parse: [] } });
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
  if (activityGiveawayListChannel) configured.push(`Active activity giveaway directory: ${activityGiveawayListChannel}`);
  if (activityWinnersChannel) configured.push(`Activity giveaway winner announcements: ${activityWinnersChannel}`);
  if (activityReviewChannel) configured.push(`Private activity drawing approval: ${activityReviewChannel}`);
  if (survivalTrialChannel) {
    configured.push(`Court's Trial survival giveaways: ${survivalTrialChannel}`);
  }
  if (giveawayPingRole || trialPingRole)
    configured.push(`Shared giveaway & Trial notifications: <@&${giveawayPingRole?.id||trialPingRole?.id}>`);
  if (clearGiveawayPing || clearTrialPing)
    configured.push("Shared giveaway & Trial notifications: disabled");
  if (hatchemChannel) configured.push(`Hatchem card-game commands: ${hatchemChannel}`);
  if (partyGamesChannel) configured.push(`Party Games: ${partyGamesChannel}`);

  await interaction.editReply({
    content: `Channel settings saved.\n${configured.join("\n")}`,
    allowedMentions: { parse: [] },
  });
}
