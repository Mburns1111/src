import "dotenv/config";
import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import mongoose from "mongoose";
import { execute as executeProfile, data as profileCommand } from "./commands/profile.js";
import {
  execute as executeInventoryVideo,
  data as inventoryVideoCommand,
} from "./commands/inventory-video.js";
import {
  execute as executeHouse,
  data as houseCommand,
  handleSold,
} from "./commands/house.js";
import { execute as executeTrade, data as tradeCommand, handleVote } from "./commands/trade.js";
import { execute as executeSetup, data as setupCommand } from "./commands/setup.js";
import { execute as executeHelp, data as helpCommand } from "./commands/help.js";
import { UserFacingError } from "./commands/errors.js";

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

    if (!interaction.isChatInputCommand()) return;
    const handler = commandHandlers.get(interaction.commandName);
    if (!handler) return;
    await handler(interaction);
  } catch (error) {
    if (!(error instanceof UserFacingError)) {
      console.error("Interaction failed:", error);
    }

    const response = {
      content: error instanceof UserFacingError
        ? error.message
        : "Something went wrong while saving or loading that information. Please try again.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    };
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply(response).catch(console.error);
    } else if (interaction.replied) {
      await interaction.followUp(response).catch(console.error);
    } else {
      await interaction.reply(response).catch(console.error);
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
