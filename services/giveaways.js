import { randomInt } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import Giveaway from "../models/Giveaway.js";
import { prizeClaimLines } from "./giveaway-claims.js";
import { MAX_TRIAL_ENTRANTS, survivalAnnouncement, publishSurvivalAnnouncement } from "./survival-giveaways.js";

export const GIVEAWAY_MAX_MINUTES = 60 * 24 * 14;
export const GIVEAWAY_MAX_WINNERS = 10;

export function chooseGiveawayWinners(entrantIds, count, excluded = []) {
  if (!Number.isInteger(count) || count < 0 || count > GIVEAWAY_MAX_WINNERS) throw Error("Invalid number of winners.");
  const excludedIds = new Set(excluded);
  const candidates = [...new Set(entrantIds)].filter(id => !excludedIds.has(id));
  for (let i = 0; i < Math.min(count, candidates.length); i += 1) {
    const j = i + randomInt(candidates.length - i);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

export function giveawayAnnouncement(record) {
  if (record.mode === "survival") return survivalAnnouncement(record);
  const ended = record.status === "ended" || record.status === "rerolling";
  const finishing = record.status === "closing";
  const endUnix = Math.floor(new Date(record.endsAt).getTime() / 1000);
  const winners = (record.winnerIds || []).map((id, i) => `${i + 1}. <@${id}>`);
  const changed = (record.rerollHistory || []).slice(-8).map(item =>
    `#${item.slot + 1}: <@${item.previousId}> → <@${item.replacementId}>`);
  const activity = record.mode === "activity";
  const foxStory = activity ? (ended ? "🥀 Activity giveaway concluded." : "🥀 Activity entries are locked; no manual entry.") : ended
    ? winners.length === 1
      ? `🦊 **The fox cackles:** "My sneaky helper <@${record.winnerIds[0]}> distracted <@${record.creatorId}> while I swiped the prize straight from their pocket! What a marvelous heist!"`
      : winners.length > 1
        ? `🦊 **The fox cackles:** "My clever helpers pulled off the great pocket heist! We snatched the prizes right out of <@${record.creatorId}>'s pocket. Not a whisker out of place!"`
        : `🦊 **The fox sighs:** "No accomplice showed up, so the prize stays tucked in <@${record.creatorId}>'s pocket. Foiled again!"`
    : `🦊 **The fox whispers:** "Psst! I spotted something shiny in <@${record.creatorId}>'s pocket. Enter below and you might be the accomplice I need to swipe the prize!"`;
  const lines = [
    foxStory,
    "",
    record.prize.slice(0, 1800),
    "",
    `**Hosted by:** <@${record.creatorId}>`,
    ended ? `**Final entries:** ${record.entrantIds?.length || 0} · **Winners:** ${record.winnerCount}` : activity ? `**Locked entries:** ${record.entrantIds?.length || 0} · **Winners:** ${record.winnerCount}` : `**Winners:** ${record.winnerCount} · Tap **Entry Count** for the live total`,
    ended
      ? `**Ended:** <t:${endUnix}:F>`
      : finishing ? "**Selecting winners…**" : `**Ends:** <t:${endUnix}:F> (<t:${endUnix}:R>)`,
    ...(record.requiredRoleId ? [`**Required role:** <@&${record.requiredRoleId}>`] : []),
    ...(!ended ? prizeClaimLines(record) : []),
    ...(record.rules ? ["", "**Rules / Requirements:**", record.rules.slice(0, 1300)] : []),
  ];
  if (ended) {
    lines.push("", "**Winners**", ...(winners.length ? winners : ["No eligible entries — no winner was selected."]));
    const claims = prizeClaimLines(record, { finished: true });
    if (claims.length) lines.push("", ...claims);
    if (changed.length) lines.push("", "**Reroll history**", ...changed);
    lines.push("", "*Prize delivery is handled by the giveaway host.*");
  }
  const description = lines.join("\n").slice(0, 4000);
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x86738d : 0xb47e99)
    .setTitle((ended ? "🦊 Heist Complete · " : "🦊 The Fox\u2019s Giveaway · ") + record.title.slice(0, 180))
    .setDescription(description)
    .setFooter({ text: `Giveaway ID: ${record._id} · This announcement is kept after the giveaway ends` });
  const components = (!activity && !ended && !finishing && record.status === "open")
    ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`giveaway:enter:${record._id}`).setLabel("Enter Giveaway").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`giveaway:leave:${record._id}`).setLabel("Leave").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`giveaway:count:${record._id}`).setLabel("Entry Count").setStyle(ButtonStyle.Secondary),
      )]
    : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

export async function joinGiveaway({ id, guildId, userId, mode = "standard", now = new Date() }) {
  const updated = await Giveaway.updateOne({
    _id: id, guildId, status: "open", endsAt: { $gt: now },
    ...(mode === "survival" ? { mode: "survival", [`entrantIds.${MAX_TRIAL_ENTRANTS - 1}`]: { $exists: false } } : { mode: "standard" }),
  }, { $addToSet: { entrantIds: userId } });
  if (updated.modifiedCount) return "joined";
  const current = await Giveaway.findOne({ _id: id, guildId })
    .select("status endsAt entrantIds").lean();
  if (!current || current.status !== "open" || new Date(current.endsAt) <= now) return "ended";
  if (current.entrantIds?.includes(userId)) return "already";
  if (mode === "survival" && current.entrantIds?.length >= MAX_TRIAL_ENTRANTS) return "full";
  return "unavailable";
}

export async function leaveGiveaway({ id, guildId, userId, now = new Date() }) {
  const changed = await Giveaway.updateOne({
    _id: id, guildId, status: "open", endsAt: { $gt: now },
    mode: { $ne: "activity" }, entrantIds: userId,
  }, { $pull: { entrantIds: userId } });
  if (changed.modifiedCount) return "left";
  const current = await Giveaway.findOne({ _id: id, guildId })
    .select("status endsAt entrantIds").lean();
  if (!current || current.status !== "open" || new Date(current.endsAt) <= now) return "ended";
  return current.entrantIds?.includes(userId) ? "unavailable" : "not-entered";
}

export async function closeGiveaway({ id, guildId, now = new Date(), client = null }) {
  let item = await Giveaway.findOneAndUpdate(
    { _id: id, guildId, mode: { $ne: "survival" }, status: "open" },
    { $set: { status: "closing" } },
    { returnDocument: "after" },
  ).lean();
  if (!item) item = await Giveaway.findOne({ _id: id, guildId }).lean();
  if (!item || item.mode === "survival" || !["closing", "ended"].includes(item.status)) return item;
  if (item.status === "ended") return item;
  let eligible = item.entrantIds || [];
  if (item.mode === "activity") {
    if (!client) throw Error("Discord client required to verify activity entrants.");
    const guild = await client.guilds.fetch(item.guildId);
    const verified = [];
    for (const id of [...new Set(eligible)]) {
      try { await guild.members.fetch({user:id,force:true}); verified.push(id); }
      catch(error) { if (error.code !== 10007 && error.status !== 404) throw error; }
    }
    eligible = verified;
  }
  const winnerIds = chooseGiveawayWinners(eligible, item.winnerCount);
  const changed = await Giveaway.findOneAndUpdate(
    { _id: id, guildId, status: "closing" },
    { $set: { status: "ended", winnerIds, ...(item.mode === "activity" ? {activityVerifiedIds:eligible} : {}), claimStartedAt: now, renderedAt: null }, $inc: { renderVersion: 1 } },
    { returnDocument: "after" },
  ).lean();
  return changed || Giveaway.findOne({ _id: id, guildId }).lean();
}

export async function rerollGiveaway({ id, guildId, staffId, slot }) {
  const item = await Giveaway.findOne({ _id: id, guildId, status: "ended" }).lean();
  if (!item) throw Error("That giveaway is not finished or does not exist.");
  if (!Number.isInteger(slot) || slot < 0 || slot >= item.winnerIds.length)
    throw Error("Choose an existing winner number to reroll.");
  const used = [...item.winnerIds, ...(item.rerollHistory || []).flatMap(x => [x.previousId, x.replacementId])];
  if (!chooseGiveawayWinners(item.mode === "activity" ? item.activityVerifiedIds || [] : item.entrantIds || [], 1, used).length)
    throw Error("There are no unused entrants left for a reroll.");
  const reserved = await Giveaway.findOneAndUpdate(
    { _id: id, guildId, status: "ended" },
    { $set: { status: "rerolling", pendingRerollSlot: slot, pendingRerollStaffId: staffId, renderedAt: null } },
    { returnDocument: "after" },
  ).lean();
  if (!reserved) throw Error("Another staff member is updating this giveaway. Try again.");
  return finishPendingReroll(reserved);
}

export async function finishPendingReroll(item) {
  if (item.status !== "rerolling") return item;
  const slot = item.pendingRerollSlot;
  if (!Number.isInteger(slot) || slot < 0 || slot >= item.winnerIds.length)
    throw Error("Giveaway reroll state requires staff repair.");
  const used = [...item.winnerIds, ...(item.rerollHistory || []).flatMap(x => [x.previousId, x.replacementId])];
  const replacementId = chooseGiveawayWinners(item.entrantIds || [], 1, used)[0];
  if (!replacementId) throw Error("No unused entrants remain.");
  const previousId = item.winnerIds[slot];
  const winnerIds = [...item.winnerIds];
  winnerIds[slot] = replacementId;
  const changed = await Giveaway.findOneAndUpdate({
    _id: item._id, status: "rerolling", pendingRerollSlot: slot,
  }, {
    $set: { winnerIds, status: "ended", pendingRerollSlot: null, pendingRerollStaffId: "", renderedAt: null },
    $push: { rerollHistory: { slot, previousId, replacementId, staffId: item.pendingRerollStaffId, at: new Date() } },
    $inc: { renderVersion: 1 },
  }, { returnDocument: "after" }).lean();
  return changed || Giveaway.findById(item._id).lean();
}

export async function publishGiveawayResult(client, item) {
  if (item?.mode === "survival") {
    if (!item?.messageId || !["ended", "cancelled", "running"].includes(item.status)) return false;
    await publishSurvivalAnnouncement(client, item);
    return true;
  }
  if (!item?.messageId || !["ended", "open"].includes(item.status)) return false;
  const channel = await client.channels.fetch(item.channelId);
  if (!channel?.messages?.fetch) throw Error("Giveaway channel is inaccessible.");
  const message = await channel.messages.fetch(item.messageId);
  if (message.author?.id !== client.user?.id) throw Error("Giveaway message is not authored by this bot.");
  await message.edit(giveawayAnnouncement(item));
  if (item.status === "ended") {
    await Giveaway.updateOne(
      { _id: item._id, status: "ended", renderVersion: item.renderVersion },
      { $set: { renderedAt: new Date() } },
    );
  }
  return true;
}

export async function reconcileGiveaways(client, { now = new Date(), limit = 30 } = {}) {
  const pending = await Giveaway.find({
    $or: [
      { status: "open", mode: { $ne: "survival" }, endsAt: { $lte: now } },
      { status: "closing" },
      { status: "rerolling" },
      { status: "ended", renderedAt: null },
      { status: "cancelled", mode: "survival", renderedAt: null },
      { status: "running", mode: "survival", renderedAt: null },
    ],
  }).sort({ endsAt: 1 }).limit(limit).lean();
  for (const candidate of pending) {
    try {
      let latest = candidate;
      if (candidate.status === "rerolling") latest = await finishPendingReroll(candidate);
      if (candidate.status === "open" || candidate.status === "closing")
        latest = await closeGiveaway({ id: candidate._id, guildId: candidate.guildId, now, client });
      if (["ended", "cancelled", "running"].includes(latest?.status) && !latest.renderedAt)
        await publishGiveawayResult(client, latest);
    } catch (error) {
      console.error("[Giveaways] Reconciliation failed for", String(candidate._id), error);
    }
  }
  return pending.length;
}
