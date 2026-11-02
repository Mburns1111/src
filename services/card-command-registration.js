import { isCardGameEnabled, isCardGameTestMode } from "./card-game-mode.js";

const LIVE_ARTWORK_TOOLS = new Set(["art-upload", "art-list", "art-info", "art-review"]);

export function buildCardCommandRegistration({
  env = process.env, playerCards, cardsAdminCommand, cardsOwnerCommand,
  cardsReleaseCommand, ownerCardOptions, releaseSubcommands,
}){
  const enabled = isCardGameEnabled(env);
  const testing = isCardGameTestMode(env);
  const legacyOwner = cardsOwnerCommand.toJSON().options.filter(
    option => !releaseSubcommands.includes(option.name)
  );
  const artwork = ownerCardOptions.toJSON().options.filter(
    option => testing || LIVE_ARTWORK_TOOLS.has(option.name)
  );
  const owner = {
    ...cardsOwnerCommand.toJSON(),
    default_member_permissions: "0",
    options: [...legacyOwner, ...artwork],
  };
  const release = { ...cardsReleaseCommand, default_member_permissions: "0" };
  const guildAdmin = cardsAdminCommand.toJSON();
  const player = playerCards.toJSON();
  const cardCommands = enabled ? [player, guildAdmin, owner, release] : [];

  for (const command of cardCommands) {
    if (command.options.length > 25)
      throw Error("Discord command subcommand limit exceeded: " + command.name);
    const names = command.options.map(option => option.name);
    if (new Set(names).size !== names.length)
      throw Error("Duplicate Discord subcommand: " + command.name);
  }
  // In test mode the card commands exist ONLY in the test guild.
  // In production only approved user/admin tools are GLOBAL across guilds.
  return {
    globalCardCommands: enabled && !testing ? cardCommands : [],
    testGuildCardCommands: testing ? cardCommands : [],
  };
}
