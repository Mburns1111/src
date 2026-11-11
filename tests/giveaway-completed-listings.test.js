import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import { completedGiveawayCanDeleteListing } from "../services/giveaway-listing-lifecycle.js";
import { giveawayStaffRecordPayload, handleGiveawayStaffAction, removeGiveawayPublicPosts } from "../services/giveaway-staff-records.js";

const id="507f1f77bcf86cd799439011";
const guildId="123456789012345678";
const winnerA="234567890123456789";
const winnerB="345678901234567890";
const staffId="456789012345678901";
const started=new Date("2026-11-09T10:00:00Z");
const beforeDeadline=new Date("2026-11-09T10:59:59Z");
const afterDeadline=new Date("2026-11-09T11:00:01Z");
const ticket=(slot,userId)=>({slot,userId,submittedAt:new Date("2026-11-09T10:25:00Z"),
  ticketNumber:"CASE-42",ticketUrl:"https://discord.com/channels/123456789012345678/456789012345678901/567890123456789012"});
function record(overrides={}) {
  return {
    _id:id,guildId,status:"ended",mode:"standard",title:"Finalized giveaway",
    prize:"Example prize",creatorId:winnerA,endsAt:started,claimStartedAt:started,
    winnerAssignedAt:[started,started],claimWindowHours:1,
    winnerIds:[winnerA],entrantIds:[winnerA,winnerB],
    winnerClaims:[],claimResolvedSlots:[],rerollHistory:[],
    maxAutoRerolls:2,autoRerollClaims:true,
    publicListingRemovedAt:null,publicListingRemovedBy:"",
    staffCardId:"678901234567890123",staffCardChannelId:staffId,
    messageId:"789012345678901234",channelId:"890123456789012345",
    renderVersion:0,...overrides,
  };
}
const buttons=rec=>giveawayStaffRecordPayload(rec).components.flatMap(row=>
  row.components.map(b=>b.data.custom_id));

test("Delete Listing is available immediately when a completed giveaway selected nobody",()=>{
  const rec=record({winnerIds:[]});
  assert.equal(completedGiveawayCanDeleteListing(rec),true);
  assert.ok(buttons(rec).includes("giveawaystaff:remove:"+id));
  assert.ok(!buttons(rec).includes("giveawaystaff:cancel:"+id));
});

test("the current winning member must submit a complete ticket claim",()=>{
  const full=record({winnerClaims:[ticket(0,winnerA)]});
  assert.equal(completedGiveawayCanDeleteListing(full),true);
  assert.ok(buttons(full).includes("giveawaystaff:remove:"+id));
  assert.ok(!buttons(full).includes("giveawaystaff:cancel:"+id));
  assert.equal(completedGiveawayCanDeleteListing(record({
    winnerClaims:[ticket(0,winnerB)] // Former winner's claim is not the current winner's claim
  })),false);
  assert.equal(completedGiveawayCanDeleteListing(record({
    winnerClaims:[{...ticket(0,winnerA),ticketUrl:""}]
  })),false);
});

test("no rerolls left permits deletion only after that winner's claim deadline",()=>{
  const exhausted=record({
    rerollHistory:[
      {slot:0,reason:"claim-expired",previousId:winnerB,replacementId:winnerA},
      {slot:0,reason:"claim-expired",previousId:"567890123456789012",replacementId:winnerB},
    ],
  });
  assert.equal(completedGiveawayCanDeleteListing(exhausted,{now:beforeDeadline}),false);
  assert.equal(completedGiveawayCanDeleteListing(exhausted,{now:afterDeadline}),true);
  assert.ok(buttons(exhausted).includes("giveawaystaff:remove:"+id));
  assert.equal(completedGiveawayCanDeleteListing(record({
    rerollHistory:[{slot:0,reason:"claim-expired"}]
  }),{now:afterDeadline}),false);
  assert.equal(completedGiveawayCanDeleteListing(record({maxAutoRerolls:0}),{now:beforeDeadline}),false);
  assert.equal(completedGiveawayCanDeleteListing(record({maxAutoRerolls:0}),{now:afterDeadline}),true);
});

test("no eligible replacement may be recorded as a resolved prize place",()=>{
  const noCandidates=record({claimResolvedSlots:[0],maxAutoRerolls:5});
  assert.equal(completedGiveawayCanDeleteListing(noCandidates,{now:beforeDeadline}),false);
  assert.equal(completedGiveawayCanDeleteListing(noCandidates,{now:afterDeadline}),true);
});

test("all prize places must be claimed or past deadline with no replacements left",()=>{
  const multi=record({winnerIds:[winnerA,winnerB],winnerClaims:[ticket(0,winnerA)],
    claimResolvedSlots:[1]});
  assert.equal(completedGiveawayCanDeleteListing(multi,{now:beforeDeadline}),false);
  assert.equal(completedGiveawayCanDeleteListing(multi,{now:afterDeadline}),true);
  assert.equal(completedGiveawayCanDeleteListing({...multi,claimResolvedSlots:[]},{now:afterDeadline}),false);
});

test("live and unsettled events cannot archive; cancelled and removed records can move",()=>{
  for(const rec of [
    record({status:"open",winnerIds:[]}),
     record({claimWindowHours:null,claimResolvedSlots:[0]}),
  ]) {
    assert.equal(completedGiveawayCanDeleteListing(rec,{now:afterDeadline}),false);
    assert.ok(!buttons(rec).includes("giveawaystaff:remove:"+id));
  }
  for(const archived of [record({status:"cancelled",winnerIds:[]}),record({publicListingRemovedAt:new Date(),winnerClaims:[ticket(0,winnerA)]})]) {
    assert.equal(completedGiveawayCanDeleteListing(archived),false);
    assert.ok(buttons(archived).includes("giveawaystaff:remove:"+id));
    assert.ok(!giveawayStaffRecordPayload(archived,{archived:true}).components.flatMap(row=>row.components).some(button=>button.data.custom_id==="giveawaystaff:remove:"+id));
  }
  const legacyTrial=record({mode:"survival",trialTicketClaimsEnabled:false,winnerClaims:[ticket(0,winnerA)]});
  assert.equal(completedGiveawayCanDeleteListing(legacyTrial,{now:afterDeadline}),true);
  assert.ok(buttons(legacyTrial).includes("giveawaystaff:remove:"+id));
  assert.ok(buttons(record({status:"open"})).includes("giveawaystaff:cancel:"+id));
  assert.ok(!buttons(record({status:"ended"})).includes("giveawaystaff:cancel:"+id));
});

test("Archive Giveaway preserves claims, removes the public listing and moves the staff record",async()=>{
  let stored=record({winnerClaims:[ticket(0,winnerA)]});
  const archiveId="901234567890123456";
  const archivedId="912345678901234567";
  const old={one:Giveaway.findOne,change:Giveaway.findOneAndUpdate,
    update:Giveaway.updateOne,config:GuildConfig.findOne};
  const deleted=[],responses=[],archivePosts=[],updates=[];
  const originalStaffPost={id:stored.staffCardId,author:{id:"bot"},
    delete:async()=>deleted.push("old staff")};
  const staffChannel={id:staffId,messages:{fetch:async()=>originalStaffPost},
    permissionsFor:()=>({has:()=>false})};
  const archiveChannel={
    id:archiveId,guild:{roles:{everyone:{id:"everyone"}}},
    permissionsFor:()=>({has:()=>false}),
    messages:{fetch:async()=>new Map()},
    send:async payload=>{archivePosts.push(payload);return {id:archivedId,author:{id:"bot"}};},
  };
  const publicChannel={messages:{fetch:async()=>({
    author:{id:"bot"},delete:async()=>deleted.push("public")
  })}};
  const client={user:{id:"bot"},channels:{fetch:async channelId=>
    channelId===staffId?staffChannel:channelId===archiveId?archiveChannel:publicChannel}};
  let modal;
  try{
    Giveaway.findOne=()=>({lean:async()=>stored});
    Giveaway.findOneAndUpdate=(query,change)=>({lean:async()=>{
      assert.equal(query.status,"ended");
      assert.equal(query.publicListingRemovedAt,null);
      stored={...stored,...change.$set,renderVersion:stored.renderVersion+1};
      return stored;
    }});
    Giveaway.updateOne=async (query,change)=>{
      updates.push({query,change});
      stored={...stored,...change.$set};
    };
    GuildConfig.findOne=()=>({select:()=>({lean:async()=>({
      activityGiveawayReviewChannelId:staffId,giveawayArchiveChannelId:archiveId
    })})});
    const memberPermissions={has:()=>true};
    await handleGiveawayStaffAction({
      guildId,channelId:staffId,customId:"giveawaystaff:remove:"+id,
      message:{id:stored.staffCardId},memberPermissions,
      showModal:async m=>{modal=m.toJSON()},
      reply:async error=>{throw Error("Unexpected archive error: "+JSON.stringify(error));}
    });
    assert.equal(modal.title,"Archive completed giveaway");
    assert.equal(modal.components.length,1);
    await handleGiveawayStaffAction({
      client,guildId,channelId:staffId,customId:"giveawaystaff:confirmremove:"+id,
      user:{id:"999999999999999999"},memberPermissions,
      fields:{getTextInputValue:()=> "ARCHIVE"},
      deferReply:async()=>{},editReply:async x=>responses.push(x),
      reply:async error=>{throw Error("Unexpected confirmation error: "+JSON.stringify(error));},
    });
    assert.equal(stored.status,"ended","archiving must not mark a completed giveaway cancelled");
    assert.equal(stored.publicListingRemovedBy,"999999999999999999");
    assert.ok(stored.publicListingRemovedAt instanceof Date);
    assert.equal(stored.winnerClaims.length,1);
    assert.deepEqual(deleted,["public","old staff"]);
    assert.equal(stored.messageId,null);
    assert.equal(stored.staffCardId,archivedId);
    assert.equal(stored.staffCardChannelId,archiveId);
    assert.equal(archivePosts.length,1);
    assert.match(archivePosts[0].embeds[0].data.description,/COMPLETED — PUBLIC LISTING DELETED/);
    assert.match(responses.at(-1),/archived in/);
    assert.ok(updates.every(x=>!Object.hasOwn(x.change.$set||{},"status")));
  }finally{
    Giveaway.findOne=old.one;
    Giveaway.findOneAndUpdate=old.change;
    Giveaway.updateOne=old.update;
    GuildConfig.findOne=old.config;
  }
});

test("completed activity Delete Listing removes only the activity-list post, preserving winner results",async()=>{
  const old=Giveaway.updateOne;
  const deleted=[],cleared=[];
  const item=record({mode:"activity",publicListingRemovedAt:new Date(),
    listChannelId:"123456789012345678",listMessageId:"234567890123456789",
    channelId:"345678901234567890",messageId:"456789012345678901"});
  try {
    Giveaway.updateOne=async (_query,update)=>cleared.push(update.$set);
    const client={user:{id:"bot"},channels:{fetch:async channelId=>{
      if(channelId!==item.listChannelId)throw Error("Winner result channel must not be accessed.");
      return {messages:{fetch:async()=>({author:{id:"bot"},delete:async()=>deleted.push("list")})}};
    }}};
    await removeGiveawayPublicPosts(client,item);
    assert.deepEqual(deleted,["list"]);
    assert.deepEqual(cleared,[{listChannelId:"",listMessageId:"",listFingerprint:""}]);
    assert.equal(item.status,"ended");
  }finally{Giveaway.updateOne=old;}
});

test("completed Trial Delete Listing removes the signup listing but preserves its Royal Verdict",async()=>{
  const old=Giveaway.updateOne;
  const deleted=[],cleared=[];
  const item=record({mode:"survival",trialTicketClaimsEnabled:true,
    publicListingRemovedAt:new Date(),finaleMessageId:"567890123456789012"});
  try {
    Giveaway.updateOne=async (_query,update)=>cleared.push(update.$set);
    const client={user:{id:"bot"},channels:{fetch:async()=>({
      messages:{fetch:async mid=>{
        if(mid===item.finaleMessageId)throw Error("Final verdict should remain published.");
        return {author:{id:"bot"},delete:async()=>deleted.push(mid)};
      }}
    })}};
    await removeGiveawayPublicPosts(client,item);
    assert.deepEqual(deleted,[item.messageId]);
    assert.equal(cleared[0].messageId,null);
    assert.equal(Object.hasOwn(cleared[0],"finaleMessageId"),false);
    assert.equal(item.status,"ended");
  }finally{Giveaway.updateOne=old;}
});

test("completed standard Delete Listing removes the original public giveaway post",async()=>{
  const old=Giveaway.updateOne;
  const deleted=[],cleared=[];
  const item=record({publicListingRemovedAt:new Date()});
  try {
    Giveaway.updateOne=async (_query,update)=>cleared.push(update.$set);
    const client={user:{id:"bot"},channels:{fetch:async()=>({
      messages:{fetch:async()=>({author:{id:"bot"},delete:async()=>deleted.push("standard")})}
    })}};
    await removeGiveawayPublicPosts(client,item);
    assert.deepEqual(deleted,["standard"]);
    assert.equal(cleared[0].messageId,null);
    assert.equal(item.status,"ended");
  }finally{Giveaway.updateOne=old;}
});
