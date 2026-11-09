import test from "node:test";
import assert from "node:assert/strict";
import GiveawayPlan from "../models/GiveawayPlan.js";
import {DEFAULT_CLAIM_HOURS,claimDuration} from "../services/giveaway-claims.js";
import {guidedActivityRequirements,qualifiesForGuidedActivity} from "../services/guided-activity.js";
import {activityWizardPrompts,activityWizardInput,defaultActivityWizardSettings} from "../commands/activity-wizard.js";
import {activityOneOffListingEmbed} from "../services/giveaway-directory.js";

test("guided activity uses period-wide message totals separate from optional active days",()=>{
  const goals=guidedActivityRequirements({minimum:10,days:3});
  assert.deepEqual(goals,{activityMinimum:1,activityDays:3,activityMinTotalMessages:10});
  assert.equal(qualifiesForGuidedActivity({messages:10,days:3},goals),true);
  assert.equal(qualifiesForGuidedActivity({messages:9,days:3},goals),false);
  assert.equal(qualifiesForGuidedActivity({messages:10,days:2},goals),false);
  const event={_id:"507f1f77bcf86cd799439011",guidedSeries:"507f1f77bcf86cd799439012",
    title:"Weekly Messages",prize:"Pet",activityStartAt:new Date("2026-11-09T00:00:00Z"),
    activityEndAt:new Date("2026-11-12T00:00:00Z"),
    endsAt:new Date("2026-11-12T00:00:00Z"),activityChannelIds:[],...goals};
  const desc=activityOneOffListingEmbed(event).toJSON().description;
  assert.match(desc,/10 matching message\(s\) total during this activity/);
  assert.match(desc,/at least one matching message on 3 days/i);
  assert.doesNotMatch(desc,/per day/i);
});
test("guided wizard supports quick choices, banner registration and image-only Discord uploads",()=>{
  assert.match(activityWizardPrompts.minimum[0],/entire activity period/);
  assert.doesNotMatch(activityWizardPrompts.minimum[0],/per active day/);
  assert.ok(activityWizardPrompts.banner[1].some(x=>x[1]==="bannerRegister"));
  assert.ok(activityWizardPrompts.banner[1].some(x=>x[1]==="bannerBack"));
  const image={name:"Pink Roses.png",url:"https://cdn.discordapp.com/attachments/1/2/rose.png",
    contentType:"image/png",size:123};
  assert.deepEqual(activityWizardInput({content:"",attachments:{first:()=>image}},"bannerName"),
    {content:"",attachment:image});
  assert.equal(activityWizardInput({content:"  8 ",attachments:{first:()=>image}},"minimum"),"8");
});
test("progress defaults on for guided activity and scheduled plans",()=>{
  const guided=defaultActivityWizardSettings("123456789012345678");
  assert.equal(guided.progress,true);
  assert.equal(guided.claimHours,12);
  const plan=new GiveawayPlan({guildId:"123456789012345678",name:"Progress",
    nameKey:"progress",title:"Progress",watchNameKey:"general",
    creatorId:"123456789012345678",channelId:"123456789012345678",
    nextRunAt:new Date()});
  assert.equal(plan.progressEnabled,true);
});
test("all new giveaway types default to a 12-hour claim window",()=>{
  assert.equal(DEFAULT_CLAIM_HOURS,12);
  const plan=new GiveawayPlan({guildId:"123456789012345678",name:"A",
    nameKey:"a",title:"Test",watchNameKey:"general",creatorId:"123456789012345678",
    channelId:"123456789012345678",nextRunAt:new Date()});
  assert.equal(plan.claimWindowHours,12);
  assert.equal(claimDuration({mode:"standard",claimWindowHours:12}).milliseconds,43200000);
  assert.equal(claimDuration({mode:"survival",claimWindowHours:12,claimWindowMinutes:null}).count,12);
  assert.equal(claimDuration({mode:"survival",claimWindowMinutes:15}).count,15);
});
