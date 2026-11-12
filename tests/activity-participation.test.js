import test from "node:test";
import assert from "node:assert/strict";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayActivityCount from "../models/GiveawayActivityCount.js";
import GiveawayActivityMinuteCount from "../models/GiveawayActivityMinuteCount.js";
import GiveawayActivityRuleMinuteCount from "../models/GiveawayActivityRuleMinuteCount.js";
import {recordGiveawayMessage,qualifyingActivityPipeline} from "../services/giveaway-activity-counter.js";
import {recordGuidedMessage} from "../services/guided-activity.js";
import {
 eligibleActivityParticipant,activeActivityParticipants,setActivityParticipation,
 activityConsentStages,startOfMinute,
} from "../services/activity-participation.js";

const guildId="123456789012345678",userId="234567890123456789";
const when=new Date("2026-11-12T15:01:34Z");
const active={guildId,userId,active:true,optedInAt:when,countFrom:startOfMinute(when)};
const message=()=>({
 guildId,author:{id:userId,bot:false},webhookId:null,
 channelId:"456789012345678901",channel:{isTextBased:()=>true},
 content:"A normal activity giveaway message",
 createdAt:when,id:"567890123456789012",
});
function stub(fn){
 const before=ActivityGiveawayOptIn.findOne;
 ActivityGiveawayOptIn.findOne=fn;
 return ()=>{ActivityGiveawayOptIn.findOne=before;};
}
test("MongoDB opt-in is not a Discord role; two counters share a single lookup for one message",async()=>{
 let queries=0;const restore=stub(()=>({lean:async()=>{queries++;return active;}}));
 try{
  const m=message();
  const [first,second]=await Promise.all([eligibleActivityParticipant(m),eligibleActivityParticipant(m)]);
  assert.equal(first.userId,userId);
  assert.deepEqual(first,second);
  assert.equal(queries,1);
  await eligibleActivityParticipant(message());
  assert.equal(queries,2,"new messages recheck consent");
 }finally{restore();}
});
test("missing MongoDB opt-in stops all activity recording before writing anything",async()=>{
 const restore=stub(()=>({lean:async()=>null}));
 const beforeCount=GiveawayActivityCount.updateOne,beforeMinute=GiveawayActivityMinuteCount.updateOne;
 let writes=0;
 try{
  GiveawayActivityCount.updateOne=async()=>{writes++;};
  GiveawayActivityMinuteCount.updateOne=async()=>{writes++;};
  await recordGiveawayMessage(message());
  await recordGuidedMessage(message());
  assert.equal(writes,0);
 }finally{
  GiveawayActivityCount.updateOne=beforeCount;
  GiveawayActivityMinuteCount.updateOne=beforeMinute;restore();
 }
});
test("active opt-ins can be looked up together for winner eligibility",async()=>{
 const before=ActivityGiveawayOptIn.find;
 try{
  let filter;
  ActivityGiveawayOptIn.find=query=>{filter=query;return {lean:async()=>[active]};};
  const selected=await activeActivityParticipants(guildId,[userId,"345678901234567890"]);
  assert.equal(filter.guildId,guildId);
  assert.equal(filter.active,true);
  assert.deepEqual([...selected.keys()],[userId]);
 }finally{ActivityGiveawayOptIn.find=before;}
});
test("rejoining starts a fresh counting window without previous-minute data",async()=>{
 const before={
  findOne:ActivityGiveawayOptIn.findOne,findOneAndUpdate:ActivityGiveawayOptIn.findOneAndUpdate,
  deleteMinute:GiveawayActivityMinuteCount.deleteMany,
  deleteRule:GiveawayActivityRuleMinuteCount.deleteMany,
 };
 const prior={...active,active:false,optedOutAt:new Date("2026-11-11T10:00:00Z")};
 const deletes=[];let recorded;
 try{
  ActivityGiveawayOptIn.findOne=()=>({lean:async()=>prior});
  ActivityGiveawayOptIn.findOneAndUpdate=(filter,update,opts)=>{
   recorded={filter,update,opts};
   return {lean:async()=>({...prior,...update.$set})};
  };
  GiveawayActivityMinuteCount.deleteMany=async query=>{deletes.push(query);};
  GiveawayActivityRuleMinuteCount.deleteMany=async query=>{deletes.push(query);};
  const result=await setActivityParticipation(guildId,userId,true,when);
  assert.equal(result.changed,true);
  assert.equal(recorded.update.$set.active,true);
  assert.equal(+recorded.update.$set.optedInAt,+when);
  assert.equal(+recorded.update.$set.countFrom,+startOfMinute(when));
  assert.equal(deletes.length,2);
  assert.ok(deletes.every(q=>+q.minute===+startOfMinute(when)));
 }finally{
  ActivityGiveawayOptIn.findOne=before.findOne;
  ActivityGiveawayOptIn.findOneAndUpdate=before.findOneAndUpdate;
  GiveawayActivityMinuteCount.deleteMany=before.deleteMinute;
  GiveawayActivityRuleMinuteCount.deleteMany=before.deleteRule;
 }
});
test("activity query pipelines join active session before totaling messages",()=>{
 const stages=activityConsentStages(guildId);
 assert.equal(stages[0].$lookup.pipeline[0].$match.guildId,guildId);
 assert.equal(stages[0].$lookup.pipeline[0].$match.active,true);
 assert.match(JSON.stringify(stages),/countFrom/);
 const pipeline=qualifyingActivityPipeline({
  guildId,type:"general",startAt:new Date("2026-11-12T00:00:00Z"),
  endAt:new Date("2026-11-13T00:00:00Z"),minimum:1,days:1,
 });
 assert.ok(pipeline.some(stage=>stage.$lookup));
 assert.deepEqual(pipeline.at(-1).$match.activeDays,{$gte:1});
});

test("punishment ban immediately blocks activity logs even if member was previously opted in",async()=>{
 const before={optin:ActivityGiveawayOptIn.findOne,config:GuildConfig.findOne,
  minute:GiveawayActivityMinuteCount.updateOne,count:GiveawayActivityCount.updateOne};
 const bannedRole="345678901234567890";
 let writes=0;
 try{
  ActivityGiveawayOptIn.findOne=()=>({lean:async()=>active});
  GuildConfig.findOne=()=>({select:()=>({lean:async()=>({giveawayExcludedRoleId:bannedRole})})});
  GiveawayActivityMinuteCount.updateOne=async()=>{writes++;};
  GiveawayActivityCount.updateOne=async()=>{writes++;};
  const m={...message(),guild:{members:{fetch:async()=>({
    roles:{cache:new Map([[bannedRole,{}]])},
  })}}};
  assert.equal(await eligibleActivityParticipant(m),null);
  await recordGiveawayMessage(m);
  await recordGuidedMessage(m);
  assert.equal(writes,0);
 }finally{
  ActivityGiveawayOptIn.findOne=before.optin;
  GuildConfig.findOne=before.config;
  GiveawayActivityMinuteCount.updateOne=before.minute;
  GiveawayActivityCount.updateOne=before.count;
 }
});
