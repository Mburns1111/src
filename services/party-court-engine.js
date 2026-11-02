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

// Standard pace uses the full answer window, then votes on each question.
export const COURT_TIMINGS = Object.freeze({
  answerMs: 60_000,
  voteMs: 30_000,
  revealMs: 8_000,
  intermissionMs: 10_000,
});
const ANSWER_MS = COURT_TIMINGS.answerMs;
const VOTE_MS = COURT_TIMINGS.voteMs;
const REVEAL_MS = COURT_TIMINGS.revealMs;
const INTERMISSION_MS = COURT_TIMINGS.intermissionMs;
const BATCH_SIZE = 1;
const phaseLabel = { lobby:"Lobby", answering:"Answering", voting:"Voting", reveal:"Verdict", intermission:"Between rounds", ended:"Finished", cancelled:"Cancelled" };

export function partyButton(game, action, rest = "") {
  return ["party", action, game._id, rest].filter(Boolean).join(":");
}
const button = (id, label, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const seconds = date => date ? "<t:" + Math.ceil(new Date(date).getTime() / 1000) + ":R>" : "";
const mentions = ids => ids.map(id => "<@" + id + ">").join(", ") || "Nobody yet";
const gameMatchups = game => game.matchups.slice(game.batch * BATCH_SIZE, (game.batch + 1) * BATCH_SIZE);
const topScores = game => game.players.map(userId => ({
  userId, score: Number(game.scores?.[userId] || 0),
  finalRound: Number(game.roundScores?.["3"]?.[userId] || 0),
  wins: Number(game.matchupWins?.[userId] || 0),
})).sort((a,b) => b.score - a.score || b.finalRound - a.finalRound || b.wins - a.wins || a.userId.localeCompare(b.userId));
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
    lines.push("**Players:** " + game.players.length + "/" + COURT_MAX_PLAYERS + " · Start with any number of players.");
    lines.push(mentions(game.players));
    lines.push("Staff can start with /party start whenever anyone joins. One-player games are solo showcases without voting.");
    rows.push(new ActionRowBuilder().addComponents(
      button(partyButton(game, "join"), "Join", ButtonStyle.Success),
      button(partyButton(game, "leave"), "Leave", ButtonStyle.Secondary)));
  } else if (game.phase === "answering") {
    lines.push("**Round " + game.round + "/3** — answer both private prompts within 60 seconds.");
    lines.push("Answering closes " + seconds(game.phaseEndsAt) + (game.paused ? " (PAUSED)" : "") + ".");
    lines.push("Both prompts are private. Voting begins when the full timer ends.");
    lines.push("Use the button to check or edit either saved answer.");
    rows.push(new ActionRowBuilder().addComponents(
      button(partyButton(game, "prompt"), "My Prompts & Answers", ButtonStyle.Primary)));
  } else if (game.phase === "voting" || game.phase === "reveal") {
    const results = await courtBatchResults(game);
    lines.push("**Round " + game.round + "/3** · Matchups " +
      (game.batch * BATCH_SIZE + 1) + " of " + game.matchups.length);
    if (game.phase === "voting") lines.push("Vote for your favorite answer! Closes " + seconds(game.phaseEndsAt) + (game.paused ? " (PAUSED)" : "") + ".");
    if (game.players.length === 1) lines.push("Solo showcase — no opponent or audience vote; enjoy your answer reveal!");
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
      if (game.phase === "voting" && match.playerIds.length > 1) {
        const candidates = participants.filter(p => p.answer);
        if (candidates.length) rows.push(new ActionRowBuilder().addComponents(...candidates.map(p =>
          button(partyButton(game, "vote", game.round + ":" + matchupIndex + ":" + p.id),
            "Match " + (matchupIndex + 1) + " · " + p.label, ButtonStyle.Primary))));
      }
    }
    if (game.phase === "reveal") lines.push("", "Next stage " + seconds(game.phaseEndsAt) + ".");
  } else if (game.phase === "intermission" || game.phase === "ended") {
    lines.push(game.phase === "ended" ? "**The final verdict!**" :
      "Round " + game.round + " complete. The next round **will not start automatically**." );
    if (game.phase === "intermission") {
      lines.push("Staff: use **Start Next Round** after the 10-second break" +
        (game.phaseEndsAt && game.phaseEndsAt > new Date() ? " (ready " + seconds(game.phaseEndsAt) + ")." : "."));
      rows.push(new ActionRowBuilder().addComponents(
        button(partyButton(game, "next", String(game.round)), "Start Next Round", ButtonStyle.Success)));
    }
    const standings = topScores(game);
    lines.push(...standings.map(p => {
      const place = standings.findIndex(other => other.score === p.score &&
        other.finalRound === p.finalRound && other.wins === p.wins) + 1;
      return place + ". <@" + p.userId + "> — **" + p.score + "**";
    }));
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
  if (game.players.length < COURT_MIN_PLAYERS) throw new Error("At least one player must join before starting.");
  const matchups = assignCourtMatchups(game.players, 1, game.category);
  const changed = await PartyGame.updateOne({
    _id: game._id, phase: "lobby", players: game.players,
  }, { $set: {
    phase: "answering", round: 1, batch: 0, matchups,
    usedPromptIds: matchups.map(m => m.promptId),
    scores: Object.fromEntries(game.players.map(id => [id, 0])),
    roundScores: {}, matchupWins: Object.fromEntries(game.players.map(id => [id, 0])),
    answeredCounts: Object.fromEntries(game.players.map(id => [id, 0])),
    phaseEndsAt: new Date(Date.now() + ANSWER_MS), paused: false,
  }, $inc: { renderVersion: 1 } });
  return changed.modifiedCount === 1;
}

export async function advanceCourtGame(game, { force = false } = {}) {
  // Intermissions are staff-controlled and must never advance via the sweeper.
  if (!["answering", "voting", "reveal"].includes(game.phase) || game.paused) return false;
  const now = Date.now();
  if (!force && (game.phaseEndsAt == null || new Date(game.phaseEndsAt).getTime() > now)) return false;
  const next = { phaseEndsAt: null };
  if (game.phase === "answering") {
    // One-player games have no other answers to compare: reveal immediately.
    // Keep the usual reveal/intermission transitions and completion tracking.
    next.phase = game.players.length === 1 ? "reveal" : "voting";
    next.batch = 0;
    next.phaseEndsAt = new Date(now + (game.players.length === 1 ? REVEAL_MS : VOTE_MS));
  } else if (game.phase === "voting") {
    const results = await courtBatchResults(game);
    const scores = { ...game.scores };
    const roundScores = { ...game.roundScores };
    const perRound = { ...(roundScores[String(game.round)] || {}) };
    const wins = { ...game.matchupWins };
    for (const result of results) {
      for (const [id, amount] of Object.entries(result.scores)) {
        scores[id] = Number(scores[id] || 0) + amount;
        perRound[id] = Number(perRound[id] || 0) + amount;
      }
      const amounts = Object.entries(result.scores).filter(([,value]) => value > 0);
      const highest = Math.max(0, ...amounts.map(([,value]) => value));
      const winners = amounts.filter(([,value]) => value === highest);
      if (winners.length === 1) wins[winners[0][0]] = Number(wins[winners[0][0]] || 0) + 1;
    }
    roundScores[String(game.round)] = perRound;
    next.scores = scores;
    next.roundScores = roundScores;
    next.matchupWins = wins;
    next.phase = "reveal";
    next.phaseEndsAt = new Date(now + REVEAL_MS);
  } else if (game.phase === "reveal") {
    const nextBatch = game.batch + 1;
    if (nextBatch * BATCH_SIZE < game.matchups.length) {
      next.phase = game.players.length === 1 ? "reveal" : "voting";
      next.batch = nextBatch;
      next.phaseEndsAt = new Date(now + (game.players.length === 1 ? REVEAL_MS : VOTE_MS));
    } else {
      const answers = await PartyResponse.find({
        gameId: game._id, round: game.round, kind: "answer", text: { $ne: "" },
      }).select("userId").lean();
      const answeredCounts = { ...game.answeredCounts };
      // Eligibility is counted by distinct completed rounds, not number
      // of prompts, so two answers in one round cannot satisfy two rounds.
      for (const userId of new Set(answers.map(a => a.userId)))
        answeredCounts[userId] = Number(answeredCounts[userId] || 0) + 1;
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
  }
  const changed = await PartyGame.updateOne({
    _id: game._id, phase: game.phase, round: game.round, batch: game.batch,
    phaseEndsAt: game.phaseEndsAt, paused: false,
  }, { $set: next, $inc: { renderVersion: 1 } });
  return changed.modifiedCount === 1;
}

// Staff alone starts a new round. Even a long downtime or bot restart cannot
// bypass the click; phaseEndsAt is a minimum readiness time, not a deadline.
export async function startNextCourtRound(game, now = Date.now()) {
  if (game.phase !== "intermission" || game.paused || game.round >= 3 ||
      !game.phaseEndsAt || game.phaseEndsAt.getTime() > now) return false;
  const round = game.round + 1;
  const matchups = assignCourtMatchups(game.players, round, game.category, game.usedPromptIds);
  const changed = await PartyGame.updateOne({
    _id: game._id, active: true, phase: "intermission", round: game.round,
    phaseEndsAt: game.phaseEndsAt, paused: false,
  }, {
    $set: {
      phase: "answering", round, batch: 0, matchups,
      usedPromptIds: [...game.usedPromptIds, ...matchups.map(m => m.promptId)],
      phaseEndsAt: new Date(now + ANSWER_MS),
    },
    $inc: { renderVersion: 1 },
  });
  return changed.modifiedCount === 1;
}

export async function settleCourtRewards(game) {
  if (game.phase !== "ended" || game.rewardSettledAt) return;
  if (!game.rewardsEnabled || game.completedRounds < 2) {
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
        const current = await PartyGame.findById(game._id);
        if (current && !current.paused && ["answering", "voting", "reveal"].includes(current.phase) &&
            current.phaseEndsAt && current.phaseEndsAt.getTime() <= Date.now())
          await advanceCourtGame(current);
        await publishCourtGame(client, current || game);
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
