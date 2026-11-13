import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GiveawayWinnerCooldown from "../models/GiveawayWinnerCooldown.js";
import {handleGiveawayCooldownAction} from "../services/giveaway-cooldown-ui.js";
import {handleGiveawayCooldownDirectoryAction} from "../services/giveaway-cooldown-directory.js";
import {handleGiveawayStaffAction,giveawayStaffRecordPayload} from "../services/giveaway-staff-records.js";
import GuildConfig from "../models/GuildConfig.js";
import {MessageFlags} from "discord.js";
const guildId="123456789012345678",staffId="234567890123456789",
 a="345678901234567890",b="456789012345678901",giveawayId="507f1f77bcf86cd799439011";
const deliveredAt=new Date(Date.now()-30*60_000);
const giveaway={
 _id:giveawayId,guildId,mode:"activity",status:"ended",prizeDeliveredAt:deliveredAt,
 winnerIds:[a,b],cooldownAssignments:[],title:"Weekly activity",prize:"Prize",
};
function makeAction(extra={}){
 const responses={reply:null,edit:null,modal:null,update:null,deferred:false};
 const i={
  guildId,user:{id:staffId},customId:"",values:[],
  fields:{getTextInputValue:()=>""},
  reply:async value=>{responses.reply=value;},
  editReply:async value=>{responses.edit=value;},
  showModal:async value=>{responses.modal=value;},
  update:async value=>{responses.update=value;},
  deferReply:async()=>{responses.deferred=true;},
  ...extra,
 };
 return {i,responses};
}
function customId(payload){
 return payload.components[0].components[0].toJSON().custom_id;
}
function patch(model,key,replacement,backups){backups.push([model,key,model[key]]);model[key]=replacement;}
function restore(backups){for(const [m,k,v] of backups.reverse())m[k]=v;}

test("cooldown staff flow selects one, several or all winners, asks days and shows private confirmation",async()=>{
 const backups=[];
 try{
  patch(GiveawayWinnerCooldown,"find",()=>({lean:async()=>[]}),backups);
  const initial=makeAction();
  await handleGiveawayCooldownAction(initial.i,giveaway,"cooldown");
  const select=initial.responses.reply.components[0].components[0].toJSON();
  assert.equal(select.max_values,2);
  assert.equal(select.options.length,2);
  assert.equal(select.options[0].value,"0");
  assert.equal(select.options[1].value,"1");
  const choice=makeAction({values:["0","1"]});
  await handleGiveawayCooldownAction(choice.i,giveaway,"cooldownselect");
  const modal=choice.responses.modal.toJSON();
  assert.match(modal.custom_id,/giveawaystaff:cooldowndays:.+:01$/);
  const form=makeAction({fields:{getTextInputValue:()=> "7"}});
  await handleGiveawayCooldownAction(form.i,giveaway,"cooldowndays","01");
  assert.match(form.responses.reply.content,/Confirm Giveaway Winner Cooldown/);
  assert.match(form.responses.reply.content,/prize delivery/i);
  assert.match(form.responses.reply.content,/7 days/);
  assert.match(customId(form.responses.reply),/cooldownapply:.+:01:7$/);
 }finally{restore(backups);}
});

test("cooldown confirmation writes both winners, audits the source giveaway and refreshes staff record",async()=>{
 const backups=[],events=[];let refresh;
 try{
  patch(Giveaway,"findOne",()=>({lean:async()=>({...giveaway})}),backups);
  patch(Giveaway,"findOneAndUpdate",(_query,update)=>({lean:async()=>{
   events.push({kind:"giveaway",update});
   return {...giveaway,cooldownAssignments:update.$push.cooldownAssignments.$each};
  }}),backups);
  patch(GiveawayWinnerCooldown,"findOneAndUpdate",(query,change,opts)=>({lean:async()=>{
   events.push({kind:"cooldown",query,change,opts});
   return {guildId,userId:query.userId,expiresAt:change.$max.expiresAt};
  }}),backups);
  const done=makeAction();
  await handleGiveawayCooldownAction(done.i,giveaway,"cooldownapply","01","7",{
   refresh:async updated=>{refresh=updated;},
  });
  assert.equal(events.filter(e=>e.kind==="cooldown").length,2);
  assert.ok(events.filter(e=>e.kind==="cooldown").every(e=>
   e.change.$push.history.action==="apply"&&e.change.$push.history.sourceGiveawayId===giveawayId));
  assert.equal(events.find(e=>e.kind==="giveaway").update.$push.cooldownAssignments.$each.length,2);
  assert.equal(refresh.cooldownAssignments.length,2);
  assert.equal(done.responses.deferred,true);
  assert.match(done.responses.edit.content,/cooldown saved/i);
 }finally{restore(backups);}
});

test("cooldown durations must be positive days and start at confirmed prize delivery",async()=>{
 const form=makeAction({fields:{getTextInputValue:()=> "0"}});
 await handleGiveawayCooldownAction(form.i,giveaway,"cooldowndays","0");
 assert.match(form.responses.reply.content,/1 to 365/);
 const trial=makeAction();
 await handleGiveawayCooldownAction(trial.i,{...giveaway,mode:"survival"},"cooldown");
 assert.match(trial.responses.reply.content,/Court's Trials do not use/);
 const prior=makeAction();
 await handleGiveawayCooldownAction(prior.i,{...giveaway,prizeDeliveredAt:null},"cooldown");
 assert.match(prior.responses.reply.content,/only after all prizes/);
});

test("staff-wide cooldown manager lists active members and supports expiry correction or removal",async()=>{
 const backups=[];let corrected,removed;
 try{
  const active={guildId,userId:a,expiresAt:new Date(Date.now()+7*86400000),
   sourceGiveawayId:giveawayId,appliedBy:staffId};
  patch(GiveawayWinnerCooldown,"find",()=>({
   sort:()=>({skip:()=>({limit:()=>({lean:async()=>[active]})})}),
  }),backups);
  patch(GiveawayWinnerCooldown,"findOne",()=>({lean:async()=>active}),backups);
  patch(GiveawayWinnerCooldown,"findOneAndUpdate",(filter,update)=>({lean:async()=>{
   if(update.$push.history.action==="adjust")corrected=update;
   if(update.$push.history.action==="remove")removed=update;
   return {...active,expiresAt:update.$set.expiresAt};
  }}),backups);
  const list=makeAction({customId:"giveawaydir:cooldowns"});
  await handleGiveawayCooldownDirectoryAction(list.i);
  assert.match(list.responses.reply.content,/Active Giveaway Winner Cooldowns/);
  assert.equal(list.responses.reply.components[0].components[0].toJSON().custom_id,"giveawaydir:cooldownmember");
  const member=makeAction({customId:"giveawaydir:cooldownmember",values:[a]});
  await handleGiveawayCooldownDirectoryAction(member.i);
  assert.equal(member.responses.reply.components[0].components[0].toJSON().label,"Correct Expiry");
  const edit=makeAction({customId:"giveawaydir:cooldownedit:"+a});
  await handleGiveawayCooldownDirectoryAction(edit.i);
  assert.match(edit.responses.modal.toJSON().title,/Correct Cooldown/);
  const input=makeAction({customId:"giveawaydir:cooldowneditdays:"+a,
   fields:{getTextInputValue:()=> "3"}});
  await handleGiveawayCooldownDirectoryAction(input.i);
  assert.match(input.responses.reply.content,/Confirm staff correction/);
  const apply=makeAction({customId:"giveawaydir:cooldownconfirmedit:"+a+":3"});
  await handleGiveawayCooldownDirectoryAction(apply.i);
  assert.equal(corrected.$push.history.action,"adjust");
  const remove=makeAction({customId:"giveawaydir:cooldownconfirmremove:"+a});
  await handleGiveawayCooldownDirectoryAction(remove.i);
  assert.equal(removed.$push.history.action,"remove");
 }finally{restore(backups);}
});


test("archived delivered giveaways still allow pending cooldown confirmation",async()=>{
 const backups=[],archived={
  ...giveaway,publicListingRemovedAt:new Date(),
  staffCardChannelId:"567890123456789012",staffCardId:"678901234567890123",
 };
 try{
  patch(Giveaway,"findOne",()=>({lean:async()=>({...archived})}),backups);
  patch(Giveaway,"findOneAndUpdate",(query,change)=>({lean:async()=>({
   ...archived,cooldownAssignments:change.$push.cooldownAssignments.$each,
  })}),backups);
  const applied=[];
  patch(GiveawayWinnerCooldown,"findOneAndUpdate",(query,change)=>({lean:async()=>{
   applied.push(query.userId);
   return {expiresAt:change.$max.expiresAt};
  }}),backups);
  const done=makeAction(),refreshes=[];
  await handleGiveawayCooldownAction(done.i,archived,"cooldownapply","01","7",{
   refresh:async updated=>refreshes.push(updated),
  });
  assert.deepEqual(applied,[a,b]);
  assert.match(done.responses.edit.content,/cooldown saved/i);
  assert.equal(refreshes.length,1);
  assert.deepEqual(refreshes[0].cooldownAssignments.map(x=>x.userId),[a,b]);
  const payload=giveawayStaffRecordPayload(archived,{archived:true});
  assert.ok(payload.components.flatMap(row=>row.components)
   .some(b=>b.data.custom_id==="giveawaystaff:cooldown:"+giveawayId),
   "private archived record provides a way to apply or manage cooldowns");
 }finally{restore(backups);}
});

test("a cooldown confirmation opened in the old staff channel succeeds after archiving",async()=>{
 const backups=[],archiveId="567890123456789012",archiveMessageId="678901234567890123";
 const archived={...giveaway,publicListingRemovedAt:new Date(),
  staffCardChannelId:archiveId,staffCardId:archiveMessageId,renderVersion:1};
 const edited=[],applied=[],queries=[];
 try{
  patch(Giveaway,"findOne",query=>{queries.push(query);
   return {lean:async()=>({...archived})};},backups);
  patch(Giveaway,"findOneAndUpdate",(query,change)=>({lean:async()=>({
   ...archived,cooldownAssignments:change.$push.cooldownAssignments.$each
  })}),backups);
  patch(GiveawayWinnerCooldown,"findOneAndUpdate",(query,change)=>({lean:async()=>{
   applied.push(query.userId);
   return {expiresAt:change.$max.expiresAt};
  }}),backups);
  patch(GuildConfig,"findOne",()=>({select:()=>({lean:async()=>({
   activityGiveawayReviewChannelId:"987654321098765432",
   giveawayArchiveChannelId:archiveId,
  })})}),backups);
  const archivedMessage={
   id:archiveMessageId,author:{id:"bot"},
   embeds:[{title:"Old archive",description:"Old archive",color:0,
    footer:{text:"Giveaway staff record · "+giveawayId},fields:[]}],
   components:[],edit:async payload=>edited.push(payload),
  };
  const client={
   user:{id:"bot"},channels:{fetch:async id=>({
    id,
    send:async()=>{throw Error("Archived record already exists");},
    messages:{fetch:async value=>
     typeof value==="string"?archivedMessage:{values:()=>[].values()}},
   })},
  };
  const action=makeAction({
   customId:"giveawaystaff:cooldownapply:"+giveawayId+":01:7",
   channelId:"987654321098765432",message:{
    id:"111111111111111111",flags:{has:flag=>flag===MessageFlags.Ephemeral},
    author:{id:"bot"},
   },
   memberPermissions:{has:()=>true},
   client,
  });
  await handleGiveawayStaffAction(action.i);
  assert.deepEqual(applied,[a,b]);
  assert.match(action.responses.edit.content,/cooldown saved/i);
  assert.equal(queries.every(q=>q.staffCardChannelId===undefined),true,
   "cooldown lookup must not require the old staff channel");
  assert.equal(edited.length,1,"archived staff post reflects the new cooldown assignments");
 }finally{restore(backups);}
});
