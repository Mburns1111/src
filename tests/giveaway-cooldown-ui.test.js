import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GiveawayWinnerCooldown from "../models/GiveawayWinnerCooldown.js";
import {handleGiveawayCooldownAction} from "../services/giveaway-cooldown-ui.js";
import {handleGiveawayCooldownDirectoryAction} from "../services/giveaway-cooldown-directory.js";
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
  deferUpdate:async()=>{responses.deferred=true;},
  ...extra,
 };
 // The staff directory button is permanent; subsequent cooldown picker
 // messages are ephemeral and may safely be updated in place.
 if(i.customId.startsWith("giveawaydir:")&&i.customId!=="giveawaydir:cooldowns"&&!i.message)
   i.message={flags:{has:()=>true}};
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
  assert.match(modal.custom_id,/giveawaystaff:cooldowndays:.+:01:p$/);
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
  patch(Giveaway,"updateMany",async(query,update)=>{
   events.push({kind:"entry-prune",query,update});return {modifiedCount:1};
  },backups);
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
  const pruned=events.find(e=>e.kind==="entry-prune");
  assert.equal(pruned.query.mode,"standard");
  assert.equal(pruned.query.winnerCooldownEnabled,true);
  assert.deepEqual(pruned.update.$pull.entrantIds.$in,[a,b]);
  assert.equal(refresh.cooldownAssignments.length,2);
  assert.equal(done.responses.deferred,true);
  assert.match(done.responses.edit.content,/cooldown saved/i);
  assert.deepEqual(done.responses.edit.components,[],"confirmed cooldown buttons must be retired");
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
  assert.equal(member.responses.update.components[0].components[0].toJSON().label,"Correct Expiry");
  const edit=makeAction({customId:"giveawaydir:cooldownedit:"+a});
  await handleGiveawayCooldownDirectoryAction(edit.i);
  assert.match(edit.responses.modal.toJSON().title,/Correct Cooldown/);
  const input=makeAction({customId:"giveawaydir:cooldowneditdays:"+a,
   fields:{getTextInputValue:()=> "3"}});
  await handleGiveawayCooldownDirectoryAction(input.i);
  assert.match(input.responses.update.content,/Confirm staff correction/);
  assert.equal(input.responses.update.flags,undefined,"updates must not change ephemeral message flags");
  const apply=makeAction({customId:"giveawaydir:cooldownconfirmedit:"+a+":3"});
  await handleGiveawayCooldownDirectoryAction(apply.i);
  assert.equal(corrected.$push.history.action,"adjust");
  assert.equal(apply.responses.edit.components.length,0);
  const remove=makeAction({customId:"giveawaydir:cooldownconfirmremove:"+a});
  await handleGiveawayCooldownDirectoryAction(remove.i);
  assert.equal(removed.$push.history.action,"remove");
  assert.equal(remove.responses.edit.components.length,0);
 }finally{restore(backups);}
});

test("member without cooldown offers Add Cooldown; modal review and confirm save an audited staff assignment",async()=>{
 const backups=[];let manual,prune;
 try{
  patch(GiveawayWinnerCooldown,"findOne",()=>({lean:async()=>manual||null}),backups);
  patch(GiveawayWinnerCooldown,"findOneAndUpdate",(query,change,options)=>({lean:async()=>{
   assert.equal(query.guildId,guildId);
   assert.equal(query.userId,a);
   assert.equal(options.upsert,true);
   assert.equal(change.$set.sourceGiveawayId,"staff-manual");
   assert.equal(change.$push.history.action,"apply");
   assert.equal(change.$push.history.sourceGiveawayId,"staff-manual");
   manual={userId:a,expiresAt:change.$max.expiresAt};
   return manual;
  }}),backups);
  patch(Giveaway,"updateMany",(query,update)=>{
   prune={query,update};return Promise.resolve({modifiedCount:1});
  },backups);
  const selected=makeAction({customId:"giveawaydir:cooldownmember",values:[a]});
  await handleGiveawayCooldownDirectoryAction(selected.i);
  assert.equal(selected.responses.update.components[0].components[0].toJSON().label,"Add Cooldown");
  const open=makeAction({customId:"giveawaydir:cooldownadd:"+a});
  await handleGiveawayCooldownDirectoryAction(open.i);
  assert.match(open.responses.modal.toJSON().title,/Add Winner Cooldown/);
  const submit=makeAction({customId:"giveawaydir:cooldownadddays:"+a,
   fields:{getTextInputValue:()=> "3"}});
  await handleGiveawayCooldownDirectoryAction(submit.i);
  assert.match(submit.responses.update.content,/Confirm new winner cooldown/);
  assert.equal(submit.responses.update.flags,undefined,"modal response updates cannot include reply flags");
  const confirm=makeAction({customId:"giveawaydir:cooldownconfirmadd:"+a+":3"});
  await handleGiveawayCooldownDirectoryAction(confirm.i);
  assert.equal(confirm.responses.deferred,true);
  assert.match(confirm.responses.edit.content,/New winner cooldown saved/);
  assert.equal(confirm.responses.edit.components.length,0);
  assert.equal(prune.query.mode,"standard");
  assert.equal(prune.query.winnerCooldownEnabled,true);
  assert.deepEqual(prune.update.$pull.entrantIds.$in,[a]);
  const repeat=makeAction({customId:"giveawaydir:cooldownmember",values:[a]});
  await handleGiveawayCooldownDirectoryAction(repeat.i);
  assert.equal(repeat.responses.update.components[0].components[0].toJSON().label,"Correct Expiry");
 }finally{restore(backups);}
});

test("multi-winner cooldown confirmation replaces the previous private selector",async()=>{
 const backups=[];
 try{
  patch(GiveawayWinnerCooldown,"find",()=>({lean:async()=>[]}),backups);
  const form=makeAction({fields:{getTextInputValue:()=> "7"}});
  await handleGiveawayCooldownAction(form.i,giveaway,"cooldowndays","01","p");
  assert.equal(form.responses.reply,null);
  assert.match(form.responses.update.content,/Confirm Giveaway Winner Cooldown/);
  assert.match(customId(form.responses.update),/cooldownapply:.+:01:7$/);
 }finally{restore(backups);}
});

test("Apply / Extend advances an existing ephemeral cooldown panel instead of stacking a new dropdown",async()=>{
 const backups=[];
 try{
  patch(GiveawayWinnerCooldown,"find",()=>({lean:async()=>[]}),backups);
  const action=makeAction({message:{flags:{has:()=>true}}});
  await handleGiveawayCooldownAction(action.i,giveaway,"cooldowncreate");
  assert.equal(action.responses.reply,null,"existing private panel should not spawn another message");
  assert.ok(action.responses.update.components.length);
  assert.equal(action.responses.update.components[0].components[0].toJSON().custom_id,
    "giveawaystaff:cooldownselect:"+giveawayId);
 }finally{restore(backups);}
});

test("cooldown manager opened from a permanent public/staff directory never edits that message",async()=>{
 const backups=[];
 try{
  patch(GiveawayWinnerCooldown,"findOne",()=>({lean:async()=>null}),backups);
  const publicAction=makeAction({
   customId:"giveawaydir:cooldownmember",values:[a],
   message:{flags:{has:()=>false}},
  });
  await handleGiveawayCooldownDirectoryAction(publicAction.i);
  assert.equal(publicAction.responses.update,null,"permanent directory cannot be updated");
  assert.equal(publicAction.responses.reply.flags,64);
  assert.match(publicAction.responses.reply.content,/no active winner cooldown/);
 }finally{restore(backups);}
});

test("empty cooldown picker retires old ephemeral selector instead of leaving it clickable",async()=>{
 const backups=[];
 try{
  patch(GiveawayWinnerCooldown,"find",()=>({lean:async()=>[]}),backups);
  // A delivered giveaway can have winners but none with an active cooldown.
  const action=makeAction({message:{flags:{has:()=>true}}});
  await handleGiveawayCooldownAction(action.i,giveaway,"cooldownremove");
  assert.equal(action.responses.reply,null);
  assert.deepEqual(action.responses.update.components,[]);
 }finally{restore(backups);}
});
