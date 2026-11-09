import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ModalBuilder,TextInputBuilder,TextInputStyle,StringSelectMenuBuilder,MessageFlags,PermissionFlagsBits} from "discord.js";
import Giveaway from "../models/Giveaway.js";
import {activityRoster,ensureStaffCard,maxActiveDays} from "./guided-activity.js";
import {closeGiveaway,publishGiveawayResult} from "./giveaways.js";
import {publishGiveawayReview,refreshGiveawayReviewMessage} from "./giveaway-review.js";
import {publishActivityOneOffListing} from "./giveaway-directory.js";
import {ensureBannerRegistered} from "./giveaway-banners.js";

export const GUIDED_EDIT_FIELDS=[
  {label:"Giveaway title",value:"title",description:"Change the displayed giveaway title"},
  {label:"Prize",value:"prize",description:"Change what the winner receives"},
  {label:"Giveaway details",value:"description",description:"Add or remove the event description"},
  {label:"Number of winners",value:"winnerCount",description:"1 to 10 winners"},
  {label:"Total message goal",value:"activityMinTotalMessages",description:"Messages across the entire activity period"},
  {label:"Different active days",value:"activityDays",description:"Days with at least one matching message"},
  {label:"Claim window (hours)",value:"claimWindowHours",description:"Winner claim deadline in hours"},
  {label:"Banner",value:"bannerNameKey",description:"Saved banner name or default"},
  {label:"Check My Progress",value:"progressEnabled",description:"Enter on or off"},
];
const inputMax={title:100,prize:1500,description:1000,winnerCount:2,
  activityMinTotalMessages:5,activityDays:3,claimWindowHours:3,bannerNameKey:60,progressEnabled:3};
const inputHint={description:"Leave empty to remove details",bannerNameKey:"Saved banner name or default",
  progressEnabled:"on or off"};

export function validateGuidedStaffEdit(field,raw,event) {
  const value=String(raw??"").trim();
  if(!GUIDED_EDIT_FIELDS.some(x=>x.value===field))throw Error("This setting cannot be edited.");
  if(field==="description"){
    if(value.length>1000)throw Error("Giveaway Details cannot exceed 1,000 characters.");
    return {description:value};
  }
  if(field==="bannerNameKey"){
    if(value.length>60)throw Error("Banner name cannot exceed 60 characters.");
    return {bannerNameKey:/^(default|none|clear)$/i.test(value)?"":value};
  }
  if(field==="progressEnabled"){
    if(!/^(on|off)$/i.test(value))throw Error('Enter "on" or "off".');
    return {progressEnabled:value.toLowerCase()==="on"};
  }
  if(["title","prize"].includes(field)){
    if(!value||value.length>(field==="title"?100:1500))
      throw Error("Enter 1–"+(field==="title"?"100":"1500")+" characters.");
    return {[field]:value};
  }
  const bounds={winnerCount:[1,10],activityMinTotalMessages:[1,10000],
    activityDays:[1,maxActiveDays(new Date(event.activityStartAt),new Date(event.activityEndAt))],
    claimWindowHours:[1,720]};
  const [min,max]=bounds[field];
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
 if(!chosen)throw Error("That giveaway setting is unavailable.");
 let old=event[field];
 if(field==="bannerNameKey")old=old||"default";
 if(field==="progressEnabled")old=old?"on":"off";
 const input=new TextInputBuilder().setCustomId("value")
   .setLabel(chosen.label.slice(0,45))
   .setStyle(["description","prize"].includes(field)?TextInputStyle.Paragraph:TextInputStyle.Short)
   .setRequired(!["description","bannerNameKey"].includes(field))
   .setMaxLength(inputMax[field]);
 if(inputHint[field])input.setPlaceholder(inputHint[field]);
 if(old!==null&&old!==undefined&&String(old).length)input.setValue(String(old).slice(0,inputMax[field]));
 return new ModalBuilder().setCustomId("activitystaff:save:"+event._id+":"+field)
   .setTitle("Edit: "+chosen.label)
   .addComponents(new ActionRowBuilder().addComponents(input));
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
     return i.showModal(editModal(event,i.values?.[0]));
   }
   await i.deferReply(ephemeral);
   if(action==="abort")return i.editReply("No changes made. The giveaway remains as it was.");
   if(action==="edit"){
     if(event.status!=="open")return i.editReply("Only an active giveaway can be edited.");
     return i.editReply({content:"Edit **this giveaway only**. Future repeats keep their original settings. Ping/phrase filters are intentionally locked because previous messages cannot be rechecked.",
       components:[editMenu(id)],allowedMentions:{parse:[]}});
   }
   if(action==="save"){
     if(event.status!=="open")return i.editReply("The giveaway already ended or was cancelled.");
     const changes=validateGuidedStaffEdit(field,i.fields.getTextInputValue("value"),event);
     if(field==="bannerNameKey"&&changes.bannerNameKey)
       changes.bannerNameKey=await ensureBannerRegistered(i.guildId,changes.bannerNameKey);
     const updated=await Giveaway.findOneAndUpdate({_id:event._id,guildId:i.guildId,status:"open"},
       {$set:changes},{returnDocument:"after"}).lean();
     if(!updated)return i.editReply("Another staff member already ended this giveaway.");
     const refreshed=await refreshPublished(i.client,updated);
     return i.editReply("Updated **"+GUIDED_EDIT_FIELDS.find(x=>x.value===field).label+
       "** for this activity. Future repeats are unchanged."+
       (refreshed?"":" A Discord post may need the next refresh."));
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
