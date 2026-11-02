import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from "discord.js";
import PartyGame from "../models/PartyGame.js";
import PartyResponse from "../models/PartyResponse.js";
import PointsLedger from "../models/PointsLedger.js";
import { grantPoints } from "./points-rewards.js";
import {
  assignCourtMatchups, courtRewardPlan, safeCourtText,
  scoreCourtMatchup, COURT_MIN_PLAYERS, COURT_MAX_PLAYERS,
} from "./party-court-rules.js";

const ANSWER_MS = 90_000;
const VOTE_MS = 30_000;
const REVEAL_MS = 8_000;
const INTERMISSION_MS = 10_000;
const BATCH_SIZE = 2;
const phaseLabel = { lobby:"Lobby", answering:"Answering", voting:"Voting", reveal:"Verdict", intermission:"Between rounds", ended:"Finished", cancelled:"Cancelled" };

export function partyButton(game, action, rest = "") {
  return ["party", action, game._id, rest].filter(Boolean).join(":");
}
const button = (id, label, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const seconds = date => date ? "<t:" + Math.ceil(new Date(date).getTime() / 1000) + ":R>" : "";
const mentions = ids => ids.map(id => "<@" + id + ">").join(", ") || "Nobody yet";
const gameMatchups = game => game.matchups.slice(game.batch * BATCH_SIZE, (game.batch + 1) * BATCH_SIZE);
const topScores = game => game.players.map(userId => ({ userId, score: Number(game.scores?.[userId] || 0) }))
  .sort((a,b) => b.score - a.score || a.userId.localeCompare(b.userId));
const resultTitle = (game, index) => "**Matchup " + (index + 1) + "**";

export async function courtBatchResults(game) {
  const matchups = gameMatchups(game);
  const all = await PartyResponse.find({
    gameId: game._id, round: game.round,
    matchupIndex: { $gte: game.batch * BATCH_SIZE, $lt: (game.batch + 1) * BATCH_SIZE },
  }).lean();
  return matchups.map((match, i) => {
    const matchupIndex = game.batch * BATCH_SIZE + i;
    const records = all.filter(v => v.matchupIndex === matchupIndex);
    const answers = records.filter(v => v.kind === "answer");
    const votes = records.filter(v => v.kind === "vote");
    return { match, matchupIndex, answers, votes,
      scores: scoreCourtMatchup(match.playerIds, answers, votes, game.round) };
  });
}

export async function courtGameDisplay(game) {
  const title = "**🎭 COURT OF CHAOS — " + phaseLabel[game.phase] + "**";
  const lines = [title];
  const rows = [];
  if (game.phase === "lobby") {
    lines.push("**Players:** " + game.players.length + "/" + COURT_MAX_PLAYERS + " (minimum " + COURT_MIN_PLAYERS + ")");
    lines.push(mentions(game.players));
    lines.push("Staff can start with /party start. Everyone may spectate and vote.");
    rows.push(new ActionRowBuilder().addComponents(
      button(partyButton(game, "join"), "Join", ButtonStyle.Success),
      button(partyButton(game, "leave"), "Leave", ButtonStyle.Secondary)));
  } else if (game.phase === "answering") {
    lines.push("**Round " + game.round + "/3** — privately submit one funny answer.");
    lines.push("Answering closes " + seconds(game.phaseEndsAt) + (game.paused ? " (PAUSED)" : "") + ".");
    lines.push("Your prompt is private. You can edit your answer before time runs out.");
    rows.push(new ActionRowBuilder().addComponents(
      button(partyButton(game, "prompt"), "My Prompt & Answer", ButtonStyle.Primary)));
  } else if (game.phase === "voting" || game.phase === "reveal") {
    const results = await courtBatchResults(game);
    lines.push("**Round " + game.round + "/3** · Matchups " +
      (game.batch * BATCH_SIZE + 1) + "–" + (game.batch * BATCH_SIZE + results.length));
    if (game.phase === "voting") lines.push("Vote for your favorite answer! Closes " + seconds(game.phaseEndsAt) + (game.paused ? " (PAUSED)" : "") + ".");
    for (const { match, matchupIndex, answers, scores } of results) {
      lines.push("", resultTitle(game, matchupIndex), safeCourtText(match.prompt));
      const participants = match.playerIds.map((id, i) => ({
        id, label: String.fromCharCode(65 + i), answer: answers.find(a => a.userId === id)?.text || "",
      }));
      for (const participant of participants) {
        const answer = participant.answer ? safeCourtText(participant.answer) : "(No answer submitted)";
        lines.push("**" + participant.label + ":** " + answer +
          (game.phase === "reveal" ? " — <@" + participant.id + "> (" + (scores[participant.id] || 0) + " pts)" : ""));
      }
      if (game.phase === "voting") {
        const candidates = participants.filter(p => p.answer);
        if (candidates.length) rows.push(new ActionRowBuilder().addComponents(...candidates.map(p =>
          button(partyButton(game, "vote", game.round + ":" + matchupIndex + ":" + p.id),
            "Match " + (matchupIndex + 1) + " · " + p.label, ButtonStyle.Primary))));
      }
    }
    if (game.phase === "reveal") lines.push("", "Next stage " + seconds(game.phaseEndsAt) + ".");
  } else if (game.phase === "intermission" || game.phase === "ended") {
    lines.push(game.phase === "ended" ? "**The final verdict!**" : "Round " + game.round + " complete. Next round " + seconds(game.phaseEndsAt) + ".");
    lines.push(...topScores(game).map((p,i) => (i + 1) + ". <@" + p.userId + "> — **" + p.score + "**"));
    if (game.phase === "ended") lines.push(game.rewardsEnabled ? "AM Isa Points rewards: enabled (subject to eligibility)." : "AM Isa Points rewards: disabled.");
  } else {
    lines.push("This game was ended by staff. No rewards will be issued.");
  }
  if (game.paused) lines.push("⏸️ Staff paused the game.");
  return { content: lines.join("\n").slice(0, 1950), components: rows, allowedMentions: { parse: [] } };
}

// Publish is safe to retry after a restart. Version checks avoid sending a
// second edit on every timer tick. A later sweep corrects out-of-order edits.
export async function publishCourtGame(client, source) {
  const game = await PartyGame.findById(source._id);
  if (!game?.messageId || game.renderedVersion >= game.renderVersion) return;
  const channel = await client.channels.fetch(game.channelId);
  if (!channel?.isTextBased()) throw new Error("Court game channel is unavailable.");
  const message = await channel.messages.fetch(game.messageId);
  const display = await courtGameDisplay(game);
  await message.edit(display);
  await PartyGame.updateOne({ _id: game._id, renderVersion: game.renderVersion },
    { $set: { renderedVersion: game.renderVersion } });
}

export async function beginCourtGame(game) {
  if (game.players.length < COURT_MIN_PLAYERS) throw new Error("At least four players must join before starting.");
  const matchups = assignCourtMatchups(game.players, 1, game.category);
  const changed = await PartyGame.updateOne({
    _id: game._id, phase: "lobby", players: game.players,
  }, { $set: {
    phase: "answering", round: 1, batch: 0, matchups,
    usedPromptIds: matchups.map(m => m.promptId),
    scores: Object.fromEntries(game.players.map(id => [id, 0])),
    answeredCounts: Object.fromEntries(game.players.map(id => [id, 0])),
    phaseEndsAt: new Date(Date.now() + ANSWER_MS), paused: false,
  }, $inc: { renderVersion: 1 } });
  return changed.modifiedCount === 1;
}

export async function advanceCourtGame(game, { force = false } = {}) {
  if (!["answering", "voting", "reveal", "intermission"].includes(game.phase) || game.paused) return false;
  const now = Date.now();
  if (!force && (game.phaseEndsAt == null || new Date(game.phaseEndsAt).getTime() > now)) return false;
  const next = { phaseEndsAt: null };
  if (game.phase === "answering") {
    next.phase = "voting";
    next.batch = 0;
    next.phaseEndsAt = new Date(now + VOTE_MS);
  } else if (game.phase === "voting") {
    const results = await courtBatchResults(game);
    const scores = { ...game.scores };
    for (const result of results) for (const [id, amount] of Object.entries(result.scores))
      scores[id] = Number(scores[id] || 0) + amount;
    next.scores = scores;
    next.phase = "reveal";
    next.phaseEndsAt = new Date(now + REVEAL_MS);
  } else if (game.phase === "reveal") {
    const nextBatch = game.batch + 1;
    if (nextBatch * BATCH_SIZE < game.matchups.length) {
      next.phase = "voting";
      next.batch = nextBatch;
      next.phaseEndsAt = new Date(now + VOTE_MS);
    } else {
      const answers = await PartyResponse.find({
        gameId: game._id, round: game.round, kind: "answer", text: { $ne: "" },
      }).select("userId").lean();
      const answeredCounts = { ...game.answeredCounts };
      for (const answer of answers) answeredCounts[answer.userId] = Number(answeredCounts[answer.userId] || 0) + 1;
      next.answeredCounts = answeredCounts;
      next.completedRounds = game.round;
      if (game.round === 3) {
        next.phase = "ended";
        next.active = false;
        next.phaseEndsAt = null;
        next.finishedAt = new Date(now);
      } else {
        next.phase = "intermission";
        next.phaseEndsAt = new Date(now + INTERMISSION_MS);
      }
    }
  } else {
    const round = game.round + 1;
    const matchups = assignCourtMatchups(game.players, round, game.category, game.usedPromptIds);
    next.phase = "answering";
    next.round = round;
    next.batch = 0;
    next.matchups = matchups;
    next.usedPromptIds = [...game.usedPromptIds, ...matchups.map(m => m.promptId)];
    next.phaseEndsAt = new Date(now + ANSWER_MS);
  }
  const changed = await PartyGame.updateOne({
    _id: game._id, phase: game.phase, round: game.round, batch: game.batch,
    phaseEndsAt: game.phaseEndsAt, paused: false,
  }, { $set: next, $inc: { renderVersion: 1 } });
  return changed.modifiedCount === 1;
}

export async function settleCourtRewards(game) {
  if (game.phase !== "ended" || game.rewardSettledAt) return;
  if (!game.rewardsEnabled || game.players.length < 4 || game.completedRounds < 2) {
    await PartyGame.updateOne({ _id: game._id }, { $set: { rewardSettledAt: new Date() } });
    return;
  }
  const rankings = topScores(game);
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);
  for (const user of rankings) {
    if (Number(game.answeredCounts?.[user.userId] || 0) < 2) continue;
    const eventKey = "party:" + game._id + ":complete";
    const alreadyAwarded = await PointsLedger.exists({ guildId: game.guildId, discordUserId: user.userId, eventKey });
    if (!alreadyAwarded) {
      const prior = await PointsLedger.countDocuments({
        guildId: game.guildId, discordUserId: user.userId,
        sourceType: "party-complete", createdAt: { $gte: todayUTC },
      });
      if (prior >= 2) continue;
    }
    const rewards = courtRewardPlan(rankings, game.answeredCounts, game.completedRounds);
    const bonus = rewards.find(r => r.userId === user.userId)?.placement || 0;
    await grantPoints({
      guildId: game.guildId, userId: user.userId, eventKey,
      kind: "party", amount: 5, sourceType: "party-complete",
      sourceId: String(game._id), description: "Court of Chaos game completion",
    });
    if (bonus) await grantPoints({
      guildId: game.guildId, userId: user.userId,
      eventKey: "party:" + game._id + ":place",
      kind: "party", amount: bonus, sourceType: "party-placement",
      sourceId: String(game._id), description: "Court of Chaos placement bonus",
    });
  }
  await PartyGame.updateOne({ _id: game._id, rewardSettledAt: null }, { $set: { rewardSettledAt: new Date() } });
}

let sweeping = false;
export async function reconcileCourtGames(client) {
  if (sweeping) return;
  sweeping = true;
  try {
    const active = await PartyGame.find({ active: true }).limit(80);
    for (const game of active) {
      try {
        if (game.phaseEndsAt && !game.paused && game.phaseEndsAt.getTime() <= Date.now())
          await advanceCourtGame(game);
        await publishCourtGame(client, game);
      } catch (error) { console.error("[Party] Game reconciliation failed", String(game._id), error); }
    }
    const terminal = await PartyGame.find({
      active: false, phase: { $in: ["ended", "cancelled"] },
      $expr: { $lt: ["$renderedVersion", "$renderVersion"] },
    }).limit(30);
    for (const game of terminal) {
      try { await publishCourtGame(client, game); }
      catch (error) { console.error("[Party] Terminal message refresh failed", String(game._id), error); }
    }
    const unpaid = await PartyGame.find({ phase: "ended", rewardsEnabled: true, rewardSettledAt: null }).limit(30);
    for (const game of unpaid) {
      try { await settleCourtRewards(game); }
      catch (error) { console.error("[Party] Reward settlement failed", String(game._id), error); }
    }
  } finally { sweeping = false; }
}
