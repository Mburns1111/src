import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import UserProfile from "../models/UserProfile.js";
import { UserFacingError } from "./errors.js";
import { requireGuild } from "./shared.js";

export const data = new SlashCommandBuilder()
  .setName("profile-cleanup")
  .setDescription("Remove profile posts for members who have left the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

const errorCode = error => Number(error?.code ?? error?.rawError?.code);

/**
 * A stale saved ID may point to someone else's message. Never delete that
 * message, and never forget our own message if deletion failed temporarily.
 */
export async function retireProfileMessage(guild, channelId, messageId) {
  if (!messageId) return { resolved: true, deleted: false };
  if (!channelId) return { resolved: false, deleted: false, error: new Error("Missing saved channel ID") };
  try {
    const channel = await guild.channels.fetch(channelId);
    const message = await channel?.messages?.fetch(messageId);
    if (!message) return { resolved: true, deleted: false };
    if (message.author?.id !== guild.client.user.id) {
      return { resolved: true, deleted: false, otherAuthor: true };
    }
    await message.delete();
    return { resolved: true, deleted: true };
  } catch (error) {
    if ([10003, 10008].includes(errorCode(error))) {
      return { resolved: true, deleted: false };
    }
    return { resolved: false, deleted: false, error };
  }
}

/** Retire both the card and its linked details post; keep profile data. */
export async function cleanupDepartedProfiles(guild, { Profiles = UserProfile } = {}) {
  const profiles = await Profiles.find({ guildId: guild.id })
    .select("discordUserId profileCardChannelId profileCardMessageId profileDetailsMessageId")
    .lean();
  const result = { removedPosts: 0, clearedReferences: 0, skippedOtherAuthors: 0, failures: [] };
  for (const profile of profiles) {
    let member;
    try {
      member = await guild.members.fetch(profile.discordUserId);
    } catch (error) {
      if (errorCode(error) !== 10007) {
        result.failures.push({ userId: profile.discordUserId, error });
        continue;
      }
    }
    if (member) continue;
    const messages = [...new Set([profile.profileCardMessageId, profile.profileDetailsMessageId].filter(Boolean))];
    const resolved = new Map();
    for (const id of messages) {
      const status = await retireProfileMessage(guild, profile.profileCardChannelId, id);
      resolved.set(id, status);
      if (!status.resolved) result.failures.push({ userId: profile.discordUserId, messageId: id, error: status.error });
    }
    const changes = {};
    for (const key of ["profileCardMessageId", "profileDetailsMessageId"]) {
      if (profile[key] && resolved.get(profile[key])?.resolved) changes[key] = "";
    }
    const allResolved = messages.every(id => resolved.get(id)?.resolved);
    if (allResolved && profile.profileCardChannelId) changes.profileCardChannelId = "";
    if (!Object.keys(changes).length) continue;
    try {
      await Profiles.updateOne({ _id: profile._id, guildId: guild.id }, { $set: changes });
      for (const [id, status] of resolved) {
        if (!status.resolved) continue;
        if (status.deleted) result.removedPosts++;
        if (status.otherAuthor) result.skippedOtherAuthors++;
      }
      result.clearedReferences += Object.keys(changes).filter(key => key !== "profileCardChannelId").length;
    } catch (error) {
      result.failures.push({ userId: profile.discordUserId, error });
    }
  }
  return result;
}

export async function execute(interaction) {
  requireGuild(interaction);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserFacingError("Only server managers can clean up profile posts.");
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const result = await cleanupDepartedProfiles(interaction.guild);
  for (const failure of result.failures) {
    console.error(`[Profile cleanup] Could not finish ${failure.userId}:`, failure.error);
  }
  await interaction.editReply({
    content: `Profile cleanup complete. Removed ${result.removedPosts} bot-authored post(s), cleared ${result.clearedReferences} stale message reference(s). Skipped deletion of ${result.skippedOtherAuthors} message(s) owned by another author. ${result.failures.length} failure(s) require retry. Saved profile data was not deleted.`,
    allowedMentions: { parse: [] },
  });
}
