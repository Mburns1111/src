import { PermissionFlagsBits } from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import CardCollector from "../models/CardCollector.js";

export const REGISTER_FIRST_MESSAGE = "Join Hatchem first with .register in the Hatchem channel.";
export async function cardRegistrationReminder(guildId) {
  const config = await GuildConfig.findOne({ guildId }).select("hatchemChannelId").lean();
  return "Join Hatchem first with .register in " +
    (config?.hatchemChannelId ? "<#" + config.hatchemChannelId + ">" : "the Hatchem channel") + ".";
}

// Registration and the locally configured role are both required to play.
// Re-registering explicitly restores a removed role.
export async function canPlayCardGame(discordUserId, guild) {
  if (!guild || !await isRegisteredCardCollector(discordUserId, guild.id)) return false;
  const config = await GuildConfig.findOne({ guildId:guild.id }).select("cardRoleId").lean();
  if (!config?.cardRoleId) return false;
  const member = await guild.members.fetch({ user:discordUserId, force:true }).catch(() => null);
  return Boolean(member?.roles?.cache?.has(config.cardRoleId));
}

export async function isRegisteredCardCollector(discordUserId, guildId) {
  if (!discordUserId || !guildId) return false;
  return Boolean(await CardCollector.exists({
    discordUserId: String(discordUserId),
    registeredAt: { $ne: null },
    registeredGuildIds: String(guildId),
  }));
}

// Explicit opt-in only. Never call from a member join, drop, grab or award.
export async function registerCardCollector(interaction) {
  const guild = interaction.guild;
  const discordUserId = interaction.user?.id;
  if (!guild || !interaction.guildId || !discordUserId)
    throw new Error("Register inside a Discord server's Hatchem channel.");
  if (interaction.user?.bot) throw new Error("Bots cannot register as collectors.");
  const config = await GuildConfig.findOne({ guildId: interaction.guildId })
    .select("cardRoleId").lean();
  if (!config?.cardRoleId)
    throw new Error("The Card role has not been configured here. Ask a server manager to run /cards-admin setup-role first.");

  const role = await guild.roles.fetch(config.cardRoleId).catch(() => null);
  if (!role || role.id === interaction.guildId || role.managed ||
      role.permissions.has(PermissionFlagsBits.Administrator))
    throw new Error("The configured Card role is unavailable or unsafe. Ask an admin to select a normal Card role.");
  const botMember = guild.members.me ||
    await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles) ||
      role.position >= botMember.roles.highest.position)
    throw new Error("I need Manage Roles and my bot role must be above the Card role. Ask an admin to fix my permissions.");
  const member = await guild.members.fetch(discordUserId).catch(() => null);
  if (!member) throw new Error("I couldn't find your server membership. Please try again.");
  const hadRole = member.roles.cache.has(role.id);
  if (!hadRole) {
    try {
      await member.roles.add(role.id, "Member explicitly registered for Hatchem");
    } catch {
      throw new Error("I couldn't assign the Card role. Ask a server manager to check my role position and Manage Roles permission.");
    }
  }
  try {
    // Never wipe existing cards, dust, tags or other guild registrations.
    const prior = await CardCollector.findOne({ discordUserId })
      .select("registeredAt registeredGuildIds").lean();
    await CardCollector.updateOne(
      { discordUserId },
      {
        $setOnInsert: { discordUserId },
        $addToSet: { registeredGuildIds: String(interaction.guildId) },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    // Old test collectors may already have cards but no explicit registration.
    await CardCollector.updateOne(
      { discordUserId, registeredAt: null },
      { $set: { registeredAt: new Date() } },
    );
    return {
      roleId: role.id,
      firstRegistration: !prior?.registeredAt,
      newServer: !prior?.registeredGuildIds?.includes(String(interaction.guildId)),
      roleWasAdded: !hadRole,
    };
  } catch (error) {
    // Don't leave a newly granted role if MongoDB failed.
    if (!hadRole) {
      try { await member.roles.remove(role.id, "Hatchem registration did not finish"); }
      catch (rollbackError) {
        console.error("[Hatchem] Could not roll back Card role after registration failure:", rollbackError);
      }
    }
    throw error;
  }
}
