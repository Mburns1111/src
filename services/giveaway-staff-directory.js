import {createHash} from "node:crypto";
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,MessageFlags,PermissionFlagsBits} from "discord.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import GuildConfig from "../models/GuildConfig.js";

// This directory lives in the existing *private* giveaway staff channel, not
// a public channel, DM, or separate new setup field.
export const STAFF_DIRECTORY_PAGE_SIZE=15;
export const STAFF_DIRECTORY_BUMP_COOLDOWN_MS=3*60_000;
export const ACTIVE_GIVEAWAY_STATES=["open","pending_review","preparing","running","closing","rerolling"];
const lastBumped=new Map();
const inFlight=new Set();

export const giveawayDirectoryMarker=guildId=>"Active giveaway staff directory · "+guildId;

function shortTitle(value){
  return String(value||"Giveaway").replace(/[\\\[\]()*_`~|<>@]/g,"").replace(/\s+/g," ").trim().slice(0,90)||"Giveaway";
}
function link(guildId,channelId,messageId){
  return channelId&&messageId?`https://discord.com/channels/${guildId}/${channelId}/${messageId}`:"";
}
function discordTime(date){
  const n=+new Date(date);
  return Number.isFinite(n)?`<t:${Math.floor(n/1000)}:R>`:"";
}
const statusLabels={
  open:"Open for entries",
  pending_review:"Awaiting staff approval",
  preparing:"Trial preparing",
  running:"Trial running",
  closing:"Selecting winners",
  rerolling:"Reroll in progress",
};

export function giveawayDirectoryEntries(giveaways=[],plans=[]){
  const entries=[];
  for(const record of giveaways){
    if(!ACTIVE_GIVEAWAY_STATES.includes(record.status) || record.publicListingRemovedAt)continue;
    const isActivity=record.mode==="activity";
    // For activities, link to the member-facing list when possible. During
    // a draw awaiting approval, staff can use their private record instead.
    const url=isActivity?
      link(record.guildId,record.listChannelId,record.listMessageId)||
      link(record.guildId,record.staffCardChannelId,record.staffCardId)||
      link(record.guildId,record.channelId,record.messageId):
      link(record.guildId,record.channelId,record.messageId)||
      link(record.guildId,record.staffCardChannelId,record.staffCardId);
    const label=record.mode==="survival"?"Court's Trial":isActivity?"Activity":"Regular";
    const end=record.status==="open"?discordTime(record.endsAt):"";
    entries.push({
      key:"giveaway:"+record._id,title:shortTitle(record.title),
      url,label,status:statusLabels[record.status]||record.status,
      detail:end?"Ends "+end:"",
      timestamp:new Date(record.endsAt||0).getTime()||0,
    });
  }
  for(const plan of plans){
    if(plan.status!=="active")continue;
    entries.push({
      key:"plan:"+plan._id,title:shortTitle(plan.title||plan.name),
      url:link(plan.guildId,plan.listChannelId,plan.listMessageId),
      label:"Recurring activity",status:"Scheduled",
      detail:discordTime(plan.nextRunAt)?"Next draw "+discordTime(plan.nextRunAt):"",
      timestamp:new Date(plan.nextRunAt||0).getTime()||0,
    });
  }
  return entries.sort((a,b)=>a.timestamp-b.timestamp||a.key.localeCompare(b.key));
}

export function giveawayStaffDirectoryPayload(guildId,entries,{page=0}={}){
  const totalPages=Math.max(1,Math.ceil(entries.length/STAFF_DIRECTORY_PAGE_SIZE));
  const selectedPage=Math.min(Math.max(0,Number(page)||0),totalPages-1);
  const begin=selectedPage*STAFF_DIRECTORY_PAGE_SIZE;
  const shown=entries.slice(begin,begin+STAFF_DIRECTORY_PAGE_SIZE);
  const rows=shown.map((entry,i)=>
    `**${begin+i+1}.** ${entry.url?`[${entry.title}](${entry.url})`:`**${entry.title}**`}`+
    ` · ${entry.label}\n${entry.status}${entry.detail?" · "+entry.detail:""}`+
    (entry.url?"":" · *Link pending*")
  );
  const description=entries.length
    ?[`**${entries.length} active giveaway${entries.length===1?"":"s"} / schedules**`,"",...rows,
      "","*Only live giveaways and active recurring schedules appear here. Finished and cancelled giveaways stay in their individual staff records.*"].join("\n").slice(0,4000)
    :"There are currently **no active giveaways**. New giveaways will appear here automatically.";
  const embed=new EmbedBuilder().setColor(0x896b88)
    .setTitle("📌 Active Giveaway Directory · Staff")
    .setDescription(description)
    .setFooter({text:giveawayDirectoryMarker(guildId)+` · Page ${selectedPage+1}/${totalPages}`});
  const buttons=[];
  if(selectedPage>0)buttons.push(new ButtonBuilder()
    .setCustomId(`giveawaydir:page:${selectedPage-1}`).setLabel("Previous page").setStyle(ButtonStyle.Secondary));
  if(selectedPage+1<totalPages)buttons.push(new ButtonBuilder()
    .setCustomId(`giveawaydir:page:${selectedPage+1}`).setLabel("Next page").setStyle(ButtonStyle.Primary));
  return {embeds:[embed],
    ...(buttons.length?{components:[new ActionRowBuilder().addComponents(buttons)]}:{components:[]}),
    allowedMentions:{parse:[]}};
}

async function loadEntries(guildId){
  const [records,plans]=await Promise.all([
    Giveaway.find({guildId,status:{$in:ACTIVE_GIVEAWAY_STATES}}).sort({endsAt:1}).lean(),
    GiveawayPlan.find({guildId,status:"active"}).sort({nextRunAt:1}).lean(),
  ]);
  return giveawayDirectoryEntries(records,plans);
}

async function fetchStored(channel,id){
  if(!id)return null;
  return channel.messages.fetch(id).catch(error=>{
    if(error.code===10008)return null;
    throw error;
  });
}

async function removeOld(client,channelId,messageId,currentChannelId,currentMessageId){
  if(!channelId||!messageId||(channelId===currentChannelId&&messageId===currentMessageId))return;
  try{
    const channel=await client.channels.fetch(channelId);
    const message=await fetchStored(channel,messageId);
    if(message?.author?.id===client.user?.id)await message.delete();
  }catch(error){console.error("[Giveaways] Could not remove old staff directory message:",error);}
}

export async function ensureGiveawayStaffDirectory(client,config,{now=new Date()}={}){
  const guildId=config.guildId,channelId=config.activityGiveawayReviewChannelId;
  if(!channelId||inFlight.has(guildId))return false;
  inFlight.add(guildId);
  try{
    const channel=await client.channels.fetch(channelId);
    if(!channel?.send||!channel.messages?.fetch)throw Error("The staff giveaway channel is unavailable.");
    if(channel.guild?.roles?.everyone&&channel.permissionsFor?.(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))
      throw Error("The giveaway staff directory channel is accessible to @everyone.");
    const entries=await loadEntries(guildId);
    const payload=giveawayStaffDirectoryPayload(guildId,entries);
    const fingerprint=createHash("sha256").update(JSON.stringify(entries)).digest("hex");
    let message=config.giveawayStaffDirectoryChannelId===channelId?
      await fetchStored(channel,config.giveawayStaffDirectoryMessageId):null;
    if(message&&message.author?.id!==client.user?.id)
      throw Error("The existing giveaway directory belongs to another bot.");

    // At most one bump every three minutes after staff/bot chat pushes this
    // directory upward. Status changes edit immediately without extra posts.
    const latest=channel.lastMessageId || (message?
      (await channel.messages.fetch({limit:1})).first?.()?.id:null);
    const shifted=Boolean(message&&latest&&latest!==message.id);
    const recentlyBumped=now.getTime()-(lastBumped.get(guildId)||0)<STAFF_DIRECTORY_BUMP_COOLDOWN_MS;
    const bump=shifted&&!recentlyBumped;
    if(message&&!bump){
      if(config.giveawayStaffDirectoryFingerprint!==fingerprint){
        await message.edit(payload);
        // Persist the new fingerprint so the 30-second sweep does not
        // repeatedly edit the same message after a single status change.
        await GuildConfig.updateOne({guildId,activityGiveawayReviewChannelId:channelId,
          giveawayStaffDirectoryMessageId:message.id},
          {$set:{giveawayStaffDirectoryFingerprint:fingerprint}});
      }
      return true;
    }

    // Send the replacement first. Never leave the staff channel without its
    // current directory if Discord rejects the new message.
    const oldChannelId=config.giveawayStaffDirectoryChannelId;
    const oldMessageId=config.giveawayStaffDirectoryMessageId;
    const created=await channel.send(payload);
    await GuildConfig.updateOne({guildId,activityGiveawayReviewChannelId:channelId},
      {$set:{giveawayStaffDirectoryChannelId:channelId,
        giveawayStaffDirectoryMessageId:created.id,
        giveawayStaffDirectoryFingerprint:fingerprint}});
    lastBumped.set(guildId,now.getTime());
    await removeOld(client,oldChannelId,oldMessageId,channelId,created.id);
    return true;
  }finally{inFlight.delete(guildId);}
}

export async function reconcileGiveawayStaffDirectories(client){
  const configs=await GuildConfig.find({
    activityGiveawayReviewChannelId:{$type:"string",$ne:""}
  }).lean();
  for(const config of configs){
    try{await ensureGiveawayStaffDirectory(client,config);}
    catch(error){console.error("[Giveaways] Staff directory sync failed:",config.guildId,error);}
  }
  return configs.length;
}

export async function handleGiveawayStaffDirectoryButton(interaction){
  const ephemeral={flags:MessageFlags.Ephemeral};
  if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
    return interaction.reply({content:"Manage Server permission is required to view the staff giveaway directory.",...ephemeral});
  const match=/^giveawaydir:page:(\d{1,6})$/.exec(interaction.customId);
  if(!match)return interaction.reply({content:"Unknown giveaway directory page.",...ephemeral});
  const config=await GuildConfig.findOne({guildId:interaction.guildId})
    .select("activityGiveawayReviewChannelId").lean();
  if(!config?.activityGiveawayReviewChannelId||config.activityGiveawayReviewChannelId!==interaction.channelId)
    return interaction.reply({content:"Use the giveaway directory in its configured private staff channel.",...ephemeral});
  await interaction.deferReply(ephemeral);
  try{
    const entries=await loadEntries(interaction.guildId);
    await interaction.editReply(giveawayStaffDirectoryPayload(interaction.guildId,entries,{page:Number(match[1])}));
  }catch(error){
    console.error("[Giveaways] Staff directory page failed:",error);
    await interaction.editReply("Could not load the staff giveaway directory. Please try again.");
  }
}
