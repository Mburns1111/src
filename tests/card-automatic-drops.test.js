import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import CardDrop from "../models/CardDrop.js";
import { data as adminCommands } from "../commands/cards-admin.js";
import { automaticEggPing } from "../commands/cards.js";
import {
  chooseAutomaticDropRelease, initializeAutomaticDropSchedules, nextTimedDrop,
  observeAutomaticDropActivity, clearAutomaticDropActivityForTests,
  AUTO_DROP_MIN_MINUTES, AUTO_DROP_MAX_MINUTES,
  ACTIVITY_CHANCE, ACTIVITY_MESSAGES_REQUIRED, ACTIVITY_MEMBERS_REQUIRED,
} from "../services/card-automatic-drops.js";
import { eligiblePlayerDrop } from "../services/card-achievement-engine.js";

test("every server uses global automatic egg settings and local managers cannot change them", () => {
  assert.ok(CardDrop.schema.path("mode").enumValues.includes("automatic"));
  assert.ok(GuildConfig.schema.path("hatchemNextAutoDropAt"));
  assert.ok(GuildConfig.schema.path("hatchemLastAutoDropAt"));
  assert.ok(GuildConfig.schema.path("hatchemNextActivityDropAt"));
  const options = adminCommands.toJSON().options.map(x => x.name);
  assert.deepEqual(options, ["setup-role"]);
  assert.ok(!options.includes("auto-drops"));
});

test("automatic egg pings only the registered server Card role", () => {
  const role = "123456789012345678";
  assert.deepEqual(automaticEggPing(role), {
    mention: "<@&" + role + ">",
    allowedMentions: { parse: [], roles: [role] },
  });
  for (const unsafe of ["", "@everyone", "<@&123456789012345678>", "invalid", "123"]) {
    assert.deepEqual(automaticEggPing(unsafe), {
      mention: "", allowedMentions: { parse: [], roles: [] },
    });
  }
});

test("timed eggs use an independent uniform 45–75 minute random window", () => {
  const now=new Date("2026-11-02T12:00:00Z");
  assert.equal(AUTO_DROP_MIN_MINUTES,45);
  assert.equal(AUTO_DROP_MAX_MINUTES,75);
  assert.equal(nextTimedDrop(now,(min,max)=>{
    assert.equal(min,45);assert.equal(max,76);return 45;
  }).toISOString(),"2026-11-02T12:45:00.000Z");
  assert.equal(nextTimedDrop(now,(_min,_max)=>75).toISOString(),"2026-11-02T13:15:00.000Z");
  for(let i=0;i<50;i++){
    const delay=+nextTimedDrop(now)-+now;
    assert.ok(delay>=45*60_000&&delay<=75*60_000);
  }
});

test("configured servers get automatic schedules without opt-in, preserving existing dates", async () => {
  const original = { find: GuildConfig.find, update: GuildConfig.updateOne };
  const calls = [];
  try {
    GuildConfig.find = query => {
      assert.equal(query.hatchemNextAutoDropAt, null);
      assert.equal(query.hatchemChannelId.$ne, "");
      assert.equal(query.cardRoleId.$ne, "");
      assert.equal("hatchemAutoDropsEnabled" in query, false);
      return { select: () => ({ limit: () => ({ lean: async () => [
        { guildId: "111111111111111111" },
        { guildId: "222222222222222222" },
      ] }) }) };
    };
    GuildConfig.updateOne = async (filter, update) => {
      assert.equal(filter.hatchemNextAutoDropAt, null);
      assert.equal(filter.hatchemChannelId.$ne, "");
      assert.equal(filter.cardRoleId.$ne, "");
      calls.push({ filter, update });
      return { modifiedCount: 1 };
    };
    const now = new Date("2026-11-02T12:00:00Z");
    assert.equal(await initializeAutomaticDropSchedules(now), 2);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      const due = call.update.$set.hatchemNextAutoDropAt;
      assert.ok(+due >= +now + 45 * 60_000);
      assert.ok(+due <= +now + 75 * 60_000);
    }
  } finally {
    GuildConfig.find = original.find; GuildConfig.updateOne = original.update;
  }
});

test("activity chance requires real chat from three people; bots, spam and commands do not qualify", () => {
  clearAutomaticDropActivityForTests();
  assert.equal(ACTIVITY_CHANCE,0.20);
  assert.equal(ACTIVITY_MEMBERS_REQUIRED,3);
  assert.equal(ACTIVITY_MESSAGES_REQUIRED,12);
  const first=new Date("2026-11-02T12:00:00Z");
  const message=(user,content="This is a meaningful conversation message.")=>({
    guildId:"111111111111111111",author:{id:user,bot:false},content,
  });
  // One participant cannot fabricate enough independent members.
  for(let i=0;i<10;i++){
    assert.equal(observeAutomaticDropActivity(message("user-a"),new Date(+first+i*65_000)),false);
  }
  clearAutomaticDropActivityForTests();
  // Three members alternate at 30s intervals, each more than 60s apart.
  const members=["user-a","user-b","user-c"];
  for(let i=0;i<12;i++){
    const at=new Date(+first+i*30_000);
    const eligible=observeAutomaticDropActivity(message(members[i%3]),at);
    assert.equal(eligible,i===11);
  }
  assert.equal(observeAutomaticDropActivity(message("user-a"),new Date(+first+12*30_000)),false);
  assert.equal(observeAutomaticDropActivity(message("user-a","/trade please"),new Date(+first+13*30_000)),false);
  assert.equal(observeAutomaticDropActivity({
    ...message("user-b"),author:{id:"user-b",bot:true},
  },new Date(+first+14*30_000)),false);
  assert.equal(observeAutomaticDropActivity(message("user-c","hi"),new Date(+first+15*30_000)),false);
  clearAutomaticDropActivityForTests();
});

test("new activity roll cannot be farmed again inside 10 minutes", () => {
  clearAutomaticDropActivityForTests();
  const start=+new Date("2026-11-02T12:00:00Z");
  const people=["a","b","c"];
  for(let i=0;i<12;i++)observeAutomaticDropActivity({
    guildId:"guild1",author:{id:people[i%3]},content:"We're talking about trading our favorite pets.",
  },new Date(start+i*30_000));
  for(let i=0;i<12;i++)assert.equal(observeAutomaticDropActivity({
    guildId:"guild1",author:{id:people[i%3]},content:"We have lots of fun activities together.",
  },new Date(start+(i+12)*30_000)),false);
  clearAutomaticDropActivityForTests();
});

test("automatic drops prioritize real approved active releases over test fixtures",()=>{
  assert.equal(chooseAutomaticDropRelease([],true),null);
  assert.equal(chooseAutomaticDropRelease([{releaseId:"test-s1-r1"}],false),null);
  assert.equal(chooseAutomaticDropRelease([{releaseId:"test-s1-r1"}],true).releaseId,"test-s1-r1");
  assert.equal(chooseAutomaticDropRelease([
    {releaseId:"test-s1-r1"},{releaseId:"s1-r1"},
  ],true).releaseId,"s1-r1");
});

test("real automated grab achievements qualify after launch; test eggs never qualify",()=>{
  const before=process.env.CARD_ACHIEVEMENTS_START_AT;
  try{
    process.env.CARD_ACHIEVEMENTS_START_AT="2026-11-01T00:00:00Z";
    for(const mode of ["player","automatic"])assert.equal(eligiblePlayerDrop({
      mode,releaseId:"s1-r1",createdAt:new Date("2026-11-02T00:00:00Z"),
    }),true);
    assert.equal(eligiblePlayerDrop({
      mode:"automatic",releaseId:"test-s1-r1",createdAt:new Date("2026-11-02T00:00:00Z"),
    }),false);
    assert.equal(eligiblePlayerDrop({
      mode:"test",releaseId:"s1-r1",createdAt:new Date("2026-11-02T00:00:00Z"),
    }),false);
  }finally{
    if(before===undefined)delete process.env.CARD_ACHIEVEMENTS_START_AT;
    else process.env.CARD_ACHIEVEMENTS_START_AT=before;
  }
});
