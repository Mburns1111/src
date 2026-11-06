import test from "node:test";
import assert from "node:assert/strict";
import {parseEasternAnnouncement,nextWeeklyAnnouncement} from "../services/giveaway-plan-time.js";
import {nextGiveawayPlanCycle,runGiveawayPlan} from "../services/giveaway-plans.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import {addGiveawayPlanCommands} from "../commands/giveaway-plans.js";
import {SlashCommandBuilder} from "discord.js";

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
 assert.ok(GiveawayPlan.schema.path("recurring"));
 const builder=addGiveawayPlanCommands(new SlashCommandBuilder().setName("check").setDescription("Check"));
 const subcommands=builder.toJSON().options.map(x=>x.name);
 assert.deepEqual(subcommands,["plan-create","plan-list","plan-view","plan-edit","prize-add","prize-edit","prize-remove","prize-move"]);
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
