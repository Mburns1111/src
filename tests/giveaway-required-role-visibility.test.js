import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import {data as giveawayCommand} from "../commands/giveaway.js";
import {startRegularGiveawayWizard} from "../commands/regular-giveaway-wizard.js";
import {activityWizardPrompts,defaultActivityWizardSettings} from "../commands/activity-wizard.js";
import {GUIDED_EDIT_FIELDS,validateGuidedStaffEdit} from "../services/guided-staff-actions.js";
import {activityOneOffListingEmbed} from "../services/giveaway-directory.js";
import {giveawayAnnouncement} from "../services/giveaways.js";

const role="123456789012345678";
const instructions="Get the member role in <#234567890123456789>.";
const event={
  _id:"507f1f77bcf86cd799439011",guildId:"345678901234567890",
  title:"Restricted Giveaway",prize:"Neon pet",mode:"activity",status:"open",
  creatorId:"456789012345678901",winnerCount:1,requiredRoleId:role,
  requiredRoleInstructions:instructions,activityMinTotalMessages:1,
  endsAt:new Date("2027-01-01T00:00:00Z"),entrantIds:[],winnerIds:[],
  activityStartAt:new Date("2026-12-30T00:00:00Z"),
  activityEndAt:new Date("2026-12-31T23:59:00Z"),
  claimWindowHours:12,
};
test("activity opt-in is mandatory and is separate from the optional regular giveaway entry role",()=>{
  const config=new GuildConfig({guildId:event.guildId});
  assert.equal(config.giveawayDefaultRequiredRoleId,"");
  assert.equal(config.activityParticipationRoleId,"");
  assert.equal(config.activityParticipationRoleInstructions,"");
  assert.equal(config.giveawayShowRoleInstructions,true);
  const record=new Giveaway({...event});
  assert.equal(record.showRequiredRoleInstructions,true);
  assert.equal(defaultActivityWizardSettings("staff").showRequiredRoleInstructions,true);
  assert.equal(activityWizardPrompts.requiredRoleChoice,undefined);
  assert.equal(activityWizardPrompts.roleHelpChoice,undefined);
  assert.equal(GUIDED_EDIT_FIELDS.some(field=>field.value==="requiredRoleId"),false);
  assert.equal(GUIDED_EDIT_FIELDS.some(field=>field.value==="showRequiredRoleInstructions"),false);
  const regular=giveawayCommand.toJSON().options.find(x=>x.name==="start");
  assert.deepEqual(regular.options||[],[],
    "regular giveaways now choose required role and visibility in the guided wizard");
  assert.equal(typeof startRegularGiveawayWizard,"function");
});
test("hidden role help stays private, but role requirement remains visible and enforced by its own field",()=>{
  const hidden={...event,showRequiredRoleInstructions:false};
  const activity=activityOneOffListingEmbed(hidden).toJSON().description;
  assert.match(activity,/<@&123456789012345678>/);
  assert.doesNotMatch(activity,/Where to get/);
  assert.doesNotMatch(activity,/Get the member role/);
  const ordinary=giveawayAnnouncement({...hidden,mode:"standard"}).embeds[0].toJSON().description;
  assert.match(ordinary,/<@&123456789012345678>/);
  assert.doesNotMatch(ordinary,/How to get the role/);
  assert.doesNotMatch(ordinary,/Get the member role/);
  const visible=activityOneOffListingEmbed({...event,showRequiredRoleInstructions:true}).toJSON().description;
  assert.match(visible,/Where to get it/);
  assert.match(visible,/<#234567890123456789>/);
  const visibleOrdinary=giveawayAnnouncement({...event,mode:"standard",showRequiredRoleInstructions:true}).embeds[0].toJSON().description;
  assert.match(visibleOrdinary,/How to get the role/);
});
test("activity staff controls cannot remove the opt-in role or hide opt-in instructions",()=>{
  assert.throws(()=>validateGuidedStaffEdit("showRequiredRoleInstructions","off",event),
    /mandatory Activity Participation role/);
  assert.throws(()=>validateGuidedStaffEdit("requiredRoleId","none",event),
    /mandatory Activity Participation role/);
  assert.throws(()=>validateGuidedStaffEdit("requiredRoleId","default",event),
    /mandatory Activity Participation role/);
});
