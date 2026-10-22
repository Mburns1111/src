import "dotenv/config";
import { REST, Routes } from "discord.js";
import { data as profileCommand } from "./commands/profile.js";
import { data as profileCleanupCommand } from "./commands/profile-cleanup.js";
import { data as inventoryVideoCommand } from "./commands/inventory-video.js";
import { data as houseCommand } from "./commands/house.js";
import { data as tradeCommand } from "./commands/trade.js";
import { data as setupCommand } from "./commands/setup.js";
import { data as helpCommand } from "./commands/help.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  throw new Error("Set DISCORD_TOKEN and DISCORD_CLIENT_ID before registering commands.");
}

const rest = new REST({ version: "10" }).setToken(token);
const commands = [
  profileCommand,
  profileCleanupCommand,
  inventoryVideoCommand,
  houseCommand,
  tradeCommand,
  setupCommand,
  helpCommand,
].map((command) => command.toJSON());

await rest.put(Routes.applicationCommands(clientId), { body: commands });
console.log("Registered global profile, profile-cleanup, inventory-video, house, trade-vote, setup, and help commands.");

if (guildId) {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands,
  });
  console.log(`Also registered commands for test server ${guildId}.`);
}
