import mongoose from "mongoose";
import {
 ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelSelectMenuBuilder,ChannelType,
 MessageFlags,ModalBuilder,PermissionFlagsBits,RoleSelectMenuBuilder,
 StringSelectMenuBuilder,TextInputBuilder,TextInputStyle,
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import PingTemplate from "../models/PingTemplate.js";
import PingSchedule from "../models/PingSchedule.js";
import PingDelivery from "../models/PingDelivery.js";
import PingAudit from "../models/PingAudit.js";
import {formatServerClock,inputParts,parseServerDateTime,validateServerTimeZone} from "../services/schedule-timezone.js";
import {
 activatePingSchedule,changeFuturePing,endPingSchedule,
 normalizePingGroup,pausePingSchedule,planPingDeliveries,refreshPingDashboard,
 extendPingSchedule,
 resumePingSchedule,validatePingDestination,
} from "../services/scheduled-pings.js";

const sessions=new Map();
const EXPIRES=60*60_000;
const key=i=>i.guildId+":"+i.user.id;
const ts=date=>"<t:"+Math.floor(new Date(date).getTime()/1000)+":f>";
const btn=(label,id,style=ButtonStyle.Secondary)=>new ButtonBuilder()
 .setCustomId("pings:"+id).setLabel(label).setStyle(style);
const row=(...items)=>new ActionRowBuilder().addComponents(items.map(([label,id,style])=>btn(label,id,style)));
const stateFor=i=>{
 const state=sessions.get(key(i));
 if(!state||state.expires<Date.now()){sessions.delete(key(i));throw Error("This editor expired. Open the dashboard again.");}
 state.expires=Date.now()+EXPIRES;
 return state;
};
function reply(i,payload){
 const state=sessions.get(key(i));
 if(state && payload.components?.length){
  // Every rendered view gets its own controls, including forms opened from it.
  state.viewId=i.id;
  for(const actionRow of payload.components){
   for(const component of actionRow.components){
    component.setCustomId(component.data.custom_id+"|"+state.viewId);
   }
  }
 }
 if(i.deferred)return i.editReply({...payload,components:payload.components||[],allowedMentions:{parse:[]}});

 if(!i.isModalSubmit() && i.message?.flags?.has(MessageFlags.Ephemeral))
  return i.update({...payload,allowedMentions:{parse:[]}});
 return i.reply({...payload,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
}
const modal=(i,id,title,inputs)=>{
 const m=new ModalBuilder().setCustomId("pings:modal:"+id+(id==="templateName"?"":"|"+stateFor(i).viewId)).setTitle(title);
 for(const [name,label,value,style,max,required=true]of inputs){
  const input=new TextInputBuilder().setCustomId(name).setLabel(label)
   .setStyle(style||TextInputStyle.Short).setRequired(required).setMaxLength(max||200);
  if(value!==undefined&&value!==null&&String(value))input.setValue(String(value).slice(0,max||200));
  m.addComponents(new ActionRowBuilder().addComponents(input));
 }
 return m;
};
const field=(i,k)=>i.fields.getTextInputValue(k)?.trim()||"";
const short=x=>String(x||"").replace(/\s+/g," ").slice(0,120);
const cleanName=x=>String(x||"").trim().slice(0,80);
const newGroup=n=>({name:"Ping Group "+n,repeatMode:"hours",interval:12,durationDays:7,
 offsetHours:0,roleIds:[],messages:[]});
const showRoles=roles=>roles?.length?roles.map(id=>"<@&"+id+">").join(" "):"None";
const summaryGroup=(g,{template=false}={})=>"**"+g.name+"** · "+(g.repeatMode==="once"?"Once":"Every "+g.interval+" "+(g.repeatMode==="days"?"days":"hours"))+
 " · "+g.durationDays+" days · Delay "+g.offsetHours+"h\n"+
 "Roles: "+showRoles(g.roleIds)+(template?"":"\nMessage style: "+(MESSAGE_MODES[g.messageMode]||"Rotate Messages"));
const MESSAGE_MODES={
 single:"Repeat One Message",
 "per-ping":"Different Message Per Ping",
 rotate:"Rotate Messages",
 roles:"Role Mentions Only",
};
function groupEvents(s,index){
 return planPingDeliveries(s.workingGroups,s.startAt,{
  timeZone:s.timeZone,allowIncomplete:true
 }).filter(e=>e.groupIndex===index);
}
function groupProgress(s,index){
 const g=s.workingGroups[index];
 if(g.messageMode==="per-ping"){
  const events=groupEvents(s,index);
  const done=events.filter(e=>Boolean(g.perPingMessages?.[e.ordinal])).length;
  return {ready:done===events.length&&events.length>0,status:done+"/"+events.length+" individual ping messages"};
 }
 if(g.messageMode==="roles")
  return {ready:!!g.roleIds?.length,status:g.roleIds?.length?"Role mentions only":"Select a role"};
 const count=g.messages?.length||0;
 return {ready:count>0,status:count+(g.messageMode==="single"?" repeating message":" rotating messages")};
}
const groupReady=(s,index)=>groupProgress(s,index).ready;
function draftPanel(s){
 const g=s.groups[s.groupIndex],lines=[
  "**✦ "+(s.editId?"Edit Saved Template":"Create Template")+"**",
  "**Name:** "+s.name,
  s.description?short(s.description):"",
  "**Ping Group "+(s.groupIndex+1)+" of "+s.groups.length+"**",
  summaryGroup(g,{template:true}),"",
  "*Templates save timing and roles only. Add and edit messages when using the template.*"
 ];
 const components=[
  row(["Set Timing","draft:timing"],["Select Roles","draft:roles"]),
  row(["Add Another Group","draft:add"],["Previous Group","draft:previous"]),
  row(["Save Template","draft:finish",ButtonStyle.Success],["Cancel","draft:cancel",ButtonStyle.Danger]),
 ];
 if(s.groups.length>1)components.unshift(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
  .setCustomId("pings:select:group").setPlaceholder("Jump to a Ping Group")
  .addOptions(s.groups.map((group,i)=>({label:group.name||"Ping Group "+(i+1),value:String(i)})))));
 return {content:lines.filter(Boolean).join("\n"),components};
}
function editorState(i){
 const s=stateFor(i);
 if(s.phase!=="draft")throw Error("Open Create Template first.");
 return s;
}
async function savedTemplatesPanel(i,page=0){
 const templates=await PingTemplate.find({guildId:i.guildId}).sort({updatedAt:-1}).skip(page*25).limit(25).lean();
 if(!templates.length)return reply(i,{content:"**Saved Templates**\n"+
  (page?"No more templates on this page. Return to the previous page.":"No templates yet. Use Create Template on the permanent dashboard."),
  components:page?[row(["Previous","template:pagePrev"])]:[]});
 const s={phase:"templateList",expires:Date.now()+EXPIRES,templates,page};
 sessions.set(key(i),s);
 const picker=new StringSelectMenuBuilder().setCustomId("pings:select:template")
  .setPlaceholder("Choose a saved template").addOptions(templates.map(t=>({
   label:t.name.slice(0,100),value:String(t._id),description:t.groups.length+" Ping Groups"
  })));
 return reply(i,{content:"**Saved Templates** · Page "+(page+1)+"\nChoose one to inspect, activate, edit or delete. The original stays unchanged when activated.",
  components:[new ActionRowBuilder().addComponents(picker),
   row(["Previous","template:pagePrev"],["Next","template:pageNext"])]});
}
function templateDetails(s){
 const t=s.template;
 return {content:"**✦ "+t.name+"**\n"+(t.description||"")+"\n\n"+
  t.groups.map((g,i)=>"**Group "+(i+1)+": "+g.name+"** · "+
   (g.repeatMode==="once"?"Once":"Every "+g.interval+" "+(g.repeatMode==="days"?"days":"hours"))+
   " · "+g.durationDays+" days · "+g.roleIds.length+" role(s)").join("\n")+
  "\n\n*Messages are added and edited when you use this template. Each activation has its own messages and schedule.*",
  components:[row(["Use Template","template:use",ButtonStyle.Success],
    ["Edit Template","template:edit"],["Delete Template","template:delete",ButtonStyle.Danger])]};
}
async function activeList(i,page=0){
 const filter={guildId:i.guildId,status:{$in:["active","paused"]}};
 const count=await PingSchedule.countDocuments(filter);
 page=Math.min(Math.max(0,page),Math.max(0,Math.ceil(count/25)-1));
 const schedules=await PingSchedule.find(filter).sort({startsAt:-1,_id:-1}).skip(page*25).limit(25).lean();
 if(!schedules.length)return reply(i,{content:"**Active Schedules**\nThere are no active schedules on this page.",components:[]});
 sessions.set(key(i),{phase:"scheduleList",page,expires:Date.now()+EXPIRES});
 const picker=new StringSelectMenuBuilder().setCustomId("pings:select:schedule")
  .setPlaceholder("Choose an active schedule")
  .addOptions(schedules.map(s=>({label:s.name.slice(0,100),value:String(s._id),
   description:s.status+" · "+s.sentCount+"/"+s.plannedCount+" sent"})));
 const pages=new ActionRowBuilder().addComponents(
  btn("Previous","list:previous").setDisabled(page===0),
  btn("Next","list:next").setDisabled((page+1)*25>=count));
 return reply(i,{content:"**Manage Schedules** · Page "+(page+1)+"/"+Math.max(1,Math.ceil(count/25))+
  "\nChoose a schedule to manage.",components:[new ActionRowBuilder().addComponents(picker),pages]});
}
function managementPanel(s){
 const d=s.schedule;
 return {content:"**✦ "+d.name+"**\n**Status:** "+d.status+
  "\n**Destination:** <#"+d.destinationChannelId+">"+
  "\n**Server time zone:** "+(d.timeZone||"UTC")+"\n**Started:** "+showZone(d.startsAt,d.timeZone||"UTC")+" · **Ends:** "+showZone(d.endsAt,d.timeZone||"UTC")+
  "\n**Progress:** "+d.sentCount+"/"+d.plannedCount+" sent, "+d.failedCount+" failed, "+d.skippedCount+" skipped"+
  "\n**Ping Groups:** "+d.groups.length+
  "\n\nEdits to future messages are logged and do not change the saved template.",
  components:[
   row([d.status==="active"?"Pause":"Resume","manage:toggle"],
    ["Edit Future Pings","manage:future"],["Extend","manage:extend"]),
   row(["View Change History","manage:history"],["End Early","manage:end",ButtonStyle.Danger],
    ["Back to List","manage:list"])
  ]};
}
const showZone=(date,zone)=>formatServerClock(date,zone);
function activationSetupPanel(s){
 const missing=s.workingGroups.map((g,i)=>!groupReady(s,i)?i+1:null).filter(Boolean);
 const lines=s.workingGroups.map((g,i)=>"**"+(i+1)+". "+g.name+"** · "+
  (MESSAGE_MODES[g.messageMode]||"Rotate Messages")+" · "+groupProgress(s,i).status+
  (groupReady(s,i)?" · Ready":" · Needs setup"));
 return {content:"**✦ Configure Schedule Messages**\n**Template:** "+s.template.name+
  "\n**Destination:** <#"+s.destinationChannelId+">"+
  "\n**Start:** "+showZone(s.startAt,s.timeZone)+"\n\n"+
  lines.join("\n")+
  "\n\n*Choose each Ping Group and its message style. Messages belong to this schedule, never to the template.*"+
  (missing.length?"\n\n**Before preview:** Configure Group "+missing.join(", ")+".":""),
  components:[
   new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId("pings:select:activationGroup").setPlaceholder("Choose Ping Group to configure")
    .addOptions(s.workingGroups.map((g,i)=>({label:g.name.slice(0,100),value:String(i)})))),
   row(["Review Scheduled Pings","activation:review",ButtonStyle.Success],
    ["Change Start","activation:start"],["Cancel","activation:cancel",ButtonStyle.Danger])
  ]};
}
function activationGroupPanel(s){
 const g=s.workingGroups[s.selectedGroupIndex];
 if(!g)throw Error("Select a Ping Group.");
 const mode=g.messageMode||"rotate";
 const selected=Math.max(0,Math.min(s.selectedMessageIndex||0,(g.messages?.length||1)-1));
 s.selectedMessageIndex=selected;
 const messages=g.messages||[];
 const progress=groupProgress(s,s.selectedGroupIndex);
 const description=mode==="single"
  ?(messages.length?"**Repeating message:** "+short(messages[0]):"*No repeating message yet.*")
  :mode==="rotate"
   ?(messages.length?messages.map((m,i)=>"**"+(i+1)+".** "+short(m).slice(0,60)).join("\n"):
     "*No rotating messages yet.*")
   :mode==="per-ping"
    ?"**Configured:** "+progress.status+"\n*Assign different text to each scheduled occurrence using Set Messages by Ping.*"
    :"*Only the selected roles will be mentioned at each scheduled time.*";
 const components=[
  row(["Repeat One Message","group:mode:single"],["Different Per Ping","group:mode:per-ping"],
   ["Rotate Messages","group:mode:rotate"],["Roles Only","group:mode:roles"]),
  row(["Set Timing","group:timing"],["Select Roles","group:roles"])
 ];
 if(mode==="single"){
  components.push(row([messages.length?"Edit Repeating Message":"Set Repeating Message","group:singleText"]));
 }else if(mode==="rotate"){
  if(messages.length)components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
   .setCustomId("pings:select:groupMessage").setPlaceholder("Select a rotating message to edit")
   .addOptions(messages.map((m,i)=>({
    label:"Message "+(i+1)+": "+short(m).slice(0,70),value:String(i),default:i===selected
   })))));
  components.push(row(["Add Rotating Message","group:addText"],
   ...(messages.length?[["Edit Selected Message","group:editText"],["Remove Selected Message","group:removeSelected"]]:[])));
 }else if(mode==="per-ping"){
  components.push(row(["Set Messages by Ping","group:perPing"]));
 }
 components.push(row(["Back to Group List","group:back"]));
 return {content:"**Configure Ping Group "+(s.selectedGroupIndex+1)+" of "+s.workingGroups.length+"**\n"+
  summaryGroup(g)+"\n\n**Message style:** "+MESSAGE_MODES[mode]+"\n"+
  description+"\n\n"+(progress.ready?"Ready to preview":"Needs more configuration")+
  "\n\n*Select a message style above. Changing styles clears this group's existing message text after confirmation. "+
  "Messages are specific to this schedule.*",components};
}
function perPingPanel(s){
 const index=s.selectedGroupIndex,g=s.workingGroups[index];
 if(g?.messageMode!=="per-ping")throw Error("Select Different Message Per Ping first.");
 const all=groupEvents(s,index);
 const maxPage=Math.max(0,Math.ceil(all.length/10)-1);
 s.perPingPage=Math.min(Math.max(0,s.perPingPage||0),maxPage);
 const events=all.slice(s.perPingPage*10,s.perPingPage*10+10);
 const chosen=events.some(e=>e.ordinal===s.selectedPerPingOrdinal)?s.selectedPerPingOrdinal:events[0]?.ordinal||0;
 s.selectedPerPingOrdinal=chosen;
 const lines=events.map(e=>"**Ping "+(e.ordinal+1)+"** · "+showZone(e.dueAt,s.timeZone)+
  " · "+(g.perPingMessages?.[e.ordinal]?short(g.perPingMessages[e.ordinal]):"*Not configured*"));
 const count=all.filter(e=>Boolean(g.perPingMessages?.[e.ordinal])).length;
 const components=[];
 if(events.length)components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
  .setCustomId("pings:select:perPing").setPlaceholder("Select a scheduled ping to write")
  .addOptions(events.map(e=>({label:"Ping "+(e.ordinal+1),value:String(e.ordinal),
   description:showZone(e.dueAt,s.timeZone).slice(0,95),default:e.ordinal===chosen})))));
 components.push(row(["Previous 10","group:perPingPrev"],["Next 10","group:perPingNext"],
  ["Write / Edit Selected","group:perPingEdit"]));
 components.push(row(["Back to Ping Group","group:return"]));
 return {content:"**Different Message Per Ping — "+g.name+"**\n"+
  "**Completed:** "+count+"/"+all.length+" pings · Page "+(s.perPingPage+1)+"/"+(maxPage+1)+
  "\n\n"+lines.join("\n")+
  "\n\n*Each ping needs its own message before this schedule can be activated. "+
  "After saving a message, the editor advances to the next unfinished ping.*",
  components};
}
async function eventsForActivation(s){
 const raw=planPingDeliveries(s.workingGroups||s.template.groups,s.startAt,{timeZone:s.timeZone});
 const custom=new Map((s.overrides||[]).map(e=>[e.sequence,e]));
 return raw.map(e=>({...e,...(custom.get(e.sequence)||{})}))
  .sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt));
}
function previewRows(events,page,zone){
 const offset=page*10;
 const items=events.slice(offset,offset+10);
 const lines=items.map(e=>"#"+e.sequence+" "+showZone(e.dueAt,zone)+" · Group "+(e.groupIndex+1)+
  " · "+e.roleIds.length+" role(s) · "+short(e.content||"(roles only)"));
 return {items,text:lines.join("\n"),total:events.length};
}
async function activationPanel(i,s){
 const events=await eventsForActivation(s);
 const {items,text,total}=previewRows(events,s.page||0,s.timeZone);
 const components=[];
 if(items.length)components.push(new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId("pings:select:planned")
   .setPlaceholder("Select an individual ping to customize")
   .addOptions(items.map(e=>({label:"Ping #"+e.sequence+" · Group "+(e.groupIndex+1),
    value:String(e.sequence),description:new Date(e.dueAt).toISOString().slice(0,16)})))));
 components.push(row(["Earlier","activation:prev"],["Later","activation:next"],["Change Start","activation:start"],["Edit Ping Groups","activation:groups"]));
 components.push(row(["Activate Schedule","activation:confirm:"+s.scheduleId,ButtonStyle.Success],
  ["Cancel","activation:cancel",ButtonStyle.Danger]));
 return reply(i,{content:"**✦ Review & Activate**\n**Template:** "+s.template.name+
  "\n**One destination:** <#"+s.destinationChannelId+">"+
  "\n**Server time zone:** "+s.timeZone+"\n**Start:** "+showZone(s.startAt,s.timeZone)+" ("+ts(s.startAt)+")\n**Total messages:** "+total+
  "\n**Preview page:** "+((s.page||0)+1)+"/"+Math.max(1,Math.ceil(total/10))+
  "\n\n"+(text||"No pings in this window.")+
  "\n\n*Select a ping to override its text, roles or time. All groups remain in this single channel.*",
  components});
}
function plannedEventPanel(s,event){
 return {content:"**Customize Ping #"+event.sequence+"**\nGroup "+(event.groupIndex+1)+
  "\n**Time:** "+showZone(event.dueAt,s.timeZone||s.schedule?.timeZone||"UTC")+" ("+ts(event.dueAt)+")\n**Roles:** "+showRoles(event.roleIds)+
  "\n**Message:**\n"+(event.content||"(Role mentions only)")+
  "\n\nChanges here affect only this scheduled ping.",
  components:[
   row(["Edit Text","event:text"],["Edit Roles","event:roles"],["Edit Time","event:time"]),
   row(["Back to Preview","event:back"])
  ]};
}
async function futureList(i,s){
 const deliveries=await PingDelivery.find({scheduleId:s.schedule._id,status:"pending",dueAt:{$gt:new Date()}})
  .sort({dueAt:1}).skip((s.futurePage||0)*25).limit(25).lean();
 if(!deliveries.length)return reply(i,{content:"No future pending pings on this page.",components:[row(["Previous","manage:futurePrev"],["Back","manage:back"])]});
 s.deliveries=deliveries;s.phase="futureList";
 return reply(i,{content:"**Future Pings — "+s.schedule.name+"** · Page "+((s.futurePage||0)+1)+
  "\nServer time zone: **"+(s.schedule.timeZone||"UTC")+"**\nChoose a message to edit. Individual changes are saved and audited immediately.",
  components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
   .setCustomId("pings:select:future").setPlaceholder("Choose a future ping")
   .addOptions(deliveries.map(d=>({label:"Ping #"+d.sequence+" · Group "+(d.groupIndex+1),
    value:String(d._id),description:showZone(d.dueAt,s.schedule.timeZone||"UTC").slice(0,100)})))),
   row(["Previous","manage:futurePrev"],["Next","manage:futureNext"],["Back","manage:back"])]});
}
async function archivesList(i){
 const archives=await PingSchedule.find({guildId:i.guildId,status:"archived"})
  .sort({archivedAt:-1}).limit(15).lean();
 const config=await GuildConfig.findOne({guildId:i.guildId}).lean();
 return reply(i,{content:"**Scheduled Pings Archives**\n"+
  (archives.length?archives.map(a=>"• **"+a.name+"** · "+a.sentCount+" sent · "+
   (a.archivedAt?ts(a.archivedAt):"")+
   "\n  https://discord.com/channels/"+a.guildId+"/"+config.giveawayArchiveChannelId+"/"+a.archiveMessageId).join("\n")
    :"No archived ping schedules yet.")+
  "\n\nComplete records also remain in MongoDB.",components:[]});
}
async function deliveryAlerts(i){
 const issues=await PingDelivery.find({guildId:i.guildId,
  $or:[{status:"failed"},{status:"skipped",error:/Missed while offline/}]})
  .sort({updatedAt:-1}).limit(15).lean();
 return reply(i,{content:"**⚠ Scheduled Ping Delivery Alerts**\n"+
  (issues.length?issues.map(d=>"• Ping #"+d.sequence+" · "+ts(d.dueAt)+"\n"+
   "  "+short(d.error||"Delivery did not complete")).join("\n"):"No missed or failed pings recorded."),
  components:[]});
}
async function upcomingList(i,page=0){
 const schedules=await PingSchedule.find({guildId:i.guildId,status:"active"}).select("_id name timeZone").lean();
 const allowed=new Map(schedules.map(s=>[String(s._id),s]));
 const all=await PingDelivery.find({guildId:i.guildId,status:"pending",scheduleId:{$in:schedules.map(s=>s._id)}})
  .sort({dueAt:1}).skip(page*20).limit(20).lean();
 const s={phase:"upcoming",page,expires:Date.now()+EXPIRES};
 sessions.set(key(i),s);
 return reply(i,{content:"**Full Upcoming Schedule** · Page "+(page+1)+"\n"+
  (all.length?all.map(e=>"• "+showZone(e.dueAt,allowed.get(String(e.scheduleId))?.timeZone||"UTC")+" — "+short(allowed.get(String(e.scheduleId))?.name)+
    " · Group "+(e.groupIndex+1)).join("\n"):"No more upcoming messages."),
  components:[row(["Previous","upcoming:prev"],["Next","upcoming:next"])]});
}
function selectedInput(i){
 const s=stateFor(i);
 if(!s.selectedEvent)throw Error("Select an upcoming message first.");
 return s;
}
function fromDateInput(date,time,zone){
 const result=parseServerDateTime(date,time,zone);
 if(result<=new Date())throw Error("Choose a future date and time in the server time zone.");
 return result;
}
async function modalSubmit(i,id){
 if(id==="templateName"){
  const name=cleanName(field(i,"name")),description=field(i,"description");
  if(!name)throw Error("Enter a name for the template.");
  const s={phase:"draft",name,description,groups:[newGroup(1)],groupIndex:0,
   expires:Date.now()+EXPIRES};
  sessions.set(key(i),s);
  return reply(i,draftPanel(s));
 }
 const s=stateFor(i);
 if(id==="timing"){
  if(s.phase!=="draft")throw Error("This editor is no longer active.");
  const g=s.groups[s.groupIndex];
  Object.assign(g,{
   name:field(i,"name"),repeatMode:field(i,"repeatMode").toLowerCase(),
   interval:Number(field(i,"interval")),durationDays:Number(field(i,"days")),
   offsetHours:Number(field(i,"offset")),
  });
  if(!["once","hours","days"].includes(g.repeatMode))throw Error("Frequency must be once, hours or days.");
  if(!g.name)throw Error("Name the group.");
  if(!Number.isInteger(g.interval)||g.interval<1||g.interval>720||
     !Number.isInteger(g.durationDays)||g.durationDays<1||g.durationDays>365||
     !Number.isInteger(g.offsetHours)||g.offsetHours<0||g.offsetHours>720)
    throw Error("Interval 1–720, duration 1–365 days, and delay 0–720 hours must be whole numbers.");
  return reply(i,draftPanel(s));
 }
 if(id==="groupTiming"){
  if(s.phase!=="activation")throw Error("Activation expired.");
  const g=s.workingGroups[s.selectedGroupIndex];
  const proposed=normalizePingGroup({...g,
   name:field(i,"name"),repeatMode:field(i,"repeatMode").toLowerCase(),
   interval:Number(field(i,"interval")),durationDays:Number(field(i,"days")),
   offsetHours:Number(field(i,"offset")),
  },{allowEmpty:true});
  const groups=s.workingGroups.map((group,index)=>index===s.selectedGroupIndex?proposed:group);
  // Before the first preview, the group may have no messages or roles.
  // Only recalculate occurrence overrides when individual edits exist.
  if(!s.overrides?.length){
   s.workingGroups=groups;s.page=0;
   return reply(i,activationGroupPanel(s));
  }
  const previous=planPingDeliveries(s.workingGroups,s.startAt,{timeZone:s.timeZone,allowIncomplete:true});
  const next=planPingDeliveries(groups,s.startAt,{timeZone:s.timeZone,allowIncomplete:true});
  const sequences=new Map(next.map(e=>[e.groupIndex+":"+e.ordinal,e.sequence]));
  const overrides=[];
  const removed=[];
  for(const edit of s.overrides){
   const event=previous[edit.sequence-1];
   const sequence=sequences.get(event.groupIndex+":"+event.ordinal);
   if(sequence===undefined)removed.push(edit.sequence);
   else overrides.push({...edit,sequence});
  }
  if(removed.length){
   s.pendingTiming={groups,overrides};
   return reply(i,{content:"This timing change removes "+removed.length+" individually edited ping(s), including #"+
    removed.slice(0,10).join(", #")+". Apply the change and discard those edits?",
    components:[row(["Apply Timing Change","group:applyTiming",ButtonStyle.Danger],["Keep Original Timing","group:keepTiming"])]});
  }
  Object.assign(s,{workingGroups:groups,overrides,page:0});
  return reply(i,activationGroupPanel(s));
 }
 if(id==="groupEditText"||id==="groupAddText"){
  if(s.phase!=="activation")throw Error("Activation expired.");
  const g=s.workingGroups[s.selectedGroupIndex];
  const value=field(i,"content");
  if(!value)throw Error("Enter message text.");
  const messages=[...(g.messages||[])];
  if(id==="groupEditText"){
   if(!Number.isInteger(s.selectedMessageIndex)||!messages[s.selectedMessageIndex])
    throw Error("Choose an existing message first.");
   messages[s.selectedMessageIndex]=value;
  }else{
   if(messages.length>=20)throw Error("This group already has 20 rotating messages.");
   messages.push(value);s.selectedMessageIndex=messages.length-1;
  }
  s.workingGroups[s.selectedGroupIndex]=normalizePingGroup({...g,messages},{allowEmpty:true});
  return reply(i,activationGroupPanel(s));
 }
 if(id==="start"){
  if(s.phase!=="activation")throw Error("Open an activation preview first.");
  s.startAt=fromDateInput(field(i,"date"),field(i,"time"),s.timeZone);s.page=0;
  return reply(i,activationSetupPanel(s));
 }
 if(id==="eventText"||id==="eventTime"){
  if(s.phase!=="activation"&&s.phase!=="management")throw Error("Select a future ping first.");
  const value=field(i,id==="eventText"?"content":"date");
  const clock=id==="eventTime"?field(i,"time"):null;
  const zone=s.phase==="activation"?s.timeZone:(s.schedule.timeZone||"UTC");
  if(s.phase==="activation"){
   const events=await eventsForActivation(s);
   const event=events.find(e=>e.sequence===s.selectedEvent);
   if(!event)throw Error("That ping is no longer available.");
   const base=s.overrides.find(x=>x.sequence===event.sequence)||{sequence:event.sequence};
   if(id==="eventText")base.content=value;
   else base.dueAt=fromDateInput(value,clock,zone);
   s.overrides=[...s.overrides.filter(x=>x.sequence!==event.sequence),base];
   const updated=(await eventsForActivation(s)).find(e=>e.sequence===s.selectedEvent);
   return reply(i,plannedEventPanel(s,updated));
  }
  const e=await PingDelivery.findById(s.selectedEvent);
  if(!e||String(e.scheduleId)!==String(s.schedule._id))throw Error("That ping cannot be edited.");
  await changeFuturePing(i.client,s.schedule,e,i.user.id,id==="eventText"?{content:value}:{dueAt:fromDateInput(value,clock,zone)});
  s.schedule=await PingSchedule.findById(s.schedule._id).lean();
  const latest=await PingDelivery.findById(e._id).lean();
  return reply(i,plannedEventPanel(s,latest));
 }
 if(id==="end"){
  if(s.phase!=="management")throw Error("Choose a schedule first.");
  const reason=field(i,"reason");
  if(!reason)throw Error("Enter a reason for ending this schedule.");
  await endPingSchedule(i.client,s.schedule,i.user.id,reason);
  const after=await PingSchedule.findById(s.schedule._id).lean();
  sessions.delete(key(i));
  return reply(i,{content:"**Schedule ended.** Reason: "+reason+"\n"+
   (after?.archiveMessageId?"The complete record was posted in Shared Staff Archives.":
   "**Archive pending:** The bot will retry automatically after any in-progress deliveries finish or archive access recovers.")});
 }
 if(id==="extend"){
  if(s.phase!=="management")throw Error("Select a schedule first.");
  const days=Number(field(i,"days"));
  const added=await extendPingSchedule(i.client,s.schedule,i.user.id,days);
  s.schedule=await PingSchedule.findById(s.schedule._id).lean();
  return reply(i,{content:"Schedule extended by "+days+" days. "+added+" new pings added.\n\n"+
   managementPanel(s).content,components:managementPanel(s).components});
 }
 throw Error("Unknown Scheduled Pings form.");
}

const handling=new Set();
export async function handleScheduledPingsInteraction(i){
 const owner=key(i);
 if(handling.has(owner))return i.reply({content:"Your previous action is still processing.",flags:MessageFlags.Ephemeral});
 handling.add(owner);
 try{return await handleControl(i);}
 finally{handling.delete(owner);}
}
async function handleControl(i){
 if(!i.guildId||!i.guild)return reply(i,{content:"Scheduled Pings must be managed in a server."});
 if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
  return reply(i,{content:"Manage Server permission is required to control scheduled role mentions."});
 const config=await GuildConfig.findOne({guildId:i.guildId}).lean();
 if(!config?.scheduledPingsChannelId||i.channelId!==config.scheduledPingsChannelId)
  return reply(i,{content:"Use the permanent Scheduled Pings dashboard in the configured private staff channel."});
 const [control,viewId]=i.customId.split("|");
 let command=control.replace(/^pings:/,"");
 if(command.startsWith("activation:confirm:")){
  const id=command.slice("activation:confirm:".length);
  const state=sessions.get(key(i));
  if(!mongoose.isObjectIdOrHexString(id))throw Error("Invalid activation preview.");
  if(!state || state.viewId!==viewId || String(state.scheduleId)!==id){
   const saved=await PingSchedule.findOne({_id:id,guildId:i.guildId,activatedBy:i.user.id}).lean();
   if(saved)return i.reply({content:"This preview already activated **"+saved.name+"** in <#"+saved.destinationChannelId+">.",
    flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
   throw Error("This activation preview expired. Open the latest preview.");
  }
  command="activation:confirm";
 }
 if(!command.startsWith("root:") && command!=="modal:templateName"){
  if(!viewId || sessions.get(key(i))?.viewId!==viewId)
   return i.reply({content:"This panel has been replaced. Use your latest panel or reopen the staff dashboard.",flags:MessageFlags.Ephemeral});
  stateFor(i);
 }
 if(i.isModalSubmit())return modalSubmit(i,command.slice("modal:".length));
 if(command==="list:previous"||command==="list:next")
  return activeList(i,stateFor(i).page+(command==="list:next"?1:-1));
 if(command==="root:create")return i.showModal(modal(i,"templateName","Create Scheduled Ping Template",[
  ["name","Template name","",TextInputStyle.Short,80],
  ["description","Optional description","",TextInputStyle.Paragraph,300,false],
 ]));
 if(command==="root:templates")return savedTemplatesPanel(i);
 if(command==="root:active")return activeList(i);
 if(command==="root:upcoming")return upcomingList(i);
 if(command==="root:archives")return archivesList(i);
 if(command==="root:alerts")return deliveryAlerts(i);
 if(command==="template:pagePrev"||command==="template:pageNext"){
  const s=stateFor(i);
  return savedTemplatesPanel(i,Math.max(0,(s.page||0)+(command.endsWith("Next")?1:-1)));
 }
 if(command==="select:template"){
  const s=stateFor(i),id=i.values?.[0];
  const t=await PingTemplate.findOne({_id:id,guildId:i.guildId}).lean();
  if(!t)throw Error("That saved template is no longer available.");
  s.template=t;s.phase="template";return reply(i,templateDetails(s));
 }
 if(command==="template:delete"){
  const s=stateFor(i);
  return reply(i,{content:"**Delete saved template "+s.template.name+"?**\nActive copies and history will remain intact.",
   components:[row(["Confirm Delete","template:confirmDelete",ButtonStyle.Danger],["Cancel","template:cancel"])]});
 }
 if(command==="template:cancel"){const s=stateFor(i);return reply(i,templateDetails(s));}
 if(command==="template:confirmDelete"){
  const s=stateFor(i);
  await PingTemplate.deleteOne({_id:s.template._id,guildId:i.guildId});
  sessions.delete(key(i));
  return reply(i,{content:"Saved template deleted. Existing schedules were not changed."});
 }
 if(command==="template:edit"){
  const s=stateFor(i),t=s.template;
  Object.assign(s,{phase:"draft",editId:t._id,name:t.name,description:t.description,
   groups:t.groups.map(g=>({...g,roleIds:[...g.roleIds],messages:[]})),groupIndex:0});
  return reply(i,draftPanel(s));
 }
 if(command==="template:use"){
  const s=stateFor(i);s.phase="chooseChannel";
  return reply(i,{content:"**Use "+s.template.name+"**\nChoose exactly **one destination channel**. All Ping Groups will post there.",
   components:[new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder()
    .setCustomId("pings:select:destination").setPlaceholder("Choose posting channel")
    .setMinValues(1).setMaxValues(1).addChannelTypes(ChannelType.GuildText,ChannelType.GuildAnnouncement))]});
 }
 if(command==="select:destination"){
  const s=stateFor(i);
  if(s.phase!=="chooseChannel")throw Error("Choose a template first.");
  const channelId=i.values?.[0];
  const timeZone=validateServerTimeZone(config.serverTimeZone);
  await validatePingDestination(i.guild,channelId,s.template.groups.flatMap(g=>g.roleIds||[]));
  const first=new Date(Date.now()+5*60_000);first.setUTCSeconds(0,0);
  Object.assign(s,{phase:"activation",scheduleId:new mongoose.Types.ObjectId(),destinationChannelId:channelId,
   timeZone,startAt:first,page:0,overrides:[],
   // Pre-existing templates may contain legacy message text. New schedules
   // always configure messages independently during activation.
   workingGroups:s.template.groups.map(g=>({...g,roleIds:[...g.roleIds],messages:[],
    messageMode:"rotate",perPingMessages:[]}))});
  return reply(i,activationSetupPanel(s));
 }
 if(command==="draft:cancel"){sessions.delete(key(i));return reply(i,{content:"Template editor closed. No changes saved."});}
 if(command.startsWith("draft:")){
  const s=editorState(i),g=s.groups[s.groupIndex];
  if(command==="draft:timing")return i.showModal(modal(i,"timing","Edit Ping Group Timing",[
   ["name","Ping Group name",g.name,TextInputStyle.Short,60],
   ["repeatMode","Frequency: once, hours or days",g.repeatMode,TextInputStyle.Short,8],
   ["interval","Repeat every X hours/days",g.interval,TextInputStyle.Short,3],
   ["days","Duration (days, 1–365)",g.durationDays,TextInputStyle.Short,3],
   ["offset","First ping delay (hours)",g.offsetHours,TextInputStyle.Short,3]
  ]));
  if(command==="draft:roles"){
   return reply(i,{content:"**Roles for "+g.name+"**\nSelect up to 10 roles. Leave unselected to post text only.",
    components:[new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder()
     .setCustomId("pings:select:draftRoles").setPlaceholder("Choose 1–10 roles")
     .setMinValues(1).setMaxValues(10)),
     row(["No Roles / Text Only","draft:clearRoles"],["Back","draft:return"])]});
  }
  if(command==="draft:clearRoles"){g.roleIds=[];return reply(i,draftPanel(s));}
  if(command==="draft:return")return reply(i,draftPanel(s));
  if(command==="draft:previous"){s.groupIndex=Math.max(0,s.groupIndex-1);return reply(i,draftPanel(s));}
  if(command==="draft:add"){
   s.groups[s.groupIndex]=normalizePingGroup({...g,messages:[]},{allowEmpty:true});
   if(s.groups.length>=10)throw Error("A template supports at most 10 Ping Groups.");
   s.groups.push(newGroup(s.groups.length+1));s.groupIndex=s.groups.length-1;
   return reply(i,draftPanel(s));
  }
  if(command==="draft:finish"){
   // Templates contain no message text; staff fill it in when using the template.
   // A Ping Group can also have no roles until activation.
   const valid=s.groups.map(g=>normalizePingGroup({...g,messages:[]},{allowEmpty:true}));
   const base={name:s.name,nameKey:s.name.toLowerCase(),description:s.description,
    updatedBy:i.user.id,groups:valid};
   let t;
   if(s.editId){
    t=await PingTemplate.findOneAndUpdate({_id:s.editId,guildId:i.guildId},{$set:base},{new:true,runValidators:true});
    if(!t)throw Error("This template was removed while editing.");
   }else{
    t=await PingTemplate.create({...base,guildId:i.guildId,createdBy:i.user.id});
   }
   sessions.delete(key(i));
   return reply(i,{content:"**Template saved: "+t.name+"**\n"+t.groups.length+
    " Ping Group(s). Timing and roles are saved. Open Saved Templates → Use Template to add messages and review the schedule."});
  }
 }
 if(command==="select:group"){
  const s=editorState(i);
  const idx=Number(i.values?.[0]);
  if(!Number.isInteger(idx)||idx<0||idx>=s.groups.length)throw Error("Choose a Ping Group.");
  s.groupIndex=idx;
  return reply(i,draftPanel(s));
 }
 if(command==="select:draftRoles"){
  const s=editorState(i);s.groups[s.groupIndex].roleIds=i.values||[];
  return reply(i,draftPanel(s));
 }
 if(command==="activation:cancel"){sessions.delete(key(i));return reply(i,{content:"Activation cancelled. The saved template remains unchanged."});}
 if(command.startsWith("activation:")){
  const s=stateFor(i);
  if(s.phase!=="activation")throw Error("Open an activation preview first.");
  if(command==="activation:groups")return reply(i,activationSetupPanel(s));
  if(command==="activation:review"){
   const missing=s.workingGroups.findIndex((g,index)=>!groupReady(s,index));
   if(missing>=0)throw Error("Ping Group "+(missing+1)+" needs a message or role before preview.");
   return activationPanel(i,s);
  }
  if(command==="activation:prev")s.page=Math.max(0,(s.page||0)-1);
  if(command==="activation:next"){
   const total=(await eventsForActivation(s)).length;
   s.page=Math.min(Math.ceil(total/10)-1,(s.page||0)+1);
  }
  if(command==="activation:start"){
   const current=inputParts(s.startAt,s.timeZone);
   return i.showModal(modal(i,"start","Schedule Start — Server Time",[
    ["date","Date (YYYY-MM-DD)",current.date,TextInputStyle.Short,10],
    ["time","Time (9:00 AM or 21:00)",current.time,TextInputStyle.Short,12]
   ]));
  }
  if(command==="activation:confirm"){
   await i.deferUpdate();
   const template=await PingTemplate.findOne({_id:s.template._id,guildId:i.guildId});
   if(!template)throw Error("This template was removed.");
   const schedule=await activatePingSchedule({guild:i.guild,template,scheduleId:s.scheduleId,
    channelId:s.destinationChannelId,startAt:s.startAt,timeZone:s.timeZone,actorId:i.user.id,
    overrides:{groups:s.workingGroups,events:s.overrides}});
   const dashboard=await refreshPingDashboard(i.client,i.guildId);
   sessions.delete(key(i));
   return reply(i,{content:"**Schedule activated!**\n"+schedule.name+
    "\nDestination: <#"+schedule.destinationChannelId+">\n"+
    schedule.plannedCount+" messages planned."+(dashboard?"":" The staff dashboard could not be refreshed.")});
  }
  return activationPanel(i,s);
 }
 if(command==="select:activationGroup"){
  const s=stateFor(i);
  if(s.phase!=="activation")throw Error("Open the activation preview first.");
  s.selectedGroupIndex=Number(i.values?.[0]);
  if(!Number.isInteger(s.selectedGroupIndex)||s.selectedGroupIndex<0||s.selectedGroupIndex>=s.workingGroups.length)
   throw Error("Choose a valid Ping Group.");
  s.selectedMessageIndex=0;
  return reply(i,activationGroupPanel(s));
 }
 if(command.startsWith("group:")){
  const s=stateFor(i);
  if(s.phase!=="activation"||!s.workingGroups)throw Error("Open a template activation first.");
  if(command==="group:applyTiming" || command==="group:keepTiming"){
   if(!s.pendingTiming)throw Error("Open the timing editor again.");
   if(command==="group:applyTiming")Object.assign(s,{workingGroups:s.pendingTiming.groups,overrides:s.pendingTiming.overrides,page:0});
   delete s.pendingTiming;
   return reply(i,activationGroupPanel(s));
  }
  if(command==="group:back")return reply(i,activationSetupPanel(s));
  if(command==="group:return")return reply(i,activationGroupPanel(s));
  const g=s.workingGroups[s.selectedGroupIndex];
  if(!g)throw Error("Select a Ping Group first.");
  if(command==="group:timing")return i.showModal(modal(i,"groupTiming","Customize Group Timing",[
   ["name","Ping Group Name",g.name,TextInputStyle.Short,60],
   ["repeatMode","Frequency: once, hours, days",g.repeatMode,TextInputStyle.Short,8],
   ["interval","Repeat every X hours / days",g.interval,TextInputStyle.Short,3],
   ["days","Duration in days",g.durationDays,TextInputStyle.Short,3],
   ["offset","Start delay in hours",g.offsetHours,TextInputStyle.Short,3]
  ]));
  if(command==="group:roles")return reply(i,{content:"**Change All Group Roles**\nThese roles apply to every ping in this group's schedule copy.",
   components:[new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder()
    .setCustomId("pings:select:groupRoles").setPlaceholder("Choose up to 10 roles")
    .setMinValues(1).setMaxValues(10)),
    row(["No Group Roles","group:clearRoles"],["Back","group:return"])]});
  if(command==="group:clearRoles"){
   g.roleIds=[];return reply(i,activationGroupPanel(s));
  }
  if(command==="group:addText"||command==="group:editText"){
   const selected=s.selectedMessageIndex||0;
   if(command==="group:editText"&&!g.messages[selected])throw Error("Choose a message first.");
   return i.showModal(modal(i,command==="group:addText"?"groupAddText":"groupEditText",
    command==="group:addText"?"Add Rotating Message":"Edit Rotating Message",[
     ["content","Message text",command==="group:editText"?g.messages[selected]:"",TextInputStyle.Paragraph,1800,true]
   ]));
  }
  if(command==="group:removeSelected"){
   const selected=s.selectedMessageIndex||0;
   if(!g.messages[selected])throw Error("Choose a message to remove.");
   const messages=g.messages.filter((_,index)=>index!==selected);
   s.workingGroups[s.selectedGroupIndex]=normalizePingGroup({...g,messages},{allowEmpty:true});
   s.selectedMessageIndex=Math.max(0,Math.min(selected,messages.length-1));
   return reply(i,activationGroupPanel(s));
  }
 }
 if(command==="select:groupMessage"){
  const s=stateFor(i),g=s.workingGroups?.[s.selectedGroupIndex];
  if(s.phase!=="activation"||!g)throw Error("Select a Ping Group first.");
  const selected=Number(i.values?.[0]);
  if(!Number.isInteger(selected)||selected<0||selected>=g.messages.length)
   throw Error("Choose a message from this group.");
  s.selectedMessageIndex=selected;
  return reply(i,activationGroupPanel(s));
 }
 if(command==="select:groupRoles"){
  const s=stateFor(i),g=s.workingGroups?.[s.selectedGroupIndex];
  if(s.phase!=="activation"||!g)throw Error("Select a Ping Group first.");
  g.roleIds=[...i.values];
  return reply(i,activationGroupPanel(s));
 }
 if(command==="select:planned"){
  const s=stateFor(i);
  if(s.phase!=="activation")throw Error("Return to the activation preview.");
  s.selectedEvent=Number(i.values?.[0]);
  const e=(await eventsForActivation(s)).find(e=>e.sequence===s.selectedEvent);
  if(!e)throw Error("That scheduled message was not found.");
  return reply(i,plannedEventPanel(s,e));
 }
 if(command==="event:back"){
  const s=selectedInput(i);
  if(s.phase==="activation")return activationPanel(i,s);
  if(s.phase==="management")return reply(i,managementPanel(s));
 }
 if(command==="event:roles"){
  const s=selectedInput(i);
  return reply(i,{content:"**Edit roles for one upcoming ping**\nChoose up to 10 roles. To remove all mentions, use the No Roles button.",
   components:[new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder()
    .setCustomId("pings:select:eventRoles").setPlaceholder("Choose roles").setMinValues(1).setMaxValues(10)),
    row(["No Roles","event:clearRoles"],["Back","event:back"])]});
 }
 if(command==="event:clearRoles"||command==="select:eventRoles"){
  const s=selectedInput(i),roles=command==="event:clearRoles"?[]:i.values||[];
  if(s.phase==="activation"){
   const current=(await eventsForActivation(s)).find(e=>e.sequence===s.selectedEvent);
   if(!current)throw Error("That ping is missing.");
   if(!roles.length&&!current.content)throw Error("A ping must have text or roles.");
   const entry=s.overrides.find(x=>x.sequence===current.sequence)||{sequence:current.sequence};
   entry.roleIds=roles;
   s.overrides=[...s.overrides.filter(x=>x.sequence!==current.sequence),entry];
   return reply(i,plannedEventPanel(s,(await eventsForActivation(s)).find(e=>e.sequence===s.selectedEvent)));
  }
  const e=await PingDelivery.findById(s.selectedEvent);
  if(!e||String(e.scheduleId)!==String(s.schedule._id))throw Error("Ping missing.");
  const changed=await changeFuturePing(i.client,s.schedule,e,i.user.id,{roleIds:roles});
  return reply(i,plannedEventPanel(s,changed));
 }
 if(command==="event:text"){
  const s=selectedInput(i);
  const e=s.phase==="activation"
   ?(await eventsForActivation(s)).find(x=>x.sequence===s.selectedEvent)
   :await PingDelivery.findById(s.selectedEvent).lean();
  return i.showModal(modal(i,"eventText","Edit One Ping Message",[
   ["content","Message text (blank = roles only)",e?.content||"",TextInputStyle.Paragraph,1800,false]
  ]));
 }
 if(command==="event:time"){
  const s=selectedInput(i);
  const zone=s.phase==="activation"?s.timeZone:(s.schedule.timeZone||"UTC");
  const e=s.phase==="activation"?(await eventsForActivation(s)).find(x=>x.sequence===s.selectedEvent)
   :await PingDelivery.findById(s.selectedEvent).lean();
  const current=inputParts(e.dueAt,zone);
  return i.showModal(modal(i,"eventTime","Edit Ping Time — Server Clock",[
   ["date","Date (YYYY-MM-DD)",current.date,TextInputStyle.Short,10],
   ["time","Time (9:00 AM or 21:00)",current.time,TextInputStyle.Short,12]
  ]));
 }
 if(command==="select:schedule"){
  const s=stateFor(i);
  const d=await PingSchedule.findOne({_id:i.values?.[0],guildId:i.guildId}).lean();
  if(!d||!["active","paused"].includes(d.status))throw Error("Schedule is no longer active.");
  s.phase="management";s.schedule=d;
  return reply(i,managementPanel(s));
 }
 if(command.startsWith("manage:")){
  const s=stateFor(i);
  if(command==="manage:list")return activeList(i,s.page);
  if(!["management","futureList"].includes(s.phase))throw Error("Select an active schedule first.");
  s.schedule=await PingSchedule.findOne({_id:s.schedule._id,guildId:i.guildId}).lean();
  if(!s.schedule)throw Error("Schedule not found.");
  if(command==="manage:back"){s.phase="management";return reply(i,managementPanel(s));}
  if(command==="manage:toggle"){
   if(s.schedule.status==="active")await pausePingSchedule(i.client,s.schedule,i.user.id);
   else await resumePingSchedule(i.client,s.schedule,i.user.id);
   s.schedule=await PingSchedule.findById(s.schedule._id).lean();
   return reply(i,managementPanel(s));
  }
  if(command==="manage:future"){s.futurePage=0;return futureList(i,s);}
  if(command==="manage:futurePrev"||command==="manage:futureNext"){
   s.futurePage=Math.max(0,(s.futurePage||0)+(command.endsWith("Next")?1:-1));
   return futureList(i,s);
  }
  if(command==="manage:end")return reply(i,{content:"End **"+s.schedule.name+"** in <#"+s.schedule.destinationChannelId+"> early?",
   components:[row(["Continue to Reason","manage:endReason",ButtonStyle.Danger],["Cancel","manage:back"])]});
  if(command==="manage:endReason")return i.showModal(modal(i,"end","End Schedule Early",[
   ["reason","Reason (required)","",TextInputStyle.Paragraph,500]
  ]));
  if(command==="manage:extend")return i.showModal(modal(i,"extend","Extend Schedule",[
   ["days","Additional days","",TextInputStyle.Short,3]
  ]));
  if(command==="manage:history"){
   const changes=await PingAudit.find({scheduleId:s.schedule._id}).sort({createdAt:-1}).limit(15).lean();
   return reply(i,{content:"**Recent Staff Changes — "+s.schedule.name+"**\n"+
    (changes.length?changes.map(c=>ts(c.createdAt)+" · "+c.event+" · <@"+c.actorId+">\n"+
     short(JSON.stringify(c.details))).join("\n"):"No changes recorded."),
    components:[row(["Back","manage:back"])]});
  }
 }
 if(command==="select:future"){
  const s=stateFor(i);
  const d=await PingDelivery.findOne({_id:i.values?.[0],guildId:i.guildId,
   scheduleId:s.schedule?._id,status:"pending"}).lean();
  if(!d)throw Error("This upcoming ping is no longer available.");
  s.phase="management";s.selectedEvent=String(d._id);
  return reply(i,plannedEventPanel(s,d));
 }
 if(command==="upcoming:prev"||command==="upcoming:next"){
  const s=stateFor(i);
  return upcomingList(i,Math.max(0,s.page+(command.endsWith("next")?1:-1)));
 }
 throw Error("That Scheduled Pings control is no longer available.");
}
