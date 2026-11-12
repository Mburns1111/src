import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {parseServerDateTime,formatServerClock,addServerCalendarDays,validateServerTimeZone} from "../services/schedule-timezone.js";
import {handleScheduledPingsInteraction} from "../commands/scheduled-pings.js";
import {activatePingSchedule,archivePingSchedule,reconcilePingSchedules,normalizePingGroup,planPingDeliveries,pingDashboardButtons} from "../services/scheduled-pings.js";
import PingTemplate from "../models/PingTemplate.js";
import PingSchedule from "../models/PingSchedule.js";
import PingDelivery from "../models/PingDelivery.js";
import PingAudit from "../models/PingAudit.js";
import GuildConfig from "../models/GuildConfig.js";
import {generalSetupFields,guidedGuildSetupSummary} from "../commands/general-card-setup.js";
import {STAFF_TOPICS} from "../commands/help.js";

const start=new Date("2026-11-14T14:00:00.000Z");
const group=(override={})=>({
 name:"A",repeatMode:"hours",interval:12,durationDays:7,offsetHours:0,
 roleIds:["123456789012345678"],messages:["Hello world"],...override
});

test("server time zone accepts common names and rejects invalid zones",()=>{
 assert.equal(validateServerTimeZone("Eastern"),"America/New_York");
 assert.equal(validateServerTimeZone("America/Chicago"),"America/Chicago");
 assert.throws(()=>validateServerTimeZone("Mars/Unspecified"),/Unknown time zone/);
});
test("staff enters date and local AM/PM clock time using the configured time zone",()=>{
 const date=parseServerDateTime("2026-11-20","9:00 AM","America/New_York");
 assert.equal(date.toISOString(),"2026-11-20T14:00:00.000Z");
 assert.match(formatServerClock(date,"America/New_York"),/9:00 AM/);
 assert.throws(()=>parseServerDateTime("2026-02-30","9:00 AM","America/New_York"),/real calendar/);
 assert.throws(()=>parseServerDateTime("2027-03-14","2:30 AM","America/New_York"),/does not exist/);
 assert.equal(parseServerDateTime("2027-11-07","1:30 AM","America/New_York").toISOString(),
  "2027-11-07T05:30:00.000Z");
});
test("daily recurrence stays at the same server clock hour across daylight saving",()=>{
 const start=parseServerDateTime("2027-03-12","9:00 AM","America/New_York");
 const daily=planPingDeliveries([group({repeatMode:"days",interval:1,durationDays:5})],start,
  {timeZone:"America/New_York"});
 assert.equal(daily.length,5);
 assert.deepEqual(daily.map(e=>e.dueAt.toISOString()),[
  "2027-03-12T14:00:00.000Z","2027-03-13T14:00:00.000Z",
  "2027-03-14T13:00:00.000Z","2027-03-15T13:00:00.000Z","2027-03-16T13:00:00.000Z"
 ]);
 const elapsed=planPingDeliveries([group({repeatMode:"hours",interval:24,durationDays:5})],start,
  {timeZone:"America/New_York"});
 assert.equal(elapsed[2].dueAt.toISOString(),"2027-03-14T14:00:00.000Z");
 assert.equal(addServerCalendarDays(start,2,"America/New_York").toISOString(),"2027-03-14T13:00:00.000Z");
});
test("no group may start after its duration finishes",()=>{
 assert.throws(()=>planPingDeliveries([group({durationDays:1,offsetHours:48})],start),
  /has no messages within its duration/);
});
test("12-hour and 24-hour groups overlap in one schedule without merging messages",()=>{
 const deliveries=planPingDeliveries([
  group({name:"A",interval:12,durationDays:7}),
  group({name:"B",interval:24,durationDays:5,messages:["Second message"]}),
 ],start);
 assert.equal(deliveries.length,19);
 assert.deepEqual(deliveries.slice(0,2).map(e=>e.groupIndex),[0,1]);
 assert.equal(deliveries[0].dueAt.toISOString(),start.toISOString());
 assert.equal(deliveries[1].dueAt.toISOString(),start.toISOString());
 assert.deepEqual(deliveries.slice(0,2).map(e=>e.sequence),[1,2]);
 assert.equal(deliveries.filter(e=>e.groupIndex===0).length,14);
 assert.equal(deliveries.filter(e=>e.groupIndex===1).length,5);
 assert.ok(deliveries.every(e=>e.roleIds.length===1));
});

test("separate groups retain independent content rotations",()=>{
 const deliveries=planPingDeliveries([
  group({interval:12,durationDays:2,messages:["Morning","Evening"]}),
  group({interval:24,durationDays:2,messages:["Daily"]}),
 ],start);
 assert.deepEqual(deliveries.filter(e=>e.groupIndex===0).map(e=>e.content),
  ["Morning","Evening","Morning","Evening"]);
 assert.deepEqual(deliveries.filter(e=>e.groupIndex===1).map(e=>e.content),
  ["Daily","Daily"]);
});

test("one-time pings, offset starts and text-only messages are valid",()=>{
 const deliveries=planPingDeliveries([group({
  repeatMode:"once",offsetHours:3,durationDays:5,roleIds:[],messages:["Remember the event."],
 })],start);
 assert.equal(deliveries.length,1);
 assert.equal(deliveries[0].dueAt.toISOString(),"2026-11-14T17:00:00.000Z");
 assert.deepEqual(deliveries[0].roleIds,[]);
});

test("invalid roles, empty messages and excessive frequency fail before scheduling",()=>{
 assert.throws(()=>normalizePingGroup(group({roleIds:[],messages:[]})),/message text or select at least one role/i);
 assert.throws(()=>normalizePingGroup(group({roleIds:Array.from({length:11},(_,i)=>String(i))})),/no more than 10 roles/i);
 assert.throws(()=>normalizePingGroup(group({interval:0})),/interval/i);
 assert.throws(()=>normalizePingGroup(group({messages:["x".repeat(1900)]})),/1,900/i);
 assert.throws(()=>planPingDeliveries([group({interval:1,durationDays:365})],start),/Too many scheduled pings/i);
 assert.throws(()=>planPingDeliveries([],start),/1–10 Ping Groups/);
});

test("the persistent dashboard has five staff controls and no publicly visible slash command",()=>{
 const rows=pingDashboardButtons();
 assert.equal(rows.length,2);
 const controls=rows.flatMap(r=>r.components.map(c=>c.toJSON()));
 assert.equal(controls.length,6);
 assert.deepEqual(controls.map(c=>c.label),[
  "Create Template","Saved Templates","Manage Schedules","View Full Schedule","View Archives","Delivery Alerts"
 ]);
 assert.ok(controls.every(c=>c.custom_id.startsWith("pings:root:")));
});

test("shared archives are required in General Setup; Scheduled Pings dashboard is optional",()=>{
 assert.deepEqual(generalSetupFields.slice(0,4),[
  "commandChannelId","giveawayArchiveChannelId","serverTimeZone","scheduledPingsChannelId"
 ]);
 const summary=guidedGuildSetupSummary("general",{
  commandChannelId:"123456789012345678",giveawayArchiveChannelId:"234567890123456789",
  serverTimeZone:"America/New_York",scheduledPingsChannelId:"",
 });
 assert.match(summary,/Server Time Zone are mandatory/);
 assert.match(summary,/Scheduled pings staff dashboard/);
 for(const field of ["giveawayArchiveChannelId","serverTimeZone","scheduledPingsChannelId","scheduledPingsDashboardMessageId"])
  assert.ok(GuildConfig.schema.path(field),field);
 assert.ok(STAFF_TOPICS.some(t=>t.id==="spings"));
});

test("schedules have independent persistent copy, send history and audit schemas",()=>{
 for(const f of ["nameKey","guildId","groups","createdBy"])assert.ok(PingTemplate.schema.path(f));
 for(const f of ["destinationChannelId","groups","status","archiveMessageId","plannedCount","sentCount"])
  assert.ok(PingSchedule.schema.path(f));
 for(const f of ["sequence","roleIds","content","dueAt","messageUrl","error","status"])
  assert.ok(PingDelivery.schema.path(f));
 for(const f of ["actorId","event","details"])assert.ok(PingAudit.schema.path(f));
});


function fakeQuery(records){
 let offset=0,size=records.length;
 return {
  sort(){return this;},select(){return this;},
  skip(value){offset=value;return this;},limit(value){size=value;return this;},
  async lean(){return records.slice(offset,offset+size);},
 };
}

function staffEditor(t){
 t.mock.method(GuildConfig,"findOne",()=>({lean:async()=>({scheduledPingsChannelId:"staff",serverTimeZone:"America/New_York"})}));
 let counter=0;
 return async function click(customId,{values=[],fields}={}){
  let result;
  const capture=async payload=>{result=payload;};
  const i={id:String(++counter),guildId:"server",
   guild:{channels:{fetch:async()=>({isTextBased:()=>true,send(){},permissionsFor:()=>({has:()=>true})})},
    members:{fetchMe:async()=>({})}},user:{id:t.name},channelId:"staff",
   memberPermissions:{has:()=>true},message:{flags:{has:()=>true}},customId,values,
   fields:{getTextInputValue:key=>fields[key]},isModalSubmit:()=>Boolean(fields),
   reply:capture,update:capture,showModal:capture};
  await handleScheduledPingsInteraction(i);
  return result;
 };
}
function control(panel,prefix){
 const component=panel.components.flatMap(row=>row.components).find(c=>c.data.custom_id.startsWith("pings:"+prefix));
 assert.ok(component,"Missing "+prefix);
 return component.data.custom_id;
}

test("management pages reach schedule 26 and an old End Early form cannot affect a different schedule",async t=>{
 const schedules=Array.from({length:26},(_,n)=>({_id:String(n),name:"Event "+n,destinationChannelId:"dest"+n,
  startsAt:start,endsAt:start,status:"active",groups:[],sentCount:0,plannedCount:1}));
 t.mock.method(PingSchedule,"countDocuments",async()=>26);
 t.mock.method(PingSchedule,"find",()=>fakeQuery(schedules));
 t.mock.method(PingSchedule,"findOne",filter=>({lean:async()=>schedules[Number(filter._id)]}));
 const click=staffEditor(t);
 const first=await click("pings:root:active");
 const last=await click(control(first,"list:next"));
 assert.equal(last.components[0].components[0].toJSON().options[0].value,"25");
 const a=await click(control(last,"select:schedule"),{values:["25"]});
 const confirm=await click(control(a,"manage:end"));
 assert.match(confirm.content,/Event 25.*<#dest25>/);
 const form=await click(control(confirm,"manage:endReason"));
 const list=await click("pings:root:active");
 await click(control(list,"select:schedule"),{values:["0"]});
 const stale=await click(form.data.custom_id,{fields:{reason:"Ended"}});
 assert.match(stale.content,/replaced/);
});

test("a paused backlog does not consume the worker's active delivery batch",async t=>{
 const pending=[...Array.from({length:50},()=>({scheduleId:"paused"})),{scheduleId:"active"}];
 t.mock.method(PingSchedule,"distinct",async(field,filter)=>{
  assert.equal(field,"_id");assert.deepEqual(filter,{status:"active"});return ["active"];
 });
 t.mock.method(PingDelivery,"find",filter=>fakeQuery(filter.status==="pending"
  ?pending.filter(event=>filter.scheduleId.$in.includes(event.scheduleId)):[]));
 t.mock.method(PingSchedule,"findById",()=>({select:()=>({lean:async()=>({status:"active",guildId:"guild"})}),lean:async()=>null}));
 t.mock.method(PingDelivery,"findOneAndUpdate",()=>({lean:async()=>null}));
 t.mock.method(PingSchedule,"find",()=>fakeQuery([]));
 t.mock.method(GuildConfig,"findOne",()=>({lean:async()=>null}));
 assert.equal((await reconcilePingSchedules({})).processed,1);
});

test("activation retry reuses the committed preview even after a restart",async t=>{
 const saved={name:"Original schedule"};
 const identity={_id:"preview-id",guildId:"guild",activatedBy:"staff"};
 t.mock.method(PingSchedule,"findOne",async filter=>{assert.deepEqual(filter,identity);return saved;});
 assert.equal(await activatePingSchedule({scheduleId:"preview-id",guild:{id:"guild"},actorId:"staff"}),saved);
});

test("retiming preserves individual edits and asks before removing an edited occurrence",async t=>{
 const template={_id:"example",name:"Reminders",groups:[group({roleIds:[],interval:12,durationDays:1}),
  group({roleIds:[],repeatMode:"once",offsetHours:3,messages:["Other"]})]};
 t.mock.method(PingTemplate,"find",()=>fakeQuery([template]));
 t.mock.method(PingTemplate,"findOne",()=>({lean:async()=>template}));
 const click=staffEditor(t);
 const list=await click("pings:root:templates");
 const details=await click(control(list,"select:template"),{values:["example"]});
 const chooser=await click(control(details,"template:use"));
 // The test destination supports both posting and viewing.
 let preview=await click(control(chooser,"select:destination"),{values:["dest"]});
 const ping=await click(control(preview,"select:planned"),{values:["3"]});
 const edit=await click(control(ping,"event:text"));
 const edited=await click(edit.data.custom_id,{fields:{content:"Custom second occurrence"}});
 preview=await click(control(edited,"event:back"));
 const startForm=await click(control(preview,"activation:start"));
 const future=new Date(Date.now()+86400000);
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(future);
 const by=Object.fromEntries(parts.map(p=>[p.type,p.value]));
 preview=await click(startForm.data.custom_id,{fields:{date:by.year+"-"+by.month+"-"+by.day,time:by.hour+":"+by.minute}});
 assert.match(preview.content,/Custom second occurrence/);
 const groups=await click(control(preview,"activation:groups"));
 let groupPanel=await click(control(groups,"select:activationGroup"),{values:["0"]});
 let timing=await click(control(groupPanel,"group:timing"));
 const values={name:"A",repeatMode:"hours",interval:"1",days:"1",offset:"0"};
 groupPanel=await click(timing.data.custom_id,{fields:values});
 preview=await click(control(groupPanel,"group:back"));
 assert.match(preview.content,/#2 [^\n]*Custom second occurrence/);
 const picker=await click(control(preview,"activation:groups"));
 groupPanel=await click(control(picker,"select:activationGroup"),{values:["0"]});
 timing=await click(control(groupPanel,"group:timing"));
 const warning=await click(timing.data.custom_id,{fields:{...values,repeatMode:"once"}});
 assert.match(warning.content,/removes 1 individually edited ping/);
 groupPanel=await click(control(warning,"group:keepTiming"));
 preview=await click(control(groupPanel,"group:back"));
 assert.match(preview.content,/Custom second occurrence/);
});

test("concurrent activations write one batch of deliveries and one audit entry",async t=>{
 const scheduleId=new mongoose.Types.ObjectId();
 const actorId="staff";
 let stored=null;
 let lookups=0;
 t.mock.method(PingSchedule,"findOne",async()=>++lookups<=2?null:stored);
 t.mock.method(mongoose,"startSession",async()=>({withTransaction:async fn=>fn(),endSession:async()=>{}}));
 t.mock.method(PingSchedule,"create",async ([record])=>{
  assert.equal(record._id,scheduleId);
  if(stored)throw Object.assign(new Error("Duplicate _id"),{code:11000});
  stored=record;
  return [record];
 });
 const deliveries=t.mock.method(PingDelivery,"insertMany",async()=>{});
 const audit=t.mock.method(PingAudit,"create",async()=>{});
 const guild={id:"guild",channels:{fetch:async()=>({isTextBased:()=>true,send(){},permissionsFor:()=>({has:()=>true})})},
  members:{fetchMe:async()=>({})}};
 const args={scheduleId,guild,actorId,channelId:"dest",startAt:new Date(Date.now()+60000),
  template:{_id:"template",name:"Reminders",createdBy:actorId,groups:[group({roleIds:[]})]}};
 const results=await Promise.all([activatePingSchedule(args),activatePingSchedule(args)]);
 assert.deepEqual(results,[stored,stored]);
 assert.equal(deliveries.mock.callCount(),1);
 assert.equal(audit.mock.callCount(),1);
});


test("ending during an in-flight Discord send defers the archive instead of posting incomplete logs",async t=>{
 const schedule={_id:new mongoose.Types.ObjectId(),guildId:"server",status:"ended",archiveMessageId:""};
 const lease=t.mock.method(PingSchedule,"findOneAndUpdate",()=>({lean:async()=>schedule}));
 const count=t.mock.method(PingDelivery,"countDocuments",async query=>{
  assert.equal(String(query.scheduleId),String(schedule._id));
  assert.deepEqual(query.status.$in,["pending","sending"]);
  return 1;
 });
 const release=t.mock.method(PingSchedule,"updateOne",async()=>({modifiedCount:1}));
 const config=t.mock.method(GuildConfig,"findOne",()=>{throw Error("Archive should not be queried while delivery is in flight.");});
 assert.equal(await archivePingSchedule({},schedule),null);
 assert.equal(lease.mock.callCount(),1);
 assert.equal(count.mock.callCount(),1);
 assert.equal(release.mock.callCount(),1);
 assert.equal(config.mock.callCount(),0);
});

test("archive locking stops duplicate archive publishers",async t=>{
 const schedule={_id:new mongoose.Types.ObjectId(),guildId:"server",status:"ended",archiveMessageId:""};
 t.mock.method(PingSchedule,"findOneAndUpdate",()=>({lean:async()=>null}));
 t.mock.method(PingDelivery,"countDocuments",async()=>{throw Error("Only the lease holder may inspect deliveries.");});
 assert.equal(await archivePingSchedule({},schedule),null);
});
