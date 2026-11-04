import { PermissionFlagsBits } from "discord.js";
export async function scanActivity(guild, { type, channelIds, startAt, endAt, minimum }) {
  const all = type === "general" ? [...(await guild.channels.fetch()).values()].filter(Boolean) : await Promise.all(channelIds.map(id => guild.channels.fetch(id)));
  const channels = all.filter(c => c?.messages?.fetch && c.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]) && (type !== "general" || c.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)));
  if (type === "channels" && channels.length !== channelIds.length) throw Error("Some selected channels cannot be scanned.");
  if (!channels.length) throw Error("No accessible channels.");
  const counts = new Map();
  for (const channel of channels) {
    let before;
    for (;;) {
      const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (!messages.size) break;
      for (const message of messages.values()) {
        if (message.createdTimestamp >= startAt.getTime() && message.createdTimestamp <= endAt.getTime() && !message.author.bot && !message.webhookId)
          counts.set(message.author.id, (counts.get(message.author.id) || 0) + 1);
      }
      if (messages.last().createdTimestamp < startAt.getTime() || messages.size < 100) break;
      before = messages.last().id;
    }
  }
  return { entrantIds: [...counts].filter(([, n]) => n >= minimum).map(([id]) => id), channelIds: channels.map(c => c.id) };
}
