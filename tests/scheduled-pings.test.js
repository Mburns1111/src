import test from "node:test";
import assert from "node:assert/strict";
import {normalizePingGroup,planPingDeliveries,pingDashboardButtons} from "../services/scheduled-pings.js";
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
 assert.equal(controls.length,5);
 assert.deepEqual(controls.map(c=>c.label),[
  "Create Template","Saved Templates","Manage Schedules","View Full Schedule","View Archives"
 ]);
 assert.ok(controls.every(c=>c.custom_id.startsWith("pings:root:")));
});

test("shared archives are required in General Setup; Scheduled Pings dashboard is optional",()=>{
 assert.deepEqual(generalSetupFields.slice(0,3),[
  "commandChannelId","giveawayArchiveChannelId","scheduledPingsChannelId"
 ]);
 const summary=guidedGuildSetupSummary("general",{
  commandChannelId:"123456789012345678",giveawayArchiveChannelId:"234567890123456789",
  scheduledPingsChannelId:"",
 });
 assert.match(summary,/Shared Staff Archives are mandatory/);
 assert.match(summary,/Scheduled pings staff dashboard/);
 for(const field of ["giveawayArchiveChannelId","scheduledPingsChannelId","scheduledPingsDashboardMessageId"])
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
