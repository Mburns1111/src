import {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,MessageFlags,PermissionFlagsBits} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import Giveaway from "../models/Giveaway.js";
import {canManageGiveaways,giveawayManagerPermissionMessage} from "./giveaway-manager-permissions.js";
import {closeGiveaway,publishGiveawayResult} from "./giveaways.js";

export function giveawayReviewPayload(record){
  const eligible=[...new Set(record.entrantIds||[])];
  const candidateCount=Math.max(record.activityCandidateCount||0,eligible.length);
  const bonus=(record.roleBonuses||[]).map(b=>`<@&${b.roleId}> +${b.extraEntries}`).join(", ")||"None";
  const lines=[
    `**Prize:** ${String(record.prize||"").slice(0,500)}`,
    ...(record.description?[`**Giveaway Details:** ${String(record.description).slice(0,1000)}`]:[]),
    `**Active members during window:** ${candidateCount}`,
    `**Qualified members:** ${eligible.length}`,
    `**Not eligible at review time:** ${Math.max(0,candidateCount-eligible.length)}`,
    `**Target:** ${record.activityMinTotalMessages||1} matching messages per member`,
    `**Period:** <t:${Math.floor(new Date(record.activityStartAt||record.customActivityStartAt).getTime()/1000)}:F> to <t:${Math.floor(new Date(record.activityEndAt||record.customActivityEndAt).getTime()/1000)}:F>`,
    `**Winner places:** ${record.winnerCount}`,
    `**Role chances:** ${bonus}`,
    `**Preview of qualifying members:** ${eligible.slice(0,20).map(id=>`<@${id}>`).join(", ")||"None"}`,
    ...(eligible.length>20?[`…and ${eligible.length-20} more`]:[]),
    "", "Approve to draw and publish the results; decline to cancel this drawing.",
  ];
  return {
    embeds:[new EmbedBuilder().setTitle(`🔒 Staff review · ${String(record.title||"Giveaway").slice(0,150)}`)
      .setColor(0x937ca3).setDescription(lines.join("\n").slice(0,3900))
      .setFooter({text:`Activity giveaway review: ${record._id}`})],
    components:[new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`giveaway-review:approve:${record._id}`).setLabel("Approve & Draw").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`giveaway-review:decline:${record._id}`).setLabel("Decline Drawing").setStyle(ButtonStyle.Secondary),
    )],allowedMentions:{parse:[]},
  };
}
export async function publishGiveawayReview(client,record){
  if(record.status!=="pending_review")return false;
  const config=await GuildConfig.findOne({guildId:record.guildId})
    .select("activityGiveawayReviewChannelId").lean();
  const channelId=config?.activityGiveawayReviewChannelId;
  if(!channelId)throw Error("Configure a private activity_review channel before enabling staff review.");
  const channel=await client.channels.fetch(channelId);
  if(!channel?.send||!channel.messages?.fetch)throw Error("Staff review channel is unavailable.");
  let post=record.reviewChannelId===channelId&&record.reviewMessageId
    ?await channel.messages.fetch(record.reviewMessageId).catch(error=>{
      if(error.code===10008)return null;throw error;
    }):null;
  if(!post){
    const recent=await channel.messages.fetch({limit:100});
    post=recent.find(m=>m.author?.id===client.user?.id &&
      m.embeds?.some(e=>e.footer?.text===`Activity giveaway review: ${record._id}`));
  }
  if(!post)post=await channel.send(giveawayReviewPayload(record));
  await Giveaway.updateOne({_id:record._id,status:"pending_review"},
    {$set:{reviewChannelId:channelId,reviewMessageId:post.id}});
  return true;
}
export async function refreshGiveawayReviewMessage(client,record,result){
  if(!record.reviewChannelId||!record.reviewMessageId)return;
  const channel=await client.channels.fetch(record.reviewChannelId);
  const message=await channel?.messages?.fetch(record.reviewMessageId).catch(()=>null);
  if(!message||message.author?.id!==client.user.id)return;
  await message.edit({embeds:[new EmbedBuilder().setColor(0x937ca3)
    .setTitle(`Staff review · ${String(record.title).slice(0,150)}`)
    .setDescription(`${result}\nReviewed by <@${record.reviewedBy||record.creatorId}>.`)
    .setFooter({text:`Activity giveaway review: ${record._id}`})],
   components:[],allowedMentions:{parse:[]}});
}
export async function handleGiveawayReviewButton(interaction){
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try{
    if(!await canManageGiveaways(interaction))
      return interaction.editReply(giveawayManagerPermissionMessage);
    const match=/^giveaway-review:(approve|decline):([0-9a-f]{24})$/.exec(interaction.customId);
    if(!match)return interaction.editReply("Invalid review action.");
    const [,action,id]=match;
    const current=await Giveaway.findOne({_id:id,guildId:interaction.guildId}).lean();
    if(!current || current.status!=="pending_review")
      return interaction.editReply("This drawing has already been reviewed or is unavailable.");
    if(current.reviewMessageId!==interaction.message?.id||current.reviewChannelId!==interaction.channelId)
      return interaction.editReply("Use the original staff review message.");
    const updated=await Giveaway.findOneAndUpdate({
      _id:id,guildId:interaction.guildId,status:"pending_review",
    },{$set:{status:action==="approve"?"closing":"cancelled",
      reviewedBy:interaction.user.id,reviewedAt:new Date()}},
      {returnDocument:"after"}).lean();
    if(!updated)return interaction.editReply("Another staff member handled this drawing.");
    if(action==="decline"){
      try{await refreshGiveawayReviewMessage(interaction.client,updated,"Declined — no winners announced.");}
      catch(error){console.error("[Giveaways] Review status post failed:",error);}
      return interaction.editReply("Drawing declined. No winner announcement or prize consumption.");
    }
    const result=await closeGiveaway({id,guildId:interaction.guildId,now:new Date(),client:interaction.client});
    if(!result||result.status!=="ended")
      return interaction.editReply("Approval saved. The bot will retry winner selection on its next sweep.");
    let published=false;
    try{published=await publishGiveawayResult(interaction.client,result);}
    catch(error){console.error("[Giveaways] Approved results publishing will retry:",error);}
    try{await refreshGiveawayReviewMessage(interaction.client,result,
      `Approved — ${result.winnerIds?.length||0} winner(s) drawn.`);}
    catch(error){console.error("[Giveaways] Review edit failed:",error);}
    return interaction.editReply(published?"Approved and announced in the winners channel.":
      "Approved and winners saved. The bot will retry the winners-channel announcement.");
  }catch(error){
    console.error("[Giveaways] Staff review action failed:",error);
    return interaction.editReply("Couldn't complete that review. Check the bot logs and try again.");
  }
}

export async function reconcilePendingGiveawayReviews(client,{limit=50}={}){
  const pending=await Giveaway.find({status:"pending_review",mode:"activity"}).limit(limit).lean();
  for(const item of pending){
    try{
      if(!item.reviewMessageId)await publishGiveawayReview(client,item);
      else {
        const channel=await client.channels.fetch(item.reviewChannelId);
        const message=await channel?.messages?.fetch(item.reviewMessageId).catch(e=>{
          if(e.code===10008)return null;throw e;
        });
        if(!message)await publishGiveawayReview(client,{...item,reviewMessageId:""});
      }
    }catch(error){console.error("[Giveaways] Pending review recovery failed:",item._id,error);}
  }
  return pending.length;
}
