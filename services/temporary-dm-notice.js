import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

// Discord cannot make DM messages ephemeral. Give every temporary notice a
// Dismiss button and let the bot delete it after ten minutes when online.
const NOTICE_LIFETIME_MS = 10 * 60 * 1000;

export async function sendTemporaryDmNotice(user, content) {
  const message = await user.send({
    content,
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dm:notice:dismiss:${user.id}`)
        .setLabel("Dismiss").setStyle(ButtonStyle.Secondary),
    )],
    allowedMentions: { parse: [] },
  });
  const expiry = setTimeout(() => {
    void message.delete().catch(error => {
      if (Number(error?.code) !== 10008) {
        console.warn("Could not remove a temporary DM notice:", error);
      }
    });
  }, NOTICE_LIFETIME_MS);
  expiry.unref?.();
  return message;
}

export async function handleTemporaryDmNotice(interaction) {
  const [, type, action, ownerId] = interaction.customId.split(":");
  if (type !== "notice" || action !== "dismiss" || ownerId !== interaction.user.id ||
      !interaction.channel?.isDMBased()) {
    return false;
  }
  await interaction.deferUpdate();
  try {
    await interaction.message.delete();
  } catch (error) {
    if (Number(error?.code) !== 10008) throw error;
  }
  return true;
}
