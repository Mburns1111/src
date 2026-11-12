import Giveaway from "../models/Giveaway.js";
import {getConfiguredTextChannelAndConfig} from "../commands/shared.js";
import {requirePrivateGiveawayStaffChannel,ensureGiveawayStaffRecord} from "./giveaway-staff-records.js";
import {sharedGiveawayPingRoleId} from "./giveaway-notification-roles.js";
import {ensureBannerRegistered} from "./giveaway-banners.js";
import {giveawayAnnouncementWithBanner,maxRegularGiveawayMinutes} from "./giveaways.js";
import {DEFAULT_CLAIM_HOURS,DEFAULT_MAX_AUTO_REROLLS} from "./giveaway-claims.js";

const nonempty=(value,label,max,min=1)=>{
  const string=String(value||"").trim();
  if(string.length<min||string.length>max)
    throw Error(label+" must be "+min+"–"+max+" characters.");
  return string;
};
const integer=(value,label,min,max)=>{
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max)
    throw Error(label+" must be a whole number from "+min+" to "+max+".");
  return n;
};

// Used by the guided /giveaway start wizard and temporarily by already-cached
// old /giveaway start slash interactions. Public posting, entry rules, claim
// tracking and the private staff record all use the existing giveaway services.
export async function createRegularGiveaway({guild,client,guildId,creatorId,settings}){
  if(!guild||!guildId||!creatorId)throw Error("Run this giveaway from a Discord server.");
  const title=nonempty(settings.title,"Giveaway title",100,2);
  const prize=nonempty(settings.prize,"Prize",1500,2);
  const description=String(settings.description||"").trim();
  const rules=String(settings.rules||"").trim();
  if(description.length>1000)throw Error("Giveaway description must be 1,000 characters or fewer.");
  if(rules.length>1200)throw Error("Giveaway rules must be 1,200 characters or fewer.");
  const minutes=integer(settings.minutes,"Giveaway duration",1,maxRegularGiveawayMinutes());
  const winners=integer(settings.winners??1,"Winner count",1,10);
  const {channel,config}=await getConfiguredTextChannelAndConfig(
    {guild,guildId},"giveawayChannelId","standard giveaway");
  await requirePrivateGiveawayStaffChannel(guild,config);
  if(!config?.giveawayExcludedRoleId)throw Error("Configure the required Giveaway Banned role in /setup giveaways first.");

  const mode=settings.requiredRoleMode||"default";
  if(!["default","none","custom"].includes(mode))throw Error("Invalid giveaway eligibility option.");
  const roleId=mode==="none"?"":mode==="custom"?
    String(settings.requiredRoleId||""):String(config?.giveawayDefaultRequiredRoleId||"");
  if(roleId&&!/^\d{17,20}$/.test(roleId))
    throw Error("The required role must belong to this Discord server.");
  if(mode==="custom"){
    const role=await guild.roles?.fetch?.(roleId).catch(()=>null);
    if(!role||role.id===guildId)throw Error("The required entry role is no longer available.");
  }
  const showRoleInstructions=settings.showRequiredRoleInstructions==null?
    config?.giveawayShowRoleInstructions!==false:
    settings.showRequiredRoleInstructions!==false;
  const claimHours=integer(settings.claimHours??config?.activityClaimWindowHours??DEFAULT_CLAIM_HOURS,
    "Claim window",1,720);
  const claimInstructions=settings.claimInstructions==null?
    String(config?.activityClaimInstructions||""):String(settings.claimInstructions);
  if(claimInstructions.length>1000)throw Error("Claim instructions must be 1,000 characters or fewer.");
  const pingRoleId=sharedGiveawayPingRoleId(config);
  const pingRoleIds=pingRoleId?[pingRoleId]:[];
  // Blank bannerNameKey inherits the saved default without overwriting it.
  const bannerNameKey=await ensureBannerRegistered(guildId,settings.bannerNameKey||"");
  const values={
    guildId,channelId:channel.id,creatorId,title,prize,description,rules,
    endsAt:new Date(Date.now()+minutes*60000),winnerCount:winners,
    claimWindowHours:claimHours,claimWindowMinutes:null,
    autoRerollClaims:true,
    winnerCooldownEnabled:settings.winnerCooldownEnabled===true,
    trialTicketClaimsEnabled:false,
    maxAutoRerolls:config?.activityMaxAutoRerolls??DEFAULT_MAX_AUTO_REROLLS,
    claimInstructions,
    requiredRoleId:roleId,
    requiredRoleInstructions:settings.roleInstructions==null?
      (config?.giveawayRoleInstructions||""):String(settings.roleInstructions).slice(0,500),
    showRequiredRoleInstructions:showRoleInstructions,
    announcementPingRoleId:pingRoleId,announcementPingRoleIds:pingRoleIds,
    bannerNameKey,mode:"standard",status:"publishing",
  };
  const record=await Giveaway.create(values);
  let message;
  try{
    const announcement=await giveawayAnnouncementWithBanner({
      ...record.toObject(),status:"open",
    });
    if(pingRoleId){
      announcement.content="<@&"+pingRoleId+">";
      announcement.allowedMentions={parse:[],roles:pingRoleIds};
    }
    message=await channel.send(announcement);
    await Giveaway.updateOne(
      {_id:record._id,status:"publishing"},
      {$set:{status:"open",messageId:message.id}});
  }catch(error){
    await Giveaway.updateOne({_id:record._id},{$set:{status:"failed"}}).catch(()=>{});
    if(message)await message.delete?.().catch(()=>{});
    throw error;
  }
  try{
    await ensureGiveawayStaffRecord(client,{
      ...record.toObject(),status:"open",messageId:message.id,
    });
  }catch(error){
    console.error("[Giveaways] Staff record on creation failed:",error);
  }
  return {record,message};
}
