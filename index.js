
import "dotenv/config";
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
import { execute as executeShop, data as shopCommand, ensureShopEntry, handleShopButton } from "./commands/shop.js";
import { execute as executeTestPoints, data as testPointsCommand } from "./commands/test-points.js";
import { execute as executeHelp, data as helpCommand } from "./commands/help.js";
import {
  execute as executeMigrateOldPosts,
  data as migrateOldPostsCommand,
} from "./commands/migrate-old-posts.js";
import {
  handleTradingPostCardButton,
  handleTradingPostEntryButton,
  handleTradingPostModal,
  refreshTradingPostCard,
  ensureTradingPostEntry,
} from "./commands/trading-post.js";
import { getInteractionErrorMessage, UserFacingError } from "./commands/errors.js";
import { handleTemporaryDmNotice } from "./services/temporary-dm-notice.js";
import { discordMessageUrl } from "./commands/shared.js";
import GuildConfig from "./models/GuildConfig.js";
import UserProfile from "./models/UserProfile.js";
import { cleanupPendingForms } from "./commands/pending-forms.js";

const token = process.env.DISCORD_TOKEN;
const mongoUri = process.env.MONGODB_URI;

if (!token || !mongoUri) {
  throw new Error("Set DISCORD_TOKEN and MONGODB_URI before starting the bot.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
});

const commandHandlers = new Map([
  [profileCommand.name, executeProfile],
  [profileCleanupCommand.name, executeProfileCleanup],
  [profileRefreshCommand.name, executeProfileRefresh],
  [inventoryVideoCommand.name, executeInventoryVideo],
  [houseCommand.name, executeHouse],
  [outfitCommand.name, executeOutfit],
  [tradeCommand.name, executeTrade],
  [setupCommand.name, executeSetup],
  [shopCommand.name, executeShop],
  [testPointsCommand.name, executeTestPoints],
  [helpCommand.name, executeHelp],
  ["migrate_old_posts", executeMigrateOldPosts],
]);

let startupMaintenancePromise = Promise.resolve();

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
  console.log(`Bot is online as ${readyClient.user.tag}.`);
  startupMaintenancePromise = (async () => {
    for (const guild of readyClient.guilds.cache.values()) {
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
      if (!config) continue;
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
    }
  })().catch((error) => {
    console.error("Startup channel maintenance failed:", error);
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await startupMaintenancePromise;
    if (interaction.isChatInputCommand()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    if (interaction.isButton() && interaction.customId.startsWith("dm:notice:")) {
      await handleTemporaryDmNotice(interaction);
      return;
    }
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith("shop:")) {
      await handleShopButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("house:new:")) {
      await ensureProfileForEntry(interaction);
      await handleHouseCreateButton(interaction);
      await sendProfileReminder(interaction);
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
    if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.customId.startsWith("profile:dm:")) {
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
      await refreshTradingPostCard(interaction.guild, interaction.user.id);
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
        shopCommand.name,
        testPointsCommand.name,
        profileCleanupCommand.name,
        profileRefreshCommand.name,
      ].includes(interaction.commandName)
    ) {
      await ensureProfileCard(interaction.guild, interaction.user);
    }
    if (interaction.commandName !== setupCommand.name && interaction.guildId) {
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
      if (interaction.deferred && !interaction.replied) {
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
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB.");
  await client.login(token);
}

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
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
