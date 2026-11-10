import test from "node:test";
import assert from "node:assert/strict";
import {parseEasternAnnouncement,nextWeeklyAnnouncement,nextDailyAnnouncement,nextPlanAnnouncement,easternMidnight} from "../services/giveaway-plan-time.js";
import {nextGiveawayPlanCycle,runGiveawayPlan,planActivityWindow} from "../services/giveaway-plans.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayWatchRule from "../models/GiveawayWatchRule.js";
import GiveawayActivityCount from "../models/GiveawayActivityCount.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import {addGiveawayPlanCommands,validatePlanSchedule} from "../commands/giveaway-plans.js";
import {SlashCommandBuilder} from "discord.js";
import {data as giveawayCommand} from "../commands/giveaway.js";
import {activityWizardPrompts} from "../commands/activity-wizard.js";

test("Eastern announcement timestamps accept future local times and reject invalid formats",()=>{
 const before=new Date("2026-11-06T05:00:00Z");
 const t=parseEasternAnnouncement("2026-11-11 19:30",{now:before});
 assert.equal(t.toISOString(),"2026-11-12T00:30:00.000Z");
 assert.throws(()=>parseEasternAnnouncement("Nov 11 7:30PM",{now:before}),/YYYY-MM-DD/);
 assert.throws(()=>parseEasternAnnouncement("2026-02-30 19:30",{now:before}),/Invalid/);
 assert.throws(()=>parseEasternAnnouncement("2026-11-03 19:30",{now:before}),/future/);
});
test("weekly recurrence preserves Eastern clock time across daylight saving",()=>{
 const before=new Date("2026-10-01T00:00:00Z");
 const oct=parseEasternAnnouncement("2026-10-28 19:30",{now:before});
 assert.equal(oct.toISOString(),"2026-10-28T23:30:00.000Z");
 assert.equal(nextWeeklyAnnouncement(oct).toISOString(),"2026-11-05T00:30:00.000Z");
 const march=parseEasternAnnouncement("2027-03-10 19:30",{now:before});
 assert.equal(nextWeeklyAnnouncement(march).toISOString(),"2027-03-17T23:30:00.000Z");
});
test("plan setup supports edit/reorder/status and does not alter existing giveaway records",()=>{
 assert.ok(GiveawayPlan.schema.path("nextRunAt"));
 assert.ok(GiveawayPlan.schema.path("repeatPrizes"));
 assert.ok(GiveawayPlan.schema.path("minimumTotalMessages"));
 assert.ok(GiveawayPlan.schema.path("description"));
 assert.ok(GiveawayPlan.schema.path("recurring"));
 const builder=addGiveawayPlanCommands(new SlashCommandBuilder().setName("check").setDescription("Check"));
 const subcommands=builder.toJSON().options.map(x=>x.name);
 assert.deepEqual(subcommands,["plan-create","plan-list","plan-view","plan-edit","prize-add","prize-edit","prize-remove","prize-move"]);
 assert.ok(builder.toJSON().options.find(o=>o.name==="plan-create").options.some(o=>o.name==="description"));
 assert.ok(builder.toJSON().options.find(o=>o.name==="plan-edit").options.some(o=>o.name==="clear_description"));
});

test("independent prize list rotates weekly and never consumes a prize without eligible entrants",()=>{
 const base={recurring:true,repeatPrizes:true,nextPrizeIndex:0,prizes:["Pet A","Pet B"],nextRunAt:new Date("2026-11-11T18:00:00Z")};
 const drawn=nextGiveawayPlanCycle(base,{drawn:true,result:"Drawn"});
 assert.equal(drawn.status,"active");
 assert.equal(drawn.nextPrizeIndex,1);
 const empty=nextGiveawayPlanCycle({...base,nextPrizeIndex:1},{drawn:false,result:"No entrants"});
 assert.equal(empty.nextPrizeIndex,1);
 const loop=nextGiveawayPlanCycle({...base,nextPrizeIndex:1},{drawn:true,result:"Drawn"});
 assert.equal(loop.nextPrizeIndex,0);
 const stop=nextGiveawayPlanCycle({...base,repeatPrizes:false,nextPrizeIndex:1},{drawn:true,result:"Drawn"});
 assert.equal(stop.status,"paused");
 assert.equal(nextGiveawayPlanCycle({...base,recurring:false},{drawn:true,result:"Done"}).status,"completed");
});
test("stale week-old plan does not publish a flood of outdated results",async()=>{
 const original=Giveaway.findOne;
 try {
   Giveaway.findOne=()=>({lean:async()=>null});
   const result=await runGiveawayPlan({},{
     status:"active",_id:"507f1f77bcf86cd799439011",
     guildId:"123456789012345678",nextRunAt:new Date("2026-10-28T18:00:00Z"),
   },{now:new Date("2026-11-06T19:00:00Z")});
   assert.equal(result.drawn,false);
   assert.match(result.result,/Skipped an outdated drawing/);
 }finally{Giveaway.findOne=original;}
});

test("Tuesday QOTD messages count only in Wednesday drawing; Thursday draws only Wednesday",()=>{
 const daily={activityPeriod:"daily"};
 const wed=planActivityWindow(daily,new Date("2026-11-12T00:30:00Z")); // Wed 19:30 EST
 const thu=planActivityWindow(daily,new Date("2026-11-13T00:30:00Z")); // Thu 19:30 EST
 assert.equal(wed.key,"2026-11-10");
 assert.equal(thu.key,"2026-11-11");
 assert.equal(wed.endAt.toISOString(),thu.startAt.toISOString());
 assert.equal(wed.startAt.toISOString(),"2026-11-10T05:00:00.000Z");
 assert.equal(thu.startAt.toISOString(),"2026-11-11T05:00:00.000Z");
 const weekly=planActivityWindow({activityPeriod:"weekly"},new Date("2026-11-12T00:30:00Z"));
 assert.equal(weekly.key,"2026-11-04");
 assert.equal(weekly.endAt.toISOString(),"2026-11-11T05:00:00.000Z");
});
test("daily Eastern midnight tracks 23-hour and 25-hour DST days",()=>{
 const springMs=easternMidnight("2027-03-15")-easternMidnight("2027-03-14");
 assert.equal(springMs,23*60*60*1000);
 const fallMs=easternMidnight("2026-11-02")-easternMidnight("2026-11-01");
 assert.equal(fallMs,25*60*60*1000);
 const springBefore=parseEasternAnnouncement("2027-03-13 19:30",{now:new Date("2026-01-01T00:00:00Z")});
 assert.equal(nextDailyAnnouncement(springBefore).toISOString(),"2027-03-14T23:30:00.000Z");
 const fallBefore=parseEasternAnnouncement("2026-10-31 19:30",{now:new Date("2026-01-01T00:00:00Z")});
 assert.equal(nextDailyAnnouncement(fallBefore).toISOString(),"2026-11-02T00:30:00.000Z");
});
test("repeat choices support fixed same-time Eastern schedules or fixed hour intervals",()=>{
 const base={prizes:["Pet"],nextPrizeIndex:0,activityPeriod:"daily",repeatMode:"daily",nextRunAt:new Date("2026-10-31T23:00:00Z"),repeatPrizes:true};
 const next=nextGiveawayPlanCycle(base,{drawn:true,result:"Awarded"},new Date("2026-10-31T23:05:00Z"));
 assert.equal(next.nextRunAt.toISOString(),"2026-11-02T00:00:00.000Z");
 assert.equal(next.status,"active");
 assert.deepEqual(validatePlanSchedule("daily","daily",null),{
   repeatMode:"daily",activityPeriod:"daily",intervalMinutes:null,recurring:true
 });
 assert.deepEqual(validatePlanSchedule("interval","daily",36).intervalMinutes,2160);
 assert.throws(()=>validatePlanSchedule("interval","daily",12),/24/);
 assert.throws(()=>validatePlanSchedule("interval","weekly",24),/168/);
 assert.throws(()=>validatePlanSchedule("daily","weekly",null),/daily activity window/);
 assert.equal(nextPlanAnnouncement(new Date("2026-11-11T12:00:00Z"),"interval",36*60).toISOString(),
   "2026-11-13T00:00:00.000Z");
});

test("daily QOTD plans query each prior day independently, even if watch has weekly days:3",async()=>{
 const originals=[Giveaway.findOne,GiveawayWatchRule.findOne,GiveawayActivityCount.aggregate];
 const matches=[];
 try{
   Giveaway.findOne=()=>({lean:async()=>null});
   GiveawayWatchRule.findOne=()=>({lean:async()=>({
     channelId:"qotd",minimumChars:25,minimumMessages:1,activeDays:3,
   })});
   GiveawayActivityCount.aggregate=async pipeline=>{
     matches.push(pipeline);
     return [];
   };
   const client={guilds:{fetch:async()=>({members:{fetch:async()=>null}})}};
   const plan={status:"active",activityPeriod:"daily",_id:"507f1f77bcf86cd799439011",
     guildId:"123456789012345678",watchNameKey:"qotd"};
   const first=await runGiveawayPlan(client,{...plan,nextRunAt:new Date("2026-11-12T00:30:00Z")},
     {now:new Date("2026-11-12T00:35:00Z")});
   const second=await runGiveawayPlan(client,{...plan,nextRunAt:new Date("2026-11-13T00:30:00Z")},
     {now:new Date("2026-11-13T00:35:00Z")});
   assert.equal(first.activityKey,"2026-11-10");
   assert.equal(second.activityKey,"2026-11-11");
   assert.deepEqual(matches.map(p=>p[0].$match.day),["2026-11-10","2026-11-11"]);
   assert.equal(matches.every(p=>!Object.hasOwn(p[0].$match,"week")),true);
   assert.equal(matches.every(p=>p.at(-1).$match.activeDays.$gte===1),true);
 }finally{
   [Giveaway.findOne,GiveawayWatchRule.findOne,GiveawayActivityCount.aggregate]=originals;
 }
});
test("a scheduled plan never redraws the same activity day at another hour",async()=>{
 const old=Giveaway.findOne;
 try {
   Giveaway.findOne=query=>({lean:async()=>query.activityPeriodKey ? {_id:"existing-draw"} : null});
   const plan={status:"active",_id:"507f1f77bcf86cd799439011",
     guildId:"123456789012345678",activityPeriod:"daily",
     nextRunAt:new Date("2026-11-12T00:30:00Z")};
   const outcome=await runGiveawayPlan({},plan,{now:new Date("2026-11-12T00:31:00Z")});
   assert.equal(outcome.drawn,false);
   assert.match(outcome.result,/already been drawn/);
 }finally{Giveaway.findOne=old;}
});

test("watch settings expose total messages for the chosen period, not forced per-day totals",()=>{
 // Legacy named watched-channel rules are retained for existing schedules,
 // but new activity giveaways choose their watch scope and total count in
 // the guided wizard (no watch-* slash command clutter).
 const visible=giveawayCommand.toJSON().options;
 assert.ok(!visible.some(o=>o.name.startsWith("watch-")));
 assert.ok(visible.some(o=>o.name==="activity"));
 const plans=addGiveawayPlanCommands(new SlashCommandBuilder().setName("x").setDescription("X")).toJSON().options;
 const create=plans.find(o=>o.name==="plan-create");
 const edit=plans.find(o=>o.name==="plan-edit");
 assert.ok(create.options.find(o=>o.name==="messages"));
 assert.ok(edit.options.find(o=>o.name==="messages"));
 const manual=giveawayCommand.toJSON().options.find(o=>o.name==="activity");
 assert.ok(manual, "guided activity setup is available");
 assert.match(activityWizardPrompts.minimum[0],/entire activity period/);
 assert.doesNotMatch(activityWizardPrompts.minimum[0],/per active day/);
});
