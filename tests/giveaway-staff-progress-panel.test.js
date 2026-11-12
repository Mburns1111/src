import test from "node:test";
import assert from "node:assert/strict";
import {progressPanelPayload,ensureStaffProgressPanel,handleStaffProgressRefresh} from "../services/giveaway-staff-progress.js";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";

const record={_id:"507f1f77bcf86cd799439011",guildId:"123456789012345678",
 mode:"activity",status:"open",title:"Weekly Giveaway",activityMinTotalMessages:30,
 activityMinimum:1,activityDays:1,activityStartAt:new Date("2026-11-11T05:00:00Z"),
 activityEndAt:new Date("2026-11-18T05:00:00Z")};

test("two-post staff progress keeps partial members and no-activity members out of shared roster",()=>{
 const at=new Date("2026-11-12T16:00:00Z");
 const payload=progressPanelPayload(record,[
   {userId:"111111111111111111",messages:48,qualified:true},
   {userId:"222222222222222222",messages:14,qualified:false},
 ],at);
 const embed=payload.embeds[0].toJSON();
 assert.match(embed.description,/Active:\*\* 2/);
 assert.match(embed.description,/Qualified:\*\* 1/);
 assert.match(embed.description,/In progress:\*\* 1/);
 assert.match(embed.description,/48\/30/);
 assert.match(embed.description,/14\/30/);
 assert.equal(payload.components.length,2);
 assert.match(payload.components[0].components[0].data.custom_id,/qualified/);
 assert.match(payload.components[0].components[1].data.custom_id,/progress/);
 assert.match(payload.components[0].components[2].data.custom_id,/refresh/);
 assert.match(payload.components[1].components[0].data.custom_id,/find/);
});

test("staff progress does not touch Discord between refreshes",async()=>{
 const at=new Date("2026-11-12T16:00:00Z");
 const saved={...record,staffProgressMessageId:"345678901234567890",
   staffProgressRefreshedAt:new Date("2026-11-12T05:00:00Z"),
   staffProgressStatus:"open"};
 let requested=0;
 const channel={messages:{fetch:async()=>{requested++;throw Error("Should not fetch");}}};
 const result=await ensureStaffProgressPanel({},saved,channel,{now:at});
 assert.equal(result,true);
 assert.equal(requested,0);
});

test("staff may refresh progress repeatedly without a cooldown",async()=>{
 const prior={findOne:Giveaway.findOne,updateOne:Giveaway.updateOne,
   configFindOne:GuildConfig.findOne,aggregate:GiveawayActivityMinuteCount.aggregate};
 const messageId="345678901234567890",channelId="456789012345678901";
 const saved={...record,staffProgressMessageId:messageId,staffCardChannelId:channelId,
   staffProgressStatus:"open",staffProgressRefreshedAt:new Date()};
 let edits=0,aggregations=0;
 try{
   Giveaway.findOne=()=>({lean:async()=>saved});
   GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
     activityParticipationRoleId:"567890123456789012",
     activityParticipationRoleConfiguredAt:new Date("2026-11-10T05:00:00Z"),
   })})});
   Giveaway.updateOne=async()=>{};
   GiveawayActivityMinuteCount.aggregate=async()=>{aggregations++;return [];};
   const message={id:messageId,author:{id:"bot"},edit:async()=>{edits++;}};
   const channel={id:channelId,messages:{fetch:async()=>message}};
   const interaction=()=>({
     customId:"activitystaff:refresh:"+record._id,
     guildId:record.guildId,channelId,message,channel,
     client:{user:{id:"bot"},guilds:{fetch:async()=>({
       members:{fetch:async()=>null},
     })}},memberPermissions:{has:()=>true},
     deferReply:async()=>{},editReply:async result=>{
       assert.equal(result,"Shared giveaway progress refreshed.");
     },
   });
   await handleStaffProgressRefresh(interaction());
   await handleStaffProgressRefresh(interaction());
   assert.equal(edits,2);
   assert.equal(aggregations,2);
 }finally{
   Giveaway.findOne=prior.findOne;Giveaway.updateOne=prior.updateOne;
   GuildConfig.findOne=prior.configFindOne;GiveawayActivityMinuteCount.aggregate=prior.aggregate;
 }
});
