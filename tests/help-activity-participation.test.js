import test from "node:test";
import assert from "node:assert/strict";
import {helpTopicPayload} from "../commands/help.js";

const userId="123456789012345678";
const fields=topic=>helpTopicPayload(topic,userId).embeds[0].toJSON().fields||[];
const field=(topic,name)=>fields(topic).find(item=>item.name===name)?.value||"";

test("Public Giveaway Help explains MongoDB opt-in without public slash commands",()=>{
 const member=field("giveaways","2. Activity Giveaways");
 assert.match(member,/Opt In/);
 assert.match(member,/Activity Giveaway List/);
 assert.match(member,/No Discord role/);
 assert.match(member,/Opt Out/);
 assert.match(member,/earlier activity does not carry over/);
 assert.match(field("giveaways","1. Regular Giveaways"),/separate/);
 assert.match(field("giveaways","4. Check Your Progress"),/privately/);
 assert.doesNotMatch(member,/\/(setup|giveaway)\b/);
});

test("Public Help directs members to the same permanent opt-in panel regardless of old settings",()=>{
 const withLegacy=helpTopicPayload("giveaways",userId,[],0,{
  activityParticipationRoleId:"234567890123456789",
  activityParticipationRoleInstructions:"Old role instructions.",
 });
 const selected=withLegacy.embeds[0].toJSON().fields.find(x=>x.name==="How to opt in on this server");
 assert.match(selected.value,/Opt In/);
 assert.match(selected.value,/Activity Giveaway List/);
 assert.doesNotMatch(selected.value,/234567890123456789|Old role instructions/);
 assert.deepEqual(withLegacy.allowedMentions,{parse:[]});
});

test("Staff Bot Setup and Track Activity describe no required participation role",()=>{
 const setup=field("ssetup","5. Giveaways & Court's Trials · PUBLIC and PRIVATE");
 assert.match(setup,/MongoDB/);
 assert.match(setup,/Opt In/);
 assert.match(setup,/no participation role is required/);
 assert.match(setup,/\/setup activity-giveaways/);
 const track=field("sactivity","Activity Participation · REQUIRED");
 assert.match(track,/Opt In/);
 assert.match(track,/No Discord role/);
 assert.match(track,/fresh counting window/);
 assert.match(field("sactivity","1. Set the Requirements"),/entire activity period/);
 assert.match(field("sactivity","3. Check Progress"),/opt out/);
 assert.match(field("sactivity","4. Manual Approval"),/still opted in/);
});

test("Updated help embeds respect Discord limits",()=>{
 for(const topic of ["giveaways","ssetup","sgiveaways","sactivity"]){
  for(const item of fields(topic)){
   assert.ok(item.name.length<=256,topic+": name too long");
   assert.ok(item.value.length<=1024,topic+": "+item.name+" too long");
  }
 }
});
