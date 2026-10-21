import "dotenv/config";
import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import mongoose from "mongoose";
import {
  execute as executeProfile,
  data as profileCommand,
  handleProfileAlbumPage,
  handleProfileMenuButton,
  handleProfileModal,
} from "./commands/profile.js";
import {
  execute as executeInventoryVideo,
  data as inventoryVideoCommand,
} from "./commands/inventory-video.js";
import {
  execute as executeHouse,
  data as houseCommand,
  handleHouseButton,
  handleHouseModal,
  handleSold,
} from "./commands/house.js";
import { execute as executeTrade, data as tradeCommand, handleVote } from "./commands/trade.js";
import { execute as executeSetup, data as setupCommand } from "./commands/setup.js";
import { execute as executeHelp, data as helpCommand } from "./commands/help.js";
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
    if (interaction.isButton() && interaction.customId.startsWith("tradevote:")) {
      await handleVote(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith("house:sold:")) {
      await handleSold(interaction);
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
    if (interaction.isButton() && interaction.customId.startsWith("profile:menu:")) {
      await handleProfileMenuButton(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("profile:")) {
      await handleProfileModal(interaction);
      return;
    }
    if (interaction.isModalSubmit() && interaction.customId.startsWith("house:media:")) {
      await handleHouseModal(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const handler = commandHandlers.get(interaction.commandName);
    if (!handler) {
      await interaction.reply({
        content: "That command isn't available right now. Try again in a moment.",
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (interaction.commandName !== setupCommand.name && interaction.guildId) {
      const config = await GuildConfig.findOne({ guildId: interaction.guildId });
      if (
        config?.commandChannelId &&
        interaction.channelId !== config.commandChannelId
      ) {
        await interaction.reply({
          content: `Please use bot commands in <#${config.commandChannelId}>.`,
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }
    }
    await handler(interaction);
  } catch (error) {
    if (!(error instanceof UserFacingError)) {
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
