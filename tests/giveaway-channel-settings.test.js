import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import { data as setupCommand, execute as setupChannels } from "../commands/setup.js";
import {generalSetupFields} from "../commands/general-card-setup.js";
import {describeActivityGiveawaySetup,giveawaySetupNotificationRoleIds,giveawaySetupNotificationFields} from "../commands/activity-giveaway-setup.js";
import {regularGiveawayNotificationRoleIds} from "../services/giveaway-notification-roles.js";
import { data as giveawayCommand, trialData as trialCommand, execute as postGiveaway } from "../commands/giveaway.js";

const guildId = "123456789012345678";
const normalId = "234567890123456789";
const trialId = "345678901234567890";
const staffId = "901234567890123456";
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

function setupInteraction(channels, roles = {}, clears = {}) {
  const posts = [];
  return {
    inGuild: () => true,
    guildId, guild: { id: guildId },
    options: {
      // Older cached Discord interactions may still arrive during rollout;
      // the retired subcommand is no longer included in new registrations.
      getSubcommand: () => "channels",
      getChannel: name => channels[name] || null,
      getRole: name => roles[name] || null,
      getBoolean: name => clears[name] || null,
    },
    deferred: false, replied: false,
    deferReply: async () => {},
    editReply: async reply => { posts.push(reply); },
    replies: posts,
  };
}

test("guided setup replaces legacy /setup channels without dropping saved settings", () => {
  const names=setupCommand.toJSON().options.map(x=>x.name);
  assert.deepEqual(names,["activity-giveaways","giveaways","trials","cards","general"]);
  assert.equal(names.includes("channels"),false,"retired legacy subcommand is absent from Discord registration");
  for(const field of ["commandChannelId","partyGamesChannelId"])
    assert.ok(generalSetupFields.includes(field),field+" is set with /setup general");
  for(const field of ["giveawayChannelId","survivalTrialChannelId",
    "activityGiveawayListChannelId","activityGiveawayWinnersChannelId",
    "activityGiveawayReviewChannelId","giveawayPingRoleId","survivalTrialPingRoleId",
    "giveawayNotificationRoleIds","activityNotificationRoleIds"])
    assert.ok(GuildConfig.schema.path(field),field+" is preserved");
  for (const command of [giveawayCommand, trialCommand]) {
    const operation=command.toJSON().options.find(o=>o.name==="start");
    assert.ok(!operation.options.some(o=>o.name==="channel"),
      command.toJSON().name+" cannot override its configured public channel");
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

function postingInteraction(mode, guild, commandName = "giveaway") {
  let reply;
  return {
    guild, guildId, commandName,
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

test("starts always publish to their own assigned channels", async () => {
  const changes = [];
  const sent = [];
  const channels = new Map([normalId, trialId].map(id => [id, {
    id, guildId, isTextBased: () => true,
    send: async payload => {
      sent.push({ id, payload });
      return { id: "678901234567890123", url: "https://discord.com/channels/example" };
    },
  }]));
  channels.set(staffId,{
    id:staffId,messages:{fetch:async()=>null},
    send:async()=>({id:"staff"}),
    permissionsFor:target=>({has:()=>target?.id!=="everyone"})
  });
  try {
    stub(changes, GuildConfig, "findOne", async () => ({
      giveawayChannelId: normalId, survivalTrialChannelId: trialId, activityGiveawayReviewChannelId:staffId,
    }));
    stub(changes, Giveaway, "create", async values => ({
      ...values, _id: giveawayId, toObject: () => ({ ...values, _id: giveawayId }),
    }));
    stub(changes, Giveaway, "updateOne", async () => ({ matchedCount: 1, modifiedCount: 1 }));
    const guild = { id: guildId, roles:{everyone:{id:"everyone"}},members:{me:{id:"bot"}}, channels: {
      fetch: async id => channels.get(id) || null,
    } };
    const normal = postingInteraction("start", guild);
    const trial = postingInteraction("start", guild, "trial");
    await postGiveaway(normal);
    await postGiveaway(trial);
    assert.deepEqual(sent.map(x => x.id), [normalId, trialId]);
    assert.match(normal.getReply(), /Giveaway posted/);
    assert.match(trial.getReply(), /Survival trial posted/);
  } finally { restore(changes); }
});

test("trial start saves claim minutes, while regular start saves claim hours", async () => {
  const changes = [];
  const created = [];
  try {
    stub(changes, GuildConfig, "findOne", async () => ({
      giveawayChannelId: normalId,
      survivalTrialChannelId: trialId,activityGiveawayReviewChannelId:staffId,
    }));
    stub(changes, Giveaway, "create", async values => {
      created.push(values);
      return { ...values, _id: giveawayId, toObject: () => ({ ...values, _id: giveawayId }) };
    });
    stub(changes, Giveaway, "updateOne", async () => ({ modifiedCount: 1 }));
    const guild = { id: guildId,roles:{everyone:{id:"everyone"}},members:{me:{id:"bot"}},channels: { fetch: async id => ({
      id, guildId, isTextBased: () => true,
      messages:{fetch:async()=>null},permissionsFor:target=>({has:()=>target?.id!=="everyone"}),
      send: async () => ({ id: "678901234567890123", url: "https://discord.com/channels/example" }),
    }) } };
    const giveaway = postingInteraction("start", guild);
    giveaway.options.getInteger = name => name === "claim_hours" ? 24 : name === "minutes" ? 60 : null;
    const trial = postingInteraction("start", guild, "trial");
    trial.options.getInteger = name => name === "claim_minutes" ? 15 : name === "signup_minutes" ? 30 : null;
    await postGiveaway(giveaway);
    await postGiveaway(trial);
    assert.equal(created.length, 2);
    assert.equal(created[0].claimWindowHours, 24);
    assert.equal(created[0].claimWindowMinutes, null);
    assert.equal(created[1].claimWindowMinutes, 15);
    assert.equal(created[1].claimWindowHours, null);
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
    assert.match(interaction.getReply().content, /setup giveaways/i);
  } finally { restore(changes); }
});

test("admins can assign and clear each event ping role without changing saved channels", async () => {
  const patches = [];
  const updates = [];
  try {
    stub(patches, GuildConfig, "findOneAndUpdate", async (query, update) => {
      updates.push(update.$set);
    });
    const first = setupInteraction({}, {
      giveaway_ping: { id: "135791357913579135" },
      trial_ping: { id: "246802468024680246" },
    });
    await setupChannels(first);
    assert.deepEqual(updates[0], {
      giveawayPingRoleId: "135791357913579135",
      giveawayNotificationRoleIds:["135791357913579135"],
      survivalTrialPingRoleId: "246802468024680246",
    });
    assert.match(first.replies.at(-1).content, /Giveaway notifications|giveaway notifications/i);
    const second = setupInteraction({}, {}, { clear_trial_ping: true });
    await setupChannels(second);
    assert.deepEqual(updates[1], { survivalTrialPingRoleId: "" });
    const third = setupInteraction({}, {}, { clear_giveaway_ping: true });
    await setupChannels(third);
    assert.deepEqual(updates[2], { giveawayPingRoleId: "",giveawayNotificationRoleIds:[] });
    assert.equal(updates.some(update => Object.hasOwn(update, "giveawayChannelId")), false);
    await assert.rejects(
      () => setupChannels(setupInteraction({}, { giveaway_ping: { id: "123" } }, { clear_giveaway_ping: true })),
      /role or clear/i,
    );
  } finally { restore(patches); }
});

test("new event posts ping their configured role only at creation, not a required-entry role", async () => {
  const patches = [];
  const notifications = [];
  const ids = { normal: "135791357913579135", trial: "246802468024680246" };
  const channel = id => ({
    id, guildId, isTextBased: () => true,
    messages:{fetch:async()=>null},permissionsFor:target=>({has:()=>target?.id!=="everyone"}),
    send: async payload => {
      notifications.push({ channel: id, payload });
      return { id: "678901234567890123", url: "https://discord.com/channels/example" };
    },
  });
  try {
    stub(patches, GuildConfig, "findOne", async () => ({
      giveawayChannelId: normalId, survivalTrialChannelId: trialId,activityGiveawayReviewChannelId:staffId,
      giveawayPingRoleId: ids.normal, survivalTrialPingRoleId: ids.trial,
    }));
    const saved = [];
    stub(patches, Giveaway, "create", async values => {
      saved.push(values);
      return { ...values, _id: giveawayId, toObject: () => ({ ...values, _id: giveawayId }) };
    });
    stub(patches, Giveaway, "updateOne", async () => ({ modifiedCount: 1 }));
    const guild = { id: guildId,roles:{everyone:{id:"everyone"}},members:{me:{id:"bot"}},channels: { fetch: async id => channel(id) } };
    await postGiveaway(postingInteraction("start", guild));
    await postGiveaway(postingInteraction("start", guild, "trial"));
    assert.deepEqual(saved.map(item => item.announcementPingRoleId), [ids.normal, ids.trial]);
    assert.deepEqual(notifications.map(item => item.channel), [normalId, trialId]);
    for (const [index, role] of [ids.normal, ids.trial].entries()) {
      assert.equal(notifications[index].payload.content, "<@&" + role + ">");
      assert.deepEqual(notifications[index].payload.allowedMentions, { parse: [], roles: [role] });
      assert.equal(notifications[index].payload.components.length, 1);
    }
  } finally { restore(patches); }
});

test("no configured ping role produces no mention and no role ping allowed", async () => {
  const patches = [];
  let payload;
  try {
    stub(patches, GuildConfig, "findOne", async () => ({
      giveawayChannelId: normalId, giveawayPingRoleId: "",activityGiveawayReviewChannelId:staffId,
    }));
    stub(patches, Giveaway, "create", async values => ({
      ...values, _id: giveawayId, toObject: () => ({ ...values, _id: giveawayId }),
    }));
    stub(patches, Giveaway, "updateOne", async () => ({ modifiedCount: 1 }));
    const guild = { id: guildId,roles:{everyone:{id:"everyone"}},members:{me:{id:"bot"}},channels: { fetch: async () => ({
      id: normalId, isTextBased: () => true,
       messages:{fetch:async()=>null},permissionsFor:target=>({has:()=>target?.id!=="everyone"}),
      send: async data => {
        payload = data;
        return { id: "678901234567890123", url: "https://discord.com/channels/example" };
      },
    }) } };
    await postGiveaway(postingInteraction("start", guild));
    assert.equal(payload.content, undefined);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
  } finally { restore(patches); }
});

test("activity giveaway listing and winners can be saved independently from standard and trial channels",async()=>{
 const changes=[],saved=[];
 try {
  stub(changes,GuildConfig,"findOne",()=>({
   select:()=>({lean:async()=>({
    giveawayChannelId:normalId,survivalTrialChannelId:trialId,
    activityGiveawayListChannelId:"",activityGiveawayWinnersChannelId:"",
   })}),
  }));
  stub(changes,GuildConfig,"findOneAndUpdate",async(_filter,update)=>saved.push(update.$set));
  const listing={id:"678901234567890123",toString:()=>"<#678901234567890123>"};
  const winners={id:"789012345678901234",toString:()=>"<#789012345678901234>"};
  const interaction=setupInteraction({activity_giveaway_list:listing,activity_winners:winners});
  await setupChannels(interaction);
  assert.deepEqual(saved,[{
    activityGiveawayListChannelId:listing.id,
    activityGiveawayWinnersChannelId:winners.id,
  }]);
  assert.match(interaction.replies.at(-1).content,/Activity giveaway winner announcements/);
  await assert.rejects(()=>setupChannels(setupInteraction({
    activity_giveaway_list:{id:otherId},activity_winners:{id:otherId}
  })),/different channels/i);
  await assert.rejects(()=>setupChannels(setupInteraction({
    activity_winners:{id:normalId}
  })),/separate channels/i);
 }finally{restore(changes);}
});
