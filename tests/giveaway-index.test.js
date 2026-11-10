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

test("index creates one pinned message and skips Discord reads and edits when unchanged",async()=>{
 const prior={find:GuildConfig.find,update:GuildConfig.updateOne,
   giveaway:Giveaway.find,plans:GiveawayPlan.find};
 const state={guildId,activityGiveawayListChannelId:channelId,
   giveawayIndexMessageId:"",giveawayIndexChannelId:"",giveawayIndexFingerprint:""};
 const sends=[],edits=[],pins=[],reads=[];
 const message={id:"987654321098765432",author:{id:"bot"},pinned:false,
   pin:async()=>{pins.push(true);},edit:async p=>{edits.push(p);}};
 const channel={id:channelId,send:async p=>{sends.push(p);return message;},
   messages:{fetch:async arg=>{reads.push(arg);return arg?.limit?{find:()=>null}:message;}}};
 try{
   GuildConfig.find=()=>({select:()=>({lean:async()=>[state]})});
   GuildConfig.updateOne=async(q,update)=>{Object.assign(state,update.$set);};
   Giveaway.find=()=>({sort:()=>({limit:()=>({lean:async()=>[]})})});
   GiveawayPlan.find=()=>({sort:()=>({limit:()=>({lean:async()=>[]})})});
   const client={user:{id:"bot"},channels:{fetch:async()=>channel}};
   await reconcileActiveGiveawayIndex(client);
   assert.equal(sends.length,1);
   assert.equal(pins.length,1);
   assert.equal(state.giveawayIndexMessageId,message.id);
   const firstReads=reads.length;
   await reconcileActiveGiveawayIndex(client);
   assert.equal(sends.length,1);
   assert.equal(edits.length,0);
   assert.equal(reads.length,firstReads);
 }finally{
   GuildConfig.find=prior.find;GuildConfig.updateOne=prior.update;
   Giveaway.find=prior.giveaway;GiveawayPlan.find=prior.plans;
 }
});
