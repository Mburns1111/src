import "dotenv/config";
import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import mongoose from "mongoose";
import {
  execute as executeProfile,
  data as profileCommand,
  ensureProfileCard,
  handleProfileAlbumPage,
  handleProfileCardButton,
  handleProfileMenuButton,
  handleProfileModal,
  handleProfilePhotoActionButton,
} from "./commands/profile.js";
import {
  execute as executeProfileCleanup,
  data as profileCleanupCommand,
} from "./commands/profile-cleanup.js";
import {
  execute as executeInventoryVideo,
  data as inventoryVideoCommand,
} from "./commands/inventory-video.js";
import {
  execute as executeHouse,
  data as houseCommand,
  handleHouseCreateButton,
  handleHouseCreateModal,
  handleHouseButton,
  handleHouseModal,
  handleSold,
} from "./commands/house.js";
import {
  execute as executeTrade,
  data as tradeCommand,
  handleTradeCreateButton,
  handleTradeCreateModal,
  handleVote,
} from "./commands/trade.js";
import { execute as executeSetup, data as setupCommand } from "./commands/setup.js";
import { execute as executeHelp, data as helpCommand } from "./commands/help.js";
import {
  handleTradingPostCardButton,
  handleTradingPostEntryButton,
  handleTradingPostModal,
  refreshTradingPostCard,
} from "./commands/trading-post.js";
import { getInteractionErrorMessage, UserFacingError } from "./commands/errors.js";
import GuildConfig from "./models/GuildConfig.js";

const token = process.env.DISCORD_TOKEN;
const mongoUri = process.env.MONGODB_URI;

if (!token || !mongoUri) {
  throw new Error("Set DISCORD_TOKEN and MONGODB_URI before starting the bot.");
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commandHandlers = new Map([
  [profileCommand.name, executeProfile],
  [profileCleanupCommand.name, executeProfileCleanup],
  [inventoryVideoCommand.name, executeInventoryVideo],
  [houseCommand.name, executeHouse],
  [tradeCommand.name, executeTrade],
  [setupCommand.name, executeSetup],
  [helpCommand.name, executeHelp],
]);

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Bot is online as ${readyClient.user.tag}.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }

    if (interaction.isButton() && interaction.customId.startsWith("house:new:")) {
      await handleHouseCreateButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("tradevote:")) {
      await handleVote(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("trade:new:")) {
      await handleTradeCreateButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("house:sold:")) {
      const ownerId = await handleSold(interaction);
      if (ownerId) {
        let member;
        try {
          member = await interaction.guild.members.fetch(ownerId);
        } catch (error) {
          if (Number(error?.code) !== 10007) throw error;
        }
        if (member) {
          await ensureProfileCard(interaction.guild, member.user, { refresh: true });
          await refreshTradingPostCard(interaction.guild, ownerId);
        }
      }
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("house:media:")) {
      await handleHouseButton(interaction);
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
    if (interaction.isButton() && interaction.customId.startsWith("profile:card:")) {
      await handleProfileCardButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("profile:menu:")) {
      await handleProfileMenuButton(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId === "tradingpost:entry") {
      await handleTradingPostEntryButton(interaction);
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
      await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("house:media:")) {
      await handleHouseModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("house:create:")) {
      await handleHouseCreateModal(interaction);
      await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });
      await refreshTradingPostCard(interaction.guild, interaction.user.id);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("trade:create:")) {
      await handleTradeCreateModal(interaction);
      await ensureProfileCard(interaction.guild, interaction.user, { refresh: true });
      return;
    }

    if (!interaction.isChatInputCommand()) return;
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
      ![setupCommand.name, profileCleanupCommand.name].includes(interaction.commandName)
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
