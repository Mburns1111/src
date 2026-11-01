import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import { data as setupCommand, execute as setupChannels } from "../commands/setup.js";
import { data as giveawayCommand, execute as postGiveaway } from "../commands/giveaway.js";

const guildId = "123456789012345678";
const normalId = "234567890123456789";
const trialId = "345678901234567890";
const otherId = "456789012345678901";
const ownerId = "567890123456789012";
const giveawayId = "507f1f77bcf86cd799439011";
const stub = (replacements, object, name, fn) => {
  replacements.push([object, name, object[name]]);
  object[name] = fn;
};
const restore = changes => {
  for (const [obj, key, previous] of changes.reverse()) obj[key] = previous;
};

function setupInteraction(channels) {
  const posts = [];
  return {
    inGuild: () => true,
    guildId, guild: { id: guildId },
    options: { getChannel: name => channels[name] || null },
    deferred: false, replied: false,
    deferReply: async () => {},
    editReply: async reply => { posts.push(reply); },
    replies: posts,
  };
}

test("setup exposes two distinct optional giveaway channel selectors", () => {
  const config = setupCommand.toJSON().options.find(o => o.name === "channels");
  const names = config.options.map(o => o.name);
  assert.ok(names.includes("giveaways"));
  assert.ok(names.includes("survival_trials"));
  assert.notEqual(names.indexOf("giveaways"), names.indexOf("survival_trials"));
  assert.ok(GuildConfig.schema.path("giveawayChannelId"));
  assert.ok(GuildConfig.schema.path("survivalTrialChannelId"));
  assert.equal(config.options.length, 10);
  const giveaway = giveawayCommand.toJSON();
  for (const name of ["start", "speed"]) {
    const operation = giveaway.options.find(o => o.name === name);
    assert.ok(!operation.options.some(o => o.name === "channel"),
      name + " cannot override its assigned channel");
  }
});

test("setup persists each channel independently, without changing other settings", async () => {
  const changes = [];
  const updated = [];
  try {
    stub(changes, GuildConfig, "findOne", () => ({
      select: () => ({ lean: async () => ({
        giveawayChannelId: "", survivalTrialChannelId: trialId,
      }) }),
    }));
    stub(changes, GuildConfig, "findOneAndUpdate", async (filter, update) => {
      updated.push({ filter, update });
    });
    const interaction = setupInteraction({ giveaways: { id: normalId, toString: () => "<#"+normalId+">" } });
    await setupChannels(interaction);
    assert.equal(updated.length, 1);
    assert.deepEqual(updated[0].filter, { guildId });
    assert.deepEqual(updated[0].update.$set, { giveawayChannelId: normalId });
    assert.match(interaction.replies.at(-1).content, /Standard giveaways/);
  } finally { restore(changes); }
});

test("setup refuses using one channel for both giveaway types, including a previously saved channel", async () => {
  const changes = [];
  try {
    stub(changes, GuildConfig, "findOne", () => ({
      select: () => ({ lean: async () => ({
        giveawayChannelId: normalId, survivalTrialChannelId: trialId,
      }) }),
    }));
    stub(changes, GuildConfig, "findOneAndUpdate", async () => {
      assert.fail("Identical channels must not be saved");
    });
    await assert.rejects(
      () => setupChannels(setupInteraction({ survival_trials: { id: normalId } })),
      /two different channels/i,
    );
    await assert.rejects(
      () => setupChannels(setupInteraction({
        giveaways: { id: otherId }, survival_trials: { id: otherId },
      })),
      /two different channels/i,
    );
  } finally { restore(changes); }
});

function postingInteraction(mode, guild) {
  let reply;
  return {
    guild, guildId,
    channel: { id: otherId, send: async () => { assert.fail("Do not post in the invoking channel"); } },
    user: { id: ownerId },
    memberPermissions: { has: bit => bit === PermissionFlagsBits.ManageGuild },
    options: {
      getSubcommand: () => mode,
      getString: name => name === "title" ? "Test Event" : name === "prize" ? "Test prize" : null,
      getInteger: name => name === "minutes" || name === "signup_minutes" ? 1 : null,
      getRole: () => null,
      getChannel: () => { assert.fail("No per-event channel picker"); },
    },
    editReply: async value => { reply = value; },
    getReply: () => reply,
  };
}

test("start and speed always publish to their own assigned channels", async () => {
  const changes = [];
  const sent = [];
  const channels = new Map([normalId, trialId].map(id => [id, {
    id, guildId, isTextBased: () => true,
    send: async payload => {
      sent.push({ id, payload });
      return { id: "678901234567890123", url: "https://discord.com/channels/example" };
    },
  }]));
  try {
    stub(changes, GuildConfig, "findOne", async () => ({
      giveawayChannelId: normalId, survivalTrialChannelId: trialId,
    }));
    stub(changes, Giveaway, "create", async values => ({
      ...values, _id: giveawayId, toObject: () => ({ ...values, _id: giveawayId }),
    }));
    stub(changes, Giveaway, "updateOne", async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const guild = { id: guildId, channels: {
      fetch: async id => channels.get(id) || null,
    } };
    const normal = postingInteraction("start", guild);
    const trial = postingInteraction("speed", guild);
    await postGiveaway(normal);
    await postGiveaway(trial);
    assert.deepEqual(sent.map(x => x.id), [normalId, trialId]);
    assert.match(normal.getReply(), /Giveaway posted/);
    assert.match(trial.getReply(), /Survival trial posted/);
  } finally { restore(changes); }
});

test("an unconfigured dedicated channel never falls back to the command channel", async () => {
  const changes = [];
  try {
    stub(changes, GuildConfig, "findOne", async () => ({
      giveawayChannelId: "", survivalTrialChannelId: trialId,
    }));
    stub(changes, Giveaway, "create", async () => { assert.fail("Must configure standard channel before posting"); });
    const guild = { id: guildId, channels: { fetch: async () => { assert.fail("No configured channel should be fetched"); } } };
    const interaction = postingInteraction("start", guild);
    await postGiveaway(interaction);
    assert.match(interaction.getReply().content, /configure the standard giveaway channel/i);
    assert.match(interaction.getReply().content, /setup channels/i);
  } finally { restore(changes); }
});
