
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
import { data as cardsCommand,ownerCardOptions } from "./commands/cards.js";
import { data as cardsAdminCommand } from "./commands/cards-admin.js";
import { data as cardsOwnerCommand, cardsReleaseCommand, RELEASE_LIFECYCLE_SUBCOMMANDS } from "./commands/cards-owner.js";
import { buildCardCommandRegistration } from "./services/card-command-registration.js";
import { isCardGameTestMode } from "./services/card-game-mode.js";
import { data as testPointsCommand } from "./commands/test-points.js";
import { data as pointsAdminCommand } from "./commands/points-admin.js";
import { data as pointsObserveCommand } from "./commands/points-observe.js";
import { data as helpCommand } from "./commands/help.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

// This validation never sends an API request or prints environment secrets.
validateRuntimeConfiguration({ mode: "register" });

if (isCardGameTestMode() && !guildId) throw new Error("Card testing requires DISCORD_GUILD_ID for test-guild-only registration.");
const rest = new REST({ version: "10" }).setToken(token);

// Only the approved Hatchem commands are registered globally in live mode.
const { globalCardCommands, testGuildCardCommands } = buildCardCommandRegistration({
  playerCards: cardsCommand,
  cardsAdminCommand, cardsOwnerCommand, cardsReleaseCommand,
  ownerCardOptions, releaseSubcommands: RELEASE_LIFECYCLE_SUBCOMMANDS,
});

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

await rest.put(Routes.applicationCommands(clientId), { body: [...commands, ...globalCardCommands] });

console.log(
  "Registered global profile, profile-cleanup, profile-refresh, inventory-video, house, outfit, trade-vote, setup, admin-import, shop, points-admin, help commands.",
);

if (guildId) {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: isCardGameTestMode()
      ? [...commands, ...testGuildCardCommands]
      : commands,
  });

  console.log(`Also registered commands for test server ${guildId}.`);
}
