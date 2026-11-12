import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import {handleGiveawayButton} from "../commands/giveaway.js";
import {handleActivityOptInButton} from "../services/activity-giveaway-optin-ui.js";
import {giveawayBanMessage} from "../services/giveaway-exclusion.js";

const guildId="123456789012345678",userId="234567890123456789",
 banRole="345678901234567890",channelId="456789012345678901",
 panelId="567890123456789012",giveawayId="507f1f77bcf86cd799439011";
const bannedMember={id:userId,user:{id:userId,bot:false},
 roles:{cache:new Map([[banRole,{}]])}};
const guild={id:guildId,members:{fetch:async()=>bannedMember}};

test("regular giveaway and Court Trial entry buttons refuse the punished member",async()=>{
 const saved={giveaway:Giveaway.findOne,config:GuildConfig.findOne,update:Giveaway.updateOne};
 const replies=[];let writes=0;
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:banRole})})});
  Giveaway.updateOne=async()=>{writes++;return {modifiedCount:1};};
  for(const mode of ["standard","survival"]){
   Giveaway.findOne=()=>({lean:async()=>({
    _id:giveawayId,guildId,mode,status:"open",channelId,messageId:panelId,
    endsAt:new Date("2027-05-01T00:00:00Z"),requiredRoleId:"",
   })});
   const response=[];
   await handleGiveawayButton({
    customId:"giveaway:enter:"+giveawayId,guildId,guild,
    channelId,message:{id:panelId},user:{id:userId,bot:false},
    deferReply:async()=>{},editReply:async x=>{response.push(x);},
   });
   replies.push(response.at(-1));
  }
  assert.deepEqual(replies,[giveawayBanMessage,giveawayBanMessage]);
  assert.equal(writes,0,"a banned member must not enter either giveaway type");
 }finally{
  Giveaway.findOne=saved.giveaway;GuildConfig.findOne=saved.config;Giveaway.updateOne=saved.update;
 }
});

test("public Activity Opt In and My Status buttons refuse a banned member without writing participation",async()=>{
 const saved={config:GuildConfig.findOne,participant:ActivityGiveawayOptIn.findOne,
  update:ActivityGiveawayOptIn.findOneAndUpdate};
 let writes=0;
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
   activityGiveawayListChannelId:channelId,
   activityParticipationPanelMessageId:panelId,
   giveawayExcludedRoleId:banRole,
  })})});
  ActivityGiveawayOptIn.findOne=()=>({lean:async()=>null});
  ActivityGiveawayOptIn.findOneAndUpdate=()=>{writes++;throw Error("Must not change opt-in");};
  for(const action of ["in","status"]){
   let response="";
   await handleActivityOptInButton({
    customId:"activity-optin:"+action,guildId,guild,channelId,
    message:{id:panelId},user:{id:userId},
    deferReply:async()=>{},editReply:async x=>{response=x;},
   });
   assert.equal(response,giveawayBanMessage);
  }
  assert.equal(writes,0);
 }finally{
  GuildConfig.findOne=saved.config;ActivityGiveawayOptIn.findOne=saved.participant;
  ActivityGiveawayOptIn.findOneAndUpdate=saved.update;
 }
});
