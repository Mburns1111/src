import test from "node:test";
import assert from "node:assert/strict";
import {helpTopicPayload} from "../commands/help.js";

const userId="123456789012345678";
const roleId="234567890123456789";
const rolesChannel="345678901234567890";
const fields=topic=>helpTopicPayload(topic,userId).embeds[0].toJSON().fields||[];
const field=(topic,name)=>fields(topic).find(item=>item.name===name)?.value||"";

test("Public Giveaway Help clearly explains mandatory opt-in without public slash commands",()=>{
  const member=field("giveaways","2. Activity Giveaways");
  assert.match(member,/Activity Participation/);
  assert.match(member,/opt-in only/);
  assert.match(member,/before you have the role/);
  assert.match(member,/there is no entry button/);
  assert.match(member,/Removing the role stops counting/);
  assert.match(member,/Earlier qualifying messages may remain/);
  assert.match(field("giveaways","1. Regular Giveaways"),/separate from the Activity Participation role/);
  assert.match(field("giveaways","4. Check Your Progress"),/privately/);
  assert.doesNotMatch(member,/\/(setup|giveaway)\b/);
});

test("Public Help shows this server's role and its actual pickup instructions",()=>{
  const config={activityParticipationRoleId:roleId,
    activityParticipationRoleInstructions:"Select the role in <#"+rolesChannel+">."};
  const payload=helpTopicPayload("giveaways",userId,[],0,config);
  const selected=payload.embeds[0].toJSON().fields.find(x=>x.name==="How to opt in on this server");
  assert.match(selected.value,new RegExp(roleId));
  assert.match(selected.value,new RegExp(rolesChannel));
  assert.match(selected.value,/Where to get it/);
  assert.deepEqual(payload.allowedMentions,{parse:[]});
});

test("Public Help handles a missing or invalid configured participation role",()=>{
  const missing=field("giveaways","How to opt in on this server");
  assert.match(missing,/not configured/);
  const bad=helpTopicPayload("giveaways",userId,[],0,
    {activityParticipationRoleId:"invalid-role"}).embeds[0].toJSON().fields;
  assert.match(bad.find(x=>x.name==="How to opt in on this server").value,/not configured/);
});

test("Staff Bot Setup and Track Activity keep the regular entry role separate",()=>{
  const setup=field("ssetup","5. Giveaways & Court's Trials · PUBLIC and PRIVATE");
  assert.match(setup,/Activity Participation/);
  assert.match(setup,/required/);
  assert.match(setup,/optional regular giveaway eligibility role/);
  assert.match(setup,/\/setup activity-giveaways/);
  const track=field("sactivity","Activity Participation · REQUIRED");
  assert.match(track,/separate from the optional regular giveaway eligibility role/);
  assert.match(track,/cannot bypass|cannot disable|cannot replace/i);
  assert.match(field("sactivity","1. Set the Requirements"),/entire activity period/);
  assert.match(field("sactivity","3. Check Progress"),/remove the role/);
  assert.match(field("sactivity","4. Manual Approval"),/still have Activity Participation/);
});

test("Updated help fields remain within Discord embed limits",()=>{
  for(const topic of ["giveaways","ssetup","sgiveaways","sactivity"]){
    for(const item of fields(topic)){
      assert.ok(item.name.length<=256,topic+": field name too long");
      assert.ok(item.value.length<=1024,topic+": "+item.name+" too long");
    }
  }
  const maxInstructions="a".repeat(500);
  const withInstructions=helpTopicPayload("giveaways",userId,[],0,{
    activityParticipationRoleId:roleId,
    activityParticipationRoleInstructions:maxInstructions,
  });
  for(const item of withInstructions.embeds[0].toJSON().fields)
    assert.ok(item.value.length<=1024,item.name);
});
