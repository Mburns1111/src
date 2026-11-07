import test from "node:test";
import assert from "node:assert/strict";
import {parseEasternActivityTime,validateCustomActivityWindow}
 from "../services/giveaway-plan-time.js";
import {planActivityWindow} from "../services/giveaway-plans.js";
import {qualifyingActivityPipeline,qualifyingWatchRulePipeline}
 from "../services/giveaway-activity-counter.js";
const start="2026-11-09 13:15",end="2026-11-11 18:45";
test("one-time custom activity start and cutoff accept exact Eastern minutes",()=>{
 const now=new Date("2026-11-06T00:00:00Z");
 const w=validateCustomActivityWindow(start,end,{now,
   announceAt:parseEasternActivityTime("2026-11-11 19:00")});
 assert.equal(w.startAt.toISOString(),"2026-11-09T18:15:00.000Z");
 assert.equal(w.endAt.toISOString(),"2026-11-11T23:45:00.000Z");
 assert.throws(()=>validateCustomActivityWindow(start,end,{now,recurrence:"daily"}),/one-time/);
 assert.throws(()=>validateCustomActivityWindow(end,start,{now}),/later/);
 assert.throws(()=>validateCustomActivityWindow(start,end,{now,announceAt:w.startAt}),/before/);
 const period=planActivityWindow({activityPeriod:"weekly",customActivityStartAt:w.startAt,
   customActivityEndAt:w.endAt},parseEasternActivityTime("2026-11-11 19:00"));
 assert.equal(period.custom,true);
 assert.equal(period.startAt.toISOString(),w.startAt.toISOString());
});
test("custom activity aggregates only minute buckets within the specified boundaries",()=>{
 const startAt=new Date("2026-11-09T18:15:00.000Z");
 const endAt=new Date("2026-11-11T23:45:00.000Z");
 const options={guildId:"123456789012345678",type:"channels",channelIds:["345678901234567890"],
   minimum:1,days:1,minimumChars:10,minimumTotalMessages:5,startAt,endAt};
 const pipeline=qualifyingActivityPipeline(options);
 assert.deepEqual(pipeline[0].$match.minute,{$gte:startAt,$lt:endAt});
 assert.equal(pipeline.at(-1).$match.totalMessages.$gte,5);
 const rulePipeline=qualifyingWatchRulePipeline({guildId:options.guildId,
   rule:{_id:"507f1f77bcf86cd799439011",criteriaVersion:1,minimumMessages:1,activeDays:1},
   minimumTotalMessages:1,startAt,endAt});
 assert.deepEqual(rulePipeline[0].$match.minute,{$gte:startAt,$lt:endAt});
});
