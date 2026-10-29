
import "dotenv/config";
import { validateRuntimeConfiguration } from "./services/runtime-configuration.js";
import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from "discord.js";
import mongoose from "mongoose";
import {
  execute as executeProfile,
  data as profileCommand,
  ensureProfileEntry,
  ensureProfileCard,
  ensureProfileRecord,
  handleProfileAlbumPage,
  handleProfileCardButton,
  handleProfileAppearanceSelect,
  handleProfileAppearanceDM,
  handleProfileStickerButton,
  handleProfileMenuButton,
  handleProfileModal,
  handleProfilePhotoActionButton,
  handleProfileEntryButton,
  handleInventoryEntryButton,
} from "./commands/profile.js";
import {
  execute as executeProfileCleanup,
  data as profileCleanupCommand,
} from "./commands/profile-cleanup.js";
import {
  execute as executeProfileRefresh,
  data as profileRefreshCommand,
} from "./commands/profile-refresh.js";
import {
  execute as executeInventoryVideo,
  data as inventoryVideoCommand,
  ensureInventoryEntry,
} from "./commands/inventory-video.js";
import {
  execute as executeHouse,
  data as houseCommand,
  handleHouseCreateButton,
  handleHouseCreateModal,
  handleHouseButton,
  handleHousePageButton,
  handleHousePhotoSelection,
  handleHouseModal,
  handleSold,
  handleHouseEntryButton,
  ensureHouseEntry,
} from "./commands/house.js";
import {
  execute as executeOutfit,
  data as outfitCommand,
  handleOutfitCreateButton,
  handleOutfitCreateModal,
  handleOutfitButton,
  handleOutfitModal,
  handleOutfitSold,
  handleOutfitPageButton,
  handleOutfitPhotoSelection,
  handleLegacyOutfitGalleryButton,
  handleOutfitEntryButton,
  ensureOutfitEntry,
} from "./commands/outfit.js";
import {
  execute as executeTrade,
  data as tradeCommand,
  handleTradeCreateButton,
  handleTradeCreateModal,
  handleVote,
  ensureTradeVoteEntry,
  handleTradeVoteEntryButton,
} from "./commands/trade.js";
import { execute as executeSetup, data as setupCommand } from "./commands/setup.js";
import {
  data as adminImportCommand, execute as executeAdminImport,
  handleAdminImportModal,
} from "./commands/admin-import-listing.js";
import { execute as executeShop, data as shopCommand, ensureShopEntry, handleShopButton } from "./commands/shop.js";
import { data as cardsCommand, execute as executeCards, handleCardGrab, handleCardUpgrade, autocompleteCards, handleCardTagDeletion, reconcileCardDropClosures } from "./commands/cards.js";
import { data as cardsAdminCommand, execute as executeCardsAdmin } from "./commands/cards-admin.js";
import { data as cardsOwnerCommand, execute as executeCardsOwner } from "./commands/cards-owner.js";
import { handleCardCollectionInteraction } from "./commands/card-collection-ui.js";
import { handleListingAppearanceDM, handleOutfitAppearancePicker, handleHouseAppearancePicker } from "./commands/listing-appearance-editor.js";
import { reconcileOutfitsForGuild } from "./services/outfit-reconciliation.js";
import { reconcileHousesForGuild } from "./services/house-availability.js";

import { execute as executeTestPoints, data as testPointsCommand } from "./commands/test-points.js";
import { execute as executePointsAdmin, data as pointsAdminCommand } from "./commands/points-admin.js";
import { execute as executePointsObserve, data as pointsObserveCommand } from "./commands/points-observe.js";
import { observeNativePollVote, parseNativePollClientEvent } from "./services/participation-observer.js";
import { awardNativePollVote } from "./services/poll-rewards.js";
import { awardMessageActivity, eligibleVoiceStates, recordVoiceMinute } from "./services/activity-rewards.js";
import { runBounded, VOICE_TICK_CONCURRENCY } from "./services/bounded-work.js";
import PointsSettings from "./models/PointsSettings.js";
import { shouldRequestMessageContent } from "./services/observation-intents.js";
import { execute as executeHelp, data as helpCommand, handleHelpTopicButton } from "./commands/help.js";
import {
  handleTradingPostCardButton,
  handleTradingPostEntryButton,
  handleTradingPostModal,
  refreshTradingPostCard,
  ensureTradingPostEntry,
} from "./commands/trading-post.js";
import { getInteractionErrorMessage, UserFacingError } from "./commands/errors.js";
import { handleMemberListingDirectory } from "./commands/member-listings.js";
import { openListingDetailsDM, handleListingDetailsDM } from "./commands/listing-details-editor.js";
import { resumePendingTradingPostDeletes } from "./services/trading-post-deletion.js";
import { recoverStagedListingPosts } from "./services/listing-publication-recovery.js";
import { startMediaTelemetry } from "./services/media-telemetry.js";
import { handleTemporaryDmNotice, sendTemporaryDmNotice } from "./services/temporary-dm-notice.js";
import { discordMessageUrl } from "./commands/shared.js";
import GuildConfig from "./models/GuildConfig.js";
import { parseHatchemText, runHatchemText } from "./services/hatchem-text-commands.js";
import UserProfile from "./models/UserProfile.js";
import { cleanupPendingForms, handleRemovePendingForm } from "./commands/pending-forms.js";
import { forgetHouseForm } from "./commands/house.js";
import { forgetOutfitForm } from "./commands/outfit.js";
import { forgetTradeForm } from "./commands/trade.js";

const token = process.env.DISCORD_TOKEN;
const mongoUri = process.env.MONGODB_URI;

// Validate local configuration before starting external connections.
validateRuntimeConfiguration({ mode: "bot" });

const client = new Client({
  // Poll-vote events need no Message Content access. To diagnose whether
  // third-party Arclo public messages expose results, privileged access can
  // be explicitly enabled on the TEST bot only (plus Discord Portal toggle).
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessagePolls,
    GatewayIntentBits.GuildVoiceStates,
    ...(shouldRequestMessageContent() ? [GatewayIntentBits.MessageContent] : [])],
  partials: [Partials.Channel, Partials.Message, Partials.Poll, Partials.PollAnswer],
});

// Login failures can otherwise leave only "Connected to MongoDB." in the
// console. These events report Discord Gateway problems without logging the
// bot token or member data.
client.on(Events.Error, error => {
  console.error("[Discord] Client error:", error);
});
client.on(Events.Warn, warning => {
  console.warn("[Discord] Warning:", warning);
});
client.on(Events.ShardError, (error, shardId) => {
  console.error(`[Discord] Shard ${shardId} error:`, error);
});
client.on(Events.ShardDisconnect, (event, shardId) => {
  console.warn(`[Discord] Shard ${shardId} disconnected (code ${event.code}; reason: ${event.reason || "unspecified"}).`);
});
client.on(Events.ShardReconnecting, shardId => {
  console.warn(`[Discord] Shard ${shardId} reconnecting.`);
});
client.on(Events.ShardReady, shardId => {
  console.log(`[Discord] Shard ${shardId} received READY.`);
});

// The supported discord.js events are MessagePollVoteAdd/Remove, not Raw.
// A native poll may be uncached after a restart; /points-observe sync can
// rebuild the current participant snapshot from Discord's voter API.
const pollObservationQueue = new Map();
function handlePollEvent(pollAnswer, userId, added) {
  const parsed = parseNativePollClientEvent(pollAnswer, userId, added);
  if (!parsed) {
    console.warn("[Points observe] Poll event was partial; use /points-observe sync for that poll.");
    return;
  }
  const key = `${parsed.guildId}:${parsed.messageId}:${parsed.userId}`;
  const previous = pollObservationQueue.get(key) ?? Promise.resolve();
  const current = previous.then(async () => {
    await observeNativePollVote(parsed);
    if (parsed.added) {
      const guild = client.guilds.cache.get(parsed.guildId);
      if (!guild) return;
      const reward = await awardNativePollVote({ ...parsed, guild });
      if (reward.credited) {
        console.log(`[Points] Approved native poll ${parsed.messageId}: +${reward.amount} Points for ${parsed.userId}.`);
      }
    }
  })
    .catch(error => {
      console.error("[Points] Could not record or credit native Discord poll vote:", error);
    }).finally(() => {
      if (pollObservationQueue.get(key) === current) pollObservationQueue.delete(key);
    });
  pollObservationQueue.set(key, current);
}
client.on(Events.MessagePollVoteAdd, (answer, userId) => handlePollEvent(answer, userId, true));
client.on(Events.MessagePollVoteRemove, (answer, userId) => handlePollEvent(answer, userId, false));

// Messages are never stored or logged: only a short SHA-256 digest is kept to
// prevent immediately repeating the same message for Points.
client.on(Events.MessageCreate, message => {
  if (!message.guildId || message.author?.bot || !message.content) return;
  // Only commands typed in the assigned Hatchem text channel are parsed.
  // Ordinary chat and every other channel are ignored by this handler.
  const parsed = process.env.ENABLE_CARD_GAME_TEST === "1" &&
    message.content.startsWith(".")
    ? parseHatchemText(message.content) : null;
  if (parsed) {
    void (async () => {
      const config = await GuildConfig.findOne({ guildId: message.guildId })
        .select("hatchemChannelId").lean();
      if (config?.hatchemChannelId && message.channelId === config.hatchemChannelId) {
        await runHatchemText(message, parsed);
      }
    })().catch(error => console.error("[Hatchem] Text routing failed:", error));
  }
  awardMessageActivity(message).then(result => {
    if (result.credited) console.log(`[Points] Chat +${result.amount} to ${message.author.id}.`);
  }).catch(error => {
    console.error("[Points] Could not award qualifying message:", error);
  });
});

// Process each calendar minute only once while the bot is online. Cached voice
// states require GuildVoiceStates intent; no recorded audio or speech analysis.
let voiceActivityTimer;
let cardDropCloseTimer;
let cardDropCloseRunning = false;
async function runCardDropCloseSweep() {
  if (cardDropCloseRunning) return;
  cardDropCloseRunning = true;
  try { await reconcileCardDropClosures(client); }
  catch (error) { console.error("[Cards] Drop-close sweep failed:", error); }
  finally { cardDropCloseRunning = false; }
}
let voiceTickRunning = false;
async function voiceActivityTick() {
  if (voiceTickRunning || !client.isReady()) return;
  voiceTickRunning = true;
  const startedAt = Date.now();
  try {
    const now = new Date();
    for (const guild of client.guilds.cache.values()) {
      const settings = await PointsSettings.findOne({ guildId: guild.id }).lean();
      if (settings?.voiceRewardsEnabled !== true) continue;
      const eligible = eligibleVoiceStates(guild);
      await runBounded(eligible, async stateMember => {
        try {
          // Cached voice members normally contain joinedAt. If it is absent,
          // fetch the full member rather than applying an incorrect multiplier.
          const member = stateMember.joinedAt ? stateMember
            : await guild.members.fetch(stateMember.id, { force: true }).catch(() => null);
          if (!member?.joinedAt || member.user?.bot) return;
          const reward = await recordVoiceMinute({ guildId: guild.id, member, now });
          if (reward.credited) console.log(`[Points] Voice +${reward.amount} to ${member.id}.`);
        } catch (error) {
          console.error("[Points] Could not record voice minute:", error);
        }
      }, VOICE_TICK_CONCURRENCY);
    }
  } catch (error) {
    console.error("[Points] Voice tick failed:", error);
  } finally {
    const elapsed = Date.now() - startedAt;
    if (elapsed > 45_000) {
      console.warn(`[Points] Voice tick required ${elapsed}ms; check MongoDB latency and concurrent voice participants.`);
    }
    voiceTickRunning = false;
  }
}

let discordReadyTimeout;

const commandHandlers = new Map([
  [profileCommand.name, executeProfile],
  [profileCleanupCommand.name, executeProfileCleanup],
  [profileRefreshCommand.name, executeProfileRefresh],
  [inventoryVideoCommand.name, executeInventoryVideo],
  [houseCommand.name, executeHouse],
  [outfitCommand.name, executeOutfit],
  [tradeCommand.name, executeTrade],
  [setupCommand.name, executeSetup],
  [adminImportCommand.name, executeAdminImport],
  [shopCommand.name, executeShop],
  [cardsCommand.name, executeCards],
  [cardsAdminCommand.name, executeCardsAdmin],
  [cardsOwnerCommand.name, executeCardsOwner],
  [testPointsCommand.name, executeTestPoints],
  [pointsAdminCommand.name, executePointsAdmin],
  [pointsObserveCommand.name, executePointsObserve],
  [helpCommand.name, executeHelp],
]);

// Startup maintenance is best-effort and must never gate a slash command.

async function ensureConfiguredEntry(guild, channelId, ensureEntry, label) {
  if (!channelId) return;
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || typeof channel.send !== "function") {
      throw new Error(`Configured ${label} channel is unavailable.`);
    }
    await ensureEntry(guild, channel);
  } catch (error) {
    console.error(
      `Could not ensure the ${label} channel button for guild ${guild.id}:`,
      error,
    );
  }
}

async function refreshListingOwnerCards(guild, ownerId) {
  let member;
  try {
    member = await guild.members.fetch(ownerId);
  } catch (error) {
    if (Number(error?.code) !== 10007) throw error;
  }
  if (!member) return;
  await ensureProfileCard(guild, member.user, { refresh: true });
  await refreshTradingPostCard(guild, ownerId);
}

async function ensureProfileForEntry(interaction) {
  await ensureProfileRecord(interaction.guildId, interaction.user);
}

async function sendProfileReminder(interaction) {
  const existingProfileCard = await UserProfile.exists({
    guildId: interaction.guildId,
    discordUserId: interaction.user.id,
    profileCardChannelId: { $type: "string", $ne: "" },
    profileCardMessageId: { $type: "string", $ne: "" },
  });
  if (existingProfileCard) return;

  const profile = await ensureProfileCard(
    interaction.guild,
    interaction.user,
    { refresh: true },
  );
  const profileUrl = discordMessageUrl(
    interaction.guildId,
    profile.profileCardChannelId,
    profile.profileCardMessageId,
  );
  await interaction.followUp({
    content: `Your profile is ready to finish filling out: ${profileUrl}`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

client.once(Events.ClientReady, (readyClient) => {
  clearTimeout(discordReadyTimeout);
  startMediaTelemetry();
  voiceActivityTimer = setInterval(() => void voiceActivityTick(), 60_000);
  voiceActivityTimer.unref?.();
  if (process.env.ENABLE_CARD_GAME_TEST === "1") {
    cardDropCloseTimer = setInterval(() => void runCardDropCloseSweep(), 5000);
    cardDropCloseTimer.unref?.();
    void runCardDropCloseSweep();
  }
  console.log(`Bot is online as ${readyClient.user.tag}.`);
  void (async () => {
    for (const guild of readyClient.guilds.cache.values()) {
      try {
        await resumePendingTradingPostDeletes(guild);
      } catch (error) {
        console.error(`Could not resume Trading Post deletions for guild ${guild.id}:`, error);
      }
      try {
        const publication = await recoverStagedListingPosts(guild);
        if (publication.scanned) console.log("[Publication recovery]", guild.id, publication);
      } catch (error) {
        console.error(`Could not recover staged house/outfit posts for guild ${guild.id}:`, error);
      }
      try {
        await cleanupPendingForms(guild);
      } catch (error) {
        console.error(`Could not clean up pending forms for guild ${guild.id}:`, error);
      }

      let config;
      try {
        config = await GuildConfig.findOne({ guildId: guild.id });
      } catch (error) {
        console.error(`Could not load channel settings for guild ${guild.id}:`, error);
        continue;
      }
      if (!config) {
        try {
          await reconcileOutfitsForGuild(guild);
        } catch (error) {
          console.error(`Could not reconcile outfit listings for guild ${guild.id}:`, error);
        }
        try {
          await reconcileHousesForGuild(guild);
        } catch (error) {
          console.error(`Could not reconcile house listings for guild ${guild.id}:`, error);
        }
        continue;
      }
      await Promise.all([
        ensureConfiguredEntry(guild, config.profileChannelId, ensureProfileEntry, "profile"),
        ensureConfiguredEntry(guild, config.shopChannelId, ensureShopEntry, "shop"),
        ensureConfiguredEntry(guild, config.houseChannelId, ensureHouseEntry, "house listing"),
        ensureConfiguredEntry(guild, config.outfitChannelId, ensureOutfitEntry, "outfit listing"),
        ensureConfiguredEntry(guild, config.inventoryChannelId, ensureInventoryEntry, "inventory"),
        ensureConfiguredEntry(guild, config.tradeVoteChannelId, ensureTradeVoteEntry, "trade voting"),
        ensureConfiguredEntry(
          guild,
          config.tradingPostChannelId,
          ensureTradingPostEntry,
          "Trading Post",
        ),
      ]);
      try {
        await reconcileOutfitsForGuild(guild);
      } catch (error) {
        console.error(`Could not reconcile outfit listings for guild ${guild.id}:`, error);
      }
      try {
        await reconcileHousesForGuild(guild);
      } catch (error) {
        console.error(`Could not reconcile house listings for guild ${guild.id}:`, error);
      }
    }
  })().catch((error) => {
    console.error("Startup channel maintenance failed:", error);
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName === cardsCommand.name) {
        const config = interaction.guildId
          ? await GuildConfig.findOne({ guildId: interaction.guildId }).select("hatchemChannelId").lean()
          : null;
        if (config?.hatchemChannelId && interaction.channelId === config.hatchemChannelId) {
          await autocompleteCards(interaction);
        } else {
          await interaction.respond([]);
        }
      } else {
        await interaction.respond([]);
      }
      return;
    }
    // Startup reconciliation may archive media or render many cards.
    // Acknowledge slash commands immediately and execute against current
    // MongoDB state; never await the unrelated maintenance pass here.
    // Both branch-specific commands and entry creation already validate
    // their current records, so they need no global startup barrier.
    // The admin import slash command must show a modal as its first
    // acknowledgement. All other slash commands keep their fast defer.
    if (interaction.isChatInputCommand() &&
        interaction.commandName !== adminImportCommand.name) {
      // Collections are intentionally public so other members can browse them.
      // All other slash commands retain their existing private replies.
      const publicCollection = interaction.commandName === cardsCommand.name &&
        interaction.options.getSubcommand(false) === "collection" &&
        process.env.ENABLE_CARD_GAME_TEST === "1";
      await interaction.deferReply(publicCollection ? {} : { flags: MessageFlags.Ephemeral });
    }

    if (interaction.isModalSubmit() &&
        interaction.customId.startsWith("admin-import:")) {
      await handleAdminImportModal(interaction);
      return;
    }
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith("cards:collection:")) {
      await handleCardCollectionInteraction(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("cards:tagdelete:")) {
      await handleCardTagDeletion(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("cards:upgrade:")) {
      await handleCardUpgrade(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("cards:grab:")) {
      await handleCardGrab(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("dm:notice:")) {
      await handleTemporaryDmNotice(interaction);
      return;
    }
    if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith("shop:")) {
      await handleShopButton(interaction);
      return;
    }
    if ((interaction.isButton() || interaction.isStringSelectMenu()) &&
        (interaction.customId.startsWith("listing:pick:") ||
         interaction.customId.startsWith("listing:pickpage:"))) {
      await handleOutfitAppearancePicker(interaction);
      return;
    }
    if ((interaction.isButton() || interaction.isStringSelectMenu()) &&
        (interaction.customId.startsWith("listing:housepick:") ||
         interaction.customId.startsWith("listing:housepage:"))) {
      await handleHouseAppearancePicker(interaction);
      return;
    }
    if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith("listing:dm:")) {
      await handleListingAppearanceDM(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("form:remove:")) {
      await handleRemovePendingForm(interaction, {
        forget: (type, guildId, ownerId, messageId, channelId) => {
          if (type === "house") forgetHouseForm(guildId, ownerId, messageId, channelId);
          if (type === "outfit") forgetOutfitForm(guildId, ownerId, messageId, channelId);
          if (type === "trade") forgetTradeForm(guildId, ownerId, messageId, channelId);
        },
      });
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("house:new:")) {
      await ensureProfileForEntry(interaction);
      await handleHouseCreateButton(interaction);
      await sendProfileReminder(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("member:edit:")) {
      await openListingDetailsDM(interaction);
      return;
    }
    if ((interaction.isButton() || interaction.isModalSubmit()) &&
        interaction.customId.startsWith("listing:details:")) {
      await handleListingDetailsDM(interaction);
      return;
    }
    if (interaction.isButton() &&
        /^(house|outfit):edit:/.test(interaction.customId)) {
      await openListingDetailsDM(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("help:topic:")) {
      await handleHelpTopicButton(interaction);
      return;
    }
    if (interaction.isButton() &&
        /^(house|outfit):mine(?::.*)?$/.test(interaction.customId)) {
      await handleMemberListingDirectory(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === "house:entry") {
      await ensureProfileForEntry(interaction);
      await handleHouseEntryButton(interaction);
      await sendProfileReminder(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === "outfit:entry") {
      await ensureProfileForEntry(interaction);
      await handleOutfitEntryButton(interaction);
      await sendProfileReminder(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("profile:entry")) {
      await handleProfileEntryButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === "inventory:entry") {
      await ensureProfileForEntry(interaction);
      await handleInventoryEntryButton(interaction);
      await sendProfileReminder(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("outfit:new:")) {
      await ensureProfileForEntry(interaction);
      await handleOutfitCreateButton(interaction);
      await sendProfileReminder(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("tradevote:")) {
      await handleVote(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === "trade:entry") {
      await ensureProfileForEntry(interaction);
      await handleTradeVoteEntryButton(interaction);
      await sendProfileReminder(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("trade:new:")) {
      await ensureProfileForEntry(interaction);
      await handleTradeCreateButton(interaction);
      await sendProfileReminder(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("house:sold:")) {
      const ownerId = await handleSold(interaction);
      if (ownerId) await refreshListingOwnerCards(interaction.guild, ownerId);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("house:photo-select:")) {
      await handleHousePhotoSelection(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("outfit:photo-select:")) {
      await handleOutfitPhotoSelection(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("house:page:")) {
      await handleHousePageButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("outfit:page:")) {
      await handleOutfitPageButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("outfit:gallery:")) {
      await handleLegacyOutfitGalleryButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("outfit:sold:")) {
      const ownerId = await handleOutfitSold(interaction);
      if (ownerId) await refreshListingOwnerCards(interaction.guild, ownerId);
      return;
    }
    if (
      interaction.isButton() &&
      ["house:media:", "house:interest:", "house:notify:"].some((prefix) =>
        interaction.customId.startsWith(prefix),
      )
    ) {
      await handleHouseButton(interaction);
      return;
    }
    if (
      interaction.isButton() &&
      ["outfit:media:", "outfit:interest:", "outfit:notify:"].some((prefix) =>
        interaction.customId.startsWith(prefix),
      )
    ) {
      await handleOutfitButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("profile:album:")) {
      await handleProfileAlbumPage(interaction);
      return;
    }
    if (
      interaction.isButton() &&
      interaction.customId.startsWith("profile:photos-action:")
    ) {
      await handleProfilePhotoActionButton(interaction);
      return;
    }
    if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) && interaction.customId.startsWith("profile:dm:")) {
      await handleProfileAppearanceDM(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("profile:sticker:")) {
      await handleProfileStickerButton(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith("profile:appearance:")) {
      await handleProfileAppearanceSelect(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("profile:card:")) {
      await handleProfileCardButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("profile:menu:")) {
      await handleProfileMenuButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === "tradingpost:entry") {
      await ensureProfileForEntry(interaction);
      await handleTradingPostEntryButton(interaction);
      await sendProfileReminder(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("tradingpost:")) {
      await handleTradingPostCardButton(interaction);
      if (interaction.customId.startsWith("tradingpost:delete:")) {
        await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });
      }
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("profile:")) {
      await handleProfileModal(interaction);
      // A successful photo edit should never appear to fail merely because
      // the optional Trading Post card refresh is temporarily unavailable.
      await refreshTradingPostCard(interaction.guild, interaction.user.id)
        .catch(error => console.warn(
          "[Profile] Trading Post refresh after profile update failed:", error));
      return;
    }
    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("tradingpost:")
    ) {
      await handleTradingPostModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("house:media:")) {
      await handleHouseModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("outfit:media:")) {
      await handleOutfitModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("house:create:")) {
      await handleHouseCreateModal(interaction);
      await refreshTradingPostCard(interaction.guild, interaction.user.id);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("outfit:create:")) {
      await handleOutfitCreateModal(interaction);
      await refreshTradingPostCard(interaction.guild, interaction.user.id);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("trade:create:")) {
      await handleTradeCreateModal(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    console.log("Command received:", interaction.commandName);
    console.log("Available handlers:", [...commandHandlers.keys()]);

    // The card-game slash commands belong to Hatchem, not the ordinary bot command channel.
    if (interaction.commandName === cardsCommand.name && interaction.guildId) {
      const hatchemConfig = await GuildConfig.findOne({ guildId: interaction.guildId })
        .select("hatchemChannelId").lean();
      if (hatchemConfig?.hatchemChannelId && interaction.channelId !== hatchemConfig.hatchemChannelId) {
        await interaction.editReply({
          content: `Use Hatchem commands in <#${hatchemConfig.hatchemChannelId}>.`,
          allowedMentions: { parse: [] },
        });
        return;
      }
    }
    const handler = commandHandlers.get(interaction.commandName);
    if (!handler) {
      await interaction.editReply({
        content: "That command isn't available right now. Try again in a moment.",
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (
      interaction.guild &&
      ![
        setupCommand.name,
        adminImportCommand.name,
        shopCommand.name,
        cardsCommand.name,
        cardsAdminCommand.name,
        cardsOwnerCommand.name,
        testPointsCommand.name,
        pointsAdminCommand.name,
        pointsObserveCommand.name,
        profileCleanupCommand.name,
        profileRefreshCommand.name,
      ].includes(interaction.commandName)
    ) {
      await ensureProfileCard(interaction.guild, interaction.user);
    }
    if (![setupCommand.name, adminImportCommand.name, cardsCommand.name, cardsAdminCommand.name, cardsOwnerCommand.name].includes(interaction.commandName) && interaction.guildId) {
      const config = await GuildConfig.findOne({ guildId: interaction.guildId });
      if (
        config?.commandChannelId &&
        interaction.channelId !== config.commandChannelId
      ) {
        const response = {
          content: `Please use bot commands in <#${config.commandChannelId}>.`,
          allowedMentions: { parse: [] },
        };
        if (interaction.deferred) {
          await interaction.editReply(response);
        } else {
          await interaction.reply({
            ...response,
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }
    }
    await handler(interaction, {
      refreshProfileCard: () =>
        ensureProfileCard(interaction.guild, interaction.user, { refresh: true }),
      refreshTradingPostCard: () =>
        refreshTradingPostCard(interaction.guild, interaction.user.id),
    });
  } catch (error) {
    if (Number(error?.code) === 10062) {
      console.error(
        `Interaction expired before acknowledgement (${interaction.commandName ?? interaction.customId ?? interaction.type}; age ${Date.now() - interaction.createdTimestamp} ms).`,
      );
    } else if (!(error instanceof UserFacingError)) {
      console.error(
        `Interaction failed (${interaction.commandName ?? interaction.customId ?? interaction.type}):`,
        error,
      );
    }

    const response = {
      content: getInteractionErrorMessage(error),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    };
    try {
      // An acknowledged DM button updates the permanent shop/editor message.
      // Do NOT overwrite that message with an error; send a dismissible notice.
      if (interaction.deferred && !interaction.replied &&
          (interaction.isMessageComponent() || interaction.isModalSubmit()) &&
          interaction.channel?.isDMBased?.() &&
          !interaction.ephemeral &&
          (interaction.customId.startsWith("shop:dm:") ||
            interaction.customId.startsWith("profile:dm:") ||
             interaction.customId.startsWith("listing:details:"))) {
        await sendTemporaryDmNotice(interaction.user, `⚠️ ${getInteractionErrorMessage(error)}`);
      } else if (interaction.deferred && !interaction.replied) {
        await interaction.editReply(response);
      } else if (interaction.replied) {
        await interaction.followUp(response);
      } else if (interaction.isRepliable()) {
        await interaction.reply(response);
      }
    } catch (responseError) {
      if ([10062, 40060].includes(Number(responseError?.code))) {
        console.warn("Could not reply because the interaction expired or was already acknowledged.");
      } else {
        console.error("Could not send the interaction error response:", responseError);
      }
    }
  }
});

async function start() {
  console.log("[Startup] Connecting to MongoDB...");
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB.");

  console.log("[Startup] Connecting to Discord Gateway...");
  discordReadyTimeout = setTimeout(() => {
    if (!client.isReady()) {
      // Report status only; don't log any secrets from environment variables.
      console.warn(
        "[Startup] Discord has not sent READY after 20 seconds.",
        "Gateway status:", client.ws.status,
        "Shards:", client.ws.shards.size,
        "Check Replit network connectivity and DISCORD_TOKEN configuration.",
      );
    }
  }, 20_000);
  discordReadyTimeout.unref?.();

  try {
    await client.login(token);
    console.log("[Startup] Discord login handshake completed.");
  } catch (error) {
    clearTimeout(discordReadyTimeout);
    console.error("[Startup] Discord login failed:", error);
    throw error;
  }
}

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  if (voiceActivityTimer) clearInterval(voiceActivityTimer);
  if (cardDropCloseTimer) clearInterval(cardDropCloseTimer);
  await client.destroy();
  await mongoose.disconnect();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

start().catch((error) => {
  console.error("Bot startup failed:", error.message);
  process.exit(1);
});
