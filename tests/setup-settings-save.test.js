import test from "node:test";
import assert from "node:assert/strict";
import GuildConfig from "../models/GuildConfig.js";
import {setupChangedFields,saveGuidedSetupFields} from "../services/setup-settings-save.js";

const guildId="123456789012345678";

function withSavedConfig(initial,run){
 const old=GuildConfig.findOneAndUpdate;
 let state=initial?{guildId,...initial}:null;
 const writes=[];
 GuildConfig.findOneAndUpdate=async(filter,update,options)=>{
  writes.push({filter,update,options});
  if(state){
   for(const [field,expected] of Object.entries(filter)){
    if(field==="guildId")continue;
    if(expected!==null && state[field]!==expected)return null;
    if(expected===null && state[field]!=null)return null;
   }
  }else if(!options.upsert)return null;
  state={...state,guildId,...update.$set};
  return state;
 };
 return Promise.resolve().then(()=>run({get:()=>state,writes}))
  .finally(()=>{GuildConfig.findOneAndUpdate=old;});
}

test("two setup sessions editing different fields preserve both changes",async()=>withSavedConfig(
 {giveawayChannelId:"original",activityClaimInstructions:"old"},async db=>{
  const original={...db.get()};
  await saveGuidedSetupFields({guildId,original,proposed:{
    giveawayChannelId:"new-regular-channel",activityClaimInstructions:"old"}});
  await saveGuidedSetupFields({guildId,original,proposed:{
    giveawayChannelId:"original",activityClaimInstructions:"new-activity-claims"}});
  assert.equal(db.get().giveawayChannelId,"new-regular-channel");
  assert.equal(db.get().activityClaimInstructions,"new-activity-claims");
  assert.deepEqual(Object.keys(db.writes[0].update.$set),["giveawayChannelId"]);
  assert.deepEqual(Object.keys(db.writes[1].update.$set),["activityClaimInstructions"]);
}));

test("a stale wizard cannot silently replace a field edited by another staff member",async()=>withSavedConfig(
 {commandChannelId:"old"},async db=>{
  const original={...db.get()};
  await saveGuidedSetupFields({guildId,original,proposed:{commandChannelId:"new-A"}});
  await assert.rejects(()=>saveGuidedSetupFields({guildId,original,
    proposed:{commandChannelId:"new-B"}}),/changed by another staff member/i);
  assert.equal(db.get().commandChannelId,"new-A");
}));

test("unchanged values do not write database fields or revert other settings",async()=>withSavedConfig(
 {commandChannelId:"commands",giveawayArchiveChannelId:"archive"},async db=>{
  const result=await saveGuidedSetupFields({guildId,original:{...db.get()},
    proposed:{commandChannelId:"commands",giveawayArchiveChannelId:"archive"}});
  assert.deepEqual(result,{changed:false,fields:[]});
  assert.equal(db.writes.length,0);
}));

test("legacy missing field is matched as absent when user selects a different value",async()=>withSavedConfig(
 {commandChannelId:"commands"},async db=>{
  await saveGuidedSetupFields({guildId,original:{...db.get()},
    proposed:{commandChannelId:"commands",helpChannelId:"public-help"},
    fallbacks:{helpChannelId:""}});
  assert.equal(db.get().helpChannelId,"public-help");
  assert.equal(db.writes[0].filter.helpChannelId,null);
}));

test("first-time General Setup creates config but does not accidentally fill disabled optional fields",async()=>withSavedConfig(
 null,async db=>{
  const result=await saveGuidedSetupFields({guildId,original:null,
    proposed:{commandChannelId:"commands",giveawayArchiveChannelId:"archive",
      helpChannelId:"",profileChannelId:""},
    fallbacks:{commandChannelId:"",giveawayArchiveChannelId:"",
      helpChannelId:"",profileChannelId:""},
    extra:{initialSetupCompletedAt:new Date("2026-11-13T15:00:00Z")}});
  assert.equal(db.get().commandChannelId,"commands");
  assert.equal(db.get().giveawayArchiveChannelId,"archive");
  assert.deepEqual(result.fields,["commandChannelId","giveawayArchiveChannelId","initialSetupCompletedAt"]);
  assert.equal(db.writes[0].options.upsert,true);
}));

test("duplicate-key conflict on first-time setup becomes a clear retry message",async()=>{
 const old=GuildConfig.findOneAndUpdate;
 try{
  GuildConfig.findOneAndUpdate=async()=>{throw Object.assign(Error("duplicate key"),{code:11000});};
  await assert.rejects(()=>saveGuidedSetupFields({guildId,original:null,
    proposed:{commandChannelId:"commands"},fallbacks:{commandChannelId:""}}),
    /Another staff member saved setup first/);
 }finally{GuildConfig.findOneAndUpdate=old;}
});
