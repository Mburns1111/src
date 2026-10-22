import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import UserProfile from "../models/UserProfile.js";
import { UserFacingError } from "./errors.js";
import { requireGuild } from "./shared.js";

export const data = new SlashCommandBuilder()
  .setName("profile-cleanup")
  .setDescription("Remove profile posts for members who have left the server")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

function getDiscordErrorCode(error) {
  return Number(error?.code ?? error?.rawError?.code);
}

export async function execute(interaction) {
  requireGuild(interaction);
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserFacingError("Only server admins can clean up profile posts.");
  }
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const profiles = await UserProfile.find({ guildId: interaction.guildId })
    .select("discordUserId profileCardChannelId profileCardMessageId")
    .lean();
  let removedPosts = 0;
  let clearedReferences = 0;

  for (const profile of profiles) {
    let member;
    try {
      member = await interaction.guild.members.fetch(profile.discordUserId);
    } catch (error) {
      if (getDiscordErrorCode(error) !== 10007) throw error;
    }
    if (member) continue;

    const channelId = profile.profileCardChannelId;
    const messageId = profile.profileCardMessageId;
    if (channelId && messageId) {
      try {
        const channel = await interaction.guild.channels.fetch(channelId);
        const message = await channel?.messages?.fetch(messageId);
        if (message) {
          await message.delete();
          removedPosts += 1;
        }
      } catch (error) {
        if (![10003, 10008].includes(getDiscordErrorCode(error))) throw error;
      }

      await UserProfile.updateOne(
        { _id: profile._id },
        { $set: { profileCardChannelId: "", profileCardMessageId: "" } },
      );
      clearedReferences += 1;
    }
  }

  await interaction.editReply({
    content:
      `Profile cleanup complete. Removed ${removedPosts} profile post(s) and cleared ${clearedReferences} stale profile reference(s). ` +
      "All profile records remain saved in the database.",
    allowedMentions: { parse: [] },
  });
}
