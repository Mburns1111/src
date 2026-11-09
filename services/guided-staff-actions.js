import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle,StringSelectMenuBuilder,MessageFlags,PermissionFlagsBits} from "discord.js";
import Giveaway from "../models/Giveaway.js";
import GuildConfig from "../models/GuildConfig.js";
import {activityRoster,ensureStaffCard,maxActiveDays} from "./guided-activity.js";
import {closeGiveaway,publishGiveawayResult} from "./giveaways.js";
import {publishGiveawayReview,refreshGiveawayReviewMessage} from "./giveaway-review.js";
import {publishActivityOneOffListing} from "./giveaway-directory.js";
import {ensureBannerRegistered} from "./giveaway-banners.js";
import {parseEasternAnnouncement} from "./giveaway-plan-time.js";
import {GuidedActivitySeries,nextOpening,windowEnd,resetGuidedActivityCriteria} from "./guided-activity.js";

// Match the creation wizard; changes to the current giveaway are distinct from
// changes to future cycles. Rule changes require an explicit RESET because the
// bot does not store old Discord messages for replaying.
export const GUIDED_EDIT_FIELDS=[
  {label:"Giveaway title",value:"title",description:"Change the displayed title"},
  {label:"Prize",value:"prize",description:"Edit the prize"},
  {label:"Giveaway Details",value:"description",description:"Edit or remove the custom description"},
  {label:"Number of winners",value:"winnerCount",description:"1–10 winners"},
  {label:"Total message goal",value:"activityMinTotalMessages",description:"Total messages for this activity"},
  {label:"Different active days",value:"activityDays",description:"Days with at least one qualifying message"},
  {label:"Activity ends",value:"activityEndAt",description:"Edit counting cutoff in Eastern time"},
  {label:"Winner announcement",value:"endsAt",description:"Edit draw date and time (Eastern)"},
  {label:"Manual approval",value:"requireStaffReview",description:"On or off: staff approve winners"},
  {label:"Check My Progress",value:"progressEnabled",description:"On or off: members see private progress"},
  {label:"Bonus roles",value:"roleBonuses",description:"Add, change or clear bonus chances"},
  {label:"Required role",value:"requiredRoleId",description:"Role required before counting; resets activity"},
  {label:"Show role instructions",value:"showRequiredRoleInstructions",description:"On/off: show where to get the role"},
  {label:"Claim time",value:"claimWindowHours",description:"Hours a winner has to claim"},
  {label:"Claim instructions",value:"claimInstructions",description:"Replace or reset the prize collection message"},
  {label:"Maximum auto rerolls",value:"maxAutoRerolls",description:"0–10 replacements for each unclaimed winner"},
  {label:"Notification roles",value:"notificationRoleIds",description:"Up to 10 roles, comma or space separated"},
  {label:"No eligible winners",value:"announceEmptyResults",description:"Announce an empty result: on or off"},
  {label:"Banner",value:"bannerNameKey",description:"Saved banner name, or default"},
  {label:"Watched channel",value:"activityChannelIds",description:"Change channel; resets prior activity"},
  {label:"Required member ping",value:"activityRequiredMentionUserId",description:"Change ping; resets prior activity"},
  {label:"Required word or phrase",value:"activityRequiredPhrase",description:"Change phrase; resets prior activity"},
  {label:"Future repeats",value:"repeatSchedule",description:"Edit next cycles, not the current one"},
  {label:"Counting start",value:"activityStartAt",description:"Started already; cannot backdate counts"},
];
const criteriaFields=new Set(["activityChannelIds","activityRequiredMentionUserId","activityRequiredPhrase","requiredRoleId"]);
const inputMax={title:100,prize:1500,description:1000,winnerCount:2,
  activityMinTotalMessages:5,activityDays:3,claimWindowHours:3,bannerNameKey:60,
  requireStaffReview:3,progressEnabled:3,showRequiredRoleInstructions:3,
  roleBonuses:350,activityChannelIds:100,
  activityRequiredMentionUserId:100,activityRequiredPhrase:120,requiredRoleId:100,
  endsAt:16,activityEndAt:16,repeatSchedule:80,
  claimInstructions:1000,maxAutoRerolls:2,notificationRoleIds:350,announceEmptyResults:3};
const inputHint={
  description:"Leave empty to remove details",
  bannerNameKey:"Saved banner name or default",
  requireStaffReview:"on or off",
  progressEnabled:"on or off",
  showRequiredRoleInstructions:"on or off (hide for restricted giveaways)",
  roleBonuses:"@role 2  /  @role remove  /  clear",
  activityChannelIds:"#channel, channel ID, or all",
  activityRequiredMentionUserId:"@member, user ID, or none",
  requiredRoleId:"@role, role ID, default, or none; resets counting",
  activityRequiredPhrase:"Exact spelling and word order; capitals ignored",
  activityEndAt:"YYYY-MM-DD HH:mm Eastern",
  endsAt:"YYYY-MM-DD HH:mm Eastern",
  repeatSchedule:"once, daily, weekly, every 3 hours",
  claimInstructions:"Enter custom instructions, or leave blank for server default",
  maxAutoRerolls:"0–10; default 2",
  notificationRoleIds:"@role @role, or none",
  announceEmptyResults:"on or off",
};

export function validateGuidedStaffEdit(field,raw,event,{now=new Date()}={}){
  const value=String(raw??"").trim();
  if(!GUIDED_EDIT_FIELDS.some(x=>x.value===field)||field==="activityStartAt")
    throw Error("The counting start cannot be edited after the activity begins.");
  if(field==="claimInstructions"){
    if(value.length>1000)throw Error("Claim instructions cannot exceed 1,000 characters.");
    return {claimInstructions:value};
  }
  if(field==="notificationRoleIds"){
    if(!value || /^(none|clear|off)$/i.test(value))return {notificationRoleIds:[]};
    const ids=[...value.matchAll(/(?:<@&(\d{17,20})>|(\d{17,20}))/g)].map(x=>x[1]||x[2]);
    if(value.replace(/(?:<@&\d{17,20}>|\d{17,20})/g,"").replace(/[\s,]+/g,"") || !ids.length||ids.length>10)
      throw Error("Enter up to 10 role mentions or IDs separated by spaces or commas, or none.");
    return {notificationRoleIds:[...new Set(ids)]};
  }
  if(field==="description"){
    if(value.length>1000)throw Error("Giveaway Details cannot exceed 1,000 characters.");
    return {description:value};
  }
  if(field==="bannerNameKey"){
    if(value.length>60)throw Error("Banner name cannot exceed 60 characters.");
    return {bannerNameKey:/^(default|none|clear)$/i.test(value)?"":value};
  }
  if(["requireStaffReview","progressEnabled","announceEmptyResults","showRequiredRoleInstructions"].includes(field)){
    if(!/^(on|off)$/i.test(value))throw Error('Enter "on" or "off".');
    return {[field]:value.toLowerCase()==="on"};
  }
  if(["title","prize"].includes(field)){
    if(!value||value.length>(field==="title"?100:1500))
      throw Error("Enter 1–"+(field==="title"?"100":"1500")+" characters.");
    return {[field]:value};
  }
  if(field==="activityChannelIds"){
    if(/^(all|none|clear)$/i.test(value))return {activityChannelIds:[],activityType:"general"};
    const match=/^(?:<#(\d{17,20})>|(\d{17,20}))$/.exec(value);
    if(!match)throw Error("Enter #channel, a channel ID, or all.");
    return {activityChannelIds:[match[1]||match[2]],activityType:"channels"};
  }
  if(field==="requiredRoleId"){
    if(/^(none|clear|off)$/i.test(value))return {requiredRoleId:"",requiredRoleInstructions:""};
    if(/^default$/i.test(value))return {requiredRoleId:"__server_default__"};
    const match=/^(?:<@&(\d{17,20})>|(\d{17,20}))$/.exec(value);
    if(!match)throw Error("Enter @role, a role ID, or none.");
    return {requiredRoleId:match[1]||match[2]};
  }
  if(field==="activityRequiredMentionUserId"){
    if(/^(none|clear|off)$/i.test(value))return {activityRequiredMentionUserId:""};
    const match=/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/.exec(value);
    if(!match)throw Error("Enter an explicit member mention, ID, or none.");
    return {activityRequiredMentionUserId:match[1]||match[2]};
  }
  if(field==="activityRequiredPhrase"){
    if(value.length>120)throw Error("Phrase must be at most 120 characters.");
    return {activityRequiredPhrase:value};
  }
  if(field==="endsAt"||field==="activityEndAt"){
    const date=parseEasternAnnouncement(value,{now});
    if(field==="endsAt"&&date<new Date(event.activityEndAt))
      throw Error("The winner announcement cannot be before counting ends.");
    if(field==="activityEndAt"&&date<=new Date(event.activityStartAt))
      throw Error("The activity cutoff must be after counting starts.");
    return {[field]:date};
  }
  if(field==="roleBonuses"){
    if(/^clear$/i.test(value))return {roleBonuses:[]};
    const match=/^(?:<@&(\d{17,20})>|(\d{17,20}))\s+(remove|[1-9]\d?)$/i.exec(value);
    if(!match)throw Error("Use @role 2 to set chances, @role remove, or clear.");
    const roleId=match[1]||match[2];
    const amount=match[3].toLowerCase();
    if(amount!=="remove"&&Number(amount)>20)throw Error("Role bonuses must be between 1 and 20.");
    const roles=(event.roleBonuses||[]).filter(b=>b.roleId!==roleId);
    if(amount!=="remove"){
      if(roles.length>=20)throw Error("At most 20 bonus roles can be configured.");
      roles.push({roleId,extraEntries:Number(amount)});
    }
    return {roleBonuses:roles};
  }
  if(field==="repeatSchedule"){
    if(/^(once|off|stop)$/i.test(value))return {repeat:"once"};
    if(/^(daily|weekly)$/i.test(value))return {repeat:value.toLowerCase()};
    const match=/^every\s+(\d{1,6})\s+(minute|minutes|hour|hours|day|days)$/i.exec(value);
    if(!match)throw Error("Use once, daily, weekly, or every 3 hours.");
    const amount=Number(match[1]);
    const unit=match[2].toLowerCase().replace(/s$/,"")+"s";
    const interval=amount*{minutes:1,hours:60,days:1440}[unit];
    if(interval>525600||interval<1)throw Error("Repeat interval must be 1–525600 minutes.");
    return {repeat:"custom",amount,unit,interval};
  }
  const bounds={winnerCount:[1,10],activityMinTotalMessages:[1,10000],
    activityDays:[1,maxActiveDays(new Date(event.activityStartAt),new Date(event.activityEndAt))],
    claimWindowHours:[1,720],maxAutoRerolls:[0,10]};
  const bound=bounds[field];
  if(!bound)throw Error("That setting is unavailable.");
  const [min,max]=bound;
  const number=Number(value);
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(number)||number<min||number>max)
    throw Error("Enter a whole number from "+min+" to "+max+".");
  return {[field]:number};
}
async function refreshPublished(client,event){
  const jobs=await Promise.allSettled([
    ensureStaffCard(client,event),
    publishActivityOneOffListing(client,event),
  ]);
  for(const result of jobs)if(result.status==="rejected")
    console.error("[Giveaways] Staff change was saved but a Discord post needs retry:",result.reason);
  return jobs.every(x=>x.status==="fulfilled");
}
const button=(label,customId,style=ButtonStyle.Secondary)=>
  new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
const confirmRow=(id,action)=>new ActionRowBuilder().addComponents(
  button("Confirm "+(action==="end"?"End Early":"Cancellation"),
    "activitystaff:confirm"+action+":"+id,ButtonStyle.Danger),
  button("Keep Giveaway", "activitystaff:abort:"+id)
);

function editMenu(id){
 return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
   .setCustomId("activitystaff:select:"+id)
   .setPlaceholder("Choose a giveaway setting")
   .addOptions(GUIDED_EDIT_FIELDS));
}

function editModal(event,field){
 const chosen=GUIDED_EDIT_FIELDS.find(x=>x.value===field);
 if(!chosen || field==="activityStartAt")
   throw Error("Counting has already started; the start cannot be backdated.");
 let old=event[field];
 if(field==="bannerNameKey")old=old||"default";
 if(["requireStaffReview","progressEnabled","announceEmptyResults","showRequiredRoleInstructions"].includes(field))old=old?"on":"off";
 if(field==="notificationRoleIds")old=(event.notificationRoleIds||[]).map(id=>"<@&"+id+">").join(" ");
 if(field==="activityChannelIds")old=event.activityChannelIds?.length?"<#"+event.activityChannelIds[0]+">":"all";
 if(field==="activityRequiredMentionUserId")old=old?"<@"+old+">":"none";
 if(field==="requiredRoleId")old=old?"<@&"+old+">":"none";
 if(field==="activityRequiredPhrase")old=old||"";
 // These fields have custom syntax or Eastern time inputs. Do not prefill
 // them with UTC timestamps or stringified MongoDB objects.
 if(["activityEndAt","endsAt","roleBonuses","repeatSchedule"].includes(field))old="";
 const input=new TextInputBuilder().setCustomId("value")
   .setLabel(chosen.label.slice(0,45))
   .setStyle(["description","prize","claimInstructions"].includes(field)?TextInputStyle.Paragraph:TextInputStyle.Short)
   .setRequired(!["description","bannerNameKey","activityRequiredPhrase","claimInstructions","notificationRoleIds"].includes(field))
   .setMaxLength(inputMax[field]);
 if(inputHint[field])input.setPlaceholder(inputHint[field]);
 if(old!==null&&old!==undefined&&String(old).length)
   input.setValue(String(old).slice(0,inputMax[field]));
 const modal=new ModalBuilder().setCustomId("activitystaff:save:"+event._id+":"+field)
   .setTitle("Edit: "+chosen.label)
   .addComponents(new ActionRowBuilder().addComponents(input));
 if(criteriaFields.has(field)){
   const reset=new TextInputBuilder().setCustomId("reset")
     .setLabel("Type RESET to restart activity tracking")
     .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5)
     .setPlaceholder("RESET: previous messages will not qualify");
   modal.addComponents(new ActionRowBuilder().addComponents(reset));
 }
 return modal;
}
export function describeGuidedStaffOptions(event){
 const channel=event.activityChannelIds?.length?"<#"+event.activityChannelIds[0]+">":"All eligible channels";
 const fmt=date=>date&&Number.isFinite(new Date(date).getTime())
   ?"<t:"+Math.floor(new Date(date).getTime()/1000)+":F>":"Not set";
 return [
   "**Edit this activity giveaway**",
   "**Giveaway post:** Title · Prize · Giveaway Details · Banner",
   "**Qualification:** Total message goal · Active days · Watched channel · Member ping · Required phrase · Required role · Role instructions visibility",
   "*Exact phrases require correct spelling and word order; capitalization does not matter.*",
   "**Timing:** Activity cutoff · Winner announcement",
   "**Drawing:** Winners · Manual approval · Bonus roles · Claim time · Max rerolls · Member progress",
   "**Claiming:** Claim instructions · Notification roles · No eligible winners behavior",
   "**Future giveaways:** Repeat schedule (changes future starts only)",
   "",
   "**Current settings**",
   "Watch: "+channel+" · Goal: "+(event.activityMinTotalMessages||1)+" total message(s)",
   "Required role: "+(event.requiredRoleId?"<@&"+event.requiredRoleId+">":"None")+
     " · Acquisition instructions: "+(event.showRequiredRoleInstructions!==false?"Shown to members":"Hidden from members"),
   "Counting ends: "+fmt(event.activityEndAt)+" · Draws: "+fmt(event.endsAt),
   "Approval: "+(event.requireStaffReview?"On":"Off")+" · Progress: "+(event.progressEnabled?"On":"Off"),
   "",
   "*Changing the watched channel, ping, or phrase restarts counting from the edit. Old messages are never backfilled. The modal requires RESET confirmation.*",
   "*Counting start cannot be backdated. Other edits affect only this giveaway unless you choose Future repeats.*",
 ].join("\n");
}

export async function updateGuidedRepeatSchedule(event,change,{now=new Date()}={}){
 const series=await GuidedActivitySeries.findOne({_id:event.guidedSeries,guildId:event.guildId}).lean();
 if(!series)throw Error("The repeating giveaway setup could not be found.");
 const settings={...series.settings,...change};
 if(settings.repeat==="once"){
   await GuidedActivitySeries.updateOne({_id:series._id,guildId:event.guildId},
     {$set:{settings,enabled:false,nextStart:null}});
   return {enabled:false,nextStart:null};
 }
 const first=new Date(event.activityStartAt);
 let next=nextOpening(settings,first);
 const activeLength=windowEnd(settings,first)-first;
 if(!Number.isFinite(+next)||next<=first || next-first<activeLength)
   throw Error("The repeat interval is shorter than the activity period. Choose a longer interval.");
 if(next<new Date(event.activityEndAt))
   throw Error("That repeat would start before the current giveaway finishes.");
 for(let n=0;next<=now&&n<525600;n++){
   const advanced=nextOpening(settings,next);
   if(advanced<=next)throw Error("The repeat interval must move forward in time.");
   next=advanced;
 }
 if(next<=now)throw Error("Unable to determine a valid upcoming repeat.");
 await GuidedActivitySeries.updateOne({_id:series._id,guildId:event.guildId},
   {$set:{settings,enabled:true,nextStart:next}});
 return {enabled:true,nextStart:next};
}

export async function handleGuidedStaffAction(i){
 const ephemeral={flags:MessageFlags.Ephemeral};
 try{
   if(!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
     return i.reply({content:"Only staff with Manage Server can edit activity giveaways.",...ephemeral});
   const match=/^activitystaff:(end|cancel|edit|select|save|confirmend|confirmcancel|abort):([0-9a-f]{24})(?::([A-Za-z]+))?$/.exec(i.customId);
   if(!match)return i.reply({content:"Unknown activity staff action.",...ephemeral});
   const [,action,id,field]=match;
   const event=await Giveaway.findOne({_id:id,guildId:i.guildId,staffCardChannelId:i.channelId,guidedSeries:{$type:"objectId"}}).lean();
   if(!event)return i.reply({content:"That activity giveaway is no longer available in this staff channel.",...ephemeral});
   if(["end","cancel","edit"].includes(action)&&event.staffCardId!==i.message?.id)
     return i.reply({content:"Use the current staff activity card for this action.",...ephemeral});
   if(action==="select"){
     if(event.status!=="open")return i.reply({content:"Only an active giveaway can be edited.",...ephemeral});
     const selected=i.values?.[0];
     if(selected==="activityStartAt")
       return i.reply({content:"Counting already started. You cannot backdate its start. To change the watched channel or filters, choose that setting and confirm RESET to start a new counting window.",...ephemeral});
     return i.showModal(editModal(event,selected));
   }
   await i.deferReply(ephemeral);
   if(action==="abort")return i.editReply("No changes made. The giveaway remains as it was.");
   if(action==="edit"){
     if(event.status!=="open")return i.editReply("Only an active giveaway can be edited.");
     return i.editReply({content:describeGuidedStaffOptions(event),
       components:[editMenu(id)],allowedMentions:{parse:[]}});
   }
   if(action==="save"){
     if(event.status!=="open")return i.editReply("The giveaway already ended or was cancelled.");
     const changes=validateGuidedStaffEdit(field,i.fields.getTextInputValue("value"),event);
     if(field==="repeatSchedule"){
       const plan=await updateGuidedRepeatSchedule(event,changes);
       await ensureStaffCard(i.client,event);
       return i.editReply(plan.enabled?
         "Future repeats updated. Next activity starts <t:"+Math.floor(+new Date(plan.nextStart)/1000)+":F>. This giveaway is unchanged.":
         "Future repeats stopped. This giveaway will continue until its current cutoff.");
     }
     if(field==="bannerNameKey"&&changes.bannerNameKey)
       changes.bannerNameKey=await ensureBannerRegistered(i.guildId,changes.bannerNameKey);
     if(field==="notificationRoleIds"){
       for(const id of changes.notificationRoleIds){
         const role=await i.guild.roles.fetch(id).catch(()=>null);
         if(!role||role.id===i.guildId)throw Error("A selected notification role is not on this server.");
       }
     }
     if(field==="requiredRoleId"&&changes.requiredRoleId==="__server_default__"){
       const cfg=await GuildConfig.findOne({guildId:i.guildId}).lean();
       changes.requiredRoleId=cfg?.giveawayDefaultRequiredRoleId||"";
       changes.requiredRoleInstructions=changes.requiredRoleId?cfg?.giveawayRoleInstructions||"":"";
     }
     if(field==="requiredRoleId"&&changes.requiredRoleId){
        const role=await i.guild.roles.fetch(changes.requiredRoleId).catch(()=>null);
        if(!role||role.id===i.guild.id)throw Error("Choose an existing server role.");
        const config=await GuildConfig.findOne({guildId:i.guildId}).lean();
        changes.requiredRoleInstructions=config?.giveawayRoleInstructions||"";
      }
      if(field==="roleBonuses"){
       const entered=String(i.fields.getTextInputValue("value"));
       if(!/^clear$/i.test(entered)){
         const match=/^(?:<@&(\d{17,20})>|(\d{17,20}))\s+/.exec(entered);
         const role=match&&await i.guild.roles.fetch(match[1]||match[2]).catch(()=>null);
         if(!role && !/remove$/i.test(entered))
           throw Error("That bonus role isn't available in this server.");
       }
     }
     if(field==="activityChannelIds" && changes.activityChannelIds.length){
       const channel=await i.guild.channels.fetch(changes.activityChannelIds[0]).catch(()=>null);
       if(!channel?.isTextBased() ||
           !channel.permissionsFor(i.guild.members.me)?.has(PermissionFlagsBits.ViewChannel))
         throw Error("Choose a text channel that the bot can read.");
     }
     if(field==="activityRequiredMentionUserId"&&changes.activityRequiredMentionUserId){
       const member=await i.guild.members.fetch(changes.activityRequiredMentionUserId).catch(()=>null);
       if(!member||member.user?.bot)throw Error("Choose a real member of this server.");
     }
     let updated;
     if(criteriaFields.has(field)){
       if(i.fields.getTextInputValue("reset")!=="RESET")
         throw Error('Type RESET to restart tracking; previous message counts cannot be carried over.');
       // An unchanged filter doesn't require throwing away valid activity.
       const before=field==="activityChannelIds"?JSON.stringify(event.activityChannelIds||[]):
         String(event[field]||"");
       const after=field==="activityChannelIds"?JSON.stringify(changes.activityChannelIds):
         String(changes[field]||"");
       if(before===after)return i.editReply("That rule is already set. No activity counts were reset.");
       updated=await resetGuidedActivityCriteria(event,changes);
       if(!updated)return i.editReply("This activity is no longer open.");
     }else{
       if(field==="activityEndAt"){
         const nextCutoff=new Date(changes.activityEndAt);
         const series=await GuidedActivitySeries.findOne({_id:event.guidedSeries,guildId:i.guildId}).lean();
         if(series?.enabled&&series.nextStart&&nextCutoff>new Date(series.nextStart))
           throw Error("Counting cannot extend into the next scheduled giveaway. Edit future repeats first.");
         if(event.activityDays>maxActiveDays(new Date(event.activityStartAt),nextCutoff))
           throw Error("There are not enough days in that window for the required active-day goal.");
         const lag=Math.max(0,new Date(event.endsAt)-new Date(event.activityEndAt));
         changes.customActivityEndAt=nextCutoff;
         changes.endsAt=new Date(+nextCutoff+lag);
       }
       updated=await Giveaway.findOneAndUpdate({_id:event._id,guildId:i.guildId,status:"open"},
         {$set:changes},{returnDocument:"after"}).lean();
       if(!updated)return i.editReply("Another staff member already ended this giveaway.");
     }
     const refreshed=await refreshPublished(i.client,updated);
     return i.editReply("Updated **"+GUIDED_EDIT_FIELDS.find(x=>x.value===field).label+
       "** for this activity. "+(criteriaFields.has(field)?
       "Counting restarted now; previous activity no longer qualifies. ":"Future repeats are unchanged. ")+
       (refreshed?"":"A Discord post may need the next refresh."));
   }
   if(["end","cancel"].includes(action)){
     if(event.status!=="open")return i.editReply("This giveaway is no longer collecting activity.");
     return i.editReply({content:action==="end"?
       "**End this giveaway early?** Counting will stop now and eligible members will be entered for the drawing. If manual approval is enabled, staff must approve before winners are announced. Future repeats will continue.":
       "**Cancel this giveaway?** It will close without choosing winners or awarding prizes. The public activity listing will be removed. Future repeats will continue.",
       components:[confirmRow(id,action)],allowedMentions:{parse:[]}});
   }
   if(!["confirmend","confirmcancel"].includes(action))return i.editReply("Unsupported action.");
   if(event.status!=="open")return i.editReply("Another staff member has already finished or cancelled this activity.");
   const now=new Date();
   if(action==="confirmcancel"){
     const updated=await Giveaway.findOneAndUpdate({_id:event._id,guildId:i.guildId,status:"open"},
       {$set:{status:"cancelled",endsAt:now,activityEndAt:now,customActivityEndAt:now,
         staffCancelledBy:i.user.id}},{returnDocument:"after"}).lean();
     if(!updated)return i.editReply("This giveaway has already been changed.");
     const refreshed=await refreshPublished(i.client,updated);
     return i.editReply("Cancelled the **current giveaway** without drawing winners. "+
       "Future repeats are unchanged."+(refreshed?"":" The listing cleanup may need another refresh."));
   }
   const roster=await activityRoster(event);
   const eligible=roster.filter(row=>row.qualified).map(row=>row._id);
   const updated=await Giveaway.findOneAndUpdate({_id:event._id,guildId:i.guildId,status:"open"},
     {$set:{status:event.requireStaffReview?"pending_review":"closing",endsAt:now,
       activityEndAt:now,customActivityEndAt:now,entrantIds:eligible,
       activityCandidateCount:roster.length,activityCheckedAt:now,
       staffEndedEarly:true,staffEndedBy:i.user.id}},{returnDocument:"after"}).lean();
   if(!updated)return i.editReply("This giveaway has already been changed.");
   let final=updated,publication="Results saved.";
   try{
     if(updated.requireStaffReview){
       await publishGiveawayReview(i.client,updated);
       publication="A staff approval card was posted before drawing winners.";
     }else{
       final=await closeGiveaway({id:updated._id,guildId:i.guildId,now,client:i.client});
       if(final?.status==="ended"){
         await publishGiveawayResult(i.client,final);
         publication=(final.winnerIds?.length||0)+" winner(s) announced in the results channel.";
       }else publication="The bot will finish the drawing on its next sweep.";
     }
   }catch(error){
     console.error("[Giveaways] Early ending saved; announcement may need a retry:",error);
     publication="The end was saved, but the drawing or Discord announcement will need a retry.";
   }
   await refreshPublished(i.client,final);
   return i.editReply("Ended the **current giveaway** early. "+
     eligible.length+" member(s) qualified when counting stopped. "+publication+
     " Future repeats are unchanged.");
 }catch(error){
   console.error("[Giveaways] Staff control action failed:",error);
   const msg="Couldn't complete that staff action: "+String(error.message||"Unknown error").slice(0,350);
   if(i.deferred||i.replied)return i.editReply(msg);
   return i.reply({content:msg,...ephemeral});
 }
}
