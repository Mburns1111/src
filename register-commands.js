
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
import { data as giveawayCommand, trialData as trialCommand } from "./commands/giveaway.js";
import { data as cardsCommand,ownerCardOptions } from "./commands/cards.js";
import { data as cardsAdminCommand } from "./commands/cards-admin.js";
import { data as cardsOwnerCommand, cardsReleaseCommand, RELEASE_LIFECYCLE_SUBCOMMANDS } from "./commands/cards-owner.js";
import { buildCardCommandRegistration } from "./services/card-command-registration.js";
import { isCardGameTestMode } from "./services/card-game-mode.js";
import { planCommandScopes } from "./services/command-registration-scopes.js";
import { data as testPointsCommand } from "./commands/test-points.js";
import { data as pointsAdminCommand } from "./commands/points-admin.js";
import { data as pointsObserveCommand } from "./commands/points-observe.js";
import { data as helpCommand } from "./commands/help.js";
import { data as partyCommand } from "./commands/party.js";

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
  giveawayCommand,
  trialCommand,
  ...(process.env.ENABLE_TEST_POINTS === "1" ? [testPointsCommand] : []),
  pointsAdminCommand,
  pointsObserveCommand,
  helpCommand,
  partyCommand,
].map((command) => command.toJSON());

// Publish ordinary commands in one scope only. The optional guild endpoint
// contains *only* test-only card commands; PUT [] removes stale guild copies
// of global commands created by older registration scripts.
const { globalCommands, guildCommands } = planCommandScopes({
  commonCommands: commands,
  globalCardCommands,
  testGuildCardCommands,
  guildId,
  testMode: isCardGameTestMode(),
});
await rest.put(Routes.applicationCommands(clientId), { body: globalCommands });

console.log(
  "Registered global profile, profile-cleanup, profile-refresh, inventory-video, house, outfit, trade-vote, setup, admin-import, shop, giveaway, trial, points-admin, help, party commands.",
);

if (guildId) {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: guildCommands,
  });

  console.log(`Synchronized ${guildCommands.length} guild-only testing commands for server ${guildId}; removed stale duplicates of global commands.`);
}
}
