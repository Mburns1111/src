import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import {giveawayAnnouncement,publishGiveawayResult} from "../services/giveaways.js";
import {winnerClaimDeadline,nextClaimCheckAt} from "../services/giveaway-claims.js";

const guildId="123456789012345678",channelId="234567890123456789",
 winner="345678901234567890",host="456789012345678901",giveawayId="507f1f77bcf86cd799439011";

test("explicitly unpublished winner has no claim deadline; legacy assigned records keep their deadlines",()=>{
 const old=new Date("2026-11-13T16:00:00Z");
 const waiting={status:"ended",autoRerollClaims:true,
   winnerIds:[winner],claimWindowHours:12,
   claimStartedAt:old,winnerAssignedAt:[null]};
 assert.equal(winnerClaimDeadline(waiting,0),null);
 assert.equal(nextClaimCheckAt(waiting),null);
 assert.equal(winnerClaimDeadline({...waiting,winnerAssignedAt:[]},0).toISOString(),
   "2026-11-14T04:00:00.000Z");
});

test("long valid giveaway wording cannot push winners out of the published embed",()=>{
 const result=giveawayAnnouncement({_id:giveawayId,guildId,channelId,mode:"standard",
   status:"ended",title:"Long story",prize:"P".repeat(1800),description:"D".repeat(1000),
   rules:"R".repeat(1200),displayWinnerText:"W".repeat(400),creatorId:host,
   endsAt:new Date(),winnerCount:1,winnerIds:[winner],entrantIds:[winner],
   winnerAssignedAt:[new Date()],claimWindowHours:24,claimResolvedSlots:[]});
 const body=result.embeds[0].toJSON();
 assert.ok(body.description.length<=3900);
 const dedicated=body.fields.find(f=>f.name==="🏆 Winners / Results");
 assert.ok(dedicated);
 assert.match(dedicated.value,new RegExp(winner));
});

test("activity winner publication crash before MongoDB save is recovered without duplicate posts or expired claim",async()=>{
 const prev={find:GuildConfig.findOne,update:Giveaway.updateOne};
 let record={_id:giveawayId,guildId,channelId,mode:"activity",status:"ended",
   messageId:"",title:"Activity test",prize:"Prize",creatorId:host,
   endsAt:new Date(),winnerCount:1,winnerIds:[winner],entrantIds:[winner],
   claimWindowHours:12,autoRerollClaims:true,claimStartedAt:null,
   winnerAssignedAt:[null],claimCheckAt:null,renderVersion:1,renderedAt:null};
 const posts=[];let fail=true,edits=0;
 const channel={
  messages:{fetch:async key=>{
    if(typeof key==="string")return posts.find(m=>m.id===key)||null;
    return {size:posts.length,values:()=>posts.values()};
  }},
  send:async payload=>{
    const message={
      id:"567890123456789012",author:{id:"bot"},
      embeds:payload.embeds.map(x=>x.toJSON()),
      components:(payload.components||[]).map(x=>x.toJSON()),
      edit:async next=>{
        edits++;
        message.embeds=next.embeds.map(x=>x.toJSON());
        message.components=(next.components||[]).map(x=>x.toJSON());
        return message;
      }
    };
    posts.push(message);return message;
  }
 };
 const client={user:{id:"bot"},channels:{fetch:async id=>id===channelId?channel:null}};
 try{
   GuildConfig.findOne=()=>({select:()=>({lean:async()=>null})});
   Giveaway.updateOne=async(query,change)=>{
     if(fail){fail=false;throw Error("MongoDB write interruption");}
     Object.assign(record,change.$set||{});
     return {matchedCount:1,modifiedCount:1};
   };
   await assert.rejects(()=>publishGiveawayResult(client,{...record}),/MongoDB write interruption/);
   assert.equal(posts.length,1);
   assert.equal(record.claimStartedAt,null);
   assert.equal(winnerClaimDeadline(record,0),null);
   assert.equal(record.claimCheckAt,null);
   await publishGiveawayResult(client,{...record});
   assert.equal(posts.length,1,"crash recovery must reuse the first public winner message");
   assert.equal(record.messageId,posts[0].id);
   assert.ok(record.claimStartedAt instanceof Date);
   assert.ok(record.winnerAssignedAt[0] instanceof Date);
   assert.ok(record.claimCheckAt instanceof Date);
   assert.ok(record.renderedAt instanceof Date);
   assert.ok(edits>=2);
 }finally{
   GuildConfig.findOne=prev.find;
   Giveaway.updateOne=prev.update;
 }
});
