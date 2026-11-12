import GuildConfig from "../models/GuildConfig.js";
import ActivityGiveawayOptIn from "../models/ActivityGiveawayOptIn.js";
import {revokeActivityParticipationForBan} from "./activity-participation.js";

// A Discord member-update event is only delivered if the optional Guild
// Members gateway intent is enabled. Reconciliation also works without that
// intent and repairs active opt-ins after downtime or missed role updates.
const cursors=new Map();
let running=false;

export async function handleActivityGiveawayBanRoleUpdate(oldMember,newMember,now=new Date()){
 const guildId=newMember?.guild?.id||oldMember?.guild?.id;
 const userId=newMember?.id||oldMember?.id;
 if(!guildId||!userId)return false;
 const config=await GuildConfig.findOne({guildId}).select("giveawayExcludedRoleId").lean();
 const roleId=config?.giveawayExcludedRoleId;
 if(!roleId||!newMember?.roles?.cache?.has(roleId))return false;
 return revokeActivityParticipationForBan(guildId,userId,now);
}

export async function reconcileBannedActivityOptIns(client,{batchSize=40,now=new Date()}={}){
 if(running)return 0;
 running=true;
 let revoked=0;
 try{
  const configs=await GuildConfig.find({
   giveawayExcludedRoleId:{$type:"string",$ne:""},
  }).select("guildId giveawayExcludedRoleId").lean();
  for(const config of configs){
   const guildId=config.guildId,roleId=config.giveawayExcludedRoleId;
   const previousCursor=cursors.get(guildId)||"";
   let entries=await ActivityGiveawayOptIn.find({
    guildId,active:true,...(previousCursor?{userId:{$gt:previousCursor}}:{}),
   }).sort({userId:1}).limit(batchSize).lean();
   if(!entries.length&&previousCursor){
    cursors.delete(guildId);
    entries=await ActivityGiveawayOptIn.find({guildId,active:true})
      .sort({userId:1}).limit(batchSize).lean();
   }
   if(!entries.length){
    cursors.delete(guildId);
    continue;
   }
   if(entries.length===batchSize)cursors.set(guildId,String(entries.at(-1).userId));
   else cursors.delete(guildId);
   let guild;
   try{guild=await client.guilds.fetch(guildId);}
   catch(error){
    console.warn("[Giveaways] Could not check activity opt-in bans for guild:",guildId,error);
    continue;
   }
   for(const entry of entries){
    let member;
    try{member=await guild.members.fetch({user:entry.userId,force:true});}
    catch(error){
     if(error?.code!==10007)console.warn("[Giveaways] Could not verify activity opt-in ban:",guildId,entry.userId,error);
     continue;
    }
    if(member?.roles?.cache?.has(roleId))
     revoked+=Number(await revokeActivityParticipationForBan(guildId,entry.userId,now));
   }
  }
  return revoked;
 }finally{running=false;}
}
