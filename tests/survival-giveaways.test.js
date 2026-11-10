import test from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import { SOLO_TRIAL_EVENTS, DUEL_TRIAL_EVENTS } from "../services/survival-event-texts.js";
import { HARVEST_SOLO_TRIAL_EVENTS, HARVEST_DUEL_TRIAL_EVENTS } from "../services/survival-harvest-event-texts.js";
import { trialData as trialCommand, handleGiveawayButton } from "../commands/giveaway.js";
import {
  MAX_TRIAL_ENTRANTS, TRIAL_SPEED_CHOICES, DEFAULT_TRIAL_SPEED_SECONDS,
  planSurvivalTrial, survivalAnnouncement, survivalEventPayload,
  beginSurvivalTrial, cancelSurvivalTrial, runSurvivalTrialStep,
  survivalFinalePayload, publishSurvivalFinale, getTrialChampionRecord,
} from "../services/survival-giveaways.js";

const id = "507f1f77bcf86cd799439011";
const guildId = "123456789012345678";
const contestants = [
  "234567890123456789",
  "345678901234567890",
  "456789012345678901",
  "567890123456789012",
];
const record = (overrides = {}) => ({
  _id: id, guildId, channelId: "678901234567890123",
  messageId: "789012345678901234", creatorId: contestants[0],
  mode: "survival", title: "Court Night", prize: "1st place - Neon Pet",
  rules: "Must be a member", requiredRoleId: "",
  entrantIds: contestants, winnerIds: [], winnerCount: 2,
  speedSeconds: 2, endsAt: new Date("2027-01-01T13:00:00Z"),
  gameEvents: [], nextEventIndex: 0, status: "open", rerollHistory: [],
  renderVersion: 0, renderedAt: null, leaseUntil: new Date(0),
  nextEventAt: new Date("2026-11-01T00:00:00Z"),
  ...overrides,
});

const patch = (records, model, name, value) => {
  records.push([model, name, model[name]]);
  model[name] = value;
};
const restore = records => {
  for (const [model, key, value] of records.reverse()) model[key] = value;
};

test("speed giveaways are staff-managed, configurable and distinct from timed giveaways", () => {
  const spec = trialCommand.toJSON();
  const commands = spec.options.map(option => option.name);
  for (const name of ["start", "cancel", "reroll", "list", "entrants"])
    assert.ok(commands.includes(name));
  assert.ok(!commands.includes("launch"), "staff start button replaces slash launch");
  const speed = spec.options.find(option => option.name === "start");
  assert.deepEqual(
    speed.options.find(option => option.name === "pace").choices.map(item => item.value),
    TRIAL_SPEED_CHOICES,
  );
  assert.equal(MAX_TRIAL_ENTRANTS, 120);
  assert.equal(DEFAULT_TRIAL_SPEED_SECONDS, 5);
  assert.equal(Giveaway.schema.path("speedSeconds").defaultValue, 5);
  assert.match(speed.options.find(option => option.name === "pace").description, /default 5/i);
  assert.equal(spec.default_member_permissions, undefined); // Giveaway Managers can invoke Trial commands
});

test("120 unique original scenarios are available with correct contestant placeholders", () => {
  assert.equal(SOLO_TRIAL_EVENTS.length, 60);
  assert.equal(DUEL_TRIAL_EVENTS.length, 60);
  const templates = [...SOLO_TRIAL_EVENTS, ...DUEL_TRIAL_EVENTS];
  assert.equal(new Set(templates).size, 120);
  assert.ok(templates.every(text => text.includes("{victim}")));
  assert.ok(DUEL_TRIAL_EVENTS.every(text => text.includes("{actor}")));
  assert.ok(SOLO_TRIAL_EVENTS.every(text => !text.includes("{actor}")));
});

test("the expanded Court catalog preserves the original scenarios and balanced solo/duel options", () => {
  assert.equal(HARVEST_SOLO_TRIAL_EVENTS.length, 100);
  assert.equal(HARVEST_DUEL_TRIAL_EVENTS.length, 100);
  const original = [...SOLO_TRIAL_EVENTS, ...DUEL_TRIAL_EVENTS];
  const harvest = [...HARVEST_SOLO_TRIAL_EVENTS, ...HARVEST_DUEL_TRIAL_EVENTS];
  const combined = [...original, ...harvest];
  assert.equal(original.length, 120);
  assert.equal(harvest.length, 200);
  assert.equal(combined.length, 320);
  assert.equal(new Set(combined).size, 320, "no new scenario may repeat an old or new one");
  assert.ok(harvest.every(text => text.includes("{victim}")));
  assert.ok(HARVEST_DUEL_TRIAL_EVENTS.every(text => text.includes("{actor}")));
  assert.ok(HARVEST_SOLO_TRIAL_EVENTS.every(text => !text.includes("{actor}")));
  assert.ok(harvest.every(text => text.length <= 230), "stories should fit the compact Canvas plaque");
  assert.ok(harvest.some(text => /scarecrow/i.test(text)));
  assert.ok(harvest.some(text => /orchard/i.test(text)));
  assert.ok(harvest.some(text => /autumn/i.test(text)));
  assert.ok(harvest.some(text => /pumpkin/i.test(text)));
});

test("120 contestants get 119 distinct event templates with no repeated scenarios", () => {
  const ids = Array.from({ length: 120 }, (_, i) => String(300000000000000000n + BigInt(i)));
  const { events, championId } = planSurvivalTrial(ids, 10);
  assert.equal(events.length, 119);
  assert.equal(new Set(events.map(event => event.templateId)).size, 119);
  assert.equal(new Set(events.map(event => event.victimId)).size, 119);
  assert.ok(!events.some(event => event.victimId === championId));
  assert.equal(events.at(-1).remaining, 1);
  const duels = events.filter(event => event.actorId);
  // Events are now drawn from 160 solo + 160 duel options, not from
  // the former fixed deck of 60 each; a 119-person draw need not be 59/60.
  assert.ok(duels.length > 0 && duels.length < events.length);
  assert.ok(events.every(event => /^(?:solo|duel)-[0-9]+$/.test(event.templateId)));
  assert.ok(events.every(event => {
    const match = /^(solo|duel)-([0-9]+)$/.exec(event.templateId);
    return match && Number(match[2]) >= 1 && Number(match[2]) <= 160;
  }), "each template ID must come from the original or new harvest catalog");
  const sampledHarvest = events.filter(event => Number(event.templateId.split("-")[1]) > 60);
  assert.ok(sampledHarvest.length > 0, "harvest stories are reachable during trials");
});

test("every participant except one receives a distinct sequential elimination with original themed text", () => {
  const ids = Array.from({ length: 42 }, (_, i) => String(200000000000000000n + BigInt(i)));
  const { events, championId, prizeWinnerIds } = planSurvivalTrial(ids, 3);
  assert.equal(events.length, ids.length - 1);
  assert.equal(new Set(events.map(item => item.victimId)).size, events.length);
  assert.ok(!events.some(item => item.victimId === championId));
  assert.equal(events.at(-1).remaining, 1);
  assert.deepEqual(prizeWinnerIds, [championId, events.at(-1).victimId, events.at(-2).victimId]);
  assert.equal(new Set(prizeWinnerIds).size, 3);
  events.forEach((event, i) => {
    assert.equal(event.remaining, events.length - i);
    assert.match(event.description, new RegExp(event.victimId));
    assert.ok(!event.description.includes("{victim}"));
    if (event.actorId) {
      assert.ok(!events.slice(0, i + 1).some(x => x.victimId === event.actorId),
        "the duel winner must still be alive at the time of the duel");
      assert.notEqual(event.actorId, event.victimId);
    }
  });
  assert.throws(() => planSurvivalTrial([ids[0]], 1), /at least two/i);
  assert.throws(() => planSurvivalTrial(ids, 11), /between 1 and 10/i);
});

test("survival post changes from join panel to battle panel to permanent result archive", () => {
  const open = survivalAnnouncement(record());
  assert.equal(open.components.length, 1);
  assert.deepEqual(open.components[0].components.map(button => button.data.label),
    ["Join Trial", "Leave", "Contestants", "Start Trial (Staff)"]);
  const running = survivalAnnouncement(record({
    status: "running", nextEventIndex: 2, gameEvents: [{}, {}, {}, {}],
  }));
  assert.equal(running.components.length, 0);
  assert.match(running.embeds[0].data.description, /2\/4 eliminations/);
  const ended = survivalAnnouncement(record({
    status: "ended", originalChampionId: contestants[0],
    winnerIds: [contestants[1], contestants[2]],
    gameEvents: [{ victimId: contestants[3] }],
    nextEventIndex: 1,
    rerollHistory: [{ slot: 0, previousId: contestants[0], replacementId: contestants[1] }],
  }));
  const body = ended.embeds[0].data.description;
  assert.match(body, /Original last survivor/);
  assert.match(body, /Reroll history/);
  assert.match(body, /Neon Pet/);
  assert.equal(ended.components.length, 0);
  const cancelled = survivalAnnouncement(record({ status: "cancelled" }));
  assert.match(cancelled.embeds[0].data.description, /No prize winners/);
});

test("sequential event posts carry a stable marker and suppress automatic ping spam", () => {
  const trial = record({ gameEvents: [{ victimId: contestants[0], description: "Eliminated", remaining: 3 }] });
  const event = survivalEventPayload(trial, trial.gameEvents[0], 0);
  assert.equal(event.allowedMentions.parse.length, 0);
  assert.equal(event.embeds[0].data.footer.text, `Trial ${id} · Event 1`);
  assert.equal(event.embeds[0].data.author.name, "♛ THE CRYPTIC COURT · LIVE ROYAL TRIAL ♛");
  assert.match(event.embeds[0].data.title, /Elimination 1 of 1/);
  assert.match(event.embeds[0].data.description, /Eliminated/);
  assert.equal(event.embeds[0].data.fields[0].name, "⚰️ Eliminated");
  assert.equal(event.embeds[0].data.fields[0].value, `<@${contestants[0]}>`);
  assert.equal(event.embeds[0].data.fields[1].name, "🕯️ Still Standing");
  assert.equal(event.embeds[0].data.fields[1].value, "**3 / 4**");
  const imageEvent = survivalEventPayload(trial, trial.gameEvents[0], 0, "event.png");
  assert.equal(imageEvent.embeds[0].data.image.url, "attachment://event.png");
  assert.equal(imageEvent.embeds[0].data.description, undefined);
  assert.equal(imageEvent.embeds[0].data.fields, undefined);
  assert.equal(imageEvent.embeds[0].data.title, undefined);
  assert.equal(imageEvent.embeds[0].data.footer.text, `Trial ${id} · Event 1`);
});

test("starting freezes entry state atomically, plans all contestants once and rejects a second launch", async () => {
  const original = [];
  let stored = record();
  const checkpoints = [];
  try {
    patch(original, Giveaway, "findOne", () => ({ lean: async () => ({ ...stored }) }));
    patch(original, Giveaway, "findOneAndUpdate", (filter, update) => ({
      lean: async () => {
        assert.equal(filter.mode, "survival");
        if (stored.status !== filter.status) return null;
        if (filter.status === "open") {
          assert.deepEqual(filter["entrantIds.1"], { $exists: true });
          checkpoints.push("entrants-locked");
          assert.equal(update.$set.status, "preparing");
        }
        if (filter.status === "preparing") {
          assert.deepEqual(checkpoints, ["entrants-locked"]);
          assert.equal(update.$set.gameEvents.length, 3);
          checkpoints.push("game-planned");
        }
        stored = { ...stored, ...update.$set };
        return { ...stored };
      },
    }));
    const first = await beginSurvivalTrial({ id, guildId });
    assert.equal(first.status, "running");
    assert.equal(first.gameEvents.length, 3);
    assert.ok(contestants.includes(first.originalChampionId));
    assert.deepEqual(checkpoints, ["entrants-locked", "game-planned"]);
    await assert.rejects(() => beginSurvivalTrial({ id, guildId }), /not open/i);
  } finally { restore(original); }
});

test("cancelled games are recorded and cannot be re-cancelled or awarded", async () => {
  const original = [];
  let stored = record();
  try {
    patch(original, Giveaway, "findOneAndUpdate", (filter, update) => ({
      lean: async () => {
        if (!filter.status.$in.includes(stored.status)) return null;
        stored = { ...stored, ...update.$set, renderVersion: stored.renderVersion + 1 };
        return { ...stored };
      },
    }));
    const stopped = await cancelSurvivalTrial({ id, guildId });
    assert.equal(stopped.status, "cancelled");
    assert.deepEqual(stopped.winnerIds, []);
    await assert.rejects(() => cancelSurvivalTrial({ id, guildId }), /cannot be cancelled/i);
  } finally { restore(original); }
});

test("the game posts one elimination at a time, saves progress, and archives ranked winners", async () => {
  const original = [];
  const plan = planSurvivalTrial(contestants, 2);
  let stored = record({
    status: "running", gameEvents: plan.events, originalChampionId: plan.championId,
  });
  let sent = [];
  let edits = 0;
  const channel = {
    messages: { fetch: async arg => arg && typeof arg === "object"
      ? new Collection(sent.map(x => [x.id, x]))
      : { id: stored.messageId, author: { id: "999999999999999999" }, edit: async () => { edits += 1; } } },
    send: async payload => {
      const m = {
        id: String(sent.length + 1), author: { id: "999999999999999999" },
        embeds: payload.embeds.map(embed => embed.data),
        files: payload.files || [],
        edit: async next => { m.embeds = next.embeds.map(embed => embed.data); },
      };
      sent.push(m);
      return m;
    },
  };
  const client = { user: { id: "999999999999999999" }, channels: { fetch: async () => channel } };
  try {
    patch(original, Giveaway, "countDocuments", async () => 1);
    patch(original, Giveaway, "findOneAndUpdate", (filter, update) => ({
      lean: async () => {
        if (filter.$or?.some(part => Object.hasOwn(part, "finaleLeaseUntil"))) {
          if (stored.status !== filter.status || stored.finaleLeaseUntil) return null;
          stored = { ...stored, ...update.$set };
          return { ...stored };
        }
        if (stored.status !== filter.status || stored.nextEventIndex !== filter.nextEventIndex)
          return null;
        if (filter.leaseKey && stored.leaseKey !== filter.leaseKey) return null;
        if (update.$set.leaseKey && update.$set.leaseKey !== "") {
          stored = { ...stored, ...update.$set };
        } else {
          stored = {
            ...stored, ...update.$set,
            eliminationMessages: [...(stored.eliminationMessages || []), update.$push.eliminationMessages],
            renderVersion: stored.renderVersion + (update.$inc?.renderVersion || 0),
          };
        }
        return { ...stored };
      },
    }));
    patch(original, Giveaway, "updateOne", async (filter, update) => {
      if (filter.leaseKey && stored.leaseKey !== filter.leaseKey) return { modifiedCount: 0 };
      if (update.$set) stored = { ...stored, ...update.$set };
      return { modifiedCount: 1 };
    });
    for (let i = 0; i < plan.events.length; i++) {
      const now = new Date(Date.now() + 60_000);
      assert.equal(await runSurvivalTrialStep(client, { ...stored }, { now }), true);
      assert.equal(sent.filter(message => message.embeds.some(embed => embed.footer?.text?.includes(" · Event "))).length, i + 1);
      assert.equal(stored.nextEventIndex, i + 1);
    }
    for (const imagePost of sent.filter(message => message.embeds.some(embed => embed.footer?.text?.includes(" · Event ")))) {
      assert.equal(imagePost.files.length, 1, "all eliminations attach artwork");
      const image = imagePost.embeds[0].image?.url;
      assert.match(image || "", /^attachment:\/\/trial-/);
      assert.equal(imagePost.files[0].name, image.slice("attachment://".length));
    }
    assert.equal(sent.length, plan.events.length + 1, "a final royal verdict is separately posted");
    assert.equal(sent.at(-1).embeds[0].footer.text, `♛ Trial ${id} · Finale`);
    assert.equal(stored.finaleMessageId, sent.at(-1).id);
    assert.equal(stored.status, "ended");
    assert.deepEqual(stored.winnerIds, plan.prizeWinnerIds);
    assert.equal(stored.eliminationMessages.length, plan.events.length);
    assert.equal(edits, 1, "the original announcement is edited and preserved");
  } finally { restore(original); }
});

test("after a restart, replay recognizes an already-posted event and advances without duplicating it", async () => {
  const original = [];
  const plan = planSurvivalTrial(contestants.slice(0, 2), 1);
  const existing = {
    id: "123", author: { id: "999999999999999999" },
    embeds: [{ footer: { text: `Trial ${id} · Event 1` } }],
  };
  let state = record({
    status: "running", gameEvents: plan.events, originalChampionId: plan.championId,
  });
  let sends = 0;
  const channel = {
    messages: { fetch: async arg => arg && typeof arg === "object"
      ? new Collection([[existing.id, existing]])
      : { author: { id: "999999999999999999" }, edit: async () => {} } },
    send: async payload => {
      if (payload.embeds[0].data.footer.text.includes(" · Finale")) {
        return { id: "456456456456456456", author: { id: "999999999999999999" },
          embeds: payload.embeds.map(embed => embed.data) };
      }
      sends++; throw Error("Would have duplicated an elimination post");
    },
  };
  const client = { user: { id: "999999999999999999" }, channels: { fetch: async () => channel } };
  try {
    patch(original, Giveaway, "countDocuments", async () => 1);
    patch(original, Giveaway, "findOneAndUpdate", (query, update) => ({
      lean: async () => {
        if (query.$or?.some(part => Object.hasOwn(part, "finaleLeaseUntil"))) {
          if (state.status !== query.status) return null;
          state = { ...state, ...update.$set };
          return { ...state };
        }
        if (state.status !== query.status || state.nextEventIndex !== query.nextEventIndex)
          return null;
        state = { ...state, ...update.$set };
        if (update.$push) state.eliminationMessages = [update.$push.eliminationMessages];
        if (update.$inc) state.renderVersion += 1;
        return { ...state };
      },
    }));
    patch(original, Giveaway, "updateOne", async (filter, update) => {
      if (update.$set) state = { ...state, ...update.$set };
      return { modifiedCount: 1 };
    });
    assert.equal(await runSurvivalTrialStep(client, { ...state }, { now: new Date(Date.now() + 60_000) }), true);
    assert.equal(sends, 0);
    assert.equal(state.finaleMessageId, "456456456456456456");
    assert.equal(state.status, "ended");
    assert.equal(state.eliminationMessages[0].messageId, existing.id);
  } finally { restore(original); }
});

test("Court's Trial has decorative royal framing and a distinct final verdict with every ranked prize", () => {
  const finished = record({
    status: "ended", originalChampionId: contestants[0],
    winnerIds: [contestants[0], contestants[1]], nextEventIndex: 3,
    rerollHistory: [{ slot: 1, previousId: contestants[2], replacementId: contestants[1] }],
  });
  const announcement = survivalAnnouncement(finished).embeds[0].data;
  assert.match(announcement.author.name, /ROYAL CHAMBERS/);
  assert.match(announcement.description, /THE ROYAL SUMMONS/);
  assert.match(announcement.footer.text, /Royal Archive/);
  const finale = survivalFinalePayload(finished);
  assert.equal(finale.allowedMentions.parse.length, 0);
  assert.match(finale.embeds[0].data.title, /TRIAL COMPLETE/);
  assert.match(finale.embeds[0].data.author.name, /ROYAL VERDICT/);
  assert.equal(finale.embeds[0].data.footer.text, `♛ Trial ${id} · Finale`);
  assert.match(finale.embeds[0].data.description, /THE COURT HAS SPOKEN/);
  assert.match(finale.embeds[0].data.description, /The Last Survivor/);
  assert.match(finale.embeds[0].data.description, /Royal Reroll Record/);
  assert.match(finale.embeds[0].data.description, /Prizes are delivered by staff/);
  for (const winner of finished.winnerIds)
    assert.ok(finale.embeds[0].data.description.includes(winner));
});

test("completed trial sends one separate finale and edits that same message after rerolls", async () => {
  const changes = [];
  let stored = record({
    status: "ended", originalChampionId: contestants[0],
    winnerIds: [contestants[0], contestants[1]], nextEventIndex: 3,
    finaleMessageId: "", finaleLeaseUntil: null, finaleLeaseKey: "",
  });
  const messages = new Collection();
  let sends = 0, edits = 0;
  const client = {
    user: { id: "999999999999999999" },
    channels: { fetch: async () => ({
      messages: { fetch: async arg => typeof arg === "object"
        ? messages : messages.get(String(arg)) || null },
      send: async payload => {
        sends++;
        const msg = {
          id: "777777777777777777", author: { id: "999999999999999999" },
          embeds: payload.embeds.map(embed => embed.data),
          edit: async next => { edits++; msg.embeds = next.embeds.map(embed => embed.data); },
        };
        messages.set(msg.id, msg);
        return msg;
      },
    }) },
  };
  try {
    patch(changes, Giveaway, "countDocuments", async () => 1);
    patch(changes, Giveaway, "findOneAndUpdate", (filter, update) => ({
      lean: async () => {
        if (stored.status !== filter.status || stored.finaleLeaseUntil) return null;
        stored = { ...stored, ...update.$set };
        return { ...stored };
      },
    }));
    patch(changes, Giveaway, "updateOne", async (filter, update) => {
      if (filter.finaleLeaseKey && stored.finaleLeaseKey !== filter.finaleLeaseKey)
        return { modifiedCount: 0 };
      stored = { ...stored, ...update.$set };
      return { modifiedCount: 1 };
    });
    assert.equal(await publishSurvivalFinale(client, stored), true);
    assert.equal(sends, 1);
    assert.equal(stored.finaleMessageId, "777777777777777777");
    assert.equal(await publishSurvivalFinale(client, stored), true);
    assert.equal(sends, 1);
    assert.equal(edits, 1);
    stored.winnerIds = [contestants[0], contestants[3]];
    stored.rerollHistory = [{ slot: 1, previousId: contestants[1], replacementId: contestants[3] }];
    assert.equal(await publishSurvivalFinale(client, stored), true);
    assert.equal(sends, 1);
    assert.equal(edits, 2);
    assert.match(messages.get(stored.finaleMessageId).embeds[0].description,
      new RegExp(contestants[3]));
  } finally { restore(changes); }
});

test("crash recovery recognizes a previously sent verdict even with no saved finale ID", async () => {
  const changes = [];
  let stored = record({
    status: "ended", originalChampionId: contestants[0], winnerIds: [contestants[0]],
    finaleMessageId: "", finaleLeaseUntil: null,
  });
  let sends = 0, edits = 0;
  const previous = {
    id: "888888888888888888", author: { id: "999999999999999999" },
    embeds: [{ footer: { text: `♛ Trial ${id} · Finale` } }],
    edit: async () => { edits++; },
  };
  const client = {
    user: { id: "999999999999999999" },
    channels: { fetch: async () => ({
      messages: { fetch: async () => new Collection([[previous.id, previous]]) },
      send: async () => { sends++; throw Error("A second finale must never be sent"); },
    }) },
  };
  try {
    patch(changes, Giveaway, "countDocuments", async () => 1);
    patch(changes, Giveaway, "findOneAndUpdate", () => ({
      lean: async () => ({ ...stored, finaleLeaseKey: "lease", finaleLeaseUntil: new Date(Date.now() + 45000) }),
    }));
    patch(changes, Giveaway, "updateOne", async (filter, update) => {
      if (update.$set.finaleMessageId) stored.finaleMessageId = update.$set.finaleMessageId;
      return { modifiedCount: 1 };
    });
    assert.equal(await publishSurvivalFinale(client, stored), true);
    assert.equal(sends, 0);
    assert.equal(edits, 1);
    assert.equal(stored.finaleMessageId, previous.id);
  } finally { restore(changes); }
});

test("champion's Court record counts actual entries and original first-place wins only within this server", async () => {
  const original = [];
  const champion = contestants[0];
  const calls = [];
  try {
    patch(original, Giveaway, "countDocuments", async query => {
      calls.push(query);
      return calls.length === 1 ? 9 : 3;
    });
    assert.deepEqual(await getTrialChampionRecord(guildId, champion),
      { entered: 9, won: 3 });
    assert.deepEqual(calls, [
      {
        guildId, mode: "survival", entrantIds: champion,
        status: { $nin: ["publishing", "failed"] },
      },
      {
        guildId, mode: "survival", originalChampionId: champion,
        status: { $in: ["ended", "rerolling"] },
      },
    ]);
    assert.equal(await getTrialChampionRecord(guildId, ""), null);
    assert.equal(calls.length, 2, "no query should run for an unknown champion");
  } finally { restore(original); }
});

test("Royal Verdict shows entered and won totals for the original champion even after a prize reroll", () => {
  const champion = contestants[0];
  const rerollRecipient = contestants[2];
  const data = record({
    status: "ended", originalChampionId: champion,
    winnerIds: [rerollRecipient], // even if prize #1 was rerolled
    rerollHistory: [{ slot: 0, previousId: champion, replacementId: rerollRecipient }],
  });
  const embed = survivalFinalePayload(data, { entered: 12, won: 4 }).embeds[0].data;
  assert.match(embed.description, /Champion's Court Record/);
  assert.match(embed.description, /Trials Entered:\*\* 12/);
  assert.match(embed.description, /Trials Won:\*\* 4/);
  assert.match(embed.description, new RegExp(champion));
  assert.match(embed.description, /Wins count original last survivors/);
  assert.equal(embed.footer.text, `♛ Trial ${id} · Finale`,
    "save and replay marker must not change");
  const withoutChampion = survivalFinalePayload(
    record({ originalChampionId: "", winnerIds: [] }), { entered: 12, won: 4 },
  );
  assert.doesNotMatch(withoutChampion.embeds[0].data.description, /Trials Entered/,
    "do not attribute historical stats to an unknown original champion");
});

test("Start Trial (Staff) button starts a real saved trial and rejects non-staff", async () => {
  const changes = [];
  let saved = record({ status: "open", entrantIds: contestants.slice(0, 3) });
  const messages = [];
  let applied = 0;
  const makeButton = (canManage = true, roles = []) => {
    let output;
    return {
      customId: "giveaway:launch:" + id,
      guildId, guild: { id: guildId }, channelId: saved.channelId,
      message: { id: saved.messageId }, user: { id: contestants[0], bot: false },
      member:{roles},
      memberPermissions: { has: () => canManage },
      deferReply: async () => {},
      editReply: async value => { output = value; },
      replyOutput: () => output,
      client: { user: { id: "777777777777777777" }, channels: {
        fetch: async () => ({ messages: {
          fetch: async () => ({ author: { id: "777777777777777777" },
            edit: async data => { messages.push(data); } }),
        } }),
      } },
    };
  };
  try {
    patch(changes, GuildConfig, "findOne",()=>({select:()=>({lean:async()=>({
      giveawayManagerRoleId:"888888888888888888"
    })})}));
    patch(changes, Giveaway, "findOne", query => ({ lean: async () => {
      assert.equal(query.guildId, guildId);
      return { ...saved };
    } }));
    patch(changes, Giveaway, "findOneAndUpdate", (query, update) => ({ lean: async () => {
      if (saved.status !== query.status) return null;
      saved = { ...saved, ...update.$set };
      applied++;
      return { ...saved };
    } }));
    patch(changes, Giveaway, "updateOne", async () => ({ modifiedCount: 1 }));
    const ordinary = makeButton(false);
    await handleGiveawayButton(ordinary);
    assert.match(ordinary.replyOutput(), /Giveaway Manager/);
    assert.equal(applied, 0);
    const staff = makeButton(false,["888888888888888888"]);
    await handleGiveawayButton(staff);
    assert.equal(saved.status, "running");
    assert.equal(applied, 2, "button froze entrants then planned trial");
    assert.match(staff.replyOutput(), /Trial has begun/i);
    assert.equal(messages.length, 1, "original signup is edited");
    assert.equal(messages[0].embeds[0].data.title.includes("Trial"), true);
  } finally { restore(changes); }
});

test("Start Trial button reports too few entrants and an already-running game clearly", async () => {
  const original = [];
  let stored = record({ status: "open", entrantIds: [contestants[0]] });
  const makeButton = () => {
    let response;
    return {
      customId: "giveaway:launch:" + id,
      guildId, guild: { id: guildId }, channelId: stored.channelId,
      message: { id: stored.messageId }, user: { id: contestants[0], bot: false },
      memberPermissions: { has: () => true },
      deferReply: async () => {},
      editReply: async text => { response = text; },
      getResponse: () => response,
    };
  };
  try {
    patch(original, Giveaway, "findOne", () => ({ lean: async () => ({ ...stored }) }));
    patch(original, Giveaway, "findOneAndUpdate", () => ({
      lean: async () => { assert.fail("Blocked start should not touch the saved trial"); },
    }));
    const few = makeButton();
    await handleGiveawayButton(few);
    assert.match(few.getResponse(), /at least two members/i);
    stored = { ...stored, status: "running", entrantIds: contestants.slice(0, 2) };
    const running = makeButton();
    await handleGiveawayButton(running);
    assert.match(running.getResponse(), /already starting or running/i);
  } finally { restore(original); }
});

test("Start Trial button acknowledges a saved game even if the original post cannot be edited", async () => {
  const original = [];
  let stored = record({ status: "open", entrantIds: contestants.slice(0, 2) });
  let response;
  const interaction = {
    customId: "giveaway:launch:" + id,
    guildId, guild: { id: guildId }, channelId: stored.channelId,
    message: { id: stored.messageId }, user: { id: contestants[0], bot: false },
    memberPermissions: { has: () => true },
    deferReply: async () => {},
    editReply: async text => { response = text; },
    client: { channels: { fetch: async () => ({
      messages: { fetch: async () => { throw Error("Missing Messages permission"); } },
    }) } },
  };
  const previousError = console.error;
  try {
    patch(original, Giveaway, "findOne", () => ({ lean: async () => ({ ...stored }) }));
    patch(original, Giveaway, "findOneAndUpdate", (query, update) => ({
      lean: async () => {
        if (query.status !== stored.status) return null;
        stored = { ...stored, ...update.$set };
        return { ...stored };
      },
    }));
    console.error = () => {};
    await handleGiveawayButton(interaction);
    assert.equal(stored.status, "running");
    assert.match(response, /started and was saved/i);
    assert.match(response, /channel permissions/i);
  } finally {
    console.error = previousError;
    restore(original);
  }
});

test("Court's Trial uses minute-based claim windows and Discord-local deadlines", () => {
  const details = {
    claimWindowMinutes: 15,
    claimInstructions: "List your Roblox username and Discord time slots.",
  };
  const signup = survivalAnnouncement(record(details));
  assert.match(signup.embeds[0].data.description, /Claim window:.*15 minutes/);
  assert.doesNotMatch(signup.embeds[0].data.description, /15 hours/);
  const finished = record({
    ...details, status: "ended", winnerIds: [contestants[0]],
    originalChampionId: contestants[0],
    claimStartedAt: new Date("2026-11-01T20:00:00Z"),
  });
  const finale = survivalFinalePayload(finished);
  const body = finale.embeds[0].data.description;
  assert.match(body, /Claim deadline:/);
  assert.match(body, /<t:1793564100:F>/, "15 minutes after the trial's actual finish time");
  assert.match(body, /Roblox username/);
  assert.match(body, /staff/i);
  assert.doesNotMatch(body, /FORFEIT YOUR WIN/, "Court's Trial does not automatically reroll claims");
  assert.deepEqual(finale.allowedMentions, { parse: [] });
  assert.equal(finale.embeds[0].data.footer.text, "♛ Trial " + id + " · Finale");

  const oneMinute = survivalAnnouncement(record({ claimWindowMinutes: 1 }));
  assert.match(oneMinute.embeds[0].data.description, /Claim window:.*1 minute after/);
});

test("previously saved trials with hour claim windows retain the original units and deadlines", () => {
  const legacy = record({
    status: "ended", winnerIds: [contestants[0]],
    originalChampionId: contestants[0],
    claimWindowHours: 24,
    claimStartedAt: new Date("2026-11-01T20:00:00Z"),
  });
  const posted = survivalFinalePayload(legacy).embeds[0].data.description;
  assert.match(posted, /<t:1793649600:F>/);
  const signup = survivalAnnouncement(record({ claimWindowHours: 24 }));
  assert.match(signup.embeds[0].data.description, /Claim window:.*24 hours/);
});


test("Court's Trial Royal Verdict removes claim details after a submitted ticket, but preserves the winner",()=>{
 const trial=record({
   status:"ended",winnerIds:[contestants[0]],winnerCount:1,
   originalChampionId:contestants[0],trialTicketClaimsEnabled:true,
   claimWindowMinutes:15,claimStartedAt:new Date("2026-11-01T20:00:00Z"),
   winnerClaims:[],claimResolvedSlots:[],
 });
 const before=survivalFinalePayload(trial);
 assert.match(before.embeds[0].toJSON().description,/Claim deadline:|How to claim:|Submit your claim:|FORFEIT YOUR WIN/);
 assert.equal(before.components.length,1);
 const after=survivalFinalePayload({...trial,winnerClaims:[
   {slot:0,userId:contestants[0],ticketNumber:"TEST001",submittedAt:new Date()}]});
 const text=after.embeds[0].toJSON().description;
 assert.match(text,/Claim submitted/);
 assert.match(text,/The Last Survivor/);
 assert.match(text,/Royal Prize/);
 assert.doesNotMatch(text,/Claim deadline:|How to claim:|Submit your claim:|FORFEIT YOUR WIN|Claiming your prize/);
 assert.equal(after.components.length,0);
});

test("Court's Trial keeps claim instructions for another pending winner and restores them after a reroll",()=>{
 const trial=record({
   status:"ended",winnerIds:[contestants[0],contestants[1]],winnerCount:2,
   originalChampionId:contestants[0],trialTicketClaimsEnabled:true,
   claimWindowMinutes:15,claimStartedAt:new Date("2026-11-01T20:00:00Z"),
   winnerClaims:[{slot:0,userId:contestants[0],ticketNumber:"TEST001"}],
   claimResolvedSlots:[],
 });
 const partial=survivalFinalePayload(trial);
 assert.match(partial.embeds[0].toJSON().description,/Claim deadline/);
 assert.match(partial.embeds[0].toJSON().description,/#1 .*Claim submitted/);
 assert.match(partial.embeds[0].toJSON().description,/#2 .*Awaiting ticket info/);
 assert.equal(partial.components.length,1);
 const finished={...trial,winnerClaims:[...trial.winnerClaims,
   {slot:1,userId:contestants[1],ticketNumber:"TEST002"}]};
 assert.doesNotMatch(survivalFinalePayload(finished).embeds[0].toJSON().description,/How to claim:|Submit your claim:|FORFEIT YOUR WIN|Claim deadline:/);
 assert.equal(survivalFinalePayload(finished).components.length,0);
 const rerolled={...finished,winnerIds:[contestants[0],contestants[2]]};
 assert.match(survivalFinalePayload(rerolled).embeds[0].toJSON().description,/Claim deadline:/);
 assert.equal(survivalFinalePayload(rerolled).components.length,1);
});

test("legacy staff-managed Court's Trials retain their existing collection directions",()=>{
 const legacy=record({status:"ended",winnerIds:[contestants[0]],
   trialTicketClaimsEnabled:false,claimWindowHours:24,
   claimStartedAt:new Date("2026-11-01T20:00:00Z")});
 const finale=survivalFinalePayload(legacy);
 assert.match(finale.embeds[0].toJSON().description,/Court's Trial claims are coordinated by staff/);
 assert.equal(finale.components.length,0);
});

test("unclaimed Court's Trial prize with no replacement becomes No Eligible Winner, leaving the Royal Verdict",()=>{
  const ended=record({
    status:"ended",winnerIds:[contestants[0]],winnerCount:1,
    originalChampionId:contestants[0],trialTicketClaimsEnabled:true,
    claimWindowMinutes:15,claimStartedAt:new Date("2026-11-01T20:00:00Z"),
    claimResolvedSlots:[0],winnerClaims:[],
  });
  const finale=survivalFinalePayload(ended);
  const description=finale.embeds[0].toJSON().description;
  assert.match(description,/No eligible winner for the prize/i);
  assert.ok(description.length<600,"public no-winner verdict must be concise");
  assert.doesNotMatch(description,/Royal Reroll Record|The Roll of Honour|Ticket claim status/);
  assert.match(description,/No eligible winner/);
  assert.match(description,/until staff explicitly remove the listing/);
  assert.match(description,/The Last Survivor/,"historic champion identity remains");
  assert.match(description,/forfeited; no replacement/);
  assert.doesNotMatch(description,/Claim deadline:|How to claim:|Submit your claim:/);
  assert.equal(finale.components.length,0,"no expired ticket button");
});
