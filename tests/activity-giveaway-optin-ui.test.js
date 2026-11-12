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
