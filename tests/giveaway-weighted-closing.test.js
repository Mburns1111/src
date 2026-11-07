import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import {closeGiveaway} from "../services/giveaways.js";
const guildId="123456789012345678",A="234567890123456789",
 B="345678901234567890",role="456789012345678901";
const giveawayId="507f1f77bcf86cd799439011";

test("activity closing saves unique-member role weights and never produces duplicate winners",async()=>{
 const original=[Giveaway.findOneAndUpdate,Giveaway.findOne];
 const now=new Date("2026-11-11T00:30:00Z");
 const originalRecord={_id:giveawayId,guildId,mode:"activity",status:"closing",
   entrantIds:[A,A,B],roleBonuses:[{roleId:role,extraEntries:4}],
   winnerCount:2,endsAt:now,claimWindowHours:48,autoRerollClaims:true,
   winnerClaims:[],rerollHistory:[],winnerIds:[]};
 let saved;
 try {
  Giveaway.findOne=()=>({lean:async()=>originalRecord});
  Giveaway.findOneAndUpdate=(query,update)=>({lean:async()=>{
    if(query.status==="open")return null;
    saved=update.$set;
    return {...originalRecord,...saved};
  }});
  const members={
   [A]:{id:A,user:{bot:false},roles:{cache:new Map([[role,{}]])}},
   [B]:{id:B,user:{bot:false},roles:{cache:new Map()}},
  };
  const client={guilds:{fetch:async()=>({members:{
    fetch:async ({user})=>members[user],
  }})}};
  const result=await closeGiveaway({id:giveawayId,guildId,client,now});
  assert.deepEqual(result.activityVerifiedIds,[A,B]);
  assert.deepEqual(result.entryWeights.map(w=>[w.userId,w.weight]),[[A,5],[B,1]]);
  assert.deepEqual([...result.winnerIds].sort(),[A,B].sort());
  assert.equal(result.winnerIds.length,2);
 }finally{[Giveaway.findOneAndUpdate,Giveaway.findOne]=original;}
});
