
import "dotenv/config";
import { validateRuntimeConfiguration } from "./services/runtime-configuration.js";
import { REST, Routes } from "discord.js";
import { data as profileCommand } from "./commands/profile.js";
import { data as profileCleanupCommand } from "./commands/profile-cleanup.js";
import { data as profileRefreshCommand } from "./commands/profile-refresh.js";
import { data as inventoryVideoCommand } from "./commands/inventory-video.js";
import { data as houseCommand } from "./commands/house.js";
import { data as outfitCommand } from "./commands/outfit.js";
import { data as tradeCommand } from "./commands/trade.js";
import { data as setupCommand } from "./commands/setup.js";
import { data as adminImportCommand } from "./commands/admin-import-listing.js";
import { data as shopCommand } from "./commands/shop.js";
import { data as cardsCommand } from "./commands/cards.js";
import { data as cardsAdminCommand } from "./commands/cards-admin.js";
import { data as cardsOwnerCommand } from "./commands/cards-owner.js";
import { data as testPointsCommand } from "./commands/test-points.js";
import { data as pointsAdminCommand } from "./commands/points-admin.js";
import { data as pointsObserveCommand } from "./commands/points-observe.js";
import { data as helpCommand } from "./commands/help.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

// This validation never sends an API request or prints environment secrets.
validateRuntimeConfiguration({ mode: "register" });

if (process.env.ENABLE_CARD_GAME_TEST === "1" && !guildId) throw new Error("Card testing requires DISCORD_GUILD_ID for test-guild-only registration.");
const rest = new REST({ version: "10" }).setToken(token);

// Keep private card-artwork/testing subcommands out of the public /cards menu.
const ownerOnlyCardSubcommands = new Set([
  "egg-art-upload", "art-upload", "art-assign", "art-list", "art-info", "art-review", "test-drop",
]);
const allCards = cardsCommand.toJSON();
const playerCards = { ...allCards, options: allCards.options.filter(o=>!ownerOnlyCardSubcommands.has(o.name)) };
const privateOwnerCards = {
  ...cardsOwnerCommand.toJSON(),
  // Default-hidden for normal members. Administrators may still see this
  // command in Discord; all execution is checked against the owner's ID.
  default_member_permissions: "0",
  options: [...cardsOwnerCommand.toJSON().options,
    ...allCards.options.filter(o=>ownerOnlyCardSubcommands.has(o.name))],
};

const commands = [
  profileCommand,
  profileCleanupCommand,
  profileRefreshCommand,
  inventoryVideoCommand,
  houseCommand,
  outfitCommand,
  tradeCommand,
  setupCommand,
  adminImportCommand,
  shopCommand,
  ...(process.env.ENABLE_TEST_POINTS === "1" ? [testPointsCommand] : []),
  pointsAdminCommand,
  pointsObserveCommand,
  helpCommand,
].map((command) => command.toJSON());

await rest.put(Routes.applicationCommands(clientId), { body: commands });

console.log(
  "Registered global profile, profile-cleanup, profile-refresh, inventory-video, house, outfit, trade-vote, setup, admin-import, shop, points-admin, help commands.",
);

if (guildId) {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: process.env.ENABLE_CARD_GAME_TEST === "1"
      ? [...commands, playerCards, cardsAdminCommand.toJSON(), privateOwnerCards]
      : commands,
  });

  console.log(`Also registered commands for test server ${guildId}.`);
}
