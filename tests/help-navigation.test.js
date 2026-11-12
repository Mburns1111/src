import test from "node:test";
import assert from "node:assert/strict";
import {
 ApplicationCommandOptionType, MessageFlags, PermissionFlagsBits,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import {
 PUBLIC_TOPICS, STAFF_TOPICS, HELP_TOPICS, helpStaffAccess,
 helpTopicPayload, execute, handleHelpTopicButton, handleHelpTopicSelect,
} from "../commands/help.js";

const userId="987654321012345678",guildId="908522799285538817";
const json=payload=>payload.embeds[0].toJSON();
const fields=payload=>json(payload).fields||[];
const textOf=topic=>JSON.stringify(json(helpTopicPayload(topic,userId)));
function interaction(customId,values=[]){
 const calls=[];
 return {
  user:{id:userId},guildId,customId,values,calls,deferred:false,replied:false,
  inGuild:()=>true,
  async deferReply(payload){this.deferred=true;calls.push({action:"deferReply",payload});},
  async deferUpdate(){calls.push({action:"deferUpdate"});},
  async editReply(payload){calls.push({action:"editReply",payload});},
 };
}
function controls(payload){
 return payload.components.flatMap(row=>row.toJSON().components);
}
function commandSources(i){
 i.client={application:{commands:{fetch:async()=>new Map([
  ["help",{name:"help",description:"Open help",options:[]}],
  ["shop",{name:"shop",description:"Shop",options:[]}],
 ])}}};
 i.guild={commands:{fetch:async()=>new Map([
  ["shop",{name:"shop",description:"Server shop",options:[{
   type:ApplicationCommandOptionType.Subcommand,name:"browse",description:"Open shop",
  }]}],
 ])}};
 return i;
}
test("root /help presents three separate buttons for Public, Staff, and Command Index",()=>{
 const payload=helpTopicPayload("root",userId);
 assert.equal(payload.embeds.length,1);
 assert.deepEqual(controls(payload).map(b=>b.label),["Public Help","Staff Help","Command Index"]);
 assert.deepEqual(controls(payload).map(b=>b.custom_id),[
  "help:topic:public:"+userId,"help:topic:staff:"+userId,"help:topic:commands:"+userId,
 ]);
 assert.deepEqual(payload.allowedMentions,{parse:[]});
});
test("public dropdown has six member topics and no command index",()=>{
 assert.equal(PUBLIC_TOPICS.length,6);
 assert.equal(PUBLIC_TOPICS.some(t=>t.id==="commands"),false);
 const payload=helpTopicPayload("public",userId);
 const select=controls(payload).find(c=>c.type===3);
 assert.deepEqual(select.options.map(o=>o.value),PUBLIC_TOPICS.map(t=>t.id));
 const topic=helpTopicPayload("listings",userId);
 assert.equal(controls(topic).filter(c=>c.type===3).length,1);
 assert.ok(controls(topic).some(c=>c.custom_id==="help:topic:root:"+userId));
});
test("staff topics are organized into three dropdown groups",()=>{
 const payload=helpTopicPayload("staff",userId);
 const selects=controls(payload).filter(c=>c.type===3);
 assert.equal(selects.length,3);
 assert.deepEqual(selects.map(c=>c.options.length),[1,3,3]);
 assert.deepEqual(selects.flatMap(c=>c.options.map(o=>o.value)),STAFF_TOPICS.map(t=>t.id));
 assert.ok(controls(helpTopicPayload("sgiveaways",userId)).some(c=>c.custom_id==="help:topic:root:"+userId));
});
test("approved help content includes core requirements and public claim instructions",()=>{
 assert.match(textOf("ssetup"),/All bot setup commands must be run in this channel/);
 assert.match(textOf("ssetup"),/Administrator/);
 assert.match(textOf("ssetup"),/Court of Chaos/);
 assert.match(textOf("sgiveaways"),/Royal Verdict/);
 assert.match(textOf("sgiveaways"),/Confirm Prizes Delivered/);
 assert.match(textOf("sgiveaways"),/Giveaway Archives/);
 assert.match(textOf("sactivity"),/not per day/);
 assert.match(textOf("sactivity"),/next two scheduled periods/);
 assert.match(textOf("sarchives"),/Only regular giveaways are deleted/);
 assert.equal(fields(helpTopicPayload("scards",userId)).length,1);
 assert.match(textOf("scards"),/Points must be enabled/);
 assert.match(textOf("spoints"),/independent shop/);
 assert.equal(fields(helpTopicPayload("sgames",userId)).length,2);
 assert.doesNotMatch(textOf("sgames"),/Court's Trials/);
 assert.match(textOf("cards"),/not affiliated with, endorsed by, or sponsored by Roblox or Adopt Me/);
 assert.match(textOf("giveaways"),/button below the winner announcement before the claim deadline/);
 assert.doesNotMatch(textOf("games"),/Court's Trials/);
});
test("all help embeds respect Discord field and overall size limits",()=>{
 for(const topic of HELP_TOPICS){
  const payload=helpTopicPayload(topic.id,userId);
  const embed=json(payload);
  const fs=embed.fields||[];
  assert.ok(fs.length<=25,topic.id+" has too many fields");
  assert.ok(embed.description.length<=4096,topic.id+" description too long");
  let size=embed.title.length+embed.description.length;
  for(const f of fs){
   assert.ok(f.value.length<=1024,topic.id+":"+f.name+" value too long");
   assert.ok(f.name.length<=256,topic.id+":"+f.name+" name too long");
   size+=f.value.length+f.name.length;
  }
  assert.ok(size<=6000,topic.id+" overall embed too long");
  assert.ok(payload.components.length<=5,topic.id+" has too many action rows");
 }
});
test("slash /help acknowledges privately and loads the root menu",async()=>{
 const i=interaction();
 await execute(i);
 assert.deepEqual(i.calls.map(c=>c.action),["deferReply","editReply"]);
 assert.equal(i.calls[0].payload.flags,MessageFlags.Ephemeral);
 assert.match(json(i.calls[1].payload).title,/Help Center/);
});
test("public topic buttons and dropdowns update the same private reply",async()=>{
 const i=interaction("help:topic:public:"+userId);
 await handleHelpTopicButton(i);
 assert.deepEqual(i.calls.map(c=>c.action),["deferUpdate","editReply"]);
 assert.match(json(i.calls[1].payload).title,/Public Help/);
 const menu=interaction("help:select:public:"+userId,["listings"]);
 await handleHelpTopicSelect(menu);
 assert.deepEqual(menu.calls.map(c=>c.action),["deferUpdate","editReply"]);
 assert.match(json(menu.calls[1].payload).title,/Listings & Trading/);
});
test("invalid, cross-member, malformed, and prototype-key interactions are rejected",async()=>{
 for(const id of [
  "help:topic:shop:123456789012345678",
  "help:topic:constructor:"+userId,
  "help:topic:__proto__:"+userId,
  "help:topic:shop:"+userId+":extra",
  "help:page:-1:"+userId,
 ]){
  const i=interaction(id);
  await assert.rejects(handleHelpTopicButton(i),/belongs to another member or has expired/);
  assert.deepEqual(i.calls,[]);
 }
 for(const [id,values] of [
  ["help:select:public:123456789012345678",["shop"]],
  ["help:select:public:"+userId,["ssetup"]],
  ["help:select:__proto__:"+userId,["home"]],
  ["help:select:public:"+userId,["constructor"]],
 ]){
  const i=interaction(id,values);
  await assert.rejects(handleHelpTopicSelect(i),/belongs to another member or has expired/);
  assert.deepEqual(i.calls,[]);
 }
 assert.throws(()=>helpTopicPayload("constructor",userId),/no longer available/);
});
test("staff access is permission-gated and menu cannot be opened without access",async()=>{
 assert.equal(helpStaffAccess({memberPermissions:{has:()=>false}},{}),false);
 assert.equal(helpStaffAccess({memberPermissions:{has:()=>true}},{}),true);
 const oldFind=GuildConfig.findOne;
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({})})});
  const denied=interaction("help:select:server:"+userId,["ssetup"]);
  denied.memberPermissions={has:()=>false};
  await assert.rejects(handleHelpTopicSelect(denied),/authorized bot staff/);
  assert.deepEqual(denied.calls,[]);
  const allowed=interaction("help:select:server:"+userId,["ssetup"]);
  allowed.memberPermissions={has:permission=>permission===PermissionFlagsBits.ManageGuild};
  await handleHelpTopicSelect(allowed);
  assert.match(json(allowed.calls.at(-1).payload).title,/Bot Setup/);
 }finally{GuildConfig.findOne=oldFind;}
});
test("Command Index is separate and paginates rather than truncating the command list",()=>{
 const lines=Array.from({length:55},(_,n)=>"• /command"+n+" — Example command "+n);
 const first=helpTopicPayload("commands",userId,lines);
 const second=helpTopicPayload("commands",userId,lines,1);
 assert.match(json(first).footer.text,/Page 1 of 4/);
 assert.match(json(second).footer.text,/Page 2 of 4/);
 assert.match(JSON.stringify(fields(second)),/command16/);
 assert.doesNotMatch(JSON.stringify(fields(second)),/command0 —/);
 const pageButtons=controls(first).filter(c=>c.custom_id?.startsWith("help:page:"));
 assert.equal(pageButtons.length,2);
 assert.equal(pageButtons[0].disabled,true);
 assert.equal(pageButtons[1].disabled,false);
});
test("Command Index loads registered commands, preserving guild command overrides",async()=>{
 const i=commandSources(interaction("help:topic:commands:"+userId));
 await handleHelpTopicButton(i);
 const content=JSON.stringify(fields(i.calls.at(-1).payload));
 assert.match(content,/Server shop/);
 assert.match(content,/shop browse/);
 assert.doesNotMatch(content,/shop balance/);
});
test("Command Index API errors show a fallback without breaking help",async()=>{
 const i=interaction("help:topic:commands:"+userId);
 i.client={application:{commands:{fetch:async()=>{throw Error("offline")}}}};
 i.guild={commands:{fetch:async()=>new Map()}};
 const oldWarn=console.warn;console.warn=()=>{};
 try{
  await handleHelpTopicButton(i);
  assert.match(JSON.stringify(fields(i.calls.at(-1).payload)),/couldn't load/);
 }finally{console.warn=oldWarn;}
});
