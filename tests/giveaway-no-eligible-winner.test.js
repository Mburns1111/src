import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import {closeGiveaway,publishGiveawayResult,giveawayAnnouncement} from "../services/giveaways.js";
import {reconcileGiveawayClaims} from "../services/giveaway-auto-claims.js";
import {giveawayStaffRecordPayload} from "../services/giveaway-staff-records.js";
import {completedGiveawayCanDeleteListing} from "../services/giveaway-listing-lifecycle.js";

const id="507f1f77bcf86cd799439010";
const guildId="123456789012345678";
const entrant="234567890123456789";
const other="345678901234567890";
const start=new Date("2026-11-09T09:00:00Z");
const end=new Date("2026-11-09T10:00:00Z");
const now=new Date("2026-11-09T10:01:00Z");
const base=overrides=>({
  _id:id,guildId,mode:"standard",status:"ended",channelId:"456789012345678901",
  messageId:"567890123456789012",creatorId:"678901234567890123",
  title:"No winner regression",prize:"Test pet",entrantIds:[entrant],
  winnerIds:[entrant],winnerCount:1,claimStartedAt:start,winnerAssignedAt:[start],
  endsAt:start,claimWindowHours:1,autoRerollClaims:true,maxAutoRerolls:2,
  claimCheckAt:end,winnerClaims:[],claimResolvedSlots:[],rerollHistory:[],
  publicListingRemovedAt:null,renderVersion:1,renderedAt:null,
  bannerNameKey:"",...overrides,
});
function patch(stubs,object,key,replacement){
  stubs.push([object,key,object[key]]);
  object[key]=replacement;
}
function restore(stubs){
  for(const [object,key,previous] of stubs.reverse())object[key]=previous;
}
function mockPublic(clientEdits,deletions){
  const message={
    id:"567890123456789012",author:{id:"bot"},
    edit:async payload=>clientEdits.push(payload),
    delete:async()=>deletions.push("deleted"),
  };
  return {user:{id:"bot"},channels:{fetch:async()=>({
    messages:{fetch:async()=>message}
  })}};
}
function mockBannerAndStaffConfig(stubs){
  // The staff channel is optional for this isolated test. Keep the public
  // announcement refresh real, including the no-winner embed render path.
  patch(stubs,GuildConfig,"findOne",()=>({
    then:(resolve,reject)=>Promise.resolve({giveawayDefaultBannerNameKey:""}).then(resolve,reject),
    select:()=>({lean:async()=>null})
  }));
}

test("zero-entry regular giveaway announces no winner and requires staff cancellation",async()=>{
  const stubs=[],edits=[],deletions=[],client=mockPublic(edits,deletions);
  let stored=base({status:"open",entrantIds:[],winnerIds:[],claimCheckAt:null});
  try{
    mockBannerAndStaffConfig(stubs);
    patch(stubs,Giveaway,"findOneAndUpdate",(query,change)=>({lean:async()=>{
      if(query.status!==stored.status)return null;
      stored={...stored,...change.$set,renderVersion:stored.renderVersion+
        (change.$inc?.renderVersion||0)};
      return {...stored};
    }}));
    patch(stubs,Giveaway,"updateOne",async(query,change)=>{
      stored={...stored,...(change.$set||{})};
      return {modifiedCount:1};
    });
    const result=await closeGiveaway({id,guildId,now});
    assert.equal(result.status,"ended");
    assert.deepEqual(result.winnerIds,[]);
    assert.equal(result.publicListingRemovedAt,null);
    assert.equal(result.messageId,base({}).messageId);
    assert.equal(await publishGiveawayResult(client,result),true);
    assert.equal(edits.length,1);
    assert.equal(deletions.length,0);
    const embed=edits[0].embeds[0].toJSON();
    assert.match(embed.title,/No Eligible Winner/i);
    assert.match(embed.description,/No eligible winner/i);
    assert.equal(edits[0].components.length,0);
    assert.equal(completedGiveawayCanDeleteListing(result),false);
    assert.match(giveawayStaffRecordPayload(result).embeds[0].toJSON().description,
      /No eligible winner/i);
    assert.ok(giveawayStaffRecordPayload(result).components.flatMap(r=>r.components)
      .some(b=>b.data.custom_id==="giveawaystaff:cancel:"+id));
  }finally{restore(stubs);}
});

test("one entrant misses claim: no second eligible member means No Eligible Winner without automatic deletion",async()=>{
  const stubs=[],edits=[],deletions=[],client=mockPublic(edits,deletions);
  let stored=base({});
  const saves=[];
  try{
    mockBannerAndStaffConfig(stubs);
    patch(stubs,Giveaway,"find",()=>({sort:()=>({limit:()=>({lean:async()=>[{...stored}]})})}));
    patch(stubs,Giveaway,"findById",()=>({lean:async()=>({...stored})}));
    patch(stubs,Giveaway,"updateOne",async(query,change)=>{
      saves.push({query,change});
      if(change.$addToSet?.claimResolvedSlots!=null)
        stored.claimResolvedSlots=[...new Set([...stored.claimResolvedSlots,change.$addToSet.claimResolvedSlots])];
      stored={...stored,...(change.$set||{}),
        renderVersion:stored.renderVersion+(change.$inc?.renderVersion||0)};
      return {modifiedCount:1};
    });
    assert.equal(await reconcileGiveawayClaims(client,{now}),1);
    assert.deepEqual(stored.claimResolvedSlots,[0],"claim is marked forfeited without spending fake rerolls");
    assert.equal(stored.status,"ended");
    assert.deepEqual(stored.winnerIds,[entrant],"winner history remains for audit");
    assert.deepEqual(stored.rerollHistory,[],"cannot reroll to an ineligible or duplicate user");
    assert.equal(stored.claimCheckAt,null,"settled giveaway stops being scheduled for claim checks");
    assert.equal(stored.publicListingRemovedAt,null);
    assert.equal(stored.messageId,base({}).messageId);
    assert.equal(edits.length,1);
    assert.deepEqual(deletions,[],"no automatic deletion");
    const rendered=edits[0];
    assert.match(rendered.embeds[0].toJSON().title,/No Eligible Winner/);
    assert.match(rendered.embeds[0].toJSON().description,/No eligible winner/);
    assert.match(rendered.embeds[0].toJSON().description,/no eligible replacement/i);
    assert.doesNotMatch(rendered.embeds[0].toJSON().description,/Ticket claim|Claim deadline|Reroll history|How to claim/i);
    assert.deepEqual(rendered.embeds[0].toJSON().fields||[],[]);
    assert.equal(rendered.components.length,0);
    assert.equal(completedGiveawayCanDeleteListing(stored,{now}),false);
    assert.ok(giveawayStaffRecordPayload(stored).components.flatMap(r=>r.components)
      .some(b=>b.data.custom_id==="giveawaystaff:cancel:"+id));
    assert.ok(saves.some(x=>x.change.$addToSet?.claimResolvedSlots===0));
  }finally{restore(stubs);}
});

test("one claimed winner and another forfeited place show one valid claim plus No Eligible Winner for the other place",()=>{
  const data=base({winnerCount:2,entrantIds:[entrant,other],winnerIds:[entrant,other],
    winnerClaims:[{slot:0,userId:entrant,ticketNumber:"T-1",
      ticketUrl:"https://discord.com/channels/123456789012345678/456789012345678901/567890123456789012",
      submittedAt:new Date("2026-11-09T09:15:00Z")}],
    claimResolvedSlots:[1]});
  const payload=giveawayAnnouncement(data);
  const embed=payload.embeds[0].toJSON();
  assert.match(embed.description,/Claim submitted successfully/);
  assert.match(embed.description,/No eligible winner/);
  assert.doesNotMatch(embed.title,/No Eligible Winner/,"one prize was validly claimed");
  assert.equal(payload.components.length,0);
  assert.equal((embed.fields||[]).length,0);
  assert.match(giveawayStaffRecordPayload(data).embeds[0].toJSON().description,/No eligible winner/i);
});
