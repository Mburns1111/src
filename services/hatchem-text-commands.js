import { execute as executeCards } from "../commands/cards.js";

export function parseHatchemTagArguments(raw) {
  const args = String(raw || "").trim();
  if (!args) return { tag: "" };
  const stripQuotes = value => String(value).trim().replace(/^"|"$/g, "");
  // Double hyphen separates a multiword pet and a multiword tag.
  const separator = args.indexOf(" -- ");
  if (separator > 0) {
    return { card_id: stripQuotes(args.slice(0, separator)), tag: stripQuotes(args.slice(separator + 4)) };
  }
  const quotedReference = /^"([^"]+)"\s+(.+)$/.exec(args);
  if (quotedReference) return { card_id: quotedReference[1], tag: stripQuotes(quotedReference[2]) };
  const quotedTag = /^"([^"]+)"$/.exec(args);
  if (quotedTag) return { tag: quotedTag[1] };
  const quotedSuffix = /^(.+?)\s+"([^"]+)"$/.exec(args);
  if (quotedSuffix) return { card_id: quotedSuffix[1].trim(), tag: quotedSuffix[2] };
  // An exact five-character card ID always targets ONE copy.
  const singleId = /^([0-9A-Za-z_-]{5})\s+(.+)$/.exec(args);
  if (singleId) return { card_id: singleId[1], tag: singleId[2].trim() };
  const words = args.split(/\s+/);
  if (words.length === 1) return { tag: args };
  // All but the final word is the pet name/prefix.
  return { card_id: words.slice(0, -1).join(" "), tag: words.at(-1) };
}

export function parseHatchemText(content) {
  const text = String(content || "").trim().slice(0, 1000);
  if (!text.startsWith(".")) return null;
  const found = /^\.(help|drop|collection|upgrade|create-tag|tags|tag|untag|tag-multiple|untag-multiple|delete-tag|stats|preview|trade|burn)(?:\s+([\s\S]*))?$/i.exec(text);
  if (!found) return null;
  const action = found[1].toLowerCase(), args = String(found[2] || "").trim();
  if (action === "drop") return { action: "test-drop", options: { release: args || "test-s1-r1" } };
  if (action === "collection") return { action, options: { member: args } };
  if (action === "upgrade") return { action, options: { card: args } };
  if (action === "tag") return { action, options: parseHatchemTagArguments(args) };
  if (action === "create-tag") return { action, options: { tag: args.replace(/^"|"$/g, "") } };
  if (["untag", "stats", "preview"].includes(action)) return { action, options: { card_id: args } };
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
  ".collection [@member] — public collection",
  ".upgrade [pet name or card ID] — combine four matching cards",
  ".create-tag cute · .tags · .tag cute (newest card)",
  ".tag 2d do cute (all 2D Doggy copies) · .untag abys",
  ".stats [card ID] · .preview [card ID]",
  ".drop — staff-only test egg",
  ".help — list more commands",
  "Trade and burn are planned, not enabled yet.",
].join("\n");

export const HATCHEM_HELP = [
  "**🥚 Hatchem typed commands — start with a dot (.)**",
  ".drop — staff test egg (test-s1-r1)",
  ".collection or .collection @member — public collection",
  ".upgrade Pet Name or .upgrade CardID — confirm a four-card upgrade",
  ".create-tag cute — save a tag · .tags — list saved tags",
  ".tag cute — tag your newest owned card (even a Neon upgrade)",
  ".tag 2d do cute — every owned 2D Doggy (case-insensitive)",
  ".tag abys cute — every Abyssinian Cat · .untag abys — clear all",
  '.tag CardID Favorites — one card · .tag "My Favorite" — newest',
  '.tag 2d do "Very Cute" — all matching pets with spaced tag',
  ".tag-multiple Favorites ID1,ID2 · .untag-multiple ID1,ID2",
  ".delete-tag Favorites · .stats abys · .preview abys",
  ".trade and .burn — coming later; not active",
  "Pet names and tags ignore capitalization. A 5-character card ID targets only one owned card.",
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
  if (parsed.action === "collection" && parsed.options.member && !match) {
    await message.reply({ content: "Use .collection or .collection @member.", allowedMentions: { parse: [] } });
    return true;
  }
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
    await message.reply({ content: "Use .tag cute for your newest card, or .tag abys cute for a pet.", allowedMentions: { parse: [] } });
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
