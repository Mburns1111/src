import test from "node:test";
import assert from "node:assert/strict";
import Giveaway from "../models/Giveaway.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import GuildConfig from "../models/GuildConfig.js";
import {
  giveawayDirectoryEntries,giveawayStaffDirectoryPayload,ensureGiveawayStaffDirectory,
  handleGiveawayStaffDirectoryButton,STAFF_DIRECTORY_PAGE_SIZE,STAFF_DIRECTORY_BUMP_COOLDOWN_MS,
} from "../services/giveaway-staff-directory.js";

const guild="123456789012345678",staff="234567890123456789";
const channel="345678901234567890",msg="456789012345678901",one="507f1f77bcf86cd799439011";
const activity="507f1f77bcf86cd799439012",trial="507f1f77bcf86cd799439013";
const noLater = new Date("2026-11-09T12:00:00Z");
const giveaway=(overrides={})=>({
  _id:one,guildId:guild,title:"Cozy drawing",mode:"standard",status:"open",
  channelId:channel,messageId:msg,endsAt:noLater,...overrides,
});
const plan=(overrides={})=>({
  _id:trial,guildId:guild,title:"Weekly pet giveaway",status:"active",
  listChannelId:channel,listMessageId:msg,nextRunAt:noLater,...overrides,
});

function buttons(payload){return payload.components.flatMap(row=>row.components).map(b=>b.data.custom_id)}

test("directory includes live giveaways and running Trials, but excludes all finished and cancelled records",()=>{
  const entries=giveawayDirectoryEntries([
    giveaway(),
    giveaway({_id:trial,title:"Court's Trial",mode:"survival",status:"running"}),
    giveaway({_id:activity,title:"Ended activity",mode:"activity",status:"ended"}),
    giveaway({_id:"507f1f77bcf86cd799439014",status:"cancelled"}),
    giveaway({_id:"507f1f77bcf86cd799439015",status:"failed"}),
  ],[plan(),plan({_id:"507f1f77bcf86cd799439016",status:"paused"})]);
  assert.equal(entries.length,3);
  assert.ok(entries.some(e=>e.key==="giveaway:"+one&&e.url.endsWith("/"+msg)));
  assert.ok(entries.some(e=>e.key==="giveaway:"+trial&&e.label==="Court's Trial"));
  assert.ok(entries.some(e=>e.key==="plan:"+trial&&e.label==="Recurring activity"));
  assert.ok(entries.every(e=>e.url.startsWith("https://discord.com/channels/")));
});

test("activity listing links to the public activity list with a private staff fallback",()=>{
 const publicLink=giveawayDirectoryEntries([giveaway({
   mode:"activity",listChannelId:"567890123456789012",listMessageId:"678901234567890123",
   staffCardChannelId:staff,staffCardId:"789012345678901234"
 })])[0];
 assert.match(publicLink.url,/567890123456789012\/678901234567890123/);
 const fallback=giveawayDirectoryEntries([giveaway({mode:"activity",messageId:"",
   staffCardChannelId:staff,staffCardId:"789012345678901234"})])[0];
 assert.match(fallback.url,/234567890123456789\/789012345678901234/);
});

test("page controls expose all entries while keeping primary sticky message compact",()=>{
 const entries=Array.from({length:STAFF_DIRECTORY_PAGE_SIZE+4},(_,i)=>({
   key:"giveaway:"+i,title:"Giveaway "+i,url:"https://discord.com/channels/"+guild+"/"+channel+"/"+msg,
   label:"Regular",status:"Open for entries",detail:"Ends soon",timestamp:i,
 }));
 const first=giveawayStaffDirectoryPayload(guild,entries);
 assert.equal(buttons(first).length,1);
 assert.equal(buttons(first)[0],"giveawaydir:page:1");
 assert.match(first.embeds[0].toJSON().description,/19 active giveaways/);
 assert.match(first.embeds[0].toJSON().description,/Giveaway 14/);
 assert.doesNotMatch(first.embeds[0].toJSON().description,/Giveaway 15/);
 const second=giveawayStaffDirectoryPayload(guild,entries,{page:1});
 assert.match(second.embeds[0].toJSON().description,/Giveaway 18/);
 assert.ok(buttons(second).includes("giveawaydir:page:0"));
 const empty=giveawayStaffDirectoryPayload(guild,[]);
 assert.match(empty.embeds[0].toJSON().description,/no active giveaways/i);
 assert.equal(empty.components.length,0);
});

test("directory is sent to the private staff channel, reused, then auto-bumped without duplicates",async()=>{
 const old={giveaways:Giveaway.find,plans:GiveawayPlan.find,update:GuildConfig.updateOne};
 const testGuild="123456789012345679";
 const now=new Date("2026-11-09T13:00:00Z");
 const config={guildId:testGuild,activityGiveawayReviewChannelId:staff,
  giveawayStaffDirectoryMessageId:"",giveawayStaffDirectoryChannelId:"",giveawayStaffDirectoryFingerprint:""};
 const posted=[],deleted=[],edited=[],updates=[];
 const messagesById=new Map();
 let current=null;
 const staffChannel={
   id:staff,lastMessageId:null,guild:{roles:{everyone:{id:"everyone"}}},
   permissionsFor:()=>({has:()=>false}),
   messages:{fetch:async value=>typeof value==="string"?messagesById.get(value):{
     first:()=>current
   }},
   send:async payload=>{
     const n=posted.length+1;
     const m={id:"70000000000000000"+n,author:{id:"bot"},
       delete:async()=>deleted.push(n),edit:async p=>edited.push(p)};
     posted.push(payload);messagesById.set(m.id,m);current=m;staffChannel.lastMessageId=m.id;
     return m;
   },
 };
 const client={user:{id:"bot"},channels:{fetch:async id=>{
   assert.equal(id,staff);return staffChannel;
 }}};
 try{
   Giveaway.find=()=>({sort:()=>({lean:async()=>[
     giveaway({guildId:testGuild,title:"Active giveaway"})
   ]})});
   GiveawayPlan.find=()=>({sort:()=>({lean:async()=>[]})});
   GuildConfig.updateOne=async (_query,change)=>{
     updates.push(change.$set);
     Object.assign(config,change.$set);
   };
   assert.equal(await ensureGiveawayStaffDirectory(client,config,{now}),true);
   assert.equal(posted.length,1);
   assert.equal(edited.length,0);
   assert.match(posted[0].embeds[0].toJSON().description, /\[Active giveaway\]\(https:\/\/discord.com/);
   assert.equal(await ensureGiveawayStaffDirectory(client,config,{now:new Date(+now+2000)}),true);
   assert.equal(posted.length,1,"the directory is updated in place, not posted every sweep");

   // Staff conversation pushes another message below the existing directory.
   staffChannel.lastMessageId="800000000000000001";
   await ensureGiveawayStaffDirectory(client,config,{now:new Date(+now+STAFF_DIRECTORY_BUMP_COOLDOWN_MS-1000)});
   assert.equal(posted.length,1,"respect the no-spam bump cooldown");
   await ensureGiveawayStaffDirectory(client,config,{now:new Date(+now+STAFF_DIRECTORY_BUMP_COOLDOWN_MS+1000)});
   assert.equal(posted.length,2,"auto-sticky reposts after staff conversation");
   assert.deepEqual(deleted,[1],"old directory gets deleted after replacement is safely posted");
   assert.equal(updates.length,2);
   assert.equal(config.giveawayStaffDirectoryMessageId,current.id);
 }finally{
   Giveaway.find=old.giveaways;GiveawayPlan.find=old.plans;GuildConfig.updateOne=old.update;
 }
});

test("staff directory never posts in a channel visible to everyone",async()=>{
 const old={giveaways:Giveaway.find,plans:GiveawayPlan.find};
 const channelInstance={
   id:staff,guild:{roles:{everyone:{id:"everyone"}}},permissionsFor:()=>({has:()=>true}),
   send:async()=>{throw Error("Directory must not be posted publicly");},
   messages:{fetch:async()=>null},
 };
 const client={channels:{fetch:async()=>channelInstance}};
 try{
   await assert.rejects(
     ensureGiveawayStaffDirectory(client,{guildId:"123456789012345680",activityGiveawayReviewChannelId:staff}),
     /accessible to @everyone/);
 }finally{
   Giveaway.find=old.giveaways;GiveawayPlan.find=old.plans;
 }
});

test("directory paging is ephemeral and gated by staff permissions",async()=>{
 const old={config:GuildConfig.findOne,giveaways:Giveaway.find,plans:GiveawayPlan.find};
 const replies=[],deferred=[];
 try {
   GuildConfig.findOne=()=>({select:()=>({lean:async()=>({activityGiveawayReviewChannelId:staff})})});
   Giveaway.find=()=>({sort:()=>({lean:async()=>[giveaway()]})});
   GiveawayPlan.find=()=>({sort:()=>({lean:async()=>[]})});
   await handleGiveawayStaffDirectoryButton({
     memberPermissions:{has:()=>false},customId:"giveawaydir:page:0",
     reply:async x=>replies.push(x),
   });
   assert.match(replies[0].content,/Manage Server/);
   await handleGiveawayStaffDirectoryButton({
     memberPermissions:{has:()=>true},customId:"giveawaydir:page:0",guildId:guild,channelId:staff,
     deferReply:async x=>deferred.push(x),
     editReply:async x=>replies.push(x),
   });
   assert.ok(deferred[0].flags);
   assert.match(replies[1].embeds[0].toJSON().description,/Cozy drawing/);
 }finally{
   GuildConfig.findOne=old.config;Giveaway.find=old.giveaways;GiveawayPlan.find=old.plans;
 }
});
