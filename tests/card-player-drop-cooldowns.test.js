import test from "node:test";
import assert from "node:assert/strict";
import CardDrop from "../models/CardDrop.js";
import CardActionCooldown from "../models/CardActionCooldown.js";
import {
  claimCardActionCooldown, releaseCardActionCooldown, readCardActionCooldown,
  cardCooldownIdentity, CARD_DROP_COOLDOWN_MS, CARD_GRAB_COOLDOWN_MS,
} from "../services/card-action-cooldowns.js";
import { refundLosingCardGrabCooldowns } from "../services/card-drop-claims.js";
import { parseHatchemText } from "../services/hatchem-text-commands.js";
import { data as cardCommand } from "../commands/cards.js";

const user = "123456789012345678";
const guildA = "234567890123456789";
const guildB = "345678901234567890";

test("member commands grant a normal drop and cooldown status, while owner test-drop stays available", () => {
  const commands = cardCommand.toJSON().options.map(option => option.name);
  assert.ok(commands.includes("drop"));
  assert.ok(commands.includes("cooldowns"));
  assert.ok(commands.includes("test-drop"));
  assert.deepEqual(parseHatchemText(".drop"), { action: "drop", options: {} });
  assert.deepEqual(parseHatchemText(".cooldowns"), { action: "cooldowns", options: {} });
  assert.equal(CardDrop.schema.path("mode").defaultValue, "test");
});

test("drop cooldown is GLOBAL and grab cooldown is per server", () => {
  const a = cardCooldownIdentity({ action:"drop", discordUserId:user, guildId:guildA });
  const b = cardCooldownIdentity({ action:"drop", discordUserId:user, guildId:guildB });
  const ga = cardCooldownIdentity({ action:"grab", discordUserId:user, guildId:guildA });
  const gb = cardCooldownIdentity({ action:"grab", discordUserId:user, guildId:guildB });
  assert.equal(a._id, b._id);
  assert.notEqual(ga._id, gb._id);
  assert.equal(CARD_DROP_COOLDOWN_MS, 15*60*1000);
  assert.equal(CARD_GRAB_COOLDOWN_MS, 5*60*1000);
  assert.ok(CardActionCooldown.schema.path("sourceId"));
});

test("a successful player drop claims exactly 15 minutes and records the drop source for refunds", async () => {
  const prev = { advance:CardActionCooldown.findOneAndUpdate, create:CardActionCooldown.create };
  const now = new Date("2026-10-29T18:00:00.000Z");
  try {
    CardActionCooldown.findOneAndUpdate = (where, change) => {
      assert.equal(where._id, "drop:global:" + user);
      assert.deepEqual(where.availableAt, { $lte:now });
      assert.equal(change.$set.sourceId, "d1");
      assert.equal(+change.$set.availableAt, +now + CARD_DROP_COOLDOWN_MS);
      return { lean:async()=>null };
    };
    CardActionCooldown.create = async record => {
      assert.equal(record.scope,"global");
      assert.equal(record.sourceId,"d1");
      return record;
    };
    const result = await claimCardActionCooldown({
      action:"drop", discordUserId:user, guildId:guildA, now, sourceId:"d1",
    });
    assert.equal(result.allowed,true);
    assert.equal(+result.availableAt, +now + 15*60*1000);
  } finally {
    CardActionCooldown.findOneAndUpdate=prev.advance;
    CardActionCooldown.create=prev.create;
  }
});

test("a second drop in another server is denied while the same global cooldown is running", async () => {
  const prev = { advance:CardActionCooldown.findOneAndUpdate, create:CardActionCooldown.create,
    find:CardActionCooldown.findById };
  const next = new Date("2026-10-29T18:15:00.000Z");
  try {
    CardActionCooldown.findOneAndUpdate = () => ({ lean:async()=>null });
    CardActionCooldown.create = async()=>{ const error=new Error("duplicate");error.code=11000;throw error; };
    CardActionCooldown.findById = id => {
      assert.equal(id,"drop:global:" + user);
      return { select:()=>({ lean:async()=>({availableAt:next}) }) };
    };
    const result=await claimCardActionCooldown({
      action:"drop", discordUserId:user,guildId:guildB,
      sourceId:"d2",now:new Date("2026-10-29T18:05:00.000Z"),
    });
    assert.equal(result.allowed,false);
    assert.equal(+result.availableAt,+next);
  } finally {
    CardActionCooldown.findOneAndUpdate=prev.advance;
    CardActionCooldown.create=prev.create;
    CardActionCooldown.findById=prev.find;
  }
});

test("a failed drop or unsuccessful grab refunds only its own cooldown source", async () => {
  const prev = CardActionCooldown.deleteOne;
  try {
    CardActionCooldown.deleteOne=async query=>{
      assert.equal(query._id,"grab:" + guildA + ":" + user);
      assert.equal(query.sourceId,"drop-abc");
      return { deletedCount:1 };
    };
    assert.equal(await releaseCardActionCooldown({
      action:"grab",discordUserId:user,guildId:guildA,sourceId:"drop-abc",
    }),true);
    CardActionCooldown.deleteOne=async query=>{
      assert.equal(query.sourceId,"old-drop");
      return { deletedCount:0 };
    };
    assert.equal(await releaseCardActionCooldown({
      action:"grab",discordUserId:user,guildId:guildA,sourceId:"old-drop",
    }),false);
  } finally { CardActionCooldown.deleteOne=prev; }
});

test("read cooldowns do not consume or renew eligibility", async () => {
  const prev=CardActionCooldown.findById;
  try {
    CardActionCooldown.findById=()=>({select:()=>({lean:async()=>null})});
    assert.equal((await readCardActionCooldown({
      action:"grab",discordUserId:user,guildId:guildB,
    })).allowed,true);
  } finally { CardActionCooldown.findById=prev; }
});

test("settling a player drop refunds losing guests, but never the winner", async () => {
  const prev={ find:CardDrop.findById,update:CardDrop.updateOne,del:CardActionCooldown.deleteOne };
  const dropId="507f1f77bcf86cd799439011";
  const loser="456789012345678901", winner=user;
  try {
    CardDrop.findById=()=>({lean:async()=>({
      _id:dropId,guildId:guildA,status:"closed",mode:"player",grabRefundedAt:null,
      slots:[
        {entrants:[winner,loser],winnerId:winner,settledAt:new Date()},
        {entrants:[],winnerId:null,settledAt:null},
        {entrants:[],winnerId:null,settledAt:null},
      ],
    })});
    let deletes=0;
    CardActionCooldown.deleteOne=async query=>{
      assert.equal(query._id,"grab:" + guildA + ":" + loser);
      assert.equal(query.sourceId,dropId);
      deletes++;
      return {deletedCount:1};
    };
    CardDrop.updateOne=async (query,changes)=>{
      assert.equal(query.grabRefundedAt,null);
      assert.ok(changes.$set.grabRefundedAt instanceof Date);
    };
    await refundLosingCardGrabCooldowns({ _id:dropId, mode:"player", grabRefundedAt:null });
    assert.equal(deletes,1);
  } finally {
    CardDrop.findById=prev.find;CardDrop.updateOne=prev.update;
    CardActionCooldown.deleteOne=prev.del;
  }
});
