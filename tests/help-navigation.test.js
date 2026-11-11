import test from "node:test";
import assert from "node:assert/strict";
import {ApplicationCommandOptionType,MessageFlags,PermissionFlagsBits} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import {
 HELP_TOPICS,PUBLIC_TOPICS,STAFF_TOPICS,helpTopicPayload,helpStaffAccess,
 execute,handleHelpTopicButton,
} from "../commands/help.js";

const userId="987654321012345678",guildId="908522799285538817",
 roleId="234567890123456789";
function interaction(customId,memberPermissions=null,roles=[]){
 const calls=[];
 return{
  user:{id:userId},guildId,customId,calls,memberPermissions,
  member:{roles:{cache:new Map(roles.map(id=>[id,{}]))}},
  inGuild:()=>true,deferred:false,replied:false,
  async deferReply(payload){this.deferred=true;calls.push({action:"deferReply",payload});},
  async deferUpdate(){calls.push({action:"deferUpdate"});},
  async editReply(payload){calls.push({action:"editReply",payload});},
 };
}
const buttonIds=p=>p.components.flatMap(row=>row.toJSON().components.map(b=>b.custom_id));
const data=p=>p.embeds[0].toJSON();

test("help opens with only Public Help and Staff Help, privately",async()=>{
 const payload=helpTopicPayload("root",userId);
 assert.deepEqual(buttonIds(payload),[
  "help:topic:public:"+userId,"help:topic:staff:"+userId]);
 assert.equal(payload.components.length,1);
 assert.deepEqual(payload.allowedMentions,{parse:[]});
 const i=interaction();
 await execute(i);
 assert.deepEqual(i.calls.map(c=>c.action),["deferReply","editReply"]);
 assert.equal(i.calls[0].payload.flags,MessageFlags.Ephemeral);
 assert.match(data(i.calls[1].payload).title,/Help Center/);
});
test("public and staff system menus have complete navigation within Discord row limits",()=>{
 for(const [topic,systems] of [["public",PUBLIC_TOPICS],["staff",STAFF_TOPICS]]){
  const payload=helpTopicPayload(topic,userId);
  const buttons=buttonIds(payload);
  assert.deepEqual(buttons,[
    ...systems.map(x=>"help:topic:"+x.id+":"+userId),
    "help:topic:root:"+userId,
  ]);
  assert.ok(payload.components.every(row=>row.components.length<=5));
 }
});
test("public system guides cover card game, giveaways, listings, games and shop",()=>{
 const all=["home","listings","shop","cards","giveaways","games","commands"];
 for(const topic of all){
  const payload=helpTopicPayload(topic,userId);
  assert.deepEqual(buttonIds(payload),["help:topic:public:"+userId,"help:topic:root:"+userId]);
  assert.ok(data(payload).description.length);
 }
 assert.match(JSON.stringify(data(helpTopicPayload("cards",userId))),/egg drops/);
 assert.match(JSON.stringify(data(helpTopicPayload("cards",userId))),/`\.help` in the Hatchem channel/);
 assert.match(JSON.stringify(data(helpTopicPayload("cards",userId))),/`\.tutorial`/);
 assert.match(JSON.stringify(data(helpTopicPayload("giveaways",userId))),/Check My Progress/);
 assert.match(JSON.stringify(data(helpTopicPayload("listings",userId))),/Choose photo/);
 assert.match(JSON.stringify(data(helpTopicPayload("shop",userId))),/shop balance/);
});
test("staff guides cover giveaway claims archives progress and setup",()=>{
 for(const topic of STAFF_TOPICS){
  const payload=helpTopicPayload(topic.id,userId);
  assert.deepEqual(buttonIds(payload),["help:topic:staff:"+userId,"help:topic:root:"+userId]);
 }
 assert.match(JSON.stringify(data(helpTopicPayload("sactivity",userId))),/Refresh Progress/);
 assert.match(JSON.stringify(data(helpTopicPayload("sarchives",userId))),/Archive Giveaway/);
 assert.match(JSON.stringify(data(helpTopicPayload("sgiveaways",userId))),/Confirm Prizes Delivered/);
 const giveawayGuide=JSON.stringify(data(helpTopicPayload("sgiveaways",userId)));
 assert.match(giveawayGuide,/\/setup channels/);
 assert.match(giveawayGuide,/Activity giveaway list/);
 assert.match(giveawayGuide,/Activity winners/);
 assert.match(giveawayGuide,/Private staff controls/);
 assert.match(giveawayGuide,/Private Archives/);
 assert.match(giveawayGuide,/View Channel/);
 assert.match(giveawayGuide,/Send Messages/);
 assert.match(giveawayGuide,/Embed Links/);
 assert.match(giveawayGuide,/Attach Files/);
 assert.match(giveawayGuide,/Read Message History/);
 assert.match(giveawayGuide,/hidden from @everyone/);
});
test("staff access includes assigned Giveaway Managers, Manage Server, Administrator but not ordinary members",()=>{
 const cfg={giveawayManagerRoleId:roleId};
 const ordinary=interaction(null,{has:()=>false});
 const manager=interaction(null,{has:()=>false},[roleId]);
 manager.member.roles.cache.set(roleId,{id:roleId,name:"Giveaway Manager"});
 const mod=interaction(null,{has:flag=>flag===PermissionFlagsBits.ManageGuild});
 const admin=interaction(null,{has:flag=>flag===PermissionFlagsBits.Administrator});
 assert.equal(helpStaffAccess(ordinary,cfg),false);
 assert.equal(helpStaffAccess(manager,cfg),true);
 assert.equal(helpStaffAccess(mod,{}),true);
 assert.equal(helpStaffAccess(admin,{}),true);
 assert.equal(helpStaffAccess(manager,{}),true);
 const other=interaction(null,{has:()=>false},["345678901234567890"]);
 other.member.roles.cache.set("345678901234567890",{name:"Event Staff"});
 assert.equal(helpStaffAccess(other,{}),false);
});
test("staff button is gated, and permission is rechecked for every staff page",async()=>{
 const original=GuildConfig.findOne;
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({giveawayManagerRoleId:roleId})})});
  const denied=interaction("help:topic:staff:"+userId,{has:()=>false});
  await assert.rejects(handleHelpTopicButton(denied),/authorized bot staff/);
  assert.equal(denied.calls.length,0);
  const manager=interaction("help:topic:staff:"+userId,{has:()=>false},[roleId]);
  manager.member.roles.cache.set(roleId,{id:roleId,name:"Giveaway Manager"});
  await handleHelpTopicButton(manager);
  assert.deepEqual(manager.calls.map(c=>c.action),["deferUpdate","editReply"]);
  const guide=interaction("help:topic:sarchives:"+userId,{has:()=>false},[roleId]);
  guide.member.roles.cache.set(roleId,{id:roleId,name:"Giveaway Manager"});
  await handleHelpTopicButton(guide);
  assert.match(data(guide.calls[1].payload).title,/Archives/);
 }finally{GuildConfig.findOne=original;}
});
test("public help is available to non-staff; cross-user and malformed clicks are rejected",async()=>{
 const i=interaction("help:topic:giveaways:"+userId,{has:()=>false});
 await handleHelpTopicButton(i);
 assert.deepEqual(i.calls.map(c=>c.action),["deferUpdate","editReply"]);
 for(const value of ["help:topic:staff:111111111111111111",
  "help:topic:constructor:"+userId,"help:topic:__proto__:"+userId,
  "help:topic:staff:"+userId+":extra"]){
  const bad=interaction(value);
  await assert.rejects(handleHelpTopicButton(bad),/belongs to another member or has expired/);
  assert.deepEqual(bad.calls,[]);
 }
});
test("every help embed respects Discord field and component limits",()=>{
 for(const topic of HELP_TOPICS){
  const payload=helpTopicPayload(topic.id,userId);
  const embed=data(payload);
  assert.ok((embed.fields||[]).length<=25);
  for(const f of embed.fields||[])assert.ok(f.value.length<=1024&&f.name.length<=256);
  assert.ok(embed.description.length<=4096);
  assert.ok(payload.components.length<=5);
  assert.ok(payload.components.every(row=>row.components.length<=5));
 }
});
test("live Discord registered command guide includes subcommands and fallback",async()=>{
 const i=interaction("help:topic:commands:"+userId);
 i.client={application:{commands:{fetch:async()=>new Map([
  ["profile",{name:"profile",description:"Profile",options:[]}],
 ])}}};
 i.guild={commands:{fetch:async()=>new Map([
  ["shop",{name:"shop",description:"Shop",options:[{
   type:ApplicationCommandOptionType.Subcommand,name:"balance",description:"Check balance",
  }]}],
 ])}};
 await handleHelpTopicButton(i);
 assert.match(JSON.stringify(data(i.calls.at(-1).payload)),/shop balance/);
 const fail=interaction("help:topic:commands:"+userId);
 fail.client={application:{commands:{fetch:async()=>{throw Error("offline")}}}};
 fail.guild={commands:{fetch:async()=>new Map()}};
 const warn=console.warn;console.warn=()=>{};
 try{
  await handleHelpTopicButton(fail);
  assert.match(JSON.stringify(data(fail.calls.at(-1).payload)),/couldn't load/);
 }finally{console.warn=warn;}
});
