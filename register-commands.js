
import "dotenv/config";
import { REST, Routes } from "discord.js";
import { data as profileCommand } from "./commands/profile.js";
import { data as profileCleanupCommand } from "./commands/profile-cleanup.js";
import { data as profileRefreshCommand } from "./commands/profile-refresh.js";
import { data as inventoryVideoCommand } from "./commands/inventory-video.js";
import { data as houseCommand } from "./commands/house.js";
import { data as outfitCommand } from "./commands/outfit.js";
import { data as tradeCommand } from "./commands/trade.js";
import { data as setupCommand } from "./commands/setup.js";
import { data as shopCommand } from "./commands/shop.js";
import { data as testPointsCommand } from "./commands/test-points.js";
import { data as pointsAdminCommand } from "./commands/points-admin.js";
import { data as helpCommand } from "./commands/help.js";
import { data as migrateOldPostsCommand } from "./commands/migrate-old-posts.js";

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
  profileRefreshCommand,
  inventoryVideoCommand,
  houseCommand,
  outfitCommand,
  tradeCommand,
  setupCommand,
  shopCommand,
  ...(process.env.ENABLE_TEST_POINTS === "1" ? [testPointsCommand] : []),
  pointsAdminCommand,
  helpCommand,
  migrateOldPostsCommand,
].map((command) => command.toJSON());

await rest.put(Routes.applicationCommands(clientId), { body: commands });

console.log(
  "Registered global profile, profile-cleanup, profile-refresh, inventory-video, house, outfit, trade-vote, setup, shop, points-admin, help, and migrate-old-posts commands.",
);

if (guildId) {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands,
  });

  console.log(`Also registered commands for test server ${guildId}.`);
}
