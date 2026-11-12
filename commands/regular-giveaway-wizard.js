import mongoose from "mongoose";
import {
  ActionRowBuilder,ButtonBuilder,ButtonStyle,RoleSelectMenuBuilder,
  StringSelectMenuBuilder,MessageFlags
} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import {shouldRequestMessageContent} from "../services/observation-intents.js";
import {canManageGiveaways,giveawayManagerPermissionMessage} from "../services/giveaway-manager-permissions.js";
import {requirePrivateGiveawayStaffChannel} from "../services/giveaway-staff-records.js";
import {sharedGiveawayPingRoleId} from "../services/giveaway-notification-roles.js";
import {regularGiveawayNotificationRoleIds} from "../services/giveaway-notification-roles.js";
import {registeredSetupBanners,bannerCatalogText,setupBannerOptions,registerSetupBanner}
  from "../services/giveaway-banner-setup.js";
import {ensureBannerRegistered,getGiveawayBanner,attachGiveawayBanner}
  from "../services/giveaway-banners.js";
import {giveawayAnnouncement,maxRegularGiveawayMinutes} from "../services/giveaways.js";
import {createRegularGiveaway} from "../services/regular-giveaway-creation.js";
import {DEFAULT_CLAIM_HOURS,DEFAULT_CLAIM_INSTRUCTIONS} from "../services/giveaway-claims.js";

const sessions=new Map();
const SESSION_MS=30*60_000;
const steps=["title","prize","description","minutes","winners","role","roleHelp",
  "rules","claimHours","claimInstructions","banner","review"];
const name={
  title:"Giveaway title",prize:"Prize details",description:"Giveaway description",
  minutes:"Entry duration",winners:"Number of winners",role:"Required entry role",
  roleHelp:"Role instructions",rules:"Rules and requirements",
  claimHours:"Claim deadline",claimInstructions:"Prize collection instructions",
  banner:"Banner",review:"Review and post"
};
const parents={descriptionText:"description",minutesText:"minutes",daysText:"minutes",winnerText:"winners",
  roleHelpText:"roleHelp",
  rulesText:"rules",claimHoursText:"claimHours",claimText:"claimInstructions",
  bannerText:"banner",bannerUpload:"banner"};
const textSteps=new Set(["title","prize","descriptionText","minutesText","daysText","winnerText","roleHelpText",
  "rulesText","claimHoursText","claimText","bannerText","bannerUpload"]);
const key=(guildId,channelId,userId)=>guildId+":"+channelId+":"+userId;
// Both custom minutes and custom days respect the actual six-calendar-month
// cutoff for the day the giveaway is created (not a fixed 180-day estimate).
export function regularGiveawayDaysToMinutes(value,start=new Date()){
  const maximum=Math.floor(maxRegularGiveawayMinutes(start)/(24*60));
  if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value))||
      Number(value)<1||Number(value)>maximum)
    throw Error("Duration must be a whole number of days from 1 to "+maximum+
      " (no more than six calendar months).");
  return Number(value)*24*60;
}
export function regularGiveawayDurationLabel(minutes){
  return Number.isSafeInteger(minutes)&&minutes>=1440&&minutes%1440===0?
    (minutes/1440)+" day(s) ("+minutes+" minutes)":
    minutes+" minutes";
}
const safe=value=>String(value||"").replace(/@/g,"＠").replace(/[\r\n]/g," ").trim();
const mention=id=>id?"<@&"+id+">":"None";
const roleId=s=>s.requiredRoleMode==="none"?"":s.requiredRoleMode==="custom"?
  s.requiredRoleId:s.serverRequiredRoleId;
const roleVisible=s=>s.showRequiredRoleInstructions==null?
  s.serverShowRoleInstructions:s.showRequiredRoleInstructions;
const effectiveRoleInstructions=s=>s.roleInstructions==null?
  String(s.serverRoleInstructions||""):String(s.roleInstructions);
const effectiveClaimInstructions=s=>String(s.claimInstructions==null?
  s.serverClaimInstructions||"":s.claimInstructions).trim()||DEFAULT_CLAIM_INSTRUCTIONS;
const claimInstructionSource=s=>s.claimInstructions!=null?"Custom for this giveaway":
  s.serverClaimInstructions?.trim()?"Saved server default":"Built-in default";
const roleInstructionSource=s=>s.roleInstructions!=null?"Custom for this giveaway":
  s.serverRoleInstructions?.trim()?"Saved server default":"Not configured";
const roleDescription=s=>s.requiredRoleMode==="default"?
  "Use server default"+(s.serverRequiredRoleId?" ("+mention(s.serverRequiredRoleId)+")":" (none)"):
  s.requiredRoleMode==="none"?"No role requirement":mention(s.requiredRoleId);
const summary=(session)=>{
  const s=session.settings;
  const ending=new Date(Date.now()+s.minutes*60000);
  const role=roleId(s);
  return [
    "**Review regular giveaway before posting**",
    "**Title:** "+safe(s.title),
    "**Prize:** "+safe(s.prize).slice(0,240),
    "**Giveaway Details:** "+(s.description?safe(s.description).slice(0,150):"None"),
    "**Duration:** "+regularGiveawayDurationLabel(s.minutes)+" · Ends approximately <t:"+Math.floor(+ending/1000)+":F>",
    "**Winners:** "+s.winners,
    "**Required role:** "+roleDescription(s),
    "**Giveaway Banned role:** "+mention(s.serverExcludedRoleId)+" (always enforced)",
    role?"**Show where to get role:** "+(roleVisible(s)?"Yes":"No"):"",
    role?"**Role instructions ("+roleInstructionSource(s)+"):** "+
      (effectiveRoleInstructions(s)||"None"):null,
    "**Rules:** "+(s.rules?safe(s.rules).slice(0,150):"None"),
    "**Claim deadline:** "+s.claimHours+" hour(s)",
    "**Claim instructions ("+claimInstructionSource(s)+"):** "+effectiveClaimInstructions(s),
    "**Banner:** "+(s.bannerNameKey||"Server default"+(s.serverBannerNameKey?" ("+s.serverBannerNameKey+")":" (none)")),
    "**Shared giveaway ping:** "+mention(s.pingRoleId),
    "**Public channel:** <#"+session.config.giveawayChannelId+">",
    "",
    "The preview does not publish the giveaway or notify members.",
    "Choose Post Giveaway only after checking the settings."
  ].filter(Boolean).join("\n").slice(0,1800);
};
const button=(s,label,action,style=ButtonStyle.Secondary)=>
  new ButtonBuilder().setCustomId("regularstart:"+s.id+":"+action)
    .setLabel(label).setStyle(style);
const buttons=(s,items)=>new ActionRowBuilder().addComponents(
  items.map(([label,action,style])=>button(s,label,action,style)));
const selectId=(s,action)=>"regularstart:"+s.id+":"+action;
const labelStep=s=>parents[s.step]||s.step;
function layout(session,banners=[]){
  const s=session.settings,step=session.step,components=[];
  const total=steps.indexOf(step);
  const progress=session.fromReview?
    "**Editing "+name[labelStep(session)]+"**":
    total>=0?"**Step "+(total+1)+" of "+steps.length+" — "+name[step]+"**":
      "**"+name[labelStep(session)]+"**";
  let content="";
  if(step==="title")content="Reply in this channel with the giveaway title (2–100 characters)."
    +(s.title?"\nCurrent: "+safe(s.title):"");
  if(step==="prize")content="Reply with the prize details (2–1,500 characters). Include ranked prizes here if needed."
    +(s.prize?"\nCurrent: "+safe(s.prize).slice(0,220):"");
  if(step==="description"){
    content="Would you like to include custom giveaway details, separate from the prize and rules?\n"+
      "Current: "+(s.description?safe(s.description).slice(0,240):"None");
    components.push(buttons(session,[["Write Details","writeDescription"],
      ["No Details","clearDescription"],["Keep / Skip","keep"]]));
  }
  if(step==="descriptionText")content="Type the giveaway description (1–1,000 characters).";
  if(step==="minutes"){
    content="How long should members be able to enter? This is the **total giveaway duration**, not a daily requirement.\nCurrent: "+regularGiveawayDurationLabel(s.minutes);
    components.push(buttons(session,[["2 min","minutes:2"],["5 min","minutes:5"],
      ["15 min","minutes:15"],["1 hour","minutes:60"],["1 day","minutes:1440"]]));
    components.push(buttons(session,[["Custom Minutes","customMinutes"],["Custom Days","customDays"],["Keep Current","keep"]]));
  }
  if(step==="minutesText")content="Type a whole number from 1 to "+
    maxRegularGiveawayMinutes()+" minutes (up to six calendar months).";
  if(step==="daysText")content="Type a whole number of days from 1 to "+
    Math.floor(maxRegularGiveawayMinutes()/(24*60))+
    ". Six calendar months is the maximum; the exact number of days depends on the start date.";
  if(step==="winners"){
    content="How many winners should be drawn?\nCurrent: "+s.winners;
    components.push(buttons(session,[["1 winner","winners:1"],["2 winners","winners:2"],
      ["3 winners","winners:3"],["5 winners","winners:5"],["Custom","customWinners"]]));
    components.push(buttons(session,[["Keep Current","keep"]]));
  }
  if(step==="winnerText")content="Type a whole number from 1 to 10.";
  if(step==="role"){
    content="Should entry require a server role?\nCurrent: "+roleDescription(s)+
      "\nThe shared Giveaway Notification Role only receives the initial announcement ping; it is not an entry requirement.";
    components.push(buttons(session,[["Use Server Default","roleDefault"],
      ["No Required Role","roleNone"],["Keep Current","keep"]]));
    components.push(new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(selectId(session,"roleSelected"))
        .setPlaceholder("Or choose a specific entry role").setMinValues(1).setMaxValues(1)));
  }
  if(step==="roleHelp"){
    content="Where can members obtain the required entry role? You can use the server's saved instructions or write different ones for this giveaway.\n"+
      "**Current instructions ("+roleInstructionSource(s)+"):**\n"+
      (effectiveRoleInstructions(s)||"*No role-acquisition instructions have been saved.*")+
      "\n**Shown publicly:** "+(roleVisible(s)?"Yes":"No")+
      (roleId(s)?"":"\nNo entry role is required, so this setting will not appear on the announcement.");
    components.push(buttons(session,[["Use Server Default","roleHelpDefault"],
      ["Write Custom Instructions","roleHelpCustom"],["Show","roleHelpShow"],
      ["Hide","roleHelpHide"]]));
    components.push(buttons(session,[["Keep Current / Next","keep"]]));
  }
  if(step==="roleHelpText")
    content="Type your custom instructions for obtaining the required entry role (1–500 characters). Include a channel mention or link if helpful.";
  if(step==="rules"){
    content="Optional rules or entry requirements displayed on the giveaway. They are informational; staff must verify external requirements.\n"+
      "Current: "+(s.rules?safe(s.rules).slice(0,220):"None");
    components.push(buttons(session,[["Write Rules","writeRules"],["No Rules","clearRules"],["Keep / Skip","keep"]]));
  }
  if(step==="rulesText")content="Type your rules (1–1,200 characters).";
  if(step==="claimHours"){
    content="How many **hours** do winners have to submit their ticket claim? Minimum 1 hour.\nCurrent: "+s.claimHours+" hours";
    components.push(buttons(session,[["1 hour","claim:1"],["12 hours","claim:12"],["24 hours","claim:24"],
      ["48 hours","claim:48"],["Custom","customClaimHours"]]));
    components.push(buttons(session,[["Keep Current","keep"]]));
  }
  if(step==="claimHoursText")content="Type a whole number of hours from 1 to 720.";
  if(step==="claimInstructions"){
    content="These are the actual prize-collection instructions winners will see. Choose the saved server/default text or enter new instructions for this giveaway.\n"+
      "**Currently selected ("+claimInstructionSource(s)+"):**\n"+
      effectiveClaimInstructions(s)+
      "\n\nThe bot always adds the ticket number, Discord message link, claim deadline and forfeiture warning.";
    components.push(buttons(session,[["Use Server Default","claimDefault"],
      ["Write Custom Instructions","writeClaim"],["Keep Current / Next","keep"]]));
  }
  if(step==="claimText")content="Type your custom prize-collection instructions (1–1,000 characters).";
  if(step==="banner"){
    content="Choose a reusable banner for this giveaway, or upload a new one without leaving setup.\n"+
      "**Current:** "+(s.bannerNameKey||"Server default"+(s.serverBannerNameKey?" ("+s.serverBannerNameKey+")":" (none)"))+
      "\n\n"+bannerCatalogText(banners);
    if(banners.length)components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(selectId(session,"selectBanner"))
        .setPlaceholder("Choose a registered banner").addOptions(setupBannerOptions(banners))));
    components.push(buttons(session,[
      ...(banners.length?[["Type Saved Name","typeBanner"]]:[]),
      ["Upload New Banner","uploadBanner",ButtonStyle.Primary],
      ["Use Default","bannerDefault"],["Keep Current","keep"]
    ]));
  }
  if(step==="bannerText")content="Type the exact saved banner name here.\n\n"+bannerCatalogText(banners);
  if(step==="bannerUpload")content="Attach a PNG, JPG, WebP or GIF (maximum 4 MB) in this channel. "+
    "You may type a banner name in the same message, or the filename becomes its name. "+
    "The banner will be registered for future use; uploading an existing name replaces the image.";
  if(step==="review"){
    content=summary(session);
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(selectId(session,"edit"))
        .setPlaceholder("Edit a giveaway setting").addOptions(
          steps.filter(x=>x!=="review").map(x=>({label:name[x],value:x})))));
    components.push(buttons(session,[["Preview Announcement","preview"],
      ["Post Giveaway","post",ButtonStyle.Success],["Cancel","cancel",ButtonStyle.Danger]]));
  }
  if(step!=="review")components.push(buttons(session,[
    ...(step==="title"&&!s.title?[]:[["Back","back"]]),
    ["Cancel","cancel",ButtonStyle.Danger]]));
  return {
    content:"**🎁 Regular giveaway creation** · <@"+session.owner+">\n"+
      progress+"\n"+content,
    components,allowedMentions:{parse:[]},
  };
}
async function show(session,step){
  session.step=step;
  session.expires=Date.now()+SESSION_MS;
  const banners=["banner","bannerText"].includes(step)?
    await registeredSetupBanners(session.guild.id):[];
  const msg=await session.channel.send(layout(session,banners));
  session.messageId=msg.id;
  return msg;
}
async function finishStep(session){
  if(session.fromReview){
    session.fromReview=false;
    return show(session,"review");
  }
  const parent=parents[session.step]||session.step;
  const index=steps.indexOf(parent);
  if(index<0)throw Error("Invalid giveaway wizard step.");
  return show(session,steps[Math.min(index+1,steps.length-1)]);
}
async function goBack(session){
  if(parents[session.step])return show(session,parents[session.step]);
  if(session.fromReview){
    session.fromReview=false;
    return show(session,"review");
  }
  const index=steps.indexOf(session.step);
  return show(session,steps[Math.max(0,index-1)]);
}
const int=(value,min,max,label)=>{
  if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value))||
      Number(value)<min||Number(value)>max)
    throw Error(label+" must be a whole number from "+min+" to "+max+".");
  return Number(value);
};
const entered=(text,min,max,label)=>{
  const v=String(text||"").trim();
  if(v.length<min||v.length>max)
    throw Error(label+" must be "+min+"–"+max+" characters.");
  return v;
};
async function preview(session){
  const s=session.settings;
  const selectedRole=roleId(s);
  const example={
    _id:session.id,guildId:session.guild.id,creatorId:session.owner,
    title:s.title,prize:s.prize,description:s.description,rules:s.rules,
    mode:"standard",status:"open",winnerCount:s.winners,
    endsAt:new Date(Date.now()+s.minutes*60000),entrantIds:[],
    requiredRoleId:selectedRole,requiredRoleInstructions:effectiveRoleInstructions(s),
    showRequiredRoleInstructions:roleVisible(s),
    claimWindowHours:s.claimHours,claimInstructions:s.claimInstructions==null?
      s.serverClaimInstructions:s.claimInstructions,maxAutoRerolls:s.maxAutoRerolls
  };
  const banner=await getGiveawayBanner(session.guild.id,s.bannerNameKey);
  const payload=attachGiveawayBanner(giveawayAnnouncement(example),banner);
  payload.content="👁️ **Regular Giveaway Preview** — not posted; no members have been pinged.";
  payload.allowedMentions={parse:[]};
  for(const row of payload.components||[])
    for(const control of row.components)control.setDisabled(true);
  await session.channel.send(payload);
}
async function post(session,client){
  if(!session.settings.title||!session.settings.prize)
    throw Error("Complete the giveaway title and prize before posting.");
  const user=await session.guild.members.fetch({user:session.owner,force:true}).catch(()=>null);
  if(!user)throw Error("The staff member starting this giveaway is no longer in the server.");
  if(!await canManageGiveaways({
    guild:session.guild,guildId:session.guild.id,
    user:user.user||{id:session.owner},member:user,memberPermissions:user.permissions
  }))throw Error(giveawayManagerPermissionMessage);
  const result=await createRegularGiveaway({
    guild:session.guild,client,guildId:session.guild.id,creatorId:session.owner,
    settings:session.settings,
  });
  sessions.delete(session.key);
  await session.channel.send({
    content:"**Regular giveaway posted!** "+(result.message.url||
      "https://discord.com/channels/"+session.guild.id+"/"+result.record.channelId+"/"+result.message.id)+
      "\nGiveaway ID: "+String(result.record._id)+
      "\nMembers can enter in the public giveaway channel. The private staff record will track the event.",
    allowedMentions:{parse:[]},
  });
}
async function apply(session,action,value,client){
  const s=session.settings,step=session.step;
  if(action==="cancel"){
    sessions.delete(session.key);
    return session.channel.send({content:"Regular giveaway setup cancelled. Nothing was published.",
      allowedMentions:{parse:[]}});
  }
  if(action==="back")return goBack(session);
  if(step==="review"){
    if(action==="preview")return preview(session);
    if(action==="edit"){
      if(!steps.includes(value)||value==="review")throw Error("Select a setting to edit.");
      session.fromReview=true;return show(session,value);
    }
    if(action==="post")return post(session,client);
    throw Error("Choose Preview, Post Giveaway, or Edit.");
  }
  if(action==="keep"){
    if((step==="title"&&!s.title)||(step==="prize"&&!s.prize))
      throw Error("Enter the giveaway title and prize first.");
    return finishStep(session);
  }
  if(step==="title"&&action==="text"){
    s.title=entered(value,2,100,"Giveaway title");return finishStep(session);
  }
  if(step==="prize"&&action==="text"){
    s.prize=entered(value,2,1500,"Prize details");return finishStep(session);
  }
  if(step==="description"){
    if(action==="writeDescription")return show(session,"descriptionText");
    if(action==="clearDescription"){s.description="";return finishStep(session);}
  }
  if(step==="descriptionText"&&action==="text"){
    s.description=entered(value,1,1000,"Giveaway details");return finishStep(session);
  }
  if(step==="minutes"){
    if(action==="customMinutes")return show(session,"minutesText");
    if(action==="customDays")return show(session,"daysText");
    if(action.startsWith("minutes:")){
      s.minutes=int(action.slice(8),1,maxRegularGiveawayMinutes(),"Duration");
      return finishStep(session);
    }
  }
  if(step==="minutesText"&&action==="text"){
    s.minutes=int(value,1,maxRegularGiveawayMinutes(),"Duration");return finishStep(session);
  }
  if(step==="daysText"&&action==="text"){
    s.minutes=regularGiveawayDaysToMinutes(value);return finishStep(session);
  }
  if(step==="winners"){
    if(action==="customWinners")return show(session,"winnerText");
    if(action.startsWith("winners:")){
      s.winners=int(action.slice(8),1,10,"Winner count");return finishStep(session);
    }
  }
  if(step==="winnerText"&&action==="text"){
    s.winners=int(value,1,10,"Winner count");return finishStep(session);
  }
  if(step==="role"){
    if(action==="roleDefault"){s.requiredRoleMode="default";s.requiredRoleId="";return finishStep(session);}
    if(action==="roleNone"){s.requiredRoleMode="none";s.requiredRoleId="";return finishStep(session);}
    if(action==="roleSelected"){
      const role=await session.guild.roles.fetch(value).catch(()=>null);
      if(!role||role.id===session.guild.id)throw Error("Choose an existing server role.");
      s.requiredRoleMode="custom";s.requiredRoleId=role.id;return finishStep(session);
    }
  }
  if(step==="roleHelp"){
    if(action==="roleHelpCustom")return show(session,"roleHelpText");
    if(["roleHelpDefault","roleHelpShow","roleHelpHide"].includes(action)){
      if(action==="roleHelpDefault"){
        s.roleInstructions=null;
        s.showRequiredRoleInstructions=null;
      }else s.showRequiredRoleInstructions=action==="roleHelpShow";
      return finishStep(session);
    }
  }
  if(step==="roleHelpText"&&action==="text"){
    s.roleInstructions=entered(value,1,500,"Role instructions");
    return finishStep(session);
  }
  if(step==="rules"){
    if(action==="writeRules")return show(session,"rulesText");
    if(action==="clearRules"){s.rules="";return finishStep(session);}
  }
  if(step==="rulesText"&&action==="text"){
    s.rules=entered(value,1,1200,"Rules");return finishStep(session);
  }
  if(step==="claimHours"){
    if(action==="customClaimHours")return show(session,"claimHoursText");
    if(action.startsWith("claim:")){
      s.claimHours=int(action.slice(6),1,720,"Claim time");return finishStep(session);
    }
  }
  if(step==="claimHoursText"&&action==="text"){
    s.claimHours=int(value,1,720,"Claim time");return finishStep(session);
  }
  if(step==="claimInstructions"){
    if(action==="claimDefault"){s.claimInstructions=null;return finishStep(session);}
    if(action==="writeClaim")return show(session,"claimText");
  }
  if(step==="claimText"&&action==="text"){
    s.claimInstructions=entered(value,1,1000,"Claim instructions");return finishStep(session);
  }
  if(step==="banner"){
    if(action==="bannerDefault"){s.bannerNameKey="";return finishStep(session);}
    if(action==="selectBanner"){
      s.bannerNameKey=await ensureBannerRegistered(session.guild.id,value);
      return finishStep(session);
    }
    if(action==="typeBanner")return show(session,"bannerText");
    if(action==="uploadBanner")return show(session,"bannerUpload");
  }
  if(step==="bannerText"&&action==="text"){
    s.bannerNameKey=await ensureBannerRegistered(session.guild.id,value);
    return finishStep(session);
  }
  if(step==="bannerUpload"&&action==="upload"){
    s.bannerNameKey=await registerSetupBanner(session.guild.id,value);
    return finishStep(session);
  }
  throw Error("That choice isn't available at the current step.");
}
async function respond(session,action,value,client){
  if(session.busy){
    // Replies can arrive while the previous prompt is still being sent.
    // Never silently swallow a staff member's message.
    await session.channel.send({
      content:"Still processing your previous giveaway choice. Please resend your answer after the next prompt appears.",
      allowedMentions:{parse:[]}
    });
    return;
  }
  session.busy=true;
  try{
    await apply(session,action,value,client);
  }catch(error){
    await session.channel.send({
      content:"Couldn't complete that giveaway step: "+String(error.message||error),
      allowedMentions:{parse:[]}
    });
  }finally{session.busy=false;}
}
export async function startRegularGiveawayWizard(interaction){
  if(!shouldRequestMessageContent())
    throw Error("Enable Message Content Intent and ENABLE_MESSAGE_CONTENT_INTENT=1 to run guided giveaway setup.");
  const config=await GuildConfig.findOne({guildId:interaction.guildId}).lean();
  if(!config?.giveawayChannelId)
    throw Error("Configure the regular giveaway channel with /setup giveaways first.");
  if(!config?.giveawayExcludedRoleId)
    throw Error("Configure the required Giveaway Banned role in /setup giveaways before starting giveaways.");
  if(!config?.commandChannelId)
    throw Error("Configure the commands channel with /setup general first.");
  if(interaction.channelId!==config.commandChannelId)
    throw Error("Run /giveaway start in <#"+config.commandChannelId+"> instead of the private giveaway staff channel.");
  await requirePrivateGiveawayStaffChannel(interaction.guild,config);
  const sessionKey=key(interaction.guildId,interaction.channelId,interaction.user.id);
  const existing=sessions.get(sessionKey);
  if(existing?.expires>Date.now())
    return interaction.editReply("You already have a regular giveaway setup open in this channel. Finish or cancel it first.");
  const session={
    id:new mongoose.Types.ObjectId().toString(),key:sessionKey,
    guild:interaction.guild,channel:interaction.channel,owner:interaction.user.id,
    client:interaction.client,config,step:"title",fromReview:false,busy:false,
    settings:{
      title:"",prize:"",description:"",rules:"",
      minutes:60,winners:1,requiredRoleMode:"default",requiredRoleId:"",
      serverExcludedRoleId:config.giveawayExcludedRoleId||"",
      serverRequiredRoleId:config.giveawayDefaultRequiredRoleId||"",
      showRequiredRoleInstructions:null,
      serverShowRoleInstructions:config.giveawayShowRoleInstructions!==false,
      serverRoleInstructions:config.giveawayRoleInstructions||"",roleInstructions:null,
      claimHours:config.activityClaimWindowHours??DEFAULT_CLAIM_HOURS,
      claimInstructions:null,serverClaimInstructions:config.activityClaimInstructions||"",
      maxAutoRerolls:config.activityMaxAutoRerolls??2,
      bannerNameKey:"",serverBannerNameKey:config.giveawayDefaultBannerNameKey||"",
      pingRoleId:regularGiveawayNotificationRoleIds(config)[0]||sharedGiveawayPingRoleId(config),
    }
  };
  sessions.set(sessionKey,session);
  try{await show(session,"title");}
  catch(error){sessions.delete(sessionKey);throw error;}
  return interaction.editReply("Your regular giveaway setup has opened in this channel. Complete the steps, preview, then post.");
}
export async function regularGiveawayWizardInteraction(interaction){
  const match=/^regularstart:([0-9a-f]{24}):(.+)$/.exec(interaction.customId);
  if(!match)return false;
  const session=sessions.get(key(interaction.guildId,interaction.channelId,interaction.user.id));
  if(!session||session.id!==match[1]||session.messageId!==interaction.message?.id||
      session.expires<Date.now())
    return interaction.reply({content:"That regular giveaway prompt is expired or belongs to another staff member.",
      flags:MessageFlags.Ephemeral});
  await interaction.deferUpdate();
  const action=match[2];
  const selected=["roleSelected","selectBanner","edit"].includes(action)?
    interaction.values?.[0]:undefined;
  return respond(session,action,selected,interaction.client);
}
export function regularGiveawayWizardReply(message){
  if(!message.guildId||message.author?.bot||message.webhookId)return false;
  const session=sessions.get(key(message.guildId,message.channelId,message.author.id));
  if(!session||session.expires<Date.now()||!textSteps.has(session.step))return false;
  if(message.reference?.messageId&&message.reference.messageId!==session.messageId)return false;
  const isUpload=session.step==="bannerUpload";
  if(!isUpload&&!String(message.content||"").trim())return false;
  if(isUpload&&!message.attachments?.size&&!String(message.content||"").trim())return false;
  void respond(session,isUpload?"upload":"text",
    isUpload?message:String(message.content||"").trim(),message.client);
  return true;
}
