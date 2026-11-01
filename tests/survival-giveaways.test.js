import test from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import Giveaway from "../models/Giveaway.js";
import { SOLO_TRIAL_EVENTS, DUEL_TRIAL_EVENTS } from "../services/survival-event-texts.js";
import { data as giveawayCommand } from "../commands/giveaway.js";
import {
  MAX_TRIAL_ENTRANTS, TRIAL_SPEED_CHOICES, DEFAULT_TRIAL_SPEED_SECONDS,
  planSurvivalTrial, survivalAnnouncement, survivalEventPayload,
  beginSurvivalTrial, cancelSurvivalTrial, runSurvivalTrialStep,
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
  const spec = giveawayCommand.toJSON();
  const commands = spec.options.map(option => option.name);
  for (const name of ["start", "speed", "launch", "cancel", "end", "reroll", "list"])
    assert.ok(commands.includes(name));
  const speed = spec.options.find(option => option.name === "speed");
  assert.deepEqual(
    speed.options.find(option => option.name === "pace").choices.map(item => item.value),
    TRIAL_SPEED_CHOICES,
  );
  assert.equal(MAX_TRIAL_ENTRANTS, 120);
  assert.equal(DEFAULT_TRIAL_SPEED_SECONDS, 5);
  assert.equal(Giveaway.schema.path("speedSeconds").defaultValue, 5);
  assert.match(speed.options.find(option => option.name === "pace").description, /default 5/i);
  assert.equal(spec.default_member_permissions, "32");
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

test("120 contestants get 119 distinct event templates with no repeated scenarios", () => {
  const ids = Array.from({ length: 120 }, (_, i) => String(300000000000000000n + BigInt(i)));
  const { events, championId } = planSurvivalTrial(ids, 10);
  assert.equal(events.length, 119);
  assert.equal(new Set(events.map(event => event.templateId)).size, 119);
  assert.equal(new Set(events.map(event => event.victimId)).size, 119);
  assert.ok(!events.some(event => event.victimId === championId));
  assert.equal(events.at(-1).remaining, 1);
  const duels = events.filter(event => event.actorId);
  assert.ok(duels.length >= 59 && duels.length <= 60);
  assert.ok(events.every(event => /^(?:solo|duel)-[0-9]+$/.test(event.templateId)));
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
  assert.match(cancelled.embeds[0].data.description, /No giveaway prize winners/);
});

test("sequential event posts carry a stable marker and suppress automatic ping spam", () => {
  const trial = record({ gameEvents: [{ victimId: contestants[0], description: "Eliminated", remaining: 3 }] });
  const event = survivalEventPayload(trial, trial.gameEvents[0], 0);
  assert.equal(event.allowedMentions.parse.length, 0);
  assert.equal(event.embeds[0].data.footer.text, `Trial ${id} · Event 1`);
  assert.equal(event.embeds[0].data.author.name, "THE CRYPTIC COURT · LIVE TRIAL");
  assert.match(event.embeds[0].data.title, /Elimination 1 of 1/);
  assert.match(event.embeds[0].data.description, /Eliminated/);
  assert.equal(event.embeds[0].data.fields[0].name, "⚰️ Eliminated");
  assert.equal(event.embeds[0].data.fields[0].value, `<@${contestants[0]}>`);
  assert.equal(event.embeds[0].data.fields[1].name, "🕯️ Still Standing");
  assert.equal(event.embeds[0].data.fields[1].value, "**3 / 4**");
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
      };
      sent.push(m);
      return m;
    },
  };
  const client = { user: { id: "999999999999999999" }, channels: { fetch: async () => channel } };
  try {
    patch(original, Giveaway, "findOneAndUpdate", (filter, update) => ({
      lean: async () => {
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
      assert.equal(sent.length, i + 1);
      assert.equal(stored.nextEventIndex, i + 1);
    }
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
    send: async () => { sends++; throw Error("Would have duplicated a post"); },
  };
  const client = { user: { id: "999999999999999999" }, channels: { fetch: async () => channel } };
  try {
    patch(original, Giveaway, "findOneAndUpdate", (query, update) => ({
      lean: async () => {
        if (state.status !== query.status || state.nextEventIndex !== query.nextEventIndex)
          return null;
        state = { ...state, ...update.$set };
        if (update.$push) state.eliminationMessages = [update.$push.eliminationMessages];
        if (update.$inc) state.renderVersion += 1;
        return { ...state };
      },
    }));
    patch(original, Giveaway, "updateOne", async () => ({ modifiedCount: 1 }));
    assert.equal(await runSurvivalTrialStep(client, { ...state }, { now: new Date(Date.now() + 60_000) }), true);
    assert.equal(sends, 0);
    assert.equal(state.status, "ended");
    assert.equal(state.eliminationMessages[0].messageId, existing.id);
  } finally { restore(original); }
});
