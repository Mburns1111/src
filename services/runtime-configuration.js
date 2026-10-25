export class StartupConfigurationError extends Error {
  constructor(message) { super(message); this.name = "StartupConfigurationError"; }
}
// Pure validation: never print environment values or credentials.
function required(env,name) {
  const value=typeof env[name]==="string" ? env[name].trim() : "";
  if (!value || /^(?:changeme|placeholder|your[_-].*|replace[_-].*)$/i.test(value)) {
    throw new StartupConfigurationError("Missing or placeholder "+name+" environment variable.");
  }
  return value;
}
function discordId(value,name) {
  if (!/^\d{17,20}$/.test(value))
    throw new StartupConfigurationError(name+" must be a Discord snowflake ID (17–20 digits).");
}
export function validateRuntimeConfiguration({
  env=process.env,mode="bot",nodeVersion=process.versions.node,
}={}) {
  if (!["bot","register","static"].includes(mode))
    throw new StartupConfigurationError("Unrecognized preflight mode.");
  const nodeMajor=Number(String(nodeVersion).split(".")[0]);
  if (!Number.isSafeInteger(nodeMajor) || nodeMajor<20)
    throw new StartupConfigurationError("Node.js 20 or newer is required (Node.js 22 recommended).");
  if (mode==="static") return {mode,nodeMajor};
  required(env,"DISCORD_TOKEN");
  const uri=required(env,"MONGODB_URI");
  let url;
  try { url=new URL(uri); }
  catch { throw new StartupConfigurationError("MONGODB_URI must be a valid MongoDB connection URI."); }
  if (!["mongodb:","mongodb+srv:"].includes(url.protocol) || !url.hostname)
    throw new StartupConfigurationError("MONGODB_URI must use mongodb:// or mongodb+srv://.");
  if (mode==="register") discordId(required(env,"DISCORD_CLIENT_ID"),"DISCORD_CLIENT_ID");
  const guild=typeof env.DISCORD_GUILD_ID==="string" ? env.DISCORD_GUILD_ID.trim() : "";
  if (guild) discordId(guild,"DISCORD_GUILD_ID");
  return {mode,nodeMajor,mongoProtocol:url.protocol.slice(0,-1),
    guildCommandRegistration:mode==="register" && Boolean(guild)};
}
