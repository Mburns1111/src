import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import {giveawayAnnouncement} from "../services/giveaways.js";
import {giveawayStaffRecordPayload,staffRecordMarker,handleGiveawayStaffAction,ensureGiveawayStaffRecord} from "../services/giveaway-staff-records.js";

const id="507f1f77bcf86cd799439011",guildId="123456789012345678",
  winner="234567890123456789",ticketLink="https://discord.com/channels/123456789012345678/345678901234567890/456789012345678901?jump=1";
const ended={
 _id:id,guildId,mode:"standard",title:"Thank-you giveaway",prize:"Neon pet",
 creatorId:"456789012345678901",status:"ended",winnerCount:1,
 endsAt:new Date("2026-11-08T12:00:00Z"),claimStartedAt:new Date("2026-11-08T12:00:00Z"),
 winnerAssignedAt:[new Date("2026-11-08T12:00:00Z")],claimWindowHours:12,
 entrantIds:[winner],winnerIds:[winner],maxAutoRerolls:2,autoRerollClaims:true,
 rerollHistory:[{slot:0,previousId:"567890123456789012",replacementId:winner,
   reason:"claim-expired",at:new Date("2026-11-08T12:00:00Z")}],
 requiredRoleId:"678901234567890123",requiredRoleInstructions:"Get it in #party",
 staffCardId:"789012345678901234",staffCardChannelId:"890123456789012345",
 winnerClaims:[],
};

test("all giveaway modes have an individual staff record, even before drawing",()=>{
 for(const mode of ["standard","activity","survival"]){
   const record={...ended,mode,status:"open",winnerIds:[],rerollHistory:[]};
   const privatePost=giveawayStaffRecordPayload(record);
   assert.match(privatePost.embeds[0].toJSON().description,/Status:\*\* Open/);
   assert.match(privatePost.embeds[0].toJSON().description,/Thank-you giveaway/);
   assert.equal(privatePost.embeds[0].toJSON().footer.text,staffRecordMarker(record));
   assert.ok(privatePost.components.flatMap(x=>x.components)
      .some(x=>x.data.custom_id==="giveawaystaff:cancel:"+id));
 }
});

test("unclaimed winner staff record shows deadline and remaining rerolls",()=>{
 const staff=giveawayStaffRecordPayload(ended);
 const description=staff.embeds[0].toJSON().description;
 assert.match(description,/Not claimed/);
 assert.match(description,/Automatic rerolls:\*\*|Automatic rerolls:\s+Enabled/);
 assert.match(description,/Claim deadline:/);
 assert.match(description,/Expired|<t:\d+:R>/);
 assert.match(description,/Reroll history/);
 const ids=staff.components.flatMap(r=>r.components).map(b=>b.data.custom_id);
 assert.ok(ids.includes("giveawaystaff:stop:"+id));
 assert.ok(ids.includes("giveawaystaff:cancel:"+id),"undelivered prizes may be cancelled");
 assert.ok(!ids.includes("giveawaystaff:remove:"+id), "unclaimed winner still has rerolls remaining");
});

test("claim number, exact message link and submission time are private",()=>{
 const claimed={...ended,winnerClaims:[{slot:0,userId:winner,ticketNumber:"123-ABC",
   ticketUrl:ticketLink,submittedAt:new Date("2026-11-08T13:45:00Z")}]};
 const staff=giveawayStaffRecordPayload(claimed);
 const fields=staff.embeds[0].toJSON().fields;
 assert.ok(fields.some(f=>f.value.includes(ticketLink)));
 assert.ok(fields.some(f=>f.value.includes("123-ABC")));
 assert.match(staff.embeds[0].toJSON().description,/Claim submitted/);
 assert.match(fields.map(f=>f.value).join('\n'),/Submitted:\*\* <t:\d+:F>/i);
 const publicPost=giveawayAnnouncement(claimed).embeds[0].toJSON();
 const publicText=publicPost.description+JSON.stringify(publicPost.fields||[]);
 assert.match(publicText,/Claim submitted successfully/);
 assert.doesNotMatch(publicText,/123-ABC|jump=1|How to get the role|Get it in #party|Required to enter/);
});

test("staff cancellation archive retains staff identity and reason without controls",()=>{
 const cancelled={...ended,status:"cancelled",staffCancelledBy:"999999999999999999",
   staffCancelledAt:new Date("2026-11-09T02:00:00Z"),staffCancelReason:"Host cannot deliver prize",
   autoRerollClaims:false};
 const staff=giveawayStaffRecordPayload(cancelled);
 const body=staff.embeds[0].toJSON().description;
 assert.match(body,/CANCELLED AND REMOVED/);
 assert.match(body,/<@999999999999999999>/);
 assert.match(body,/Host cannot deliver prize/);
 assert.match(body,/<t:\d+:F>/);
 assert.deepEqual(staff.components.flatMap(r=>r.components).map(b=>b.data.custom_id),
   ["giveawaystaff:entrants:"+id+":0","giveawaystaff:remove:"+id],"cancelled records can be moved to the configured archive");
});

test("cancel and delete requires a written reason and confirmation",async()=>{
 const previous=Giveaway.findOne;
 let modal;
 try{
  Giveaway.findOne=()=>({lean:async()=>({...ended,status:"open",winnerIds:[]})});
  await handleGiveawayStaffAction({
    guildId,channelId:ended.staffCardChannelId,
    customId:"giveawaystaff:cancel:"+id,
    message:{id:ended.staffCardId},
    memberPermissions:{has:()=>true},
    showModal:async m=>{modal=m.toJSON();}
  });
  assert.equal(modal.components.length,2);
  assert.equal(modal.components[0].components[0].custom_id,"reason");
  assert.equal(modal.components[0].components[0].required,true);
  assert.equal(modal.components[1].components[0].custom_id,"confirm");
 }finally{Giveaway.findOne=previous;}
});


test("cancelling a live giveaway archives the reason and removes only its public post",async()=>{
 const GuildConfig=(await import("../models/GuildConfig.js")).default;
 const original={
   find:Giveaway.findOne,update:Giveaway.findOneAndUpdate,updateOne:Giveaway.updateOne,
   config:GuildConfig.findOne,
 };
 let stored={...ended,status:"open",channelId:"101234567890123456",messageId:"112345678901234567",
   listChannelId:"",listMessageId:""};
 const updated=[],removed=[],staffEdits=[];
 const staffMessage={id:stored.staffCardId,author:{id:"bot"},
   embeds:[{description:"old staff card",footer:{text:"old"}}],
   components:[],edit:async p=>staffEdits.push(p)};
 const publicMessage={author:{id:"bot"},delete:async()=>removed.push("public")};
 const staffChannel={
   id:stored.staffCardChannelId,guild:{roles:{everyone:{id:"everyone"}}},
   permissionsFor:()=>({has:()=>false}),
   send:async()=>{throw Error("Should reuse existing private staff record");},
   messages:{fetch:async id=>id===staffMessage.id?staffMessage:[]},
 };
 const publicChannel={messages:{fetch:async()=>publicMessage}};
 const client={user:{id:"bot"},channels:{fetch:async id=>
   id===staffChannel.id?staffChannel:publicChannel}};
 const replies=[];
 try{
   Giveaway.findOne=()=>({lean:async()=>stored});
   Giveaway.findOneAndUpdate=(_q,update)=>({lean:async()=>{
     stored={...stored,...update.$set};updated.push(update.$set);return stored;
   }});
   Giveaway.updateOne=async(_q,update)=>{updated.push(update.$set);};
   GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
     activityGiveawayReviewChannelId:staffChannel.id
   })})});
   await handleGiveawayStaffAction({
     client,guildId,channelId:staffChannel.id,customId:"giveawaystaff:confirmcancel:"+id,
     user:{id:"999999999999999999"},
     memberPermissions:{has:()=>true},
     fields:{getTextInputValue:key=>key==="reason"?"Prize delivery unavailable":"CANCEL"},
     deferReply:async()=>{},editReply:async message=>{replies.push(message);}
   });
   assert.equal(stored.status,"cancelled");
   assert.equal(stored.staffCancelledBy,"999999999999999999");
   assert.equal(stored.staffCancelReason,"Prize delivery unavailable");
   assert.ok(stored.staffCancelledAt instanceof Date);
   assert.equal(stored.autoRerollClaims,false);
   assert.deepEqual(removed,["public"]);
   assert.match(staffEdits[0].embeds[0].data.description,/Prize delivery unavailable/);
   assert.equal(staffMessage.id,ended.staffCardId);
   assert.match(replies[0],/cancelled and removed/i);
   assert.ok(updated.some(x=>x.messageId===null),"record keeps audit but clears deleted public message");
 }finally{
   Giveaway.findOne=original.find;
   Giveaway.findOneAndUpdate=original.update;
   Giveaway.updateOne=original.updateOne;
   GuildConfig.findOne=original.config;
 }
});

test("claim completion enables delivery confirmation, and only delivery enables archive",()=>{
 const claim={slot:0,userId:winner,ticketNumber:"123-ABC",ticketUrl:ticketLink,
   submittedAt:new Date("2026-11-08T13:45:00Z")};
 const record={...ended,winnerClaims:[claim]};
 const controls=giveawayStaffRecordPayload(record).components.flatMap(row=>row.components);
 assert.ok(controls.some(button=>button.data.custom_id==="giveawaystaff:deliver:"+id &&
   button.data.label==="Confirm Prizes Delivered"));
 assert.ok(!controls.some(button=>button.data.custom_id==="giveawaystaff:remove:"+id));
 const after=giveawayStaffRecordPayload({...record,prizeDeliveredAt:new Date(),
   prizeDeliveredBy:record.creatorId}).components.flatMap(row=>row.components);
 assert.ok(after.some(button=>button.data.custom_id==="giveawaystaff:remove:"+id &&
   button.data.label==="Archive Giveaway"));
});

test("archived staff records stay read-only and retain prize claim details",()=>{
 const claim={slot:0,userId:winner,ticketNumber:"123-ABC",ticketUrl:ticketLink,
   submittedAt:new Date("2026-11-08T13:45:00Z")};
 const record={...ended,publicListingRemovedAt:new Date("2026-11-11T12:00:00Z"),
   publicListingRemovedBy:"999999999999999999",winnerClaims:[claim],guidedSeries:id};
 const archived=giveawayStaffRecordPayload(record,{archived:true});
 const ids=archived.components.flatMap(row=>row.components).map(button=>button.data.custom_id);
 assert.deepEqual(ids,["giveawaystaff:entrants:"+id+":0"]);
 assert.match(archived.embeds[0].toJSON().description,/COMPLETED — PUBLIC LISTING DELETED/);
 assert.ok(archived.embeds[0].toJSON().fields.some(field=>field.value.includes(ticketLink)));
 const unmoved=giveawayStaffRecordPayload(record,{archived:false});
 assert.ok(unmoved.components.flatMap(row=>row.components)
   .some(button=>button.data.custom_id==="giveawaystaff:remove:"+id));
});


test("archived staff card backfills missing archive completion marker for the directory",async()=>{
 const GuildConfig=(await import("../models/GuildConfig.js")).default;
 const old={config:GuildConfig.findOne,update:Giveaway.updateOne};
 const archiveId="901234567890123456",staffId="890123456789012345",archiveMessageId="912345678901234567";
 const record={...ended,
   publicListingRemovedAt:new Date("2026-11-12T12:00:00Z"),
   staffCardChannelId:archiveId,staffCardId:archiveMessageId,
   archiveMovedAt:null,prizeDeliveredAt:new Date(),
   winnerClaims:[{slot:0,userId:winner,ticketNumber:"ABC",ticketUrl:ticketLink}],
 };
 const saved=[],edits=[];
 const archivedMessage={
   id:archiveMessageId,author:{id:"bot"},embeds:[],components:[],
   edit:async payload=>edits.push(payload),
 };
 const privateChannel={
   guild:{roles:{everyone:{id:"everyone"}}},
   permissionsFor:()=>({has:()=>false}),
   messages:{fetch:async value=>typeof value==="string"?archivedMessage:[]},
 };
 const staffChannel={messages:{fetch:async()=>new Map()}};
 const client={user:{id:"bot"},channels:{fetch:async id=>
   id===archiveId?privateChannel:id===staffId?staffChannel:null}};
 try{
   GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
     giveawayArchiveChannelId:archiveId,activityGiveawayReviewChannelId:staffId,
   })})});
   Giveaway.updateOne=async(query,update)=>{
     saved.push({query,update});return {matchedCount:1,modifiedCount:1};
   };
   assert.equal(await ensureGiveawayStaffRecord(client,record),true);
   const moved=saved.find(x=>x.update.$set.archiveMovedAt);
   assert.ok(moved,"an already archived staff message must repair the missing completion marker");
   assert.equal(moved.query.staffCardChannelId,archiveId);
   assert.equal(moved.query.staffCardId,archiveMessageId);
   assert.deepEqual(moved.query.archiveMovedAt,{$in:[null]});
   assert.equal(edits.length,1,"existing archive message is reused, not copied a second time");
   assert.equal(await ensureGiveawayStaffRecord(client,{...record,archiveMovedAt:new Date()}),true);
   assert.equal(saved.filter(x=>x.update.$set.archiveMovedAt).length,1,
     "a saved archive completion timestamp is not replaced during reconciliation");
 }finally{
   GuildConfig.findOne=old.config;
   Giveaway.updateOne=old.update;
 }
});

test("staff archive is not marked complete when the linked private review remains unmoved",async()=>{
 const GuildConfig=(await import("../models/GuildConfig.js")).default;
 const old={config:GuildConfig.findOne,update:Giveaway.updateOne};
 const archiveId="901234567890123456",staffId="890123456789012345",archiveMessageId="912345678901234567";
 const record={...ended,
   publicListingRemovedAt:new Date("2026-11-12T12:00:00Z"),
   staffCardChannelId:archiveId,staffCardId:archiveMessageId,
   reviewChannelId:staffId,reviewMessageId:"923456789012345678",
   archiveMovedAt:null,
 };
 const saved=[];
 const archivedMessage={id:archiveMessageId,author:{id:"bot"},embeds:[],components:[],
   edit:async()=>{}};
 const archiveChannel={guild:{roles:{everyone:{id:"everyone"}}},
   permissionsFor:()=>({has:()=>false}),
   messages:{fetch:async value=>typeof value==="string"?archivedMessage:[]}};
 const staffChannel={messages:{fetch:async()=>new Map()}};
 const client={user:{id:"bot"},channels:{fetch:async id=>
   id===archiveId?archiveChannel:id===staffId?staffChannel:null}};
 try{
   GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
     giveawayArchiveChannelId:archiveId,activityGiveawayReviewChannelId:staffId,
   })})});
   Giveaway.updateOne=async(_query,update)=>{saved.push(update);return {matchedCount:1};};
   assert.equal(await ensureGiveawayStaffRecord(client,record),true);
   assert.equal(saved.some(x=>x.$set.archiveMovedAt),false,
     "keep the directory entry until a referenced staff review is preserved");
 }finally{
   GuildConfig.findOne=old.config;
   Giveaway.updateOne=old.update;
 }
});
