import { randomInt, randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import Giveaway from "../models/Giveaway.js";
import { SOLO_TRIAL_EVENTS, DUEL_TRIAL_EVENTS } from "./survival-event-texts.js";

export const MAX_TRIAL_ENTRANTS = 120;
export const TRIAL_SPEED_CHOICES = [2, 3, 5];
export const DEFAULT_TRIAL_SPEED_SECONDS = 5;
export const MAX_TRIAL_SIGNUP_MINUTES = 1440;

function pick(items) { return items[randomInt(items.length)]; }
function shuffledUnique(ids) {
  const values = [...new Set(ids)];
  for (let i = values.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

export function planSurvivalTrial(entrantIds, winnerCount = 1) {
  if (!Number.isInteger(winnerCount) || winnerCount < 1 || winnerCount > 10)
    throw Error("Choose between 1 and 10 ranked prize winners.");
  const shuffled = shuffledUnique(entrantIds);
  if (shuffled.length < 2) throw Error("At least two members must enter before the trial can begin.");
  if (shuffled.length > MAX_TRIAL_ENTRANTS)
    throw Error(`A trial supports up to ${MAX_TRIAL_ENTRANTS} entrants.`);
  const championId = shuffled[shuffled.length - 1];
  // Deal the 120 unique scenarios from a shuffled deck: no repeated text
  // during the same trial (the max is 119 eliminations for 120 entrants).
  const templateDeck = shuffledUnique([
    ...SOLO_TRIAL_EVENTS.map((text, i) => ({ templateId: `solo-${i + 1}`, text, duel: false })),
    ...DUEL_TRIAL_EVENTS.map((text, i) => ({ templateId: `duel-${i + 1}`, text, duel: true })),
  ]);
  if (shuffled.length - 1 > templateDeck.length)
    throw Error("There are not enough unique trial event templates.");
  const events = shuffled.slice(0, -1).map((victimId, index) => {
    const alive = shuffled.slice(index + 1);
    const template = templateDeck[index];
    const actorId = template.duel ? pick(alive) : "";
    return {
      victimId, actorId, templateId: template.templateId,
      description: template.text.replaceAll("{victim}", `<@${victimId}>`)
        .replaceAll("{actor}", `<@${actorId}>`),
      remaining: alive.length,
    };
  });
  const prizeWinnerIds = [championId, ...events.slice().reverse().map(event => event.victimId)]
    .slice(0, Math.min(winnerCount, shuffled.length));
  return { events, championId, prizeWinnerIds };
}

export function survivalAnnouncement(record) {
  const state = record.status;
  const ended = ["ended", "rerolling"].includes(state);
  const cancelled = state === "cancelled";
  const open = state === "open";
  const running = state === "running";
  const endUnix = Math.floor(new Date(record.endsAt).getTime() / 1000);
  const events = record.gameEvents || [];
  const completed = Math.min(record.nextEventIndex || 0, events.length);
  const lines = [
    "━━━━━━━━ ✦ ♛ ✦ ━━━━━━━━",
    "**THE ROYAL SUMMONS**",
    "",
    `**The Prize:** ${record.prize.slice(0, 1300)}`,
    "",
    `**Hosted by:** <@${record.creatorId}>`,
    `**Contestants:** ${record.entrantIds?.length || 0} · **Prize places:** ${record.winnerCount}`,
    `**Elimination pace:** every ${record.speedSeconds || DEFAULT_TRIAL_SPEED_SECONDS} seconds`,
    open
      ? `**Signup closes:** <t:${endUnix}:R> · Host clicks **Start Trial** when ready`
      : state === "preparing" ? "**Preparing the trial — contestant entries are locked.**"
      : running
        ? `**Trial in progress:** ${completed}/${events.length} eliminations · ${Math.max(0, events.length + 1 - completed)} remain`
        : cancelled ? "**Trial cancelled by staff.**" : "**Trial complete.**",
    ...(record.requiredRoleId ? [`**Required role:** <@&${record.requiredRoleId}>`] : []),
    ...(record.rules ? ["", "**Entry requirements**", record.rules.slice(0, 1000)] : []),
  ];
  if (ended) {
    lines.push("", "━━━━━━━━ ✦ ♛ ✦ ━━━━━━━━", `**Original last survivor:** <@${record.originalChampionId || record.winnerIds?.[0] || record.creatorId}>`);
    lines.push("**Prize winners**");
    for (const [i, winnerId] of (record.winnerIds || []).entries()) lines.push(`${i + 1}. <@${winnerId}>`);
    if (!record.winnerIds?.length) lines.push("No winners were selected.");
    const recent = (record.rerollHistory || []).slice(-5);
    if (recent.length) lines.push("", "**Reroll history**", ...recent.map(x =>
      `#${x.slot + 1}: <@${x.previousId}> → <@${x.replacementId}>`));
    lines.push("", `**Recorded eliminations:** ${completed}`, "*The royal verdict is also announced below. Prizes are delivered by staff.*");
  }
  if (cancelled) lines.push("", `**Eliminations completed:** ${completed}`, "*No prize winners were selected.*");
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x71537c : cancelled ? 0x777777 : running ? 0x8a456e : 0xb47796)
    .setAuthor({ name: "♛ THE CRYPTIC COURT · ROYAL CHAMBERS ♛" })
    .setTitle((ended ? "👑 Trial Complete · " : cancelled ? "🥀 Trial Cancelled · " : running ? "⚔️ The Court's Trial · " : "🥀 Join the Court's Trial · ") + record.title.slice(0, 160))
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({ text: `♛ The Cryptic Court · Trial ID: ${record._id} · Royal Archive` });
  const components = open ? [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`giveaway:enter:${record._id}`).setLabel("Join Trial").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`giveaway:leave:${record._id}`).setLabel("Leave").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`giveaway:count:${record._id}`).setLabel("Contestants").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`giveaway:launch:${record._id}`).setLabel("Start Trial (Staff)").setStyle(ButtonStyle.Primary),
    ),
  ] : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

export function survivalEventPayload(record, event, index) {
  const total = record.gameEvents.length;
  const contestants = record.entrantIds?.length || total + 1;
  const duel = Boolean(event.actorId);
  const embed = new EmbedBuilder()
    .setColor(duel ? 0x835276 : 0xa66b8b)
    .setAuthor({ name: "♛ THE CRYPTIC COURT · LIVE ROYAL TRIAL ♛" })
    .setTitle(`${duel ? "⚔️" : "🥀"} Elimination ${index + 1} of ${total}`)
    .setDescription(`━━━━━━━━ ✦ ⚔️ ✦ ━━━━━━━━\n${event.description}\n\n${event.remaining === 1
      ? "👑 **Only one survivor remains!**"
      : "*The Court awaits its next elimination…*"}\n━━━━━━━━ ✦ ♛ ✦ ━━━━━━━━`)
    .addFields(
      { name: "⚰️ Eliminated", value: `<@${event.victimId}>`, inline: true },
      { name: "🕯️ Still Standing", value: `**${event.remaining} / ${contestants}**`, inline: true },
    )
    // Stable footer lets a restarted bot recognize already-posted events.
    .setFooter({ text: `Trial ${record._id} · Event ${index + 1}` });
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

// Freeze entries with a single Mongo update BEFORE drawing the elimination
// order. A concurrent, accepted Enter click is included in this snapshot.
export async function beginSurvivalTrial({ id, guildId, now = new Date() }) {
  const prepared = await Giveaway.findOneAndUpdate(
    { _id: id, guildId, mode: "survival", status: "open", "entrantIds.1": { $exists: true } },
    { $set: { status: "preparing", gameStartedAt: now, renderedAt: null } },
    { returnDocument: "after" },
  ).lean();
  if (!prepared) {
    const candidate = await Giveaway.findOne({ _id: id, guildId, mode: "survival" }).lean();
    if (candidate?.status === "open") throw Error("At least two members must join before starting a trial.");
    throw Error("That trial is not open for a new start.");
  }
  return finishPreparingTrial(prepared, { now });
}

export async function finishPreparingTrial(prepared, { now = new Date() } = {}) {
  if (prepared.status !== "preparing" || prepared.mode !== "survival") return prepared;
  const plan = planSurvivalTrial(prepared.entrantIds || [], prepared.winnerCount);
  const updated = await Giveaway.findOneAndUpdate(
    { _id: prepared._id, guildId: prepared.guildId, mode: "survival", status: "preparing" },
    { $set: {
      status: "running", gameEvents: plan.events,
      originalChampionId: plan.championId, nextEventIndex: 0, nextEventAt: now,
      leaseUntil: new Date(0), leaseKey: "", renderedAt: null,
    } }, { returnDocument: "after" },
  ).lean();
  if (updated) return updated;
  // Another worker may have resumed the same frozen game.
  const current = await Giveaway.findOne({ _id: prepared._id, guildId: prepared.guildId }).lean();
  if (current?.status === "running") return current;
  throw Error("This trial is being updated by another staff member.");
}

export async function cancelSurvivalTrial({ id, guildId, now = new Date() }) {
  const updated = await Giveaway.findOneAndUpdate(
    { _id: id, guildId, mode: "survival", status: { $in: ["open", "preparing", "running"] } },
    { $set: {
      status: "cancelled", gameEndedAt: now,
      winnerIds: [], renderedAt: null,
    }, $inc: { renderVersion: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!updated) throw Error("This trial is not open or running, so it cannot be cancelled.");
  return updated;
}

/**
 * The distinct final message appears after the final elimination, and is
 * edited (not reposted) when staff reroll one prize place. The embedded
 * marker supports crash recovery when Discord accepts a post before its
 * message ID is committed to MongoDB.
 */
export function survivalFinalePayload(record) {
  const championId = record.originalChampionId || record.winnerIds?.[0];
  const ranked = (record.winnerIds || []).slice(0, 10)
    .map((id, index) => (index + 1) + ". <@" + id + ">");
  const changes = (record.rerollHistory || []).slice(-8)
    .map(item => "#" + (item.slot + 1) + " · <@" + item.previousId + "> → <@" + item.replacementId + ">");
  const lines = [
    "━━━━━━━━━━ ✦ ♛ ✦ ━━━━━━━━━━",
    "🏰 **THE COURT HAS SPOKEN**",
    "",
    championId ? "👑 **The Last Survivor:** <@" + championId + ">" : "**No survivor was recorded.**",
    "",
    "**Royal Prize:**",
    record.prize.slice(0, 1300),
    "",
    "**The Roll of Honour**",
    ...(ranked.length ? ranked : ["No prize winners recorded."]),
    ...(changes.length ? ["", "**Royal Reroll Record**", ...changes] : []),
    "",
    "**Contestants:** " + (record.entrantIds?.length || 0)
      + " · **Eliminations:** " + (record.nextEventIndex || 0),
    "",
    "🥀 *The final decree is recorded. Prizes are delivered by staff, not automatically.*",
    "━━━━━━━━━━ ✦ ♛ ✦ ━━━━━━━━━━",
  ];
  const embed = new EmbedBuilder()
    .setColor(0x71537c)
    .setAuthor({ name: "♛ THE CRYPTIC COURT · ROYAL VERDICT ♛" })
    .setTitle("👑 TRIAL COMPLETE · " + String(record.title).slice(0, 160))
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({ text: "♛ Trial " + record._id + " · Finale" });
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

export async function publishSurvivalFinale(client, record, { now = new Date() } = {}) {
  if (record.status !== "ended") return false;
  // Acquire a separate lease. Eliminations have their own lock; this one
  // prevents simultaneous recovery workers from posting two royal verdicts.
  const key = randomUUID();
  const current = await Giveaway.findOneAndUpdate({
    _id: record._id, guildId: record.guildId, mode: "survival", status: "ended",
    $or: [{ finaleLeaseUntil: { $lte: now } }, { finaleLeaseUntil: null }],
  }, {
    $set: { finaleLeaseKey: key, finaleLeaseUntil: new Date(now.getTime() + 45000) },
  }, { returnDocument: "after" }).lean();
  if (!current) throw Error("Final trial verdict is being posted by another worker; retry later.");

  try {
    const channel = await client.channels.fetch(record.channelId);
    if (!channel?.messages?.fetch || !channel?.send) throw Error("Cannot publish the Court's final verdict in this channel.");
    const marker = "♛ Trial " + record._id + " · Finale";
    let message;
    if (current.finaleMessageId) {
      message = await channel.messages.fetch(current.finaleMessageId).catch(() => null);
    }
    if (!message) {
      // Search the latest bot messages for a previously published verdict
      // before sending. This reconciles a crash between Discord send and DB save.
      const recent = await channel.messages.fetch({ limit: 100 });
      message = recent.find(item => item.author?.id === client.user?.id
        && item.embeds?.some(embed => embed.footer?.text === marker));
    }
    const payload = survivalFinalePayload(record);
    if (message) await message.edit(payload);
    else message = await channel.send(payload);

    // Saving the ID guarantees a stable message for rerolls and restarts.
    await Giveaway.updateOne(
      { _id: record._id, guildId: record.guildId, finaleLeaseKey: key },
      { $set: { finaleMessageId: message.id } },
    );
    return true;
  } finally {
    await Giveaway.updateOne(
      { _id: record._id, finaleLeaseKey: key },
      { $set: { finaleLeaseKey: "", finaleLeaseUntil: null } },
    ).catch(error => console.error("[Trials] Could not release verdict lock:", error));
  }
}

export async function publishSurvivalAnnouncement(client, record) {
  const channel = await client.channels.fetch(record.channelId);
  if (!channel?.messages?.fetch) throw Error("Cannot read the giveaway channel.");
  const message = await channel.messages.fetch(record.messageId);
  if (message.author?.id !== client.user?.id) throw Error("Cannot edit an announcement from another bot.");
  await message.edit(survivalAnnouncement(record));
  if (record.status === "ended") await publishSurvivalFinale(client, record);
  if (["running", "ended", "cancelled"].includes(record.status)) {
    await Giveaway.updateOne(
      { _id: record._id, status: record.status, renderVersion: record.renderVersion },
      { $set: { renderedAt: new Date() } },
    );
  }
}

async function findOrSendEvent(client, record, event, index) {
  const channel = await client.channels.fetch(record.channelId);
  if (!channel?.messages?.fetch || !channel?.send) throw Error("Cannot post in trial channel.");
  const marker = `Trial ${record._id} · Event ${index + 1}`;
  // A process crash may occur after Discord accepts a post but before the
  // database confirms it. Reuse that message rather than posting it twice.
  const recent = await channel.messages.fetch({ limit: 100 });
  const prior = recent.find(message => message.author?.id === client.user?.id
    && message.embeds?.some(embed => embed.footer?.text === marker));
  if (prior) return prior;
  return channel.send(survivalEventPayload(record, event, index));
}

export async function runSurvivalTrialStep(client, item, { now = new Date() } = {}) {
  if (item.status !== "running" || new Date(item.nextEventAt) > now) return false;
  const leaseKey = randomUUID();
  const record = await Giveaway.findOneAndUpdate(
    {
      _id: item._id, mode: "survival", status: "running",
      nextEventIndex: item.nextEventIndex, nextEventAt: { $lte: now },
      $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: null }],
    },
    { $set: { leaseKey, leaseUntil: new Date(now.getTime() + 45000) } },
    { returnDocument: "after" },
  ).lean();
  if (!record) return false;
  try {
    const index = record.nextEventIndex;
    const event = record.gameEvents[index];
    if (!event) throw Error("Trial has no next elimination event.");
    const message = await findOrSendEvent(client, record, event, index);
    const finishing = index + 1 === record.gameEvents.length;
    const winnerIds = finishing
      ? [record.originalChampionId, ...record.gameEvents.slice().reverse().map(x => x.victimId)]
          .slice(0, Math.min(record.winnerCount, record.entrantIds.length))
      : [];
    const update = {
      $set: {
        nextEventIndex: index + 1,
        nextEventAt: new Date(Date.now() + (record.speedSeconds || DEFAULT_TRIAL_SPEED_SECONDS) * 1000),
        leaseUntil: new Date(0), leaseKey: "",
        ...(finishing ? { status: "ended", winnerIds, gameEndedAt: new Date(), renderedAt: null } : {}),
      },
      $push: { eliminationMessages: { index, messageId: message.id, sentAt: new Date() } },
      ...(finishing ? { $inc: { renderVersion: 1 } } : {}),
    };
    const result = await Giveaway.findOneAndUpdate(
      { _id: record._id, status: "running", leaseKey, nextEventIndex: index },
      update, { returnDocument: "after" },
    ).lean();
    if (result?.status === "ended") {
      try { await publishSurvivalAnnouncement(client, result); }
      catch (error) { console.error("[Trials] Final results saved; announcement edit will retry:", error); }
    }
    return Boolean(result);
  } finally {
    // Safe no-op after the successful CAS (which clears the lease).
    await Giveaway.updateOne(
      { _id: record._id, leaseKey },
      { $set: { leaseUntil: new Date(0), leaseKey: "" } },
    ).catch(error => console.error("[Trials] Could not release trial lock:", error));
  }
}

export async function reconcileSurvivalTrials(client, { now = new Date(), limit = 8 } = {}) {
  const preparing = await Giveaway.find({ mode: "survival", status: "preparing" })
    .limit(limit).lean();
  for (const item of preparing) {
    try { await finishPreparingTrial(item, { now }); }
    catch (error) { console.error("[Trials] Could not resume a frozen signup:", String(item._id), error); }
  }
  const due = await Giveaway.find({
    mode: "survival", status: "running", nextEventAt: { $lte: now },
    $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: null }],
  }).sort({ nextEventAt: 1 }).limit(limit).lean();
  for (const game of due) {
    try { await runSurvivalTrialStep(client, game, { now }); }
    catch (error) { console.error("[Trials] Elimination could not be posted; will retry:", String(game._id), error); }
  }
  return due.length;
}
