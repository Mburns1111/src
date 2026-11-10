import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import {activeGiveawayIndexData,activeGiveawayIndexEmbed,reconcileActiveGiveawayIndex} from "../services/giveaway-index.js";

const guildId="123456789012345678",channelId="234567890123456789";
const record=(id,mode,status,endsAt=new Date("2026-11-12T12:00:00Z"))=>({
 _id:id,guildId,mode,status,endsAt,title:mode+" giveaway",
 channelId:"345678901234567890",messageId:id,
});
const plan={_id:"507f1f77bcf86cd799439011",guildId,status:"active",
 title:"Wednesday Activity",listChannelId:channelId,listMessageId:"567890123456789012",
 nextRunAt:new Date("2026-11-12T12:00:00Z")};

test("giveaway index formats real clickable links and empty state",()=>{
 const embed=activeGiveawayIndexEmbed({
   standard:[{title:"Regular",url:"https://discord.com/channels/1/2/3",endsAt:new Date("2026-11-12T12:00:00Z")}],
   plans:[{title:"Weekly",url:"https://discord.com/channels/1/2/4"}],
   trials:[{title:"Court Trial",url:"https://discord.com/channels/1/2/5"}],
 }).toJSON();
 assert.match(embed.description,/\[Regular\]\(https:\/\/discord.com\/channels\/1\/2\/3\)/);
 assert.match(embed.description,/\[Weekly\]\(https:\/\/discord.com\/channels\/1\/2\/4\)/);
 assert.match(embed.description,/\[Court Trial\]\(https:\/\/discord.com\/channels\/1\/2\/5\)/);
 assert.equal(embed.footer.text,"AM Isa · Active Giveaway Index");
 assert.match(activeGiveawayIndexEmbed().toJSON().description,/No giveaways are accepting entries/);
});

test("giveaway index lists active standard, activity and trial posts but omits completed giveaways",async()=>{
 const prior={find:Giveaway.find,planFind:GiveawayPlan.find};
 try{
   Giveaway.find=query=>{
     const items=query.mode==="survival" ? [record("678901234567890123","survival","running",new Date("2026-11-10T12:00:00Z"))]
       :[record("111111111111111111","standard","open"),
         record("222222222222222222","activity","open"),
         record("333333333333333333","standard","ended"),
         record("678901234567890123","survival","running")];
     return {sort:()=>({limit:()=>({lean:async()=>items.filter(r=>r.status!=="ended")})})};
   };
   GiveawayPlan.find=()=>({sort:()=>({limit:()=>({lean:async()=>[plan]})})});
   const data=await activeGiveawayIndexData(guildId,new Date("2026-11-10T13:00:00Z"));
   assert.equal(data.standard.length,1);
   assert.equal(data.activities.length,1);
   assert.equal(data.trials.length,1);
   assert.equal(data.plans.length,1);
   assert.match(data.plans[0].url,/567890123456789012/);
 }finally{Giveaway.find=prior.find;GiveawayPlan.find=prior.planFind;}
});

test("sticky index posts once, checks position hourly, and moves only when displaced",async()=>{
 const old={find:GuildConfig.find,update:GuildConfig.updateOne,
   giveaway:Giveaway.find,plans:GiveawayPlan.find};
 const t0=new Date("2026-11-10T12:00:00Z");
 const state={guildId,activityGiveawayListChannelId:channelId,
   giveawayIndexMessageId:"",giveawayIndexChannelId:"",
   giveawayIndexFingerprint:"",giveawayIndexCheckedAt:null};
 const sent=[],deleted=[],edited=[],fetched=[];
 let newest="987654321098765432";
 const messages=new Map();
 const channel={id:channelId,send:async payload=>{
   sent.push(payload);
   const id=sent.length===1?"987654321098765432":"876543210987654321";
   newest=id;
   const msg={id,author:{id:"bot"},pinned:false,
     edit:async()=>edited.push(id),delete:async()=>deleted.push(id)};
   messages.set(id,msg);return msg;
 },messages:{fetch:async arg=>{
   fetched.push(arg);
   if(arg?.limit===1)return {first:()=>({id:newest})};
   if(arg?.limit===100)return {find:()=>null};
   return messages.get(arg)||null;
 }}};
 try{
   GuildConfig.find=()=>({select:()=>({lean:async()=>[state]})});
   GuildConfig.updateOne=async(q,update)=>{Object.assign(state,update.$set);};
   Giveaway.find=()=>({sort:()=>({limit:()=>({lean:async()=>[]})})});
   GiveawayPlan.find=()=>({sort:()=>({limit:()=>({lean:async()=>[]})})});
   const client={user:{id:"bot"},channels:{fetch:async()=>channel}};
   await reconcileActiveGiveawayIndex(client,{now:t0});
   assert.equal(sent.length,1);
   assert.equal(state.giveawayIndexMessageId,"987654321098765432");
   assert.equal(state.giveawayIndexCheckedAt.getTime(),t0.getTime());
   const firstReads=fetched.length;
   await reconcileActiveGiveawayIndex(client,{now:new Date(t0.getTime()+30*60_000)});
   assert.equal(fetched.length,firstReads,"No Discord message checks between hourly windows");

   // A newer user post appears. The index must stay where it is until an hour passes.
   newest="777777777777777777";
   await reconcileActiveGiveawayIndex(client,{now:new Date(t0.getTime()+59*60_000)});
   assert.equal(sent.length,1);
   await reconcileActiveGiveawayIndex(client,{now:new Date(t0.getTime()+60*60_000)});
   assert.equal(sent.length,2,"One replacement restores the index as the last message");
   assert.deepEqual(deleted,["987654321098765432"]);
   assert.equal(state.giveawayIndexMessageId,"876543210987654321");
   assert.equal(sent[1].allowedMentions.parse.length,0);
   await reconcileActiveGiveawayIndex(client,{now:new Date(t0.getTime()+120*60_000)});
   assert.equal(sent.length,2,"Do not repost when the sticky remains last");
   assert.equal(edited.length,0);
 }finally{
   GuildConfig.find=old.find;GuildConfig.updateOne=old.update;
   Giveaway.find=old.giveaway;GiveawayPlan.find=old.plans;
 }
});

test("previously pinned giveaway index is unpinned instead of reposted when already last",async()=>{
 const old={find:GuildConfig.find,update:GuildConfig.updateOne,
   giveaway:Giveaway.find,plans:GiveawayPlan.find};
 const now=new Date("2026-11-10T14:00:00Z");
 const id="987654321098765432";
 const state={guildId,activityGiveawayListChannelId:channelId,
   giveawayIndexMessageId:id,giveawayIndexChannelId:channelId,
   giveawayIndexFingerprint:"changed",giveawayIndexCheckedAt:null};
 let unpins=0,edits=0,sends=0;
 try{
   GuildConfig.find=()=>({select:()=>({lean:async()=>[state]})});
   GuildConfig.updateOne=async(q,update)=>{Object.assign(state,update.$set);};
   Giveaway.find=()=>({sort:()=>({limit:()=>({lean:async()=>[]})})});
   GiveawayPlan.find=()=>({sort:()=>({limit:()=>({lean:async()=>[]})})});
   const msg={id,author:{id:"bot"},pinned:true,
     unpin:async()=>{unpins++;},edit:async()=>{edits++;}};
   const client={user:{id:"bot"},channels:{fetch:async()=>({
     id:channelId,send:async()=>{sends++;},messages:{fetch:async arg=>
       arg?.limit===1?{first:()=>({id})}:msg},
   })}};
   await reconcileActiveGiveawayIndex(client,{now});
   assert.equal(unpins,1);
   assert.equal(edits,1);
   assert.equal(sends,0);
 }finally{
   GuildConfig.find=old.find;GuildConfig.updateOne=old.update;
   Giveaway.find=old.giveaway;GiveawayPlan.find=old.plans;
 }
});
