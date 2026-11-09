import test from "node:test";
import assert from "node:assert/strict";
import { activityWeek, completedActivityWeek } from "../services/giveaway-activity-counter.js";
test("Wednesday midnight Eastern starts a new week in standard time", () => {
  assert.equal(activityWeek(new Date("2026-11-04T04:59:59Z")), "2026-10-28");
  assert.equal(activityWeek(new Date("2026-11-04T05:00:00Z")), "2026-11-04");
  assert.equal(completedActivityWeek(new Date("2026-11-04T05:00:00Z")), "2026-10-28");
});
test("Wednesday midnight Eastern accounts for daylight saving", () => {
  assert.equal(activityWeek(new Date("2026-07-08T03:59:59Z")), "2026-07-01");
  assert.equal(activityWeek(new Date("2026-07-08T04:00:00Z")), "2026-07-08");
});
test("Sunday and Tuesday are in the same Wednesday activity week", () => {
  assert.equal(activityWeek(new Date("2026-11-08T16:00:00Z")), "2026-11-04");
  assert.equal(activityWeek(new Date("2026-11-10T16:00:00Z")), "2026-11-04");
});

import { messageCharacterCount, messageMatchesGiveawayWatch, qualifyingActivityPipeline, qualifyingWatchRulePipeline, previousActivityDay } from "../services/giveaway-activity-counter.js";
test("QOTD message thresholds exclude command text, bots, and short responses",()=>{
 assert.equal(messageCharacterCount({content:"   Hello, world!  "}),13);
 assert.equal(messageCharacterCount({content:"/giveaway activity"}),0);
 assert.equal(messageCharacterCount({content:" .claim "}),0);
 const pipeline=qualifyingActivityPipeline({guildId:"test",type:"channels",channelIds:["qotd"],minimumChars:20,minimum:1,days:3,week:"2026-11-04"});
 assert.deepEqual(pipeline[0].$match.channelId,{$in:["qotd"]});
 assert.equal(pipeline[1].$project.messages.$sum.$map.input.$filter.cond.$gte[1],20);
 assert.equal(pipeline.at(-1).$match.activeDays.$gte,3);
});

test("daily QOTD activity does not mix neighboring calendar days",()=>{
 assert.equal(previousActivityDay(new Date("2026-11-12T00:30:00Z")),"2026-11-10");
 assert.equal(previousActivityDay(new Date("2026-11-13T00:30:00Z")),"2026-11-11");
 const tue=qualifyingActivityPipeline({guildId:"g",type:"channels",
   channelIds:["qotd"],day:"2026-11-10",minimumChars:20,days:1,minimum:1});
 const wed=qualifyingActivityPipeline({guildId:"g",type:"channels",
   channelIds:["qotd"],day:"2026-11-11",minimumChars:20,days:1,minimum:1});
 assert.deepEqual(tue[0].$match,{guildId:"g",day:"2026-11-10",channelId:{$in:["qotd"]}});
 assert.deepEqual(wed[0].$match,{guildId:"g",day:"2026-11-11",channelId:{$in:["qotd"]}});
 assert.equal("week" in tue[0].$match,false);
 assert.throws(()=>qualifyingActivityPipeline({guildId:"g",type:"general",day:"2026-11-10",days:3}),/one active day/);
});

test("manually set message goal counts all messages in the period, without daily quotas",()=>{
 const weekly=qualifyingActivityPipeline({guildId:"server",type:"channels",channelIds:["general"],
   minimum:1,days:1,minimumTotalMessages:50,minimumChars:10,week:"2026-11-04"});
 assert.equal(weekly[0].$match.week,"2026-11-04");
 assert.equal(weekly.at(-1).$match.activeDays.$gte,1);
 assert.equal(weekly.at(-1).$match.totalMessages.$gte,50);
 const daily=qualifyingActivityPipeline({guildId:"server",type:"channels",channelIds:["general"],
   minimum:1,days:1,minimumTotalMessages:50,minimumChars:10,day:"2026-11-10"});
 assert.deepEqual(daily[0].$match,{guildId:"server",day:"2026-11-10",channelId:{$in:["general"]}});
 assert.equal(daily.at(-1).$match.totalMessages.$gte,50);
});
test("a stand-alone explicit user ping counts as one message, not a daily quota",()=>{
 const target="123456789012345678",author="234567890123456789";
 const message={guildId:"g",channelId:"c",author:{id:author,bot:false},
   content:`<@${target}>`,mentions:{users:{has:id=>id===target}}};
 const matcher={requiredMentionUserId:target,minimumChars:1};
 assert.equal(messageMatchesGiveawayWatch(message,matcher),true);
 assert.equal(messageMatchesGiveawayWatch({...message,content:`<@!${target}>`},matcher),true);
 assert.equal(messageMatchesGiveawayWatch({...message,content:"Pinged you!"},matcher),false);
 assert.equal(messageMatchesGiveawayWatch({...message,author:{id:target,bot:false}},matcher),false);
 assert.equal(messageMatchesGiveawayWatch({...message,mentions:{users:{has:()=>false}}},matcher),false);
 assert.equal(messageMatchesGiveawayWatch(message,{...matcher,requiredPhrase:"hello"}),false);
 assert.equal(messageMatchesGiveawayWatch(message,{...matcher,minimumChars:3}),false);
});
test("actual member pings with an optional phrase, not plain names or reply mentions",()=>{
 const tina="123456789012345678",member="234567890123456789";
 const rule={requiredMentionUserId:tina,requiredPhrase:"you are wonderful",minimumChars:5};
 const message={guildId:"g",author:{id:member,bot:false},webhookId:null,
   content:`<@${tina}> You are WONDERFUL!`,
   mentions:{users:{has:id=>id===tina}}};
 assert.equal(messageMatchesGiveawayWatch(message,rule),true);
 assert.equal(messageMatchesGiveawayWatch({...message,content:"Tina, you are wonderful!"},rule),false);
 assert.equal(messageMatchesGiveawayWatch({...message,content:"You are wonderful!"},rule),false);
 assert.equal(messageMatchesGiveawayWatch({...message,content:`<@${tina}> Thank you`},rule),false);
 assert.equal(messageMatchesGiveawayWatch({...message,content:`<@&${tina}> You are wonderful!`},rule),false);
 assert.equal(messageMatchesGiveawayWatch({...message,author:{id:tina,bot:false}},rule),false);
 assert.equal(messageMatchesGiveawayWatch({...message,mentions:{users:{has:()=>false}}},rule),false);
 assert.equal(messageMatchesGiveawayWatch({...message,author:{id:member,bot:true}},rule),false);
 assert.equal(messageMatchesGiveawayWatch({...message,webhookId:"hook"},rule),false);
});
test("mention challenge accumulates only matching messages within the chosen day/week",()=>{
 const rule={_id:"rule",criteriaVersion:2,minimumMessages:1,activeDays:1,minimumTotalMessages:3};
 const day=qualifyingWatchRulePipeline({guildId:"g",rule,day:"2026-11-10"});
 assert.deepEqual(day[0].$match,{guildId:"g",ruleId:"rule",criteriaVersion:2,day:"2026-11-10"});
 assert.equal(day.at(-1).$match.totalMessages.$gte,3);
 const week=qualifyingWatchRulePipeline({guildId:"g",rule,week:"2026-11-04"});
 assert.equal(week[0].$match.week,"2026-11-04");
 assert.ok(!Object.hasOwn(week[0].$match,"day"));
});
