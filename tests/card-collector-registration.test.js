import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits } from "discord.js";
import CardCollector from "../models/CardCollector.js";
import GuildConfig from "../models/GuildConfig.js";
import { data as cards, execute as executeCards } from "../commands/cards.js";
import { registerCardCollector, isRegisteredCardCollector } from "../services/card-collector-registration.js";
import { parseHatchemText, HATCHEM_GUIDE, HATCHEM_HELP } from "../services/hatchem-text-commands.js";

const player = "123456789012345678";
const guildA = "234567890123456789";
const guildB = "345678901234567890";
const roleId = "456789012345678901";

function mockInteraction(guildId, { hasRole = false, canManageRoles = true,
  hierarchy = true, roleConfigured = true, prior = null } = {}) {
  const calls = { add:0, remove:0, writes:[], read:0 };
  const role = {
    id:roleId, managed:false, position:1,
    permissions:{ has:()=>false },
  };
  const member = {
    roles:{
      cache:{has:()=>hasRole},
      add:async(id)=>{ assert.equal(id, roleId); calls.add++; },
      remove:async(id)=>{ assert.equal(id, roleId); calls.remove++; },
    },
  };
  const guild = {
    id:guildId,
    roles:{fetch:async()=>role},
    members:{
      me:{
        permissions:{ has: flag=>flag === PermissionFlagsBits.ManageRoles && canManageRoles },
        roles:{ highest:{position:hierarchy?2:1} },
      },
      fetch:async()=>member,
      fetchMe:async()=>null,
    },
  };
  return {
    calls, interaction:{ user:{id:player, bot:false}, guild, guildId },
    roleConfigured, prior,
  };
}

async function withMocks(setup, callback) {
  const old = {
    findConfig:GuildConfig.findOne, find:CardCollector.findOne,
    update:CardCollector.updateOne,
    exists:CardCollector.exists,
  };
  try {
    GuildConfig.findOne=()=>({select:()=>({lean:async()=>(
      setup.roleConfigured ? {cardRoleId:roleId}:{cardRoleId:""}
    )})});
    CardCollector.findOne=()=>({select:()=>({lean:async()=>setup.prior})});
    CardCollector.updateOne=async (filter, update, opts)=>{
      setup.calls.writes.push({filter,update,opts});
      return {acknowledged:true, matchedCount:1};
    };
    CardCollector.exists=async query=>{
      setup.calls.read++;
      if (setup.exists) return setup.exists(query);
      return null;
    };
    return await callback();
  } finally {
    GuildConfig.findOne=old.findConfig; CardCollector.findOne=old.find;
    CardCollector.updateOne=old.update; CardCollector.exists=old.exists;
  }
}

test("only .register is the explicit member opt-in command", () => {
  assert.deepEqual(parseHatchemText(".register"), {action:"register", options:{}});
  assert.equal(parseHatchemText(".REGISTER").action, "register");
  assert.equal(parseHatchemText(".registration"), null);
  assert.equal(cards.toJSON().options.find(x=>x.name==="register").name, "register");
  assert.match(HATCHEM_GUIDE, /\.register/);
  assert.match(HATCHEM_HELP, /Registration is required/);
  assert.ok(CardCollector.schema.path("registeredAt"));
  assert.ok(CardCollector.schema.path("registeredGuildIds"));
});

test("first registration assigns the configured local Card role and preserves collection fields", async () => {
  const setup = mockInteraction(guildA);
  await withMocks(setup, async()=>{
    const result = await registerCardCollector(setup.interaction);
    assert.equal(result.firstRegistration, true);
    assert.equal(result.newServer, true);
    assert.equal(result.roleWasAdded, true);
    assert.equal(setup.calls.add,1);
    assert.equal(setup.calls.writes.length,2);
    assert.deepEqual(setup.calls.writes[0].filter, {discordUserId:player});
    assert.deepEqual(setup.calls.writes[0].update.$addToSet, {registeredGuildIds:guildA});
    assert.equal(setup.calls.writes[0].update.$setOnInsert.discordUserId, player);
    assert.equal(setup.calls.writes[0].update.$set, undefined);
    assert.deepEqual(setup.calls.writes[1].filter, {discordUserId:player,registeredAt:null});
    assert.ok(setup.calls.writes[1].update.$set.registeredAt instanceof Date);
  });
});

test("re-running registration never adds duplicate role or wipes existing cards/tags", async () => {
  const setup=mockInteraction(guildA,{
    hasRole:true, prior:{registeredAt:new Date(),registeredGuildIds:[guildA]},
  });
  await withMocks(setup,async()=>{
    const result=await registerCardCollector(setup.interaction);
    assert.equal(result.firstRegistration,false);
    assert.equal(result.newServer,false);
    assert.equal(result.roleWasAdded,false);
    assert.equal(setup.calls.add,0);
    assert.equal(setup.calls.remove,0);
    assert.ok(setup.calls.writes[0].update.$addToSet.registeredGuildIds);
    assert.equal(setup.calls.writes[0].update.$set?.tagNames,undefined);
    assert.equal(setup.calls.writes[0].update.$set?.dust,undefined);
  });
});

test("collector in another server needs a separate .register to get that guild role",async()=>{
  const setup=mockInteraction(guildB,{
    prior:{registeredAt:new Date(),registeredGuildIds:[guildA]},
  });
  await withMocks(setup,async()=>{
    const result=await registerCardCollector(setup.interaction);
    assert.equal(result.firstRegistration,false);
    assert.equal(result.newServer,true);
    assert.equal(setup.calls.writes[0].update.$addToSet.registeredGuildIds,guildB);
    assert.equal(setup.calls.add,1);
  });
});

test("no configured Card role refuses registration before changing MongoDB",async()=>{
  const setup=mockInteraction(guildA,{roleConfigured:false});
  await withMocks(setup,async()=>{
    await assert.rejects(()=>registerCardCollector(setup.interaction),/not been configured/);
    assert.equal(setup.calls.add,0);
    assert.equal(setup.calls.writes.length,0);
  });
});

test("missing Manage Roles or role hierarchy refuses registration and does not mark collector",async()=>{
  for (const options of [{canManageRoles:false},{hierarchy:false}]) {
    const setup=mockInteraction(guildA,options);
    await withMocks(setup,async()=>{
      await assert.rejects(()=>registerCardCollector(setup.interaction),/Manage Roles/);
      assert.equal(setup.calls.add,0);
      assert.equal(setup.calls.writes.length,0);
    });
  }
});

test("database failure rolls back only a newly assigned role",async()=>{
  const setup=mockInteraction(guildA);
  const old=CardCollector.updateOne;
  await withMocks(setup,async()=>{
    CardCollector.updateOne=async()=>{throw Error("Database disconnected");};
    await assert.rejects(()=>registerCardCollector(setup.interaction),/Database disconnected/);
    assert.equal(setup.calls.add,1);
    assert.equal(setup.calls.remove,1);
  });
  CardCollector.updateOne=old;
});

test("eligibility is scoped to explicit server opt-in and does not autocreate collectors",async()=>{
  const setup=mockInteraction(guildA);
  await withMocks(setup,async()=>{
    setup.exists=query=>{
      assert.equal(query.discordUserId,player);
      assert.deepEqual(query.registeredAt,{$ne:null});
      return query.registeredGuildIds === guildA ? {_id:"found"}:null;
    };
    assert.equal(await isRegisteredCardCollector(player,guildA),true);
    assert.equal(await isRegisteredCardCollector(player,guildB),false);
    assert.equal(setup.calls.writes.length,0);
  });
});

test("regular drop refuses unregistered member before selecting release or spending cooldown",async()=>{
  const setup=mockInteraction(guildA);
  await withMocks(setup,async()=>{
    process.env.ENABLE_CARD_GAME_TEST="1";
    let response;
    await executeCards({
      ...setup.interaction,
      options:{getSubcommand:()=>"drop"},
      editReply:value=>{response=value;},
    });
    assert.match(response,/\.register/);
    assert.equal(setup.calls.writes.length,0);
    delete process.env.ENABLE_CARD_GAME_TEST;
  });
});
