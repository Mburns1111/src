import { randomInt, randomUUID } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import Giveaway from "../models/Giveaway.js";

export const MAX_TRIAL_ENTRANTS = 120;
export const TRIAL_SPEED_CHOICES = [2, 3, 5];
export const MAX_TRIAL_SIGNUP_MINUTES = 1440;

const soloEvents = [
  "🥀 {victim} stepped into the thorn garden. The roses decided to keep them.",
  "🦇 {victim} followed a whisper down the west corridor and was never seen again.",
  "🕯️ {victim} blew out the last candle. Something in the dark whispered, *thank you.*",
  "🐈‍⬛ {victim} crossed a black cat's path, then vanished through a trapdoor.",
  "🏰 {victim} entered a room that was not on the manor's floor plan.",
  "🪞 {victim} looked into the cursed mirror. Their reflection walked away without them.",
  "🗝️ {victim} found a golden key. The door it opened led straight out of the competition.",
  "🕸️ {victim} tried to sneak through the crypt and woke the ancient spiders.",
  "🌙 {victim} accepted an invitation to midnight tea from a suspicious ghost.",
  "🧛 {victim} challenged the manor's vampire to a staring contest. Bad idea.",
  "🐉 {victim} mistook a sleeping dragon for a very warm sofa.",
  "🎭 {victim} put on the forbidden mask. The mask got a new owner.",
  "⚰️ {victim} opened the wrong coffin and received a very stern eviction notice.",
  "👑 {victim} tried on the cursed crown. The Court had other plans.",
  "🔮 {victim} asked the crystal ball for the winner. The answer was *not you.*",
  "🌫️ {victim} wandered into the rose-colored fog and forgot the way back.",
];

const duelEvents = [
  "⚔️ {actor} challenged {victim} to a duel beneath the chandeliers. {actor} prevailed.",
  "🥀 {actor} lured {victim} into the thorn maze. Only {actor} found the exit.",
  "🦇 {actor} released the manor bats. {victim} fled the competition entirely.",
  "🗝️ {actor} locked the crypt door behind {victim}. One less contestant.",
  "♟️ {actor} defeated {victim} in the Court's enchanted chess match.",
  "🕯️ {actor} solved the candlelit riddle. {victim} chose the wrong answer.",
  "🪞 {actor} tricked {victim} into challenging their own reflection. The reflection won.",
  "🐉 {actor} escaped the dragon's chamber. {victim} was not so fortunate.",
  "🌹 {actor} offered {victim} a rose. It turned out to be a very sneaky trap.",
  "🔮 {actor} read the prophecy first and dodged the curse meant for {victim}.",
  "🎭 {actor} swapped places with {victim} at the masked ball just before the trap sprang.",
  "🏰 {actor} claimed the last safe seat at the royal banquet. {victim} was dismissed.",
];

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
  const events = shuffled.slice(0, -1).map((victimId, index) => {
    const alive = shuffled.slice(index + 1);
    const actorId = randomInt(2) === 0 ? pick(alive) : "";
    const template = actorId ? pick(duelEvents) : pick(soloEvents);
    return {
      victimId, actorId,
      description: template.replaceAll("{victim}", `<@${victimId}>`)
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
    record.prize.slice(0, 1400),
    "",
    `**Hosted by:** <@${record.creatorId}>`,
    `**Contestants:** ${record.entrantIds?.length || 0} · **Prize places:** ${record.winnerCount}`,
    `**Elimination pace:** every ${record.speedSeconds || 3} seconds`,
    open
      ? `**Signup closes:** <t:${endUnix}:R> · Host clicks **Start Trial** when ready`
      : running
        ? `**Trial in progress:** ${completed}/${events.length} eliminations · ${Math.max(0, events.length + 1 - completed)} remain`
        : cancelled ? "**Trial cancelled by staff.**" : "**Trial complete.**",
    ...(record.requiredRoleId ? [`**Required role:** <@&${record.requiredRoleId}>`] : []),
    ...(record.rules ? ["", "**Entry requirements**", record.rules.slice(0, 1000)] : []),
  ];
  if (ended) {
    lines.push("", `**Original last survivor:** <@${record.originalChampionId || record.winnerIds?.[0] || record.creatorId}>`);
    lines.push("**Prize winners**");
    for (const [i, winnerId] of (record.winnerIds || []).entries()) lines.push(`${i + 1}. <@${winnerId}>`);
    if (!record.winnerIds?.length) lines.push("No winners were selected.");
    const recent = (record.rerollHistory || []).slice(-5);
    if (recent.length) lines.push("", "**Reroll history**", ...recent.map(x =>
      `#${x.slot + 1}: <@${x.previousId}> → <@${x.replacementId}>`));
    lines.push("", `**Recorded eliminations:** ${completed}`, "*All elimination announcements remain in this channel. Prize delivery is handled by staff.*");
  }
  if (cancelled) lines.push("", `**Eliminations completed:** ${completed}`, "*No giveaway prize winners were selected.*");
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x71537c : cancelled ? 0x777777 : running ? 0x8a456e : 0xb47796)
    .setTitle((ended ? "👑 Trial Complete · " : cancelled ? "🥀 Trial Cancelled · " : running ? "⚔️ The Court's Trial · " : "🥀 Join the Court's Trial · ") + record.title.slice(0, 160))
    .setDescription(lines.join("\n").slice(0, 4000))
    .setFooter({ text: `Trial ID: ${record._id} · Permanent giveaway record` });
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
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x956488)
      .setTitle(`⚔️ Elimination ${index + 1} / ${record.gameEvents.length}`)
      .setDescription(`${event.description}\n\n**${event.remaining} contestant${event.remaining === 1 ? "" : "s"} remain.**`)
      .setFooter({ text: `Trial ${record._id} · Event ${index + 1}` })],
    allowedMentions: { parse: [] },
  };
}

export async function beginSurvivalTrial({ id, guildId, now = new Date() }) {
  const candidate = await Giveaway.findOne({ _id: id, guildId, mode: "survival" }).lean();
  if (!candidate || candidate.status !== "open")
    throw Error("That trial is not open for a new start.");
  const plan = planSurvivalTrial(candidate.entrantIds || [], candidate.winnerCount);
  const updated = await Giveaway.findOneAndUpdate(
    { _id: id, guildId, mode: "survival", status: "open" },
    { $set: {
      status: "running", gameStartedAt: now, gameEvents: plan.events,
      originalChampionId: plan.championId,
      nextEventIndex: 0, nextEventAt: now,
      leaseUntil: new Date(0), leaseKey: "", renderedAt: null,
    } }, { returnDocument: "after" },
  ).lean();
  if (!updated) throw Error("Another staff member already started this trial.");
  return updated;
}

export async function cancelSurvivalTrial({ id, guildId, now = new Date() }) {
  const updated = await Giveaway.findOneAndUpdate(
    { _id: id, guildId, mode: "survival", status: { $in: ["open", "running"] } },
    { $set: {
      status: "cancelled", gameEndedAt: now,
      winnerIds: [], renderedAt: null,
    }, $inc: { renderVersion: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!updated) throw Error("This trial is not open or running, so it cannot be cancelled.");
  return updated;
}

export async function publishSurvivalAnnouncement(client, record) {
  const channel = await client.channels.fetch(record.channelId);
  if (!channel?.messages?.fetch) throw Error("Cannot read the giveaway channel.");
  const message = await channel.messages.fetch(record.messageId);
  if (message.author?.id !== client.user?.id) throw Error("Cannot edit an announcement from another bot.");
  await message.edit(survivalAnnouncement(record));
  if (["ended", "cancelled"].includes(record.status)) {
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
        nextEventAt: new Date(Date.now() + record.speedSeconds * 1000),
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
