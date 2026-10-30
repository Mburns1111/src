import { execute as executeCards } from "../commands/cards.js";

export function parseHatchemTagArguments(raw) {
  const args = String(raw || "").trim();
  if (!args) return { tag: "" };
  // The tag always comes first. Quotes allow tags containing spaces.
  // Examples:
  // .tag "cute"                     (newest owned card)
  // .tag "cute" Abyssinian Cat      (all matching owned pet copies)
  // .tag "cute" KxQOo               (one ID, or ask when duplicates exist)
  // .tag "cute" KxQOo Abc12 Def34   (exactly those card IDs)
  const first = /^"([^"]+)"(?:\s+([\s\S]+))?$/.exec(args)
    || /^(\S+)(?:\s+([\s\S]+))?$/.exec(args);
  if (!first) return { tag: "" };
  const tag = first[1].trim();
  const target = String(first[2] || "").trim();
  if (!target) return { tag };
  const namedTarget = /^"([^"]+)"$/.exec(target);
  if (namedTarget) return { tag, card_id: namedTarget[1] };
  const references = target.split(/[\s,;]+/).filter(Boolean);
  // A batch is recognized only when every token is a five-character ID.
  // If the user enters commas, let the ID validator explain malformed IDs.
  if ((references.length > 1 && references.every(value => /^[0-9A-Za-z_-]{5}$/.test(value)))
      || /[,;]/.test(target)) {
    return { tag, card_ids: references.join(" ") };
  }
  return { tag, card_id: target };
}

export function parseHatchemText(content) {
  const text = String(content || "").trim().slice(0, 1000);
  if (!text.startsWith(".")) return null;
  const found = /^\.(help|drop|collection|upgrade|create-tag|tags|tag|untag|tag-multiple|untag-multiple|delete-tag|stats|view|trade|burn)(?:\s+([\s\S]*))?$/i.exec(text);
  if (!found) return null;
  const action = found[1].toLowerCase(), args = String(found[2] || "").trim();
  if (action === "drop") return { action: "test-drop", options: { release: args || "test-s1-r1" } };
  if (action === "collection") {
    const tokens = args.split(/\s+/).filter(Boolean);
    const member = /^<@!?\d{17,20}>$/.test(tokens[0] || "") ? tokens.shift() : "";
    return { action, options: { member, tag: tokens.join(" ").replace(/^"|"$/g, "") } };
  }
  if (action === "upgrade") return { action, options: { card: args } };
  if (action === "tag") return { action, options: parseHatchemTagArguments(args) };
  if (action === "create-tag") return { action, options: { tag: args.replace(/^"|"$/g, "") } };
  if (["untag", "stats", "view"].includes(action)) return { action, options: { card_id: args } };
  if (action === "tag-multiple") {
    const [tag, ...ids] = args.split(/\s+/);
    return { action, options: { tag: tag || "", card_ids: ids.join(" ") } };
  }
  if (action === "untag-multiple") return { action, options: { card_ids: args } };
  if (action === "delete-tag") return { action, options: { tag: args } };
  return { action, options: {} };
}

export const HATCHEM_GUIDE = [
  "**🥚 Hatchem — Hatch, Collect & Upgrade!**",
  "Type a command starting with a dot (.) here, or use /cards:",
  ".collection [tag] or .collection @member [tag] — filter collection",
  ".upgrade [pet name or card ID] — combine four matching cards",
  '.create-tag cute · .tags · .tag "cute" (newest card)',
  '.tag "cute" 2D Doggy (all copies) · .untag abys',
  ".stats [card ID] · .view [card ID]",
  ".drop — staff-only test egg",
  ".help — list more commands",
  "Trade and burn are planned, not enabled yet.",
].join("\n");

export const HATCHEM_HELP = [
  "**🥚 Hatchem typed commands — start with a dot (.)**",
  ".drop — staff test egg (test-s1-r1)",
  ".collection or .collection cute — optionally filter by tag",
  ".collection @member or .collection @member cute — public collection",
  ".upgrade Pet Name or .upgrade CardID — confirm a four-card upgrade",
  '.create-tag cute — save a tag · .tags — list saved tags',
  '.tag "cute" — tag your newest owned card',
  '.tag "cute" 2D Doggy — select one or all matching pet copies',
  '.tag "cute" KxQOo — target a card ID (ask one/all if duplicates)',
  '.tag "cute" KxQOo Abc12 Def34 — tag only these card IDs',
  '.tag "Very Cute" Abyssinian Cat — a tag containing spaces',
  '.untag abys — confirm before removing tags',
  ".tag-multiple Favorites ID1,ID2 · .untag-multiple ID1,ID2",
  ".delete-tag Favorites · .stats abys · .view abys",
  ".trade and .burn — coming later; not active",
  "Tag FIRST, then pet name or IDs. Pet names and tags ignore capitalization.",
].join("\n");

export async function runHatchemText(message, parsed) {
  if (!parsed) return false;
  if (parsed.action === "help" || ["trade", "burn"].includes(parsed.action)) {
    const content = parsed.action === "help" ? HATCHEM_HELP :
      "That Hatchem feature isn't ready yet. Trade and burn do not change cards or Points.";
    await message.reply({ content, allowedMentions: { parse: [] } });
    return true;
  }
  const match = /^<@!?(\d{17,20})>$/.exec(parsed.options.member || "");
  const target = match ? (message.mentions.users.get(match[1]) ||
    await message.client.users.fetch(match[1]).catch(() => null)) : null;
  if (match && !target) {
    await message.reply({ content: "That member could not be found.", allowedMentions: { parse: [] } });
    return true;
  }
  if (parsed.action === "upgrade" && !parsed.options.card) {
    await message.reply({ content: "Use .upgrade followed by a pet name or card ID.", allowedMentions: { parse: [] } });
    return true;
  }
  if (parsed.action === "tag" && !parsed.options.tag) {
    await message.reply({ content: 'Use .tag "cute" for your newest card, .tag "cute" 2D Doggy for a pet, or .tag "cute" KxQOo Abc12 for multiple IDs.', allowedMentions: { parse: [] } });
    return true;
  }
  let response = null;
  const options = parsed.options;
  const facade = {
    user: message.author, guild: message.guild, guildId: message.guildId,
    channel: message.channel, channelId: message.channelId,
    memberPermissions: message.member?.permissions,
    options: {
      getSubcommand: () => parsed.action,
      getString: key => options[key] || null,
      getUser: key => key === "member" ? target : null,
      getInteger: () => null,
      getAttachment: () => null,
    },
    editReply: async payload => {
      const body = typeof payload === "string" ? { content: payload } : payload;
      const data = { ...body, allowedMentions: body.allowedMentions || { parse: [] } };
      response = response ? await response.edit(data) : await message.reply(data);
      return response;
    },
  };
  try {
    await executeCards(facade);
  } catch (error) {
    console.error("[Hatchem] Text command failed:", error);
    await message.reply({ content: "Hatchem couldn't complete that command. Please try again.", allowedMentions: { parse: [] } });
  }
  return true;
}
