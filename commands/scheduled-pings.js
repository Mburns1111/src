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
import {
 activatePingSchedule,changeFuturePing,endPingSchedule,ensurePingDashboard,
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
 if(!i.isModalSubmit() && i.message?.flags?.has(MessageFlags.Ephemeral))
  return i.update({...payload,allowedMentions:{parse:[]}});
 return i.reply({...payload,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
}
const modal=(id,title,inputs)=>{
 const m=new ModalBuilder().setCustomId("pings:modal:"+id).setTitle(title);
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
const summaryGroup=g=>"**"+g.name+"** · "+(g.repeatMode==="once"?"Once":"Every "+g.interval+" "+(g.repeatMode==="days"?"days":"hours"))+
 " · "+g.durationDays+" days · Delay "+g.offsetHours+"h\n"+
 "Roles: "+showRoles(g.roleIds)+"\nMessages: "+g.messages.length+
 (g.messages.length?" · "+short(g.messages[0]):" · role-only");
function draftPanel(s){
 const g=s.groups[s.groupIndex],lines=[
  "**✦ "+(s.editId?"Edit Saved Template":"Create Template")+"**",
  "**Name:** "+s.name,
  s.description?short(s.description):"",
  "**Ping Group "+(s.groupIndex+1)+" of "+s.groups.length+"**",
  summaryGroup(g),"",
  "*Configure this group, then add another or save the template.*"
 ];
 const components=[
  row(["Set Timing","draft:timing"],["Select Roles","draft:roles"],["Add Message","draft:message"]),
  row(["Remove Last Message","draft:removeMessage"],["Add Another Group","draft:add"],["Previous Group","draft:previous"]),
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
   " · "+g.durationDays+" days · "+g.roleIds.length+" role(s) · "+g.messages.length+" message(s)").join("\n")+
  "\n\n*Using a template creates an independent schedule in one channel.*",
  components:[row(["Use Template","template:use",ButtonStyle.Success],
    ["Edit Template","template:edit"],["Delete Template","template:delete",ButtonStyle.Danger])]};
}
async function activeList(i){
 const schedules=await PingSchedule.find({guildId:i.guildId,status:{$in:["active","paused"]}})
  .sort({startsAt:-1}).limit(25).lean();
 if(!schedules.length)return reply(i,{content:"**Active Schedules**\nThere are no active schedules."});
 sessions.set(key(i),{phase:"scheduleList",expires:Date.now()+EXPIRES});
 return reply(i,{content:"**Manage Schedules**\nChoose one schedule. Each schedule posts in only one channel.",
  components:[new ActionRowBuilder().addComponents(
   new StringSelectMenuBuilder().setCustomId("pings:select:schedule")
    .setPlaceholder("Choose an active schedule")
    .addOptions(schedules.map(s=>({label:s.name.slice(0,100),value:String(s._id),
     description:s.status+" · "+s.sentCount+"/"+s.plannedCount+" sent"})))
  )]});
}
function managementPanel(s){
 const d=s.schedule;
 return {content:"**✦ "+d.name+"**\n**Status:** "+d.status+
  "\n**Destination:** <#"+d.destinationChannelId+">"+
  "\n**Started:** "+ts(d.startsAt)+" · **Ends:** "+ts(d.endsAt)+
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
function activationGroupPanel(s){
 const g=s.workingGroups[s.selectedGroupIndex];
 if(!g)throw Error("Select a Ping Group.");
 return {content:"**Customize Ping Group "+(s.selectedGroupIndex+1)+"**\n"+
  summaryGroup(g)+"\n\n"+
  (g.messages.length?g.messages.slice(0,8).map((m,i)=>"Message "+(i+1)+": "+short(m)).join("\n")+
   (g.messages.length>8?"\n…plus "+(g.messages.length-8)+" more rotating messages.":""):
   "This group only sends role mentions.")+
  "\n\n*Edits apply to this activation only. The saved template remains unchanged.*",
  components:[
   row(["Set Timing","group:timing"],["Select Roles","group:roles"],
    ["Replace Messages","group:replaceText"]),
   row(["Add Rotating Text","group:addText"],["Remove Last Message","group:removeMessage"],
    ["Back to Preview","group:back"])
  ]};
}
async function eventsForActivation(s){
 const raw=planPingDeliveries(s.workingGroups||s.template.groups,s.startAt);
 const custom=new Map((s.overrides||[]).map(e=>[e.sequence,e]));
 return raw.map(e=>({...e,...(custom.get(e.sequence)||{})}))
  .sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt));
}
function previewRows(events,page){
 const offset=page*10;
 const items=events.slice(offset,offset+10);
 const lines=items.map(e=>"#"+e.sequence+" "+ts(e.dueAt)+" · Group "+(e.groupIndex+1)+
  " · "+e.roleIds.length+" role(s) · "+short(e.content||"(roles only)"));
 return {items,text:lines.join("\n"),total:events.length};
}
async function activationPanel(i,s){
 const events=await eventsForActivation(s);
 const {items,text,total}=previewRows(events,s.page||0);
 const components=[];
 if(items.length)components.push(new ActionRowBuilder().addComponents(
  new StringSelectMenuBuilder().setCustomId("pings:select:planned")
   .setPlaceholder("Select an individual ping to customize")
   .addOptions(items.map(e=>({label:"Ping #"+e.sequence+" · Group "+(e.groupIndex+1),
    value:String(e.sequence),description:new Date(e.dueAt).toISOString().slice(0,16)})))));
 components.push(row(["Earlier","activation:prev"],["Later","activation:next"],["Change Start","activation:start"],["Edit Ping Groups","activation:groups"]));
 components.push(row(["Activate Schedule","activation:confirm",ButtonStyle.Success],
  ["Cancel","activation:cancel",ButtonStyle.Danger]));
 return reply(i,{content:"**✦ Review & Activate**\n**Template:** "+s.template.name+
  "\n**One destination:** <#"+s.destinationChannelId+">"+
  "\n**Start:** "+ts(s.startAt)+"\n**Total messages:** "+total+
  "\n**Preview page:** "+((s.page||0)+1)+"/"+Math.max(1,Math.ceil(total/10))+
  "\n\n"+(text||"No pings in this window.")+
  "\n\n*Select a ping to override its text, roles or time. All groups remain in this single channel.*",
  components});
}
function plannedEventPanel(s,event){
 return {content:"**Customize Ping #"+event.sequence+"**\nGroup "+(event.groupIndex+1)+
  "\n**Time:** "+ts(event.dueAt)+"\n**Roles:** "+showRoles(event.roleIds)+
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
 return reply(i,{content:"**Future Pings — "+s.schedule.name+"** · Page "+((s.futurePage||0)+1)+"\nChoose a message to edit. Individual changes are saved and audited immediately.",
  components:[new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
   .setCustomId("pings:select:future").setPlaceholder("Choose a future ping")
   .addOptions(deliveries.map(d=>({label:"Ping #"+d.sequence+" · Group "+(d.groupIndex+1),
    value:String(d._id),description:new Date(d.dueAt).toISOString().slice(0,16)})))),
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
async function upcomingList(i,page=0){
 const schedules=await PingSchedule.find({guildId:i.guildId,status:"active"}).select("_id name").lean();
 const allowed=new Map(schedules.map(s=>[String(s._id),s.name]));
 const all=await PingDelivery.find({guildId:i.guildId,status:"pending",scheduleId:{$in:schedules.map(s=>s._id)}})
  .sort({dueAt:1}).skip(page*20).limit(20).lean();
 const s={phase:"upcoming",page,expires:Date.now()+EXPIRES};
 sessions.set(key(i),s);
 return reply(i,{content:"**Full Upcoming Schedule** · Page "+(page+1)+"\n"+
  (all.length?all.map(e=>"• "+ts(e.dueAt)+" — "+short(allowed.get(String(e.scheduleId)))+
    " · Group "+(e.groupIndex+1)).join("\n"):"No more upcoming messages."),
  components:[row(["Previous","upcoming:prev"],["Next","upcoming:next"])]});
}
function selectedInput(i){
 const s=stateFor(i);
 if(!s.selectedEvent)throw Error("Select an upcoming message first.");
 return s;
}
function fromDateInput(input){
 const text=String(input||"").trim();
 const date=new Date(text);
 if(!Number.isFinite(date.getTime()))throw Error("Enter an ISO date with a timezone, for example 2026-11-14T09:00:00-05:00.");
 if(date<Date.now())throw Error("Choose a future date.");
 return date;
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
  Object.assign(g,{
   name:field(i,"name"),repeatMode:field(i,"repeatMode").toLowerCase(),
   interval:Number(field(i,"interval")),durationDays:Number(field(i,"days")),
   offsetHours:Number(field(i,"offset")),
  });
  s.workingGroups[s.selectedGroupIndex]=normalizePingGroup(g);
  // Indexes of newly generated pings may change when frequency is edited.
  s.overrides=[];s.page=0;
  return reply(i,activationGroupPanel(s));
 }
 if(id==="groupReplaceText"||id==="groupAddText"){
  if(s.phase!=="activation")throw Error("Activation expired.");
  const g=s.workingGroups[s.selectedGroupIndex];
  const value=field(i,"content");
  if(!value)throw Error("Enter message text.");
  if(id==="groupReplaceText")g.messages=[value];
  else{
   if(g.messages.length>=20)throw Error("This group already has 20 rotating messages.");
   g.messages.push(value);
  }
  s.workingGroups[s.selectedGroupIndex]=normalizePingGroup(g);
  return reply(i,activationGroupPanel(s));
 }
 if(id==="message"){
  if(s.phase!=="draft")throw Error("This editor is no longer active.");
  const g=s.groups[s.groupIndex];
  if(g.messages.length>=20)throw Error("This group already has 20 rotating messages.");
  g.messages.push(field(i,"content"));
  return reply(i,draftPanel(s));
 }
 if(id==="start"){
  if(s.phase!=="activation")throw Error("Open an activation preview first.");
  s.startAt=fromDateInput(field(i,"date"));s.page=0;s.overrides=[];
  return activationPanel(i,s);
 }
 if(id==="eventText"||id==="eventTime"){
  if(s.phase!=="activation"&&s.phase!=="management")throw Error("Select a future ping first.");
  const value=field(i,id==="eventText"?"content":"date");
  if(s.phase==="activation"){
   const events=await eventsForActivation(s);
   const event=events.find(e=>e.sequence===s.selectedEvent);
   if(!event)throw Error("That ping is no longer available.");
   const base=s.overrides.find(x=>x.sequence===event.sequence)||{sequence:event.sequence};
   if(id==="eventText")base.content=value;
   else base.dueAt=fromDateInput(value);
   s.overrides=[...s.overrides.filter(x=>x.sequence!==event.sequence),base];
   const updated=(await eventsForActivation(s)).find(e=>e.sequence===s.selectedEvent);
   return reply(i,plannedEventPanel(s,updated));
  }
  const e=await PingDelivery.findById(s.selectedEvent);
  if(!e||String(e.scheduleId)!==String(s.schedule._id))throw Error("That ping cannot be edited.");
  await changeFuturePing(i.client,s.schedule,e,i.user.id,id==="eventText"?{content:value}:{dueAt:fromDateInput(value)});
  s.schedule=await PingSchedule.findById(s.schedule._id).lean();
  const latest=await PingDelivery.findById(e._id).lean();
  return reply(i,plannedEventPanel(s,latest));
 }
 if(id==="end"){
  if(s.phase!=="management")throw Error("Choose a schedule first.");
  const reason=field(i,"reason");
  if(!reason)throw Error("Enter a reason for ending this schedule.");
  await endPingSchedule(i.client,s.schedule,i.user.id,reason);
  sessions.delete(key(i));
  return reply(i,{content:"Schedule ended and sent to the shared archive. Reason: "+reason});
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

export async function handleScheduledPingsInteraction(i){
 if(!i.guildId||!i.guild)return reply(i,{content:"Scheduled Pings must be managed in a server."});
 if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
  return reply(i,{content:"Manage Server permission is required to control scheduled role mentions."});
 const config=await GuildConfig.findOne({guildId:i.guildId}).lean();
 if(!config?.scheduledPingsChannelId||i.channelId!==config.scheduledPingsChannelId)
  return reply(i,{content:"Use the permanent Scheduled Pings dashboard in the configured private staff channel."});
 if(i.isModalSubmit())return modalSubmit(i,i.customId.split(":").slice(2).join(":"));
 const command=i.customId.replace(/^pings:/,"");
 if(command==="root:create")return i.showModal(modal("templateName","Create Scheduled Ping Template",[
  ["name","Template name","",TextInputStyle.Short,80],
  ["description","Optional description","",TextInputStyle.Paragraph,300,false],
 ]));
 if(command==="root:templates")return savedTemplatesPanel(i);
 if(command==="root:active")return activeList(i);
 if(command==="root:upcoming")return upcomingList(i);
 if(command==="root:archives")return archivesList(i);
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
   groups:t.groups.map(g=>({...g,roleIds:[...g.roleIds],messages:[...g.messages]})),groupIndex:0});
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
  await validatePingDestination(i.guild,channelId,s.template.groups.flatMap(g=>g.roleIds||[]));
  Object.assign(s,{phase:"activation",destinationChannelId:channelId,
   startAt:new Date(Date.now()+5*60_000),page:0,overrides:[],
   workingGroups:s.template.groups.map(g=>({...g,roleIds:[...g.roleIds],messages:[...g.messages]}))});
  return activationPanel(i,s);
 }
 if(command==="draft:cancel"){sessions.delete(key(i));return reply(i,{content:"Template editor closed. No changes saved."});}
 if(command.startsWith("draft:")){
  const s=editorState(i),g=s.groups[s.groupIndex];
  if(command==="draft:timing")return i.showModal(modal("timing","Edit Ping Group Timing",[
   ["name","Ping Group name",g.name,TextInputStyle.Short,60],
   ["repeatMode","Frequency: once, hours or days",g.repeatMode,TextInputStyle.Short,8],
   ["interval","Repeat every X hours/days",g.interval,TextInputStyle.Short,3],
   ["days","Duration (days, 1–365)",g.durationDays,TextInputStyle.Short,3],
   ["offset","First ping delay (hours)",g.offsetHours,TextInputStyle.Short,3]
  ]));
  if(command==="draft:message")return i.showModal(modal("message","Add Rotating Message",[
   ["content","Message (roles added separately)","",TextInputStyle.Paragraph,1800]
  ]));
  if(command==="draft:removeMessage"){g.messages.pop();return reply(i,draftPanel(s));}
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
   s.groups[s.groupIndex]=normalizePingGroup(g);
   if(s.groups.length>=10)throw Error("A template supports at most 10 Ping Groups.");
   s.groups.push(newGroup(s.groups.length+1));s.groupIndex=s.groups.length-1;
   return reply(i,draftPanel(s));
  }
  if(command==="draft:finish"){
   const groups=s.groups.slice();
   // An accidentally added, untouched final group may be omitted.
   if(s.groupIndex===groups.length-1&&!g.roleIds.length&&!g.messages.length&&groups.length>1)groups.pop();
   else groups[s.groupIndex]=normalizePingGroup(g);
   const valid=groups.map(normalizePingGroup);
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
    " Ping Group(s). No messages have been scheduled. Select Saved Templates on the dashboard to use it."});
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
  if(command==="activation:groups"){
   const picker=new StringSelectMenuBuilder().setCustomId("pings:select:activationGroup")
    .setPlaceholder("Choose a Ping Group to customize")
    .addOptions(s.workingGroups.map((g,index)=>({label:g.name.slice(0,100),value:String(index)})));
   return reply(i,{content:"**Customize Ping Groups**\nChange timing, roles or messages in this schedule copy without editing the saved template.",
    components:[new ActionRowBuilder().addComponents(picker),row(["Back to Preview","group:back"])]});
  }
  if(command==="activation:prev")s.page=Math.max(0,(s.page||0)-1);
  if(command==="activation:next"){
   const total=(await eventsForActivation(s)).length;
   s.page=Math.min(Math.ceil(total/10)-1,(s.page||0)+1);
  }
  if(command==="activation:start")return i.showModal(modal("start","Schedule Start Time",[
   ["date","ISO date/time incl timezone","",TextInputStyle.Short,40]
  ]));
  if(command==="activation:confirm"){
   const template=await PingTemplate.findOne({_id:s.template._id,guildId:i.guildId});
   if(!template)throw Error("This template was removed.");
   const schedule=await activatePingSchedule({guild:i.guild,template,
    channelId:s.destinationChannelId,startAt:s.startAt,actorId:i.user.id,
    overrides:{groups:s.workingGroups,events:s.overrides}});
   sessions.delete(key(i));
   return reply(i,{content:"**Schedule activated!**\n"+schedule.name+
    "\nDestination: <#"+schedule.destinationChannelId+">\n"+
    schedule.plannedCount+" messages planned. The permanent staff dashboard has been updated."});
  }
  return activationPanel(i,s);
 }
 if(command==="select:activationGroup"){
  const s=stateFor(i);
  if(s.phase!=="activation")throw Error("Open the activation preview first.");
  s.selectedGroupIndex=Number(i.values?.[0]);
  return reply(i,activationGroupPanel(s));
 }
 if(command.startsWith("group:")){
  const s=stateFor(i);
  if(s.phase!=="activation"||!s.workingGroups)throw Error("Open a template activation first.");
  if(command==="group:back")return activationPanel(i,s);
  const g=s.workingGroups[s.selectedGroupIndex];
  if(!g)throw Error("Select a Ping Group first.");
  if(command==="group:timing")return i.showModal(modal("groupTiming","Customize Group Timing",[
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
    row(["No Group Roles","group:clearRoles"],["Back","group:back"])]});
  if(command==="group:clearRoles"){
   if(!g.messages.length)throw Error("This group needs text or at least one role.");
   g.roleIds=[];return reply(i,activationGroupPanel(s));
  }
  if(command==="group:replaceText"||command==="group:addText")
   return i.showModal(modal(command==="group:addText"?"groupAddText":"groupReplaceText",
    command==="group:addText"?"Add Rotating Message":"Replace Group Messages",[
     ["content","Message text","",TextInputStyle.Paragraph,1800,true]
   ]));
  if(command==="group:removeMessage"){
   if(g.messages.length===1&&!g.roleIds.length)throw Error("This group needs text or at least one role.");
   g.messages.pop();return reply(i,activationGroupPanel(s));
  }
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
  if(s.phase==="management")return managementPanel(s);
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
  return i.showModal(modal("eventText","Edit One Ping Message",[
   ["content","Message text (blank = roles only)",e?.content||"",TextInputStyle.Paragraph,1800,false]
  ]));
 }
 if(command==="event:time"){
  selectedInput(i);
  return i.showModal(modal("eventTime","Change One Ping's Time",[
   ["date","ISO date/time incl timezone","",TextInputStyle.Short,40]
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
  if(command==="manage:list")return activeList(i);
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
  if(command==="manage:end")return i.showModal(modal("end","End Schedule Early",[
   ["reason","Reason (required)","",TextInputStyle.Paragraph,500]
  ]));
  if(command==="manage:extend")return i.showModal(modal("extend","Extend Schedule",[
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
