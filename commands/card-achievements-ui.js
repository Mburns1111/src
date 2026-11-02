import {isCardGameEnabled} from "../services/card-game-mode.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { achievementPages, listCardAchievements } from "../services/card-achievements.js";

const validOwner = value => /^\d{17,20}$/.test(String(value || ""));
const PAGE_LIMIT = 9999;

/** A destination-oriented ID means navigation never needs in-memory sessions. */
function buttonId(action, view, page, ownerId) {
  // Discord rejects duplicate custom IDs even on disabled controls.
  // Include control identity to cover first, last and single-page lists.
  return `cards:achievements:${action}:${view}:${page}:${ownerId}`;
}

/**
 * Private achievements message payload. Used unchanged by slash commands,
 * DM-based dot commands and the inventory's private Achievements button.
 */
export function achievementMessage(rows, ownerId, { view = "compact", page = 1 } = {}) {
  if (!validOwner(ownerId) || !["compact", "details"].includes(view)) {
    throw new Error("Invalid achievement owner or view.");
  }
  const pages = achievementPages(rows, { detailed: view === "details" });
  const current = Number.isSafeInteger(Number(page)) ? Math.max(1, Math.min(pages.length, Number(page))) : 1;
  const count = pages.length;
  const button = (label, action, mode, destination, style, disabled = false) =>
    new ButtonBuilder()
      .setCustomId(buttonId(action, mode, destination, ownerId))
      .setLabel(label)
      .setStyle(style)
      .setDisabled(disabled);
  const row = new ActionRowBuilder().addComponents(
    button("◀ Previous", "previous", view, Math.max(1, current - 1), ButtonStyle.Secondary, current === 1),
    button("Page " + current + "/" + count, "indicator", view, current, ButtonStyle.Secondary, true),
    button("Next ▶", "next", view, Math.min(count, current + 1), ButtonStyle.Secondary, current === count),
    button(view === "details" ? "Compact" : "Show Details", "toggle",
      view === "details" ? "compact" : "details", current, ButtonStyle.Primary),
  );
  return { content: pages[current - 1], components: [row], allowedMentions: { parse: [] } };
}

export async function loadAchievementMessage(ownerId, options = {}) {
  const rows = await listCardAchievements(ownerId);
  return achievementMessage(rows, ownerId, options);
}

const deny = (interaction, content) => interaction.reply({
  content,
  ...(interaction.guildId ? { flags: MessageFlags.Ephemeral } : {}),
  allowedMentions: { parse: [] },
});

/** Page buttons are usable on slash ephemeral replies and DM messages. */
export async function handleCardAchievementButton(interaction) {
  const parts = String(interaction.customId || "").split(":");
  if (!interaction.isButton() || parts.length !== 6 ||
      parts[0] !== "cards" || parts[1] !== "achievements" ||
      !["previous", "next", "toggle"].includes(parts[2]) ||
      !["compact", "details"].includes(parts[3]) ||
      !/^[1-9]\d{0,3}$/.test(parts[4]) || !validOwner(parts[5])) {
    return deny(interaction, "That achievement page button is invalid.");
  }
  const [, , , view, pageText, ownerId] = parts;
  if (interaction.user.id !== ownerId) {
    return deny(interaction, "These are another collector's private achievements. Open your own with `.achievements`.");
  }
  if (!isCardGameEnabled())
    return deny(interaction, "Hatchem achievements are currently unavailable.");
  await interaction.deferUpdate();
  try {
    const page = Math.min(PAGE_LIMIT, Number(pageText));
    return await interaction.editReply(await loadAchievementMessage(ownerId, { view, page }));
  } catch (error) {
    console.error("[Hatchem Achievements] Page update failed:", error);
    return interaction.editReply({
      content: "Could not refresh achievements right now. Try opening them again.",
      components: [],
      allowedMentions: { parse: [] },
    });
  }
}
