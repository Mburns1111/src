import test from "node:test";
import assert from "node:assert/strict";
import {giveawayAnnouncement} from "../services/giveaways.js";
import {giveawayStaffRecordPayload} from "../services/giveaway-staff-records.js";
import {giveawayClaimsComplete,giveawayPrizesSettled,completedGiveawayCanDeleteListing} from "../services/giveaway-listing-lifecycle.js";
import {giveawayStaffEditableFields,validateGiveawayStaffEdit} from "../services/giveaway-staff-edit.js";
import {progressPanelPayload} from "../services/giveaway-staff-progress.js";

const id="507f1f77bcf86cd799439011",a="123456789012345678",b="234567890123456789";
const claim={slot:0,userId:a,ticketNumber:"T-1",
 ticketUrl:"https://discord.com/channels/123456789012345678/345678901234567890/456789012345678901",submittedAt:new Date()};
const base={_id:id,guildId:a,title:"Test giveaway",prize:"Test prize",creatorId:b,
 endsAt:new Date("2026-11-14T17:00:00Z"),status:"ended",mode:"standard",
 winnerCount:2,winnerIds:[a,b],entrantIds:[a,b],
 claimWindowHours:12,winnerClaims:[claim],claimResolvedSlots:[],
 winnerAssignedAt:[new Date("2026-11-14T17:00:00Z"),new Date("2026-11-14T17:00:00Z")],
 publicListingRemovedAt:null};

const ids=payload=>payload.components.flatMap(row=>row.components).map(b=>b.data.custom_id);

test("regular and activity result mention each winner only once and retain a claim button",()=>{
 for(const mode of ["standard","activity"]){
  const payload=giveawayAnnouncement({...base,mode});
  const data=payload.embeds[0].toJSON();
  for(const winner of [a,b])
   assert.equal((data.description.match(new RegExp("<@"+winner+">","g"))||[]).length,1);
  assert.equal((data.description.match(/Winners \/ Results/g)||[]).length,1);
  assert.equal(data.fields?.length||0,0);
  assert.ok(ids(payload).includes("giveaway:claim:"+id));
  assert.doesNotMatch(data.description,/Hosted by|Rules \/ Requirements|Winner ticket claims/);
 }
});

test("staff can confirm one claim while a second winner is awaiting a claim",()=>{
 const payload=giveawayStaffRecordPayload(base);
 assert.ok(ids(payload).includes("giveawaystaff:deliver:"+id));
 assert.ok(!ids(payload).includes("giveawaystaff:remove:"+id));
 assert.equal(giveawayClaimsComplete(base),false);
});

test("a cancelled prize is not announced as an active winner, but remains in staff history",()=>{
 const cancelled={...base,cancelledPrizes:[{slot:1,userId:b,by:a,reason:"Not eligible",at:new Date()}],
  claimResolvedSlots:[1]};
 const publicText=giveawayAnnouncement(cancelled).embeds[0].toJSON().description;
 assert.match(publicText,/Prize cancelled by staff/);
 assert.equal((publicText.match(new RegExp("<@"+b+">","g"))||[]).length,0);
 assert.match(giveawayStaffRecordPayload(cancelled).embeds[0].toJSON().description,/original winner/);
});

test("delivered and cancelled places can be archived together, not pending prizes",()=>{
 const pending={...base,prizeDeliveries:[{slot:0,userId:a,by:b,at:new Date()}]};
 assert.equal(giveawayPrizesSettled(pending),false);
 const settled={...pending,cancelledPrizes:[{slot:1,userId:b,by:a,reason:"Denied",at:new Date()}],
  claimResolvedSlots:[1]};
 assert.equal(giveawayPrizesSettled(settled),true);
 assert.equal(completedGiveawayCanDeleteListing(settled),true);
 assert.equal(completedGiveawayCanDeleteListing({...settled,prizeDeliveries:[]}),false);
});

test("regular staff editor accepts bonus roles but cannot replace existing drawing entries",()=>{
 const open={...base,status:"open",roleBonuses:[]};
 assert.ok(giveawayStaffEditableFields(open).includes("roleBonuses"));
 const added=validateGiveawayStaffEdit(open,"roleBonuses",a+" 3");
 assert.deepEqual(added.roleBonuses,[{roleId:a,extraEntries:3}]);
 assert.deepEqual(validateGiveawayStaffEdit({...open,roleBonuses:added.roleBonuses},
   "roleBonuses",a+" remove").roleBonuses,[]);
 assert.throws(()=>validateGiveawayStaffEdit(open,"roleBonuses",a+" 30"),/1–20/);
});

test("activity panel keeps qualification and in-progress counts separate",()=>{
 const payload=progressPanelPayload({...base,mode:"activity"},
  [{userId:a,messages:2,days:1,qualified:true},{userId:b,messages:1,days:1,qualified:false}]);
 const display=payload.embeds[0].toJSON().description;
 assert.match(display,/Qualified:\*\* 1/);
 assert.match(display,/In progress:\*\* 1/);
 assert.equal(ids(payload).filter(x=>x.startsWith("activitystaff:")).length,3);
});
