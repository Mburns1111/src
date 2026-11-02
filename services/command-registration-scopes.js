// Prevent Discord slash commands from appearing twice in a server when both
// application-wide and server-scoped registrations exist.
export function planCommandScopes({
  commonCommands,
  globalCardCommands = [],
  testGuildCardCommands = [],
  guildId = "",
  testMode = false,
}) {
  const globalCommands = [...commonCommands, ...globalCardCommands];
  // The guild PUT must run even with an empty list. It removes stale guild
  // registrations of commands that are now provided globally.
  const guildCommands = guildId ? (testMode ? [...testGuildCardCommands] : []) : null;
  const names = (commands, scope) => {
    const seen = new Set();
    for (const cmd of commands) {
      if (!cmd || typeof cmd.name !== "string" || !cmd.name) {
        throw new Error("Missing command name in " + scope + " registration.");
      }
      if (seen.has(cmd.name)) {
        throw new Error("Duplicate " + scope + " command: " + cmd.name);
      }
      seen.add(cmd.name);
    }
    return seen;
  };
  const globalNames = names(globalCommands, "global");
  if (guildCommands !== null) {
    for (const guildName of names(guildCommands, "guild")) {
      if (globalNames.has(guildName)) {
        throw new Error("Command " + guildName + " cannot be registered globally and in a guild.");
      }
    }
  }
  return { globalCommands, guildCommands };
}
