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

import { messageCharacterCount, qualifyingActivityPipeline, previousActivityDay } from "../services/giveaway-activity-counter.js";
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
