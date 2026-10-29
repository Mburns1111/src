import { execute as executeCards } from "../commands/cards.js";

export function parseHatchemText(content) {
  const text = String(content || "").trim().slice(0, 1000);
  const found = /^\/?(help|drop|collection|upgrade|tag|untag|tag-multiple|untag-multiple|delete-tag|stats|preview|trade|burn)(?:\s+([\s\S]*))?$/i.exec(text);
  if (!found) return null;
  const action = found[1].toLowerCase(), args = String(found[2] || "").trim();
  if (action === "drop") return { action: "test-drop", options: { release: args || "test-s1-r1" } };
  if (action === "collection") return { action, options: { member: args } };
  if (action === "upgrade") return { action, options: { card: args } };
  if (action === "tag") {
    const match = /^([0-9A-Za-z_-]{5})\s+(.+)$/.exec(args);
    return { action, options: match ? { card_id: match[1], tag: match[2].trim() } : { tag: args } };
  }
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
  "Type a command here, or use /cards:",
  "collection [@member] — public collection",
  "upgrade [pet name or card ID] — combine four matching cards",
  "tag [card ID] [tag] · untag [card ID]",
  "stats [card ID] · preview [card ID]",
  "drop — staff-only test egg",
  "help — list more commands",
  "Trade and burn are planned, not enabled yet.",
].join("\n");

export const HATCHEM_HELP = [
  "**🥚 Hatchem typed commands**",
  "drop — staff test egg (test-s1-r1)",
  "collection or collection @member — public collection",
  "upgrade Pet Name or upgrade CardID — confirm a four-card upgrade",
  "tag CardID Favorites, tag Favorites (last grab), untag CardID",
  "tag-multiple Favorites ID1,ID2 · untag-multiple ID1,ID2",
  "delete-tag Favorites · stats CardID · preview CardID",
  "trade and burn — coming later; not active",
  "Card IDs are case-sensitive; pet names are not.",
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
    await message.reply({ content: "Use collection or collection @member.", allowedMentions: { parse: [] } });
    return true;
  }
  const target = match ? (message.mentions.users.get(match[1]) ||
    await message.client.users.fetch(match[1]).catch(() => null)) : null;
  if (match && !target) {
    await message.reply({ content: "That member could not be found.", allowedMentions: { parse: [] } });
    return true;
  }
  if (parsed.action === "upgrade" && !parsed.options.card) {
    await message.reply({ content: "Use upgrade followed by a pet name or card ID.", allowedMentions: { parse: [] } });
    return true;
  }
  if (parsed.action === "tag" && !parsed.options.tag) {
    await message.reply({ content: "Use tag CardID TagName or tag TagName for the last grabbed card.", allowedMentions: { parse: [] } });
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
