import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import GiveawayActivityRuleMinuteCount from "../models/GiveawayActivityRuleMinuteCount.js";
import {
 activityOptInPanelPayload,ensureActivityOptInPanel,handleActivityOptInButton,
} from "../services/activity-giveaway-optin-ui.js";

const guildId="123456789012345678",channelId="234567890123456789",
 userId="345678901234567890",panelId="456789012345678901";

test("public opt-in panel has persistent buttons and no participation role",()=>{
 const payload=activityOptInPanelPayload();
 const embed=payload.embeds[0].toJSON();
 assert.match(embed.description,/Opt In/);
 assert.match(embed.description,/Opt Out/);
 assert.match(embed.description,/No Discord role is required/);
 assert.match(embed.footer.text,/Activity Giveaway Participation/);
 assert.deepEqual(payload.components[0].toJSON().components.map(x=>x.label),["Opt In","Opt Out","My Status"]);
 assert.deepEqual(payload.allowedMentions,{parse:[]});
});

test("member opts in and out through private buttons with no role changes",async()=>{
 const saved={
  config:GuildConfig.findOne,member:ActivityGiveawayOptIn.findOne,
  update:ActivityGiveawayOptIn.findOneAndUpdate,
  minute:GiveawayActivityMinuteCount.deleteMany,
  rule:GiveawayActivityRuleMinuteCount.deleteMany,
 };
 const requests=[];let state=null;
 const interaction=action=>({
  customId:"activity-optin:"+action,guildId,channelId,
  message:{id:panelId},user:{id:userId},calls:[],
  async deferReply(payload){requests.push({type:"defer",payload});},
  async editReply(payload){requests.push({type:"reply",payload});},
 });
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
   activityGiveawayListChannelId:channelId,
   activityParticipationPanelMessageId:panelId,
  })})});
  ActivityGiveawayOptIn.findOne=()=>({lean:async()=>state});
  ActivityGiveawayOptIn.findOneAndUpdate=(_query,change)=>({lean:async()=>{
   state={guildId,userId,...(state||{}),...change.$set};return state;
  }});
  GiveawayActivityMinuteCount.deleteMany=async()=>{};
  GiveawayActivityRuleMinuteCount.deleteMany=async()=>{};
  await handleActivityOptInButton(interaction("in"));
  assert.equal(state.active,true);
  assert.ok(state.optedInAt instanceof Date);
  assert.match(requests.at(-1).payload,/now \*\*opted in\*\*/);
  await handleActivityOptInButton(interaction("status"));
  assert.match(requests.at(-1).payload,/opted in/);
  await handleActivityOptInButton(interaction("out"));
  assert.equal(state.active,false);
  assert.match(requests.at(-1).payload,/opted out/);
  assert.ok(requests.some(r=>r.type==="defer"&&Boolean(r.payload.flags)));
 }finally{
  GuildConfig.findOne=saved.config;
  ActivityGiveawayOptIn.findOne=saved.member;
  ActivityGiveawayOptIn.findOneAndUpdate=saved.update;
  GiveawayActivityMinuteCount.deleteMany=saved.minute;
  GiveawayActivityRuleMinuteCount.deleteMany=saved.rule;
 }
});

test("activity panel follows new listings and is reused between sweeps",async()=>{
 const saved={findOne:GuildConfig.findOne,updateOne:GuildConfig.updateOne};
 const config={activityGiveawayListChannelId:channelId,
  activityParticipationPanelChannelId:"",activityParticipationPanelMessageId:""};
 const messages=new Map(),actions=[];
 let next=0;
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({...config})})});
  GuildConfig.updateOne=async(_query,change)=>{Object.assign(config,change.$set);};
  const channel={
   id:channelId,
   messages:{fetch:async key=>typeof key==="string"?messages.get(key)||null:
    {find:fn=>[...messages.values()].find(fn)||null}},
   send:async payload=>{
    const id=String(++next).padStart(18,"0");
    const message={id,author:{id:"bot"},embeds:payload.embeds.map(e=>e.toJSON()),
     edit:async()=>{actions.push("edit "+id);},
     delete:async()=>{actions.push("delete "+id);messages.delete(id);}};
    messages.set(id,message);
    actions.push("send "+id);
    return message;
   },
  };
  const client={user:{id:"bot"},channels:{fetch:async()=>channel}};
  assert.equal(await ensureActivityOptInPanel(client,guildId),true);
  const first=config.activityParticipationPanelMessageId;
  assert.equal(actions.length,1);
  assert.equal(await ensureActivityOptInPanel(client,guildId,{bump:true}),true);
  assert.notEqual(config.activityParticipationPanelMessageId,first);
  assert.deepEqual(actions,["send "+first,"send "+config.activityParticipationPanelMessageId,"delete "+first]);
  await ensureActivityOptInPanel(client,guildId);
  assert.equal(actions.length,3);
 }finally{
  GuildConfig.findOne=saved.findOne;GuildConfig.updateOne=saved.updateOne;
 }
});

test("activity opt-in panel reappears below new channel chat, no more than once per ten minutes",async()=>{
 const uniqueGuild="123456789012345679";
 const saved={findOne:GuildConfig.findOne,updateOne:GuildConfig.updateOne};
 const state={activityGiveawayListChannelId:channelId,
  activityParticipationPanelChannelId:"",activityParticipationPanelMessageId:""};
 const messages=new Map(),sent=[],deleted=[];
 let sequence=0,lastMessageId=null;
 try{
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({...state})})});
  GuildConfig.updateOne=async(_query,change)=>{Object.assign(state,change.$set);};
  const channel={id:channelId,
   get lastMessageId(){return lastMessageId;},
   messages:{fetch:async query=>typeof query==="string"?messages.get(query)||null:{
    find:fn=>[...messages.values()].find(fn)||null,
    first:()=>messages.get(lastMessageId)||null,
   }},
   send:async payload=>{
    const id=String(700000000000000000n+BigInt(++sequence));
    const item={id,author:{id:"bot"},embeds:payload.embeds.map(e=>e.toJSON()),
      delete:async()=>{deleted.push(id);messages.delete(id);},
      edit:async()=>{}};
    messages.set(id,item);lastMessageId=id;sent.push(id);return item;
   },
  };
  const client={user:{id:"bot"},channels:{fetch:async()=>channel}};
  const initial=new Date("2026-11-12T12:00:00Z");
  await ensureActivityOptInPanel(client,uniqueGuild,{now:initial});
  assert.equal(sent.length,1);
  lastMessageId="888888888888888888"; // A member posted below the panel.
  await ensureActivityOptInPanel(client,uniqueGuild,{now:new Date(+initial+60_000)});
  assert.equal(sent.length,1,"regular sweeps should not spam a new panel within ten minutes");
  await ensureActivityOptInPanel(client,uniqueGuild,{now:new Date(+initial+11*60_000)});
  assert.equal(sent.length,2,"once the throttle expires the panel is bumped to the bottom");
  assert.deepEqual(deleted,[sent[0]]);
  assert.equal(state.activityParticipationPanelMessageId,sent[1]);
 }finally{
  GuildConfig.findOne=saved.findOne;GuildConfig.updateOne=saved.updateOne;
 }
});
