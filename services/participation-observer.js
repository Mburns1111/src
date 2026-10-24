import ParticipationSource from "../models/ParticipationSource.js";
import NativePollParticipation from "../models/NativePollParticipation.js";

const SNOWFLAKE = /^\d{17,21}$/;
const EVENTS = new Set(["MESSAGE_POLL_VOTE_ADD", "MESSAGE_POLL_VOTE_REMOVE"]);

// Raw Gateway poll events work even if the original poll is not cached (for
// example if it was posted before the test bot restarted). No message body
// access, Message Content intent or third-party poll interactions are needed.
export function parseNativePollEvent(packet) {
  if (!EVENTS.has(packet?.t)) return null;
  const data = packet.d;
  if (!data || ![data.guild_id, data.channel_id, data.message_id, data.user_id]
    .every(value => typeof value === "string" && SNOWFLAKE.test(value))) return null;
  const answerId = Number(data.answer_id);
  if (!Number.isInteger(answerId) || answerId < 1 || answerId > 10) return null;
  return {
    guildId: data.guild_id,
    channelId: data.channel_id,
    messageId: data.message_id,
    userId: data.user_id,
    answerId,
    added: packet.t === "MESSAGE_POLL_VOTE_ADD",
  };
}

export function parseGuildMessageLink(input, guildId) {
  if (typeof input !== "string") return null;
  const match = /^https?:\/\/(?:canary\.|ptb\.)?(?:discord(?:app)?\.com)\/channels\/(\d{17,21})\/(\d{17,21})\/(\d{17,21})(?:\/)?(?:\?.*)?$/.exec(input.trim());
  if (!match || (guildId && match[1] !== guildId)) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}

export async function observeNativePollVote(parsed, {
  sources = ParticipationSource,
  participants = NativePollParticipation,
} = {}) {
  if (!parsed) return false;
  const key = { guildId: parsed.guildId, messageId: parsed.messageId };
  const userKey = { ...key, discordUserId: parsed.userId };
  const now = new Date();

  // Register the poll itself. Never overwrite a manual third-party source.
  await sources.updateOne(key, {
    $setOnInsert: {
      ...key, channelId: parsed.channelId, source: "discord-native-poll",
    },
    $set: { lastObservedAt: now },
  }, { upsert: true });

  if (parsed.added) {
    try {
      await participants.updateOne(userKey, {
        $setOnInsert: { ...userKey, channelId: parsed.channelId },
        $addToSet: { answerIds: parsed.answerId },
        $set: { lastEventAt: now },
      }, { upsert: true });
    } catch (error) {
      if (Number(error?.code) !== 11000) throw error;
      // Concurrent answers for a newly recorded multi-choice ballot may
      // race during upsert. The unique index prevents duplicates; retry.
      await participants.updateOne(userKey, {
        $addToSet: { answerIds: parsed.answerId },
        $set: { lastEventAt: now },
      });
    }
  } else {
    // Don't create an empty participant if the original vote was cast while
    // this bot was offline.
    await participants.updateOne(userKey, {
      $pull: { answerIds: parsed.answerId },
      $set: { lastEventAt: now },
    });
  }
  return true;
}

export function messageVisibility(message) {
  // Bot can fetch the message from this channel if this function is called.
  // Embeds/components of messages authored by other apps may be redacted by
  // the Message Content gateway permission; any public panel is not proof of
  // individual private votes or giveaway entries.
  return {
    authorId: message.author?.id || "",
    authorBot: Boolean(message.author?.bot),
    embedCount: message.embeds?.length ?? 0,
    componentCount: message.components?.length ?? 0,
    hasContent: Boolean(message.content),
    nativePollVisible: Boolean(message.poll),
  };
}


// Inspection-only view of PUBLIC embed content. Summaries are returned only in
// the manager's ephemeral response; no embed bodies or participant IDs are
// persisted. Never interpret a mention or winner listing as proof that all
// giveaway entrants are available for Points.
export function publicEmbedDiagnostic(message) {
  const limited = (value, max = 170) => {
    if (typeof value !== "string") return "";
    return value.replace(/<@!?\d{17,21}>/g, "[member]")
      .replace(/\b\d{17,21}\b/g, "[id]")
      .replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ")
      .replace(/@/g, "@\u200b").replace(/[`*_~|]/g, "")
      .trim().slice(0, max);
  };
  return (message.embeds || []).slice(0, 2).map((embed, index) => {
    const fields = Array.isArray(embed.fields) ? embed.fields : [];
    const text = [embed.title, embed.description,
      ...fields.flatMap(field => [field.name, field.value])].filter(Boolean).join(" ");
    const mentionedIds = new Set([...text.matchAll(/<@!?(\d{17,21})>/g)].map(m => m[1]));
    const labels = fields.slice(0, 5).map(field => limited(field.name, 42)).filter(Boolean);
    return {
      number: index + 1,
      title: limited(embed.title, 90),
      description: limited(embed.description, 170),
      fieldCount: fields.length,
      fieldLabels: labels,
      mentionCount: mentionedIds.size,
    };
  });
}


// The supported discord.js poll events provide a PollAnswer and user ID,
// rather than a raw Gateway packet. This adapter works for the cache/partial
// poll objects when their message, channel and guild can be resolved.
export function parseNativePollClientEvent(pollAnswer, userId, added) {
  const poll = pollAnswer?.poll;
  const candidate = {
    guildId: poll?.message?.guildId ?? poll?.guild?.id,
    channelId: poll?.channelId ?? poll?.message?.channelId,
    messageId: poll?.messageId ?? poll?.message?.id,
    userId,
    answerId: Number(pollAnswer?.id),
    added,
  };
  if (![candidate.guildId, candidate.channelId, candidate.messageId, candidate.userId]
    .every(value => typeof value === "string" && SNOWFLAKE.test(value))) return null;
  if (!Number.isInteger(candidate.answerId) || candidate.answerId < 1 || candidate.answerId > 10 ||
      typeof added !== "boolean") return null;
  return candidate;
}

// On-demand reconciliation for native polls, including those created before
// the bot booted or while it was offline. Discord's public API lets the bot
// retrieve voters for each answer: this is NOT supported for Arclo's polls.
// Only persist a snapshot once every page has loaded successfully so a failed
// API request cannot accidentally erase prior observations. No Points credit.
export async function syncNativePoll(message, {
  sources = ParticipationSource,
  participants = NativePollParticipation,
  fetchVoters = (msg, options) => msg.channel.messages.fetchPollAnswerVoters(options),
  maxPagesPerAnswer = 20,
} = {}) {
  if (!message?.guildId || !SNOWFLAKE.test(message.guildId) ||
      !message?.channelId || !SNOWFLAKE.test(message.channelId) ||
      !message?.id || !SNOWFLAKE.test(message.id) ||
      !message.poll?.answers) {
    throw new Error("That message is not a readable native Discord server poll.");
  }
  const answerList = [...message.poll.answers.values()];
  if (!answerList.length || answerList.length > 10) {
    throw new Error("The native poll has no readable answers.");
  }
  const ballots = new Map();
  let pages = 0;
  for (const answer of answerList) {
    const answerId = Number(answer.id);
    if (!Number.isInteger(answerId) || answerId < 1 || answerId > 10) {
      throw new Error("Invalid native poll answer ID.");
    }
    let after;
    let complete = false;
    for (let page = 0; page < maxPagesPerAnswer; page++) {
      const voters = await fetchVoters(message, {
        messageId: message.id, answerId, limit: 100, ...(after ? { after } : {}),
      });
      const batch = [...voters.values()];
      pages++;
      for (const user of batch) {
        if (!user?.bot && SNOWFLAKE.test(user?.id)) {
          if (!ballots.has(user.id)) ballots.set(user.id, new Set());
          ballots.get(user.id).add(answerId);
        }
      }
      if (batch.length < 100) { complete = true; break; }
      const lastId = batch.at(-1)?.id;
      if (!lastId || lastId === after) {
        throw new Error("Discord poll voter pagination did not advance.");
      }
      after = lastId;
    }
    if (!complete) throw new Error(
      "This poll exceeds the safe voter sync limit. No participation records were changed.");
  }

  const now = new Date();
  const key = { guildId: message.guildId, messageId: message.id };
  await sources.updateOne(key, {
    $setOnInsert: { ...key, channelId: message.channelId, source: "discord-native-poll" },
    $set: { lastObservedAt: now },
  }, { upsert: true });

  const writes = [...ballots.entries()].map(([userId, answerIds]) => ({
    updateOne: {
      filter: { ...key, discordUserId: userId },
      update: {
        $set: { channelId: message.channelId, answerIds: [...answerIds].sort((a, b) => a - b),
          lastEventAt: now },
      },
      upsert: true,
    },
  }));
  if (writes.length) await participants.bulkWrite(writes, { ordered: false });
  await participants.deleteMany({
    ...key, discordUserId: { $nin: [...ballots.keys()] },
  });
  return { voters: ballots.size, answers: answerList.length, pages };
}
