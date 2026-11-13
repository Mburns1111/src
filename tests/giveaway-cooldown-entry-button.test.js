import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayWinnerCooldown from "../models/GiveawayWinnerCooldown.js";
import {handleGiveawayButton} from "../commands/giveaway.js";

const guildId="123456789012345678",userId="234567890123456789",
 channelId="345678901234567890",messageId="456789012345678901",
 id="507f1f77bcf86cd799439011";
const expire=new Date("2027-01-03T00:00:00Z");
const guild={id:guildId,members:{fetch:async()=>({
 id:userId,user:{id:userId,bot:false},roles:{cache:new Map()}
})}};
const saved={
  config:GuildConfig.findOne,
  giveaway:Giveaway.findOne,
  update:Giveaway.updateOne,
  cooldown:GiveawayWinnerCooldown.findOne
};
const restore=()=>{
 GuildConfig.findOne=saved.config;
 Giveaway.findOne=saved.giveaway;
 Giveaway.updateOne=saved.update;
 GiveawayWinnerCooldown.findOne=saved.cooldown;
};
test("public Enter button clearly refuses active cooldown, returns expiration and does not add an entry",async()=>{
 let writes=0;
 try{
   GuildConfig.findOne=()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:""})})});
   Giveaway.findOne=()=>({
     lean:async()=>({
       _id:id,guildId,mode:"standard",status:"open",channelId,messageId,
       endsAt:new Date("2027-02-01T00:00:00Z"),winnerCooldownEnabled:true,
       entrantIds:[],requiredRoleId:"",
     }),
     select:()=>({lean:async()=>({
       mode:"standard",status:"open",endsAt:new Date("2027-02-01T00:00:00Z"),
       winnerCooldownEnabled:true,entrantIds:[],
     })})
   });
   GiveawayWinnerCooldown.findOne=()=>({lean:async()=>({userId,expiresAt:expire})});
   Giveaway.updateOne=async()=>{writes++;return {modifiedCount:1};};
   const responses=[];
   await handleGiveawayButton({
     customId:"giveaway:enter:"+id,guildId,guild,channelId,
     message:{id:messageId},user:{id:userId,bot:false},
     deferReply:async()=>{},editReply:async value=>responses.push(value)
   });
   const value=responses.at(-1);
   assert.match(value.content,/can't enter this giveaway/);
   assert.match(value.content,/winner cooldown/);
   assert.match(value.content,/until <t:\d+:F>/);
   assert.match(value.content,/entry has not been accepted/);
   assert.equal(writes,0);
 }finally{restore();}
});
