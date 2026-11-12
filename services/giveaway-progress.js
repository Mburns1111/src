import {activityRoster} from "./guided-activity.js";
import GuildConfig from "../models/GuildConfig.js";
import {MessageFlags} from "discord.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayWatchRule from "../models/GiveawayWatchRule.js";
import {memberActivityProgress} from "./giveaway-activity-counter.js";
import {planActivityWindow} from "./giveaway-plans.js";
import {weightForMember} from "./giveaway-role-weights.js";

export async function handleActivityGiveawayProgress(interaction) {
 await interaction.deferReply({flags:MessageFlags.Ephemeral});
 try {
  const match=/^activity-progress:(plan|event):([a-f0-9]{24})$/.exec(interaction.customId);
  if(!match||!interaction.guildId)return interaction.editReply("This activity progress link is invalid.");
  const isPlan=match[1]==="plan";
  const item=await (isPlan?GiveawayPlan:Giveaway).findOne({
    _id:match[2],guildId:interaction.guildId,
  }).lean();
  if(!item?.progressEnabled || item.listMessageId!==interaction.message?.id ||
     item.listChannelId!==interaction.channelId ||
     (isPlan?item.status!=="active":item.status!=="open"))
    return interaction.editReply("Progress tracking is unavailable for this giveaway.");
  const config=await GuildConfig.findOne({guildId:interaction.guildId})
    .select("activityParticipationRoleId activityParticipationRoleConfiguredAt activityParticipationRoleInstructions").lean();
  const optInRole=config?.activityParticipationRoleId;
  if(!optInRole)
    return interaction.editReply("Activity giveaways are paused until staff configure an Activity Participation role in /setup activity-giveaways.");
  const currentMember=await interaction.guild.members.fetch({user:interaction.user.id,force:true}).catch(()=>null);
  if(!currentMember?.roles?.cache?.has(optInRole))
    return interaction.editReply({content:"**Opt in first:** Get the Activity Participation role <@&"+optInRole+">.\n"+
      (config?.activityParticipationRoleInstructions||"Ask staff where to select this role.")+
      "\nOnly messages sent while holding the role count toward activity giveaways.",allowedMentions:{parse:[]}});
  if(item.guidedSeries){
    if(item.requiredRoleId!==optInRole)
      return interaction.editReply("This older activity needs to be updated to the current Activity Participation role before counting can resume.");
    if(item.requiredRoleId){
      const member=await interaction.guild.members.fetch({user:interaction.user.id,force:true}).catch(()=>null);
      if(!member?.roles?.cache?.has(item.requiredRoleId))
        return interaction.editReply({content:"**Required role:** <@&"+item.requiredRoleId+">\n"+
          (item.showRequiredRoleInstructions!==false&&item.requiredRoleInstructions?
            "**Where to get it:** "+item.requiredRoleInstructions+"\n":"")+
          "Activity messages do not count until you hold this role.",allowedMentions:{parse:[]}});
    }
    const [row]=await activityRoster(item,interaction.user.id);
    return interaction.editReply({content:[
      "**"+item.title+"** · "+(row?.qualified?"Qualified":"Not yet qualified"),
      (row?.messages||0)+" / "+(item.activityMinTotalMessages||item.activityMinimum)+" matching message(s) total"+
        (item.activityDays>1?" · "+(row?.days||0)+"/"+item.activityDays+" active days":"")
    ].join("\n"),allowedMentions:{parse:[]}});
  }
  const rule=isPlan && item.watchNameKey!=="general"
    ? await GiveawayWatchRule.findOne({guildId:interaction.guildId,nameKey:item.watchNameKey}).lean()
    :!isPlan && item.activityRuleId ? {
      _id:item.activityRuleId,criteriaVersion:item.activityRuleCriteriaVersion||0,
      channelId:item.activityChannelIds?.[0],
      minimumChars:item.activityMinChars,minimumMessages:item.activityMinimum,
      activeDays:item.activityDays,requiredMentionUserId:item.activityRequiredMentionUserId,
      requiredPhrase:item.activityRequiredPhrase,roleBonuses:item.roleBonuses,
    }:null;
  const period=isPlan?item.activityPeriod:item.activityPeriod;
  const customStart=isPlan?item.customActivityStartAt:item.customActivityStartAt;
  const customEnd=isPlan?item.customActivityEndAt:item.customActivityEndAt;
  const now=new Date(),custom=customStart&&customEnd;
  const settings=isPlan?{
    minimumTotalMessages:item.minimumTotalMessages??rule?.minimumTotalMessages??1,
    minimum:rule?.minimumMessages??1,
    days:period==="daily"&&!custom?1:rule?.activeDays??1,
    minimumChars:rule?.minimumChars??1,
    type:rule?"channels":"general",
    channelIds:rule?[rule.channelId]:[],
  }:{
    minimumTotalMessages:item.activityMinTotalMessages||1,
    minimum:item.activityMinimum||1,
    days:item.activityDays||1,
    minimumChars:item.activityMinChars||1,
    type:item.activityType||"general",
    channelIds:item.activityChannelIds||[],
  };
  const nextWindow=isPlan?planActivityWindow(item,item.nextRunAt):null;
  const periodStart=custom?new Date(customStart):
    isPlan?nextWindow.startAt:
      new Date(item.activityStartAt);
  const periodEnd=custom?new Date(customEnd):
    isPlan?nextWindow.endAt:new Date(item.activityEndAt);
  const configuredAt=config.activityParticipationRoleConfiguredAt;
  const roleStart=configuredAt?Math.ceil(+new Date(configuredAt)/60000)*60000:Infinity;
  const startAt=new Date(Math.max(+periodStart,roleStart));
  const endAt=new Date(Math.min(+periodEnd,+now));
  const window={startAt,endAt};
  // Custom window has not opened yet. No activity can have been credited.
  let progress={messages:0,activeDays:0,target:settings.minimumTotalMessages,qualified:false};
  if(endAt>startAt)
    progress=await memberActivityProgress({guildId:interaction.guildId,userId:interaction.user.id,
      rule,period,...settings,...window});
  const qualifying=progress.qualified?"**Goal reached!**":"Not qualified yet";
  const bonuses=isPlan?[...(rule?.roleBonuses||[]),...(item.roleBonuses||[])]:item.roleBonuses||[];
  let weight=1;
  if(bonuses.length){
    const member=await interaction.guild.members.fetch(interaction.user.id);
    // Unique role IDs are counted once even when configured on both watch and plan.
    const merged=[...new Map(bonuses.map(b=>[b.roleId,b])).values()];
    weight=weightForMember(member,merged);
  }
  return interaction.editReply({content:[
    `**Your activity progress · ${item.title}**`,
    `${Math.min(progress.messages,settings.minimumTotalMessages)} / ${settings.minimumTotalMessages} qualifying messages`,
    settings.days>1?`Active days: ${progress.activeDays} / ${settings.days}`:null,
    `Status: ${qualifying}`,
    `Drawing weight if qualified: ${weight} chance${weight===1?"":"s"} (still one unique entrant)`,
    custom?`Activity ends: <t:${Math.floor(new Date(customEnd).getTime()/1000)}:F>`:
      isPlan?`Counting period for next drawing: <t:${Math.floor(nextWindow.startAt.getTime()/1000)}:F> to <t:${Math.floor(nextWindow.endAt.getTime()/1000)}:F>`:
      `Activity period: ${period==="daily"?"Previous Eastern calendar day":"Eastern Wednesday–Wednesday week"}`,
   ].filter(Boolean).join("\n"),allowedMentions:{parse:[]}});
 }catch(error){
   console.error("[Giveaways] Progress check failed:",error);
   return interaction.editReply("I couldn't check your current activity progress. Please try again.");
 }
}
