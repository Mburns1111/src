import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
} from "discord.js";
import { isCardGameEnabled } from "../services/card-game-mode.js";

// This is a read-only guide: it never grants cards, registers someone, runs
// cooldowns, spends Points, or changes persistent state.
export const HATCHEM_TUTORIAL_PAGES = Object.freeze([
  Object.freeze({
    title: "Welcome to Hatchem!",
    description: [
      "🥚 **Hatch eggs, collect Adopt Me pet cards, and grow your collection.**",
      "",
      "**Start here:** Type `.register` in this server's Hatchem channel.",
      "You'll receive the local **Card role**, which is also pinged for wild eggs.",
      "Already play in another server? Register here too—your cards are shared!",
      "",
      "You can open this tutorial again whenever you like.",
    ].join("\n"),
  }),
  Object.freeze({
    title: "Find and Drop Eggs",
    description: [
      "🥚 Every egg reveals **3 pet cards**. You'll have **75 seconds** to enter.",
      "",
      "🎲 **Wild eggs** depend on server activity—not a clock. 12 meaningful messages from 3 members in 10 minutes gives a **20% chance** at an egg.",
      "📣 Wild eggs ping your server's Card role in the Hatchem channel.",
      "",
      "Want to hatch one yourself? Type `.drop`.",
      "You can make **one player drop every 15 minutes**, across all Hatchem servers.",
      "Type `.cooldowns` to check when you're ready again.",
    ].join("\n"),
  }),
  Object.freeze({
    title: "Grab a Card",
    description: [
      "🐾 When an egg appears, tap **Grab #1**, **Grab #2**, or **Grab #3**.",
      "You can enter for **one card per egg**. If other players enter for the same card, a winner is drawn when the egg ends.",
      "",
      "⭐ Whoever created a **player egg** gets priority for their chosen card. **Wild eggs** have no player with priority.",
      "⏱️ A successful grab has a **5-minute cooldown in that server**. If you don't win, your grab is refunded.",
      "",
      "Your newly won card appears in your collection after the egg closes.",
    ].join("\n"),
  }),
  Object.freeze({
    title: "View and Protect Your Cards",
    description: [
      "📚 Type `.collection` to browse your cards, or `.inventory` for your counts, Points, extras, and dust.",
      "🔎 Type `.view CARDID` to inspect one card. Every owned card has its own **5-character ID**, like `Abc12`.",
      "",
      "🔒 Type `.lock CARDID` to protect a favorite from trading, gifting, burning, or upgrading.",
      "🏷️ Use `.createtag Favorites` and `.tag Favorites CARDID` to organize your collection.",
      "",
      "Your cards, tags, and upgrades are shared across every server using Hatchem.",
    ].join("\n"),
  }),
  Object.freeze({
    title: "Make Neons, Megas, and Dust",
    description: [
      "✨ Collect **4 matching Normal cards** to make **1 Neon**.",
      "🌈 Combine **4 matching Neons** to make **1 Mega Neon**.",
      "Try `.upgrade Pet Name` or `.upgrade CARDID` to preview and confirm.",
      "",
      "🔥 Unwanted cards can be **burned** for rarity dust with `.burn CARDID`.",
      "🪄 Dust can replace missing copies during some upgrades: `.dustupgrade CARDID`.",
      "",
      "**Important:** Burning and upgrading consume cards. Review the confirmation, and lock any cards you want to keep.",
    ].join("\n"),
  }),
  Object.freeze({
    title: "Trade, Shop, and Explore!",
    description: [
      "🎁 `.give @member CARDID` sends a gift after you confirm.",
      "🤝 `.trade @member` opens a trade. Both players review and confirm before cards move.",
      "",
      "🛍️ `.shop` lets you use server Points for extra chances:",
      "• **Extra Grab — 10 Points**",
      "• **Extra Drop — 20 Points**",
      "",
      "🏆 Try `.achievements` to explore challenges, or `.show Pet Name` to display a card.",
      "",
      "Need a command reminder? Type `.help`!",
    ].join("\n"),
  }),
]);

export const TUTORIAL_BUTTON_PREFIX = "cards:tutorial:";

export function hatchemTutorialEntryRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TUTORIAL_BUTTON_PREFIX + "open")
      .setLabel("Learn to Play")
      .setEmoji("📖")
      .setStyle(ButtonStyle.Primary)
  );
}

export function hatchemTutorialPage(index) {
  if (!Number.isInteger(index) || index < 0 || index >= HATCHEM_TUTORIAL_PAGES.length)
    throw new RangeError("Invalid Hatchem tutorial page.");
  const page = HATCHEM_TUTORIAL_PAGES[index];
  const last = index === HATCHEM_TUTORIAL_PAGES.length - 1;
  const embed = new EmbedBuilder()
    .setColor(0x967D92)
    .setTitle(`🥚 Hatchem Tutorial · ${page.title}`)
    .setDescription(page.description)
    .setFooter({ text: `Page ${index + 1} of ${HATCHEM_TUTORIAL_PAGES.length} · Learn at your own pace` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TUTORIAL_BUTTON_PREFIX + "page:" + (index - 1))
      .setLabel("Back")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(index === 0),
    new ButtonBuilder()
      .setCustomId(TUTORIAL_BUTTON_PREFIX + (last ? "close" : "page:" + (index + 1)))
      .setLabel(last ? "Finish" : "Next")
      .setStyle(last ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(TUTORIAL_BUTTON_PREFIX + "close")
      .setLabel("Close")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(last),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

// Acknowledge page-navigation clicks before editing the guide. Discord requires
// component interactions to be acknowledged promptly, including on the last page.
async function editTutorialPage(interaction, payload) {
  if (typeof interaction.deferUpdate === "function" && typeof interaction.editReply === "function") {
    await interaction.deferUpdate();
    return interaction.editReply(payload);
  }
  // Keep compatibility with lightweight interaction adapters in tests.
  return interaction.update(payload);
}

export async function handleHatchemTutorialButton(interaction) {
  if (!interaction.isButton?.() || !interaction.customId?.startsWith(TUTORIAL_BUTTON_PREFIX))
    return false;
  if (!isCardGameEnabled()) {
    await interaction.reply({
      content: "Hatchem isn't open for play yet.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return true;
  }
  const action = interaction.customId.slice(TUTORIAL_BUTTON_PREFIX.length);
  if (action === "open") {
    const response = hatchemTutorialPage(0);
    await interaction.reply({
      ...response,
      ...(interaction.inGuild?.() ? { flags: MessageFlags.Ephemeral } : {}),
    });
    return true;
  }
  if (action === "close") {
    await editTutorialPage(interaction, {
      content: "📖 Tutorial finished! You can reopen it with the **Learn to Play** button or `.tutorial`.",
      embeds: [], components: [], allowedMentions: { parse: [] },
    });
    return true;
  }
  const match = /^page:(\d+)$/.exec(action);
  const index = match ? Number(match[1]) : -1;
  if (!Number.isSafeInteger(index) || index < 0 || index >= HATCHEM_TUTORIAL_PAGES.length) {
    await interaction.reply({
      content: "That tutorial page isn't available. Use **Learn to Play** to start again.",
      flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] },
    });
    return true;
  }
  await editTutorialPage(interaction, hatchemTutorialPage(index));
  return true;
}

export async function sendHatchemTutorial(message) {
  // Text messages cannot open an ephemeral reply. DM a private tutorial
  // when possible; if DMs are closed, offer an entry button in this channel.
  try {
    await message.author.send(hatchemTutorialPage(0));
    await message.reply({
      content: "📖 Your Hatchem tutorial is in your DMs! You can also use **Learn to Play** on the channel guide.",
      allowedMentions: { parse: [] },
    });
  } catch {
    await message.reply({
      content: "📖 Tap **Learn to Play** to open your private Hatchem tutorial.",
      components: [hatchemTutorialEntryRow()],
      allowedMentions: { parse: [] },
    });
  }
}
