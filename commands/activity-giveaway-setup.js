import mongoose from "mongoose";
import {ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelSelectMenuBuilder,RoleSelectMenuBuilder,
  StringSelectMenuBuilder,ChannelType,PermissionFlagsBits,MessageFlags,ModalBuilder,TextInputBuilder,TextInputStyle} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import {preferSetupButtons} from "../services/setup-button-preferences.js";
import {retireGuidedControls} from "../services/retire-guided-controls.js";
import Giveaway from "../models/Giveaway.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import GiveawayBanner, {bannerNameKey} from "../models/GiveawayBanner.js";
import {GuidedActivitySeries} from "../services/guided-activity.js";
import {ensureBannerRegistered,attachGiveawayBanner} from "../services/giveaway-banners.js";
import {registeredSetupBanners,bannerCatalogText,setupBannerOptions,registerSetupBanner} from "../services/giveaway-banner-setup.js";
import {giveawayAnnouncement} from "../services/giveaways.js";
import {REGULAR_DISPLAY_FIELDS,REGULAR_DISPLAY_DEFAULTS,cleanRegularDisplayField} from "../services/giveaway-display-text.js";
import {sharedGiveawayPingRoleId,sharedGiveawayNotificationFields} from "../services/giveaway-notification-roles.js";
import {DEFAULT_CLAIM_HOURS,DEFAULT_MAX_AUTO_REROLLS,DEFAULT_CLAIM_INSTRUCTIONS} from "../services/giveaway-claims.js";

const serverDisplayField=field=>"regularGiveaway"+field[0].toUpperCase()+field.slice(1);
const displayLabels={
 displayOpenTitle:"Open giveaway title",displayEndedTitle:"Winner announcement title",
 displayEntryText:"Entry story",displayWinnerText:"Winner story"
};
export function regularGiveawayDisplayPreview(settings,{winner=false,
 previewUserId="123456789012345678",now=new Date()}={}){
 const values=Object.fromEntries(REGULAR_DISPLAY_FIELDS.map(field=>
   [field,cleanRegularDisplayField(field,settings?.[serverDisplayField(field)]||"")]));
 const record={_id:"PREVIEW",mode:"standard",status:winner?"ended":"open",
   title:"Example Giveaway",prize:"Example prize",creatorId:previewUserId,
   winnerCount:1,winnerIds:winner?[previewUserId]:[],entrantIds:winner?[previewUserId]:[],
   endsAt:new Date(now.getTime()+(winner?0:3600000)),
   claimWindowHours:settings.activityClaimWindowHours||12,
   claimInstructions:settings.activityClaimInstructions||"",
   requiredRoleId:settings.giveawayDefaultRequiredRoleId||"",claimResolvedSlots:[],...values};
 const payload=giveawayAnnouncement(record);
 payload.embeds[0].setFooter({text:"SERVER TEMPLATE PREVIEW · No giveaway posted"});
 for(const r of payload.components||[])for(const c of r.components)c.setDisabled(true);
 payload.allowedMentions={parse:[]};
 return payload;
}
const sessions=new Map();
const expiry=30*60_000;
const key=(channel,user)=>channel+":"+user;
const steps=["list","winners","staff","archive","managerRole","excludedRole","instructions","hours","rerolls","roles","empty","banner","review"];
const regularSteps=["regularChannel","winners","staff","archive","managerRole","excludedRole","requiredRole","roleHelp","roleHelpVisible","instructions","hours","rerolls","roles","empty","banner","review"];
const stepsFor=session=>session.mode==="regular"?regularSteps:steps;
const stepName={list:"Public giveaway listings",winners:"Winner announcements",staff:"Private staff controls",archive:"Private giveaway archive",
  regularChannel:"Regular giveaway posts",managerRole:"Giveaway Manager role",
  excludedRole:"Required Giveaway Banned role",
  requiredRole:"Default regular entry role",roleHelp:"Where to get required roles",
  roleHelpVisible:"Show role instructions",instructions:"Claim instructions",hours:"Claim deadline",rerolls:"Automatic rerolls",
  roles:"Shared giveaway ping role",empty:"No eligible winners",banner:"Default banner"};
const button=(id,label,value,style=ButtonStyle.Secondary)=>new ButtonBuilder()
  .setCustomId("actconfig:"+id+":"+value).setLabel(label).setStyle(style);
const row=(id,items)=>new ActionRowBuilder().addComponents(items.map(([label,value,style])=>button(id,label,value,style)));
const shown=id=>id?"<#"+id+">":"Not set";
const progress=session=>session.step==="displayEditor"?"Edit giveaway display":
  (session.editing||session.fromReview)?"Editing "+(stepName[session.step]||"Default banner"):
  stepsFor(session).includes(session.step)?"Step "+(stepsFor(session).indexOf(session.step)+1)+" of "+stepsFor(session).length:
    "Banner · "+(session.step==="bannerUpload"?"Upload new banner":"Choose a saved banner");
const mainSetting=session=>session.settings;
// Both guided giveaway setups configure the same single announcement role.
export const giveawaySetupNotificationRoleIds=(settings,_mode="activity")=>{
  const role=sharedGiveawayPingRoleId(settings);
  return role?[role]:[];
};
export const giveawaySetupNotificationFields=(settings,_mode="activity")=>
  sharedGiveawayNotificationFields(sharedGiveawayPingRoleId(settings));

export function currentGiveawayClaimInstructions(settings){
  return String(settings?.activityClaimInstructions||"").trim().slice(0,1000)
    ||DEFAULT_CLAIM_INSTRUCTIONS;
}
export function describeActivityGiveawaySetup(settings,{updateExisting=false,mode="activity"}={}){
 return [
  "**"+(mode==="regular"?"Regular":"Activity")+" Giveaway Setup — Review**",
  ...(mode==="regular"?["🎁 **Giveaway List:** "+shown(settings.giveawayChannelId),
    "🏆 **Giveaway Winners:** "+shown(settings.activityGiveawayWinnersChannelId)]:[]),
  ...(mode==="activity"?["📋 **Activity list:** "+shown(settings.activityGiveawayListChannelId),
     "🏆 **Winners:** "+shown(settings.activityGiveawayWinnersChannelId)]:[]),
  "🔒 **Staff controls:** "+shown(settings.activityGiveawayReviewChannelId),
   "🗄️ **Private giveaway archive (required):** "+shown(settings.giveawayArchiveChannelId),
  "🔑 **Giveaway Manager role:** "+(settings.giveawayManagerRoleId?"<@&"+settings.giveawayManagerRoleId+">":"None — Manage Server only"),
  "🚫 **Giveaway Banned role (required):** "+(settings.giveawayExcludedRoleId?"<@&"+settings.giveawayExcludedRoleId+">":"NOT CONFIGURED — REQUIRED"),
  ...(mode==="activity"?[
    "✅ **Activity participation:** Members use **Opt In / Opt Out** at the bottom of the Activity Giveaway List. Stored in MongoDB; no Discord role required.",
  ]:[
    "🎟️ **Optional regular giveaway entry role:** "+(settings.giveawayDefaultRequiredRoleId?"<@&"+settings.giveawayDefaultRequiredRoleId+">":"None"),
    "👁️ **Show regular role instructions publicly:** "+(settings.giveawayShowRoleInstructions!==false?"Yes":"No"),
    "🎟️ **Regular role acquisition instructions:** "+(settings.giveawayRoleInstructions||"Not set"),
  ]),
  "📝 **Current prize-claim instructions ("+(settings.activityClaimInstructions?"Saved server custom":"Built-in default")+"):**",
  currentGiveawayClaimInstructions(settings),
  "⏰ **Default claim window:** "+settings.activityClaimWindowHours+" hours",
  "🔁 **Automatic rerolls:** "+settings.activityMaxAutoRerolls+" per winning place",
  "🔔 **Shared giveaway ping role (all giveaways and Trials):** "+(sharedGiveawayPingRoleId(settings)?"<@&"+sharedGiveawayPingRoleId(settings)+">":"None"),
  "🥀 **No eligible members:** "+(settings.activityAnnounceEmptyResults?"Announce no winners":"Don't post an empty result"),
  "🖼️ **Default banner:** "+(settings.giveawayDefaultBannerNameKey||"None"),
  ...(mode==="regular"?["🎭 **Regular giveaway display:** "+(REGULAR_DISPLAY_FIELDS.some(field=>settings[serverDisplayField(field)])?"Customized server template":"Built-in fox template")]:[]),
  "",
  "**Changes to existing giveaways:** "+(updateExisting?"Apply new claim instructions to current giveaways when saved":"Future giveaways only"),
  "*Changing the default claim window or reroll maximum here does not change deadlines that are already running.*",
 ].join("\n");
}
export function claimAnnouncementPreview(settings,{
 mode="activity",previewUserId="123456789012345678",now=new Date(),banner=null
}={}){
 // Build the preview from the live winner announcement renderer, not a
 // separate text template. Never persist a simulated giveaway.
 const sample={
  _id:"PREVIEW",mode:mode==="regular"?"standard":"activity",
  status:"ended",title:"Example Giveaway",prize:"Example prize",
  creatorId:previewUserId,winnerCount:1,
  winnerIds:[previewUserId],entrantIds:[previewUserId],
  endsAt:now,claimStartedAt:now,winnerAssignedAt:[now],
  claimWindowHours:settings.activityClaimWindowHours??DEFAULT_CLAIM_HOURS,
  claimInstructions:settings.activityClaimInstructions||"",
  maxAutoRerolls:settings.activityMaxAutoRerolls??DEFAULT_MAX_AUTO_REROLLS,
  autoRerollClaims:true,
  requiredRoleId:mode==="regular"?settings.giveawayDefaultRequiredRoleId||"":"",
  requiredRoleInstructions:mode==="regular"?settings.giveawayRoleInstructions||"":"",
  showRequiredRoleInstructions:mode==="regular"?settings.giveawayShowRoleInstructions!==false:false,
  ...(mode==="regular"?Object.fromEntries(REGULAR_DISPLAY_FIELDS.map(field=>
    [field,settings?.[serverDisplayField(field)]||""])):{}),
 };
 const payload=giveawayAnnouncement(sample);
 payload.embeds[0].setFooter({text:"PREVIEW ONLY · No giveaway created or modified"});
 for(const actionRow of payload.components){
  for(const control of actionRow.components)control.setDisabled(true);
 }
 payload.content="👁️ **Winner Announcement Preview** — example only; no giveaway was created.";
 return attachGiveawayBanner(payload,banner);
}
const bind=(session,value)=>"actconfig:"+session.id+":"+value;
function layout(session,banners=[]) {
 const s=session.settings,step=session.step;
 const title="**"+(session.mode==="regular"?"Regular":"Activity")+" giveaway setup** · <@"+session.owner+">\n**"+progress(session)+"**\n";
 const components=[];
 let content="";
 let embeds;
 if(["list","winners","staff","archive","regularChannel"].includes(step)){
   const field={list:"activityGiveawayListChannelId",winners:"activityGiveawayWinnersChannelId",
     staff:"activityGiveawayReviewChannelId",archive:"giveawayArchiveChannelId",regularChannel:"giveawayChannelId"}[step];
   content={
    list:"Choose the public channel where members will see the giveaway posters and **Check My Progress** buttons.",
     regularChannel:"Choose the **Giveaway List** channel for regular giveaways. Members enter here; when the giveaway ends, the bot transfers its finished announcement to Giveaway Winners.",
    winners:session.mode==="regular"
      ?"Choose the **Giveaway Winners** channel. When a regular giveaway ends, its completed announcement and claim buttons are posted here; the original Giveaway List post is removed."
      :"Choose the public channel where activity giveaway winners, claim deadlines and claim buttons will appear.",
    staff:"Choose a **private, staff-only** text channel for eligibility previews, editing, early ending, cancelling and approval.",
     archive:"Choose the required **private giveaway archive** channel for completed and cancelled staff records. This is shared by regular giveaways, activity giveaways and Court\'s Trials; it must be different from staff controls and hidden from @everyone.",
   }[step]+"\nCurrent: "+shown(s[field])+"\nThe bot will check its ability to see and post in this channel.";
   const selector=new ChannelSelectMenuBuilder().setCustomId(bind(session,"channel"))
    .setPlaceholder("Choose "+stepName[step]).setMinValues(1).setMaxValues(1)
    .addChannelTypes(...(["staff","archive"].includes(step)?[ChannelType.GuildText]:
      [ChannelType.GuildText,ChannelType.GuildAnnouncement]));
   components.push(new ActionRowBuilder().addComponents(selector));
   if(s[field])components.push(row(session.id,[["Keep selected channel","keep"]]));
 }else if(step==="managerRole"){
   content="Choose an optional **Giveaway Manager role**. Members with this role can run /giveaway, /giveaway-role and /trial and use giveaway staff buttons without Manage Server. This role does **not** allow /setup or other admin commands. Only Manage Server staff may change this setting.\nCurrent: "+
     (s.giveawayManagerRoleId?"<@&"+s.giveawayManagerRoleId+">":"None — Manage Server only");
   components.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder()
     .setCustomId(bind(session,"managerRole")).setPlaceholder("Choose Giveaway Manager role")
     .setMinValues(1).setMaxValues(1)));
   components.push(row(session.id,[["No manager role","clearManagerRole"],["Keep Current","keep"]]));
 }else if(step==="excludedRole"){
   content="Choose the **required Giveaway Banned role** shared by all prize giveaways. "+
     "Anyone holding this punishment role cannot enter regular giveaways, Court's Trials, or collect activity giveaway progress; they cannot win or be rerolled into any giveaway. "+
     "The restriction is always enforced, never optional, and has no cooldown.\\nCurrent: "+
     (s.giveawayExcludedRoleId?"<@&"+s.giveawayExcludedRoleId+">":"NOT CONFIGURED — REQUIRED");
   components.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder()
     .setCustomId(bind(session,"excludedRole")).setPlaceholder("Select required banned role")
     .setMinValues(1).setMaxValues(1)));
   if(s.giveawayExcludedRoleId)components.push(row(session.id,[["Keep Current","keep"]]));
 }else if(step==="requiredRole"){
   content="Choose an **optional default required role** for regular giveaways only. "+
     "Staff can keep this default, choose a different role, or disable the role requirement for each regular giveaway.\n"+
     "Current: "+(s.giveawayDefaultRequiredRoleId?"<@&"+s.giveawayDefaultRequiredRoleId+">":"None");
   components.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder()
     .setCustomId(bind(session,"requiredRole")).setPlaceholder("Choose default required role")
     .setMinValues(1).setMaxValues(1)));
   components.push(row(session.id,[["No Default Required Role","noneRequiredRole"],["Keep Current","keep"]]));
 }else if(step==="roleHelp"){
   content="Save instructions on where members can get the required role. "+
     "This can include Discord channel links. The next step controls whether "+
     "these instructions are shown publicly; restricted giveaways may keep them hidden.\n"+
     "**Current:** "+(s.giveawayRoleInstructions||"Not set");
   components.push(row(session.id,[["Write instructions","writeRoleHelp"],["Keep Current","keep"],["Clear","clearRoleHelp"]]));
 }else if(step==="roleHelpText"){
   content="Reply with the instructions (maximum 500 characters), including the channel where members can obtain the role.";
 }else if(step==="roleHelpVisible"){
   content="Show members **where to get the required role**? "+
     "Turn this OFF for invitation-only or restricted giveaways. "+
     "**The role itself is still required**; only the instructions are hidden.\n"+
     "Current default: "+(s.giveawayShowRoleInstructions!==false?"Show instructions":"Hide instructions");
   components.push(row(session.id,[["Show Instructions","showHelp"],
     ["Hide Instructions","hideHelp"],["Keep Current","keep"]]));
 }else if(step==="instructions"){
   content="Set the saved server-wide prize-claim instructions used by regular and activity giveaways.\n"+
    "**These are the current instructions winners will see ("+(s.activityClaimInstructions?"Saved server custom":"Built-in default")+"):**\n"+
    currentGiveawayClaimInstructions(s)+"\n"+
    "The bot also adds the ticket number, Discord message link, claim deadline and forfeiture warning.\n"+
    "Choose **Write / Edit Server Instructions** to enter your own text, then Save Settings on the final review.";
   components.push(row(session.id,[["Use Built-in Default","default"],["Write / Edit Server Instructions","custom"],["Keep Saved","keep"]]));
 }else if(step==="instructionsText"){
   content="Type your custom claim instructions in this commands channel (1–1,000 characters). "+
     "Do not include the mandatory claim deadline warning; the bot always adds it.";
 }else if(step==="hours"){
   content="How many hours should winners have to enter their claim information? Default: 12 hours.\nCurrent: "+s.activityClaimWindowHours+" hours";
   components.push(row(session.id,[["12 hours","hours12"],["24 hours","hours24"],["48 hours","hours48"],["Custom","customHours"],["Keep","keep"]]));
 }else if(step==="hoursText"){
   content="Reply with a number of claim hours from 1 to 720.";
 }else if(step==="rerolls"){
   content="How many times may the bot automatically replace an unclaimed winning place? **Default: 2.** Manual staff rerolls are separate.\nCurrent: "+s.activityMaxAutoRerolls;
   components.push(row(session.id,[0,1,2,3,5].map(x=>[String(x)+" reroll"+(x===1?"":"s"),"reroll"+x])));
   components.push(row(session.id,[["10 rerolls","reroll10"],["Keep Current","keep"]]));
 }else if(step==="roles"){
   content="Choose **one shared notification role** to ping when any regular giveaway, activity giveaway, or Court's Trial is first announced. It is not the Giveaway Manager role or an entry requirement.\n"+
     "Current: "+(sharedGiveawayPingRoleId(s)?"<@&"+sharedGiveawayPingRoleId(s)+">":"None")+
     "\nThis role will not be pinged on routine edits, rerolls, or winner updates.";
   components.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder()
     .setCustomId(bind(session,"roles")).setPlaceholder("Choose giveaway ping role").setMinValues(1).setMaxValues(1)));
   components.push(row(session.id,[["No giveaway ping role","none"],["Keep Current","keep"]]));
 }else if(step==="empty"){
   content="If nobody qualifies, should the bot announce that no winners were selected, or simply record the result without a public announcement?";
   components.push(row(session.id,[["Announce no winners","announce"],["Do not announce","silent"],["Keep Current","keep"]]));
 }else if(step==="banner"){
   content="Choose a server-wide default giveaway banner for regular and activity giveaways.\n**Current:** "+
     (s.giveawayDefaultBannerNameKey||"None")+"\n\n"+bannerCatalogText(banners);
   if(banners.length)components.push(new ActionRowBuilder().addComponents(
     new StringSelectMenuBuilder().setCustomId(bind(session,"selectSavedBanner"))
       .setPlaceholder("Choose a registered banner").addOptions(setupBannerOptions(banners))));
   components.push(row(session.id,[
     ...(banners.length?[["Type Banner Name","chooseBanner"]]:[]),
     ["Upload New Banner","uploadBanner",ButtonStyle.Primary],
     ["No Default Banner","clearBanner"],["Keep","keep"],
   ]));
 }else if(step==="bannerText"){
   content="Type the **exact saved banner name** in this channel.\n\n"+
     bannerCatalogText(banners);
   components.push(row(session.id,[["Upload New Banner","uploadBanner",ButtonStyle.Primary]]));
 }else if(step==="bannerUpload"){
   content="Attach a **PNG, JPG, WebP or GIF (maximum 4 MB)** in this same channel.\n"+
     "Type a name in the same message as the image if you want; otherwise its filename becomes its name. "+
     "The bot will register it for future giveaways and select it as the default. "+
     "Uploading with an existing name replaces that banner's stored image.";
 }else if(step==="displayEditor"){
   if(session.mode!=="regular"||!session.displayDraft)throw Error("Display text editor is unavailable.");
   const d=session.displayDraft;
   content="**Regular giveaway display template** — previewing the "+
     (session.displayPreviewWinner?"winner announcement":"open giveaway")+
     ".\nEdit any title or story using the buttons below. The embedded preview updates as you change it. "+
     "Use Default to restore a section.\n\n"+
     "**Customized sections:** "+(REGULAR_DISPLAY_FIELDS.filter(field=>d[serverDisplayField(field)])
       .map(field=>displayLabels[field]).join(", ")||"None (built-in fox wording)")+
     "\n\n**Confirm Text** accepts this draft. **Save Settings** on the final setup review makes it the server default.";
   embeds=regularGiveawayDisplayPreview(d,{winner:session.displayPreviewWinner,previewUserId:session.owner}).embeds;
   components.push(row(session.id,[
     ["Edit Open Title","displayEdit:displayOpenTitle"],
     ["Edit Winner Title","displayEdit:displayEndedTitle"],
     ["Edit Entry Story","displayEdit:displayEntryText"],
     ["Edit Winner Story","displayEdit:displayWinnerText"]
   ]));
   components.push(row(session.id,[
     ["Default Open Title","displayDefault:displayOpenTitle"],
     ["Default Winner Title","displayDefault:displayEndedTitle"],
     ["Default Entry Story","displayDefault:displayEntryText"],
     ["Default Winner Story","displayDefault:displayWinnerText"]
   ]));
   components.push(row(session.id,[
     ["Preview Open","displayPreviewOpen",ButtonStyle.Primary],
     ["Preview Winners","displayPreviewWinner",ButtonStyle.Primary]
   ]));
   components.push(row(session.id,[["Confirm Text","displayConfirm",ButtonStyle.Success],
     ["Discard Changes","displayDiscard"]]));
 }else if(step==="review"){
   content=describeActivityGiveawaySetup(s,{updateExisting:session.updateExisting,mode:session.mode});
   components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
     .setCustomId(bind(session,"edit")).setPlaceholder("Edit a setup setting")
     .addOptions(stepsFor(session).filter(x=>x!=="review").map(v=>({label:stepName[v],value:v})))));
   components.push(row(session.id,[["Preview Winner Announcement","preview"],["Edit Claim Instructions","editClaims"],
     ...(session.mode==="regular"?[["Edit Giveaway Display","displayOpen",ButtonStyle.Secondary]]:[]),
     ["Apply to Existing: "+(session.updateExisting?"ON":"OFF"),"toggleExisting"]]));
   components.push(row(session.id,[["Save Settings","save",ButtonStyle.Success],["Cancel Setup","cancel",ButtonStyle.Danger]]));
 }
 if(step!=="review"&&step!=="displayEditor")components.push(row(session.id,[["Back","back"],["Cancel Setup","cancel",ButtonStyle.Danger]]));
 return {content:title+content,...(embeds?{embeds}:{}),components:preferSetupButtons(components),allowedMentions:{parse:[]}};
}
async function show(session,step){
 session.step=step;session.expires=Date.now()+expiry;
 const banners=["banner","bannerText"].includes(step)?
   await registeredSetupBanners(session.guild.id):[];
 const previous=session.message;
 const message=await session.channel.send(layout(session,banners));
 session.messageId=message.id;
 session.message=message;
 await retireGuidedControls(previous,session.channel);
}
function after(session,step){
 const nextStep=session.fromReview?"review":step;
 session.editing=false;
 session.fromReview=false;
 return show(session,nextStep);
}
async function checkChannels(session){
 const s=session.settings;
 const ids=session.mode==="regular"?[s.giveawayChannelId,s.activityGiveawayWinnersChannelId,s.activityGiveawayReviewChannelId,s.giveawayArchiveChannelId]:
    [s.activityGiveawayListChannelId,s.activityGiveawayWinnersChannelId,s.activityGiveawayReviewChannelId,s.giveawayArchiveChannelId];
 if(ids.some(x=>!x)||new Set(ids).size!==ids.length)throw Error("Choose separate public, private staff, and private archive channels for giveaways.");
  const existing=await GuildConfig.findOne({guildId:session.guild.id}).lean();
  const publicIds=[existing?.giveawayChannelId,existing?.activityGiveawayListChannelId,
    existing?.activityGiveawayWinnersChannelId,existing?.survivalTrialChannelId].filter(Boolean);
  if(publicIds.includes(s.giveawayArchiveChannelId))throw Error("The private giveaway archive must be separate from every public giveaway or Trial channel.");
 for(const [idx,id] of ids.entries()){
   const channel=await session.guild.channels.fetch(id).catch(()=>null);
   if(!channel?.send||!channel?.permissionsFor)throw Error("The selected channel is unavailable: "+id);
   const bot=channel.permissionsFor(session.guild.members.me);
   for(const perm of [PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.EmbedLinks,PermissionFlagsBits.ReadMessageHistory]){
     if(!bot?.has(perm))throw Error("The bot needs View Channel, Send Messages, Embed Links and Read Message History in <#"+id+">.");
   }
   if(idx>=ids.length-2&&channel.permissionsFor(session.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))
     throw Error("Staff controls and giveaway archives must both be hidden from @everyone before saving.");
 }
}
export async function updateExistingActivityClaimInstructions(guildId,instructions){
 const filter={guildId,status:{$in:["open","ended"]},mode:{$in:["activity","standard"]}};
 const changed=await Giveaway.updateMany(filter,{$set:{claimInstructions:instructions,renderedAt:null},$inc:{renderVersion:1}});
 await GiveawayPlan.updateMany({guildId,status:{$in:["active","paused"]}},{$set:{claimInstructions:instructions}});
 await GuidedActivitySeries.updateMany({guildId,enabled:true},{$set:{"settings.claimInstructions":instructions}});
 return changed.modifiedCount||0;
}
async function apply(session,verb,value){
 const s=mainSetting(session);
 const next=()=>after(session,stepsFor(session)[stepsFor(session).indexOf(session.step)+1]);
 if(verb==="cancel"){sessions.delete(session.key);await session.channel.send("Activity giveaway setup cancelled.");await retireGuidedControls(session.message,session.channel);return;}
 if(verb==="back"){
   if(session.step==="displayEditor"){session.displayDraft=null;await show(session,"review");return;}
   if(["bannerText","bannerUpload"].includes(session.step)){
     await show(session,"banner");return;
   }
   if(session.fromReview){
     session.fromReview=false;session.editing=false;
     await show(session,"review");return;
   }
   const ordered=stepsFor(session),index=ordered.indexOf(session.step);
   const back=({participationHelpText:"participationHelp",roleHelpText:"roleHelp",instructionsText:"instructions",hoursText:"hours"})[session.step]||ordered[Math.max(0,index-1)];
   await show(session,back);return;
 }
 if(session.step==="displayEditor"){
   if(verb==="displayDiscard"){
     session.displayDraft=null;session.modalField=null;await show(session,"review");return;
   }
   if(verb==="displayConfirm"){
     for(const field of REGULAR_DISPLAY_FIELDS)
       s[serverDisplayField(field)]=session.displayDraft[serverDisplayField(field)];
     session.displayDraft=null;session.modalField=null;await show(session,"review");return;
   }
   if(verb==="displayPreviewOpen"||verb==="displayPreviewWinner"){
     session.displayPreviewWinner=verb==="displayPreviewWinner";
     await refreshDisplayEditor(session);return;
   }
   if(verb.startsWith("displayDefault:")){
     const field=verb.slice("displayDefault:".length);
     if(!REGULAR_DISPLAY_FIELDS.includes(field))throw Error("Invalid display section.");
     session.displayDraft[serverDisplayField(field)]="";
     await refreshDisplayEditor(session);return;
   }
   throw Error("Use the editor buttons, Confirm Text or Discard Changes.");
 }
 if(session.step==="review"){
   if(verb==="displayOpen"){
     if(session.mode!=="regular")throw Error("Display editor belongs to regular giveaways.");
     session.displayDraft={...Object.fromEntries(REGULAR_DISPLAY_FIELDS.map(field=>
       [serverDisplayField(field),s[serverDisplayField(field)]||""])),
       activityClaimWindowHours:s.activityClaimWindowHours,
       activityClaimInstructions:s.activityClaimInstructions,
       giveawayDefaultRequiredRoleId:s.giveawayDefaultRequiredRoleId};
     session.displayPreviewWinner=false;session.modalField=null;
     await show(session,"displayEditor");return;
   }
   if(verb==="preview"){
     const nameKey=bannerNameKey(s.giveawayDefaultBannerNameKey);
     const banner=nameKey?await GiveawayBanner.findOne({guildId:session.guild.id,nameKey}).lean():null;
     if(nameKey&&!banner)throw Error("The selected default banner is no longer registered. Select another banner before previewing.");
     await session.channel.send(claimAnnouncementPreview(s,{
       mode:session.mode,previewUserId:session.owner,banner
     }));
     return;
   }
   if(verb==="toggleExisting"){session.updateExisting=!session.updateExisting;await show(session,"review");return;}
   if(verb==="editClaims"){session.fromReview=true;await show(session,"instructions");return;}
   if(verb==="edit"){
     if(!stepsFor(session).includes(value)||value==="review")throw Error("Choose a valid setup setting.");
     session.fromReview=true;await show(session,value);return;
   }
   if(verb!=="save")throw Error("Choose Save Settings, Preview, or Edit.");
   if(!s.giveawayExcludedRoleId)throw Error("Select the required Giveaway Banned role before saving setup.");
   const banRole=await session.guild.roles.fetch(s.giveawayExcludedRoleId).catch(()=>null);
   if(!banRole||banRole.id===session.guild.id)throw Error("The required Giveaway Banned role no longer exists. Select a current role.");
   await checkChannels(session);
   const previous=await GuildConfig.findOne({guildId:session.guild.id}).lean();
   const settings={
     ...Object.fromEntries([
      "activityGiveawayListChannelId","activityGiveawayWinnersChannelId","activityGiveawayReviewChannelId","giveawayArchiveChannelId","giveawayChannelId",
      "giveawayManagerRoleId","giveawayExcludedRoleId","giveawayDefaultRequiredRoleId","giveawayShowRoleInstructions",
      "giveawayRoleInstructions","activityClaimInstructions","activityClaimWindowHours","activityMaxAutoRerolls",
      "activityAnnounceEmptyResults","giveawayDefaultBannerNameKey",
      ...(session.mode==="regular"?REGULAR_DISPLAY_FIELDS.map(serverDisplayField):[])
     ].map(field=>[field,s[field]])),
     ...giveawaySetupNotificationFields(s,session.mode),
     commandChannelId:previous?.commandChannelId||session.channel.id,
   };
   await GuildConfig.findOneAndUpdate({guildId:session.guild.id},{$set:settings},
      {upsert:true,new:true,runValidators:true});
   let modified=0;
   if(session.updateExisting)modified=await updateExistingActivityClaimInstructions(session.guild.id,s.activityClaimInstructions);
   sessions.delete(session.key);
   await session.channel.send({content:("**"+(session.mode==="regular"?"Regular":"Activity")+" giveaway setup saved.** ")+
     (session.updateExisting?"Claim instructions were also updated for "+modified+" existing standard/activity giveaways. "+
       "Announcements will refresh as the bot reconciles them.":"New giveaways will use these defaults; existing claim deadlines and ticket claims were not changed.")+
     "\nUse **/giveaway "+(session.mode==="regular"?"start":"activity")+"** to create a giveaway with per-event overrides.",
     allowedMentions:{parse:[]}});
   await retireGuidedControls(session.message,session.channel);
   return;
 }
 if(verb==="keep"){
   if(session.step==="excludedRole"&&!s.giveawayExcludedRoleId)throw Error("Choose the required Giveaway Banned role first.");
   return next();
 }
 if(session.step==="managerRole"){
   if(verb==="clearManagerRole"){s.giveawayManagerRoleId="";return next();}
   if(verb==="managerRole"){
     const id=Array.isArray(value)?value[0]:value;
     const role=await session.guild.roles.fetch(id).catch(()=>null);
     if(!role||role.id===session.guild.id||role.managed)
       throw Error("Choose a real, assignable server role for Giveaway Managers.");
     s.giveawayManagerRoleId=role.id;return next();
   }
 }
 if(session.step==="excludedRole"){
   if(verb==="excludedRole"){
     const id=Array.isArray(value)?value[0]:value;
     const role=await session.guild.roles.fetch(id).catch(()=>null);
     if(!role||role.id===session.guild.id)throw Error("Choose an existing server role.");
     s.giveawayExcludedRoleId=role.id;return next();
   }
 }
 if(session.step==="requiredRole"){
   if(verb==="noneRequiredRole"){s.giveawayDefaultRequiredRoleId="";return next();}
   if(verb==="requiredRole"){
     const id=Array.isArray(value)?value[0]:value;
     const role=await session.guild.roles.fetch(id).catch(()=>null);
     if(!role||role.id===session.guild.id)throw Error("Choose an existing server role.");
     s.giveawayDefaultRequiredRoleId=id;return next();
   }
 }
 if(session.step==="roleHelpVisible"){
   if(verb==="showHelp"||verb==="hideHelp"){
     s.giveawayShowRoleInstructions=verb==="showHelp";return next();
   }
 }
 if(session.step==="roleHelp"){
   if(verb==="clearRoleHelp"){s.giveawayRoleInstructions="";return next();}
   if(verb==="writeRoleHelp"){await show(session,"roleHelpText");return;}
 }
 if(session.step==="roleHelpText"&&verb==="text"){
   if(!value||value.length>500)throw Error("Enter 1–500 characters explaining where to obtain the role.");
   s.giveawayRoleInstructions=value;return after(session,"roleHelpVisible");
 }
 const fields={list:"activityGiveawayListChannelId",winners:"activityGiveawayWinnersChannelId",staff:"activityGiveawayReviewChannelId",archive:"giveawayArchiveChannelId",regularChannel:"giveawayChannelId"};
 if(fields[session.step]){
   if(verb!=="channel")throw Error("Choose a channel from the picker.");
   s[fields[session.step]]=value;return next();
 }
 if(session.step==="instructions"){
   if(verb==="default"){s.activityClaimInstructions="";return next();}
   if(verb==="custom"){await show(session,"instructionsText");return;}
 }
 if(session.step==="instructionsText"&&verb==="text"){
   if(!value||value.length>1000)throw Error("Custom instructions must contain 1–1,000 characters.");
   s.activityClaimInstructions=value;return after(session,"hours");
 }
 if(session.step==="hours"){
   if(verb==="customHours"){await show(session,"hoursText");return;}
   if(/^hours(?:12|24|48)$/.test(verb)){
     s.activityClaimWindowHours=Number(verb.slice(5));return next();
   }
 }
 if(session.step==="hoursText"&&verb==="text"){
   if(!/^\d+$/.test(value)||+value<1||+value>720)throw Error("Enter 1–720 hours.");
   s.activityClaimWindowHours=Number(value);return after(session,"rerolls");
 }
 if(session.step==="rerolls" && /^reroll(?:0|1|2|3|5|10)$/.test(verb)){
   s.activityMaxAutoRerolls=Number(verb.slice(6));return next();
 }
 if(session.step==="roles"){
   if(verb==="none"){Object.assign(s,sharedGiveawayNotificationFields(""));return next();}
   if(verb==="roles"){
     if(!Array.isArray(value)||value.length!==1)throw Error("Select exactly one shared giveaway ping role.");
     const role=await session.guild.roles.fetch(value[0]).catch(()=>null);
     if(!role||role.id===session.guild.id)throw Error("Choose an existing server role.");
     Object.assign(s,sharedGiveawayNotificationFields(role.id));return next();
   }
 }
 if(session.step==="empty"&&["announce","silent"].includes(verb)){
   s.activityAnnounceEmptyResults=verb==="announce";return next();
 }
 if(session.step==="banner"){
   if(verb==="clearBanner"){s.giveawayDefaultBannerNameKey="";return next();}
   if(verb==="selectSavedBanner"){
     s.giveawayDefaultBannerNameKey=await ensureBannerRegistered(session.guild.id,value);
     return next();
   }
   if(verb==="chooseBanner"){await show(session,"bannerText");return;}
   if(verb==="uploadBanner"){await show(session,"bannerUpload");return;}
 }
 if(session.step==="bannerText"&&verb==="text"){
   s.giveawayDefaultBannerNameKey=await ensureBannerRegistered(session.guild.id,value);
   return after(session,"review");
 }
 if(session.step==="bannerText"&&verb==="uploadBanner"){
   await show(session,"bannerUpload");return;
 }
 if(session.step==="bannerUpload"&&verb==="upload"){
   s.giveawayDefaultBannerNameKey=await registerSetupBanner(session.guild.id,value);
   return after(session,"review");
 }
 throw Error("That choice isn't available at this step.");
}
async function refreshDisplayEditor(session){
 if(session.step!=="displayEditor"||!session.displayDraft)
   throw Error("The display editor is no longer active.");
 if(session.message?.edit)await session.message.edit(layout(session));
 else await show(session,"displayEditor");
}
function displayEditModal(session,field){
 const existing=session.displayDraft[serverDisplayField(field)]||REGULAR_DISPLAY_DEFAULTS[field];
 return new ModalBuilder()
   .setCustomId("actconfig:"+session.id+":displaySubmit:"+field)
   .setTitle("Edit "+displayLabels[field])
   .addComponents(new ActionRowBuilder().addComponents(
     new TextInputBuilder().setCustomId("displayValue")
       .setLabel(displayLabels[field])
       .setStyle(field.endsWith("Title")?TextInputStyle.Short:TextInputStyle.Paragraph)
       .setMaxLength(field.endsWith("Title")?120:400)
       .setRequired(true).setValue(existing)
   ));
}
async function startGiveawaySetup(interaction,mode="activity"){
 const config=await GuildConfig.findOne({guildId:interaction.guildId}).lean();
 if(config?.commandChannelId&&config.commandChannelId!==interaction.channelId)
   throw Error("Run /setup giveaways or /setup activity-giveaways in <#"+config.commandChannelId+">.");
 const sessionKey=key(interaction.channelId,interaction.user.id);
 if(sessions.get(sessionKey)?.expires>Date.now())
   return interaction.editReply("Your activity giveaway setup is already open in this channel.");
 const defaults={
   giveawayChannelId:config?.giveawayChannelId||"",
    activityGiveawayListChannelId:config?.activityGiveawayListChannelId||"",
   activityGiveawayWinnersChannelId:config?.activityGiveawayWinnersChannelId||"",
   activityGiveawayReviewChannelId:config?.activityGiveawayReviewChannelId||"",
    giveawayArchiveChannelId:config?.giveawayArchiveChannelId||"",
   giveawayManagerRoleId:config?.giveawayManagerRoleId||"",
   giveawayExcludedRoleId:config?.giveawayExcludedRoleId||"",
   giveawayDefaultRequiredRoleId:config?.giveawayDefaultRequiredRoleId||"",
   giveawayShowRoleInstructions:config?.giveawayShowRoleInstructions!==false,
   giveawayRoleInstructions:config?.giveawayRoleInstructions||"",
   activityClaimInstructions:config?.activityClaimInstructions||"",
   activityClaimWindowHours:config?.activityClaimWindowHours??DEFAULT_CLAIM_HOURS,
   activityMaxAutoRerolls:config?.activityMaxAutoRerolls??DEFAULT_MAX_AUTO_REROLLS,
   ...sharedGiveawayNotificationFields(sharedGiveawayPingRoleId(config)),
   activityAnnounceEmptyResults:config?.activityAnnounceEmptyResults!==false,
   giveawayDefaultBannerNameKey:config?.giveawayDefaultBannerNameKey||"",
   ...Object.fromEntries(REGULAR_DISPLAY_FIELDS.map(field=>
     [serverDisplayField(field),config?.[serverDisplayField(field)]||""])),
 };
 const session={id:new mongoose.Types.ObjectId().toString(),key:sessionKey,
   owner:interaction.user.id,channel:interaction.channel,guild:interaction.guild,
   mode,fromReview:false,updateExisting:false,settings:defaults};
 sessions.set(sessionKey,session);
 await show(session,mode==="regular"?"regularChannel":"list");
 return interaction.editReply((mode==="regular"?"Regular":"Activity")+" giveaway server setup has opened here. Follow the numbered steps.");
}
export const startActivityGiveawaySetup=i=>startGiveawaySetup(i,"activity");
export const startRegularGiveawaySetup=i=>startGiveawaySetup(i,"regular");
export async function handleActivityGiveawaySetupInteraction(interaction){
 const match=/^actconfig:([0-9a-f]{24}):(.+)$/.exec(interaction.customId);
 const session=match&&sessions.get(key(interaction.channelId,interaction.user.id));
 const modalSubmit=match?.[2]?.startsWith("displaySubmit:");
 if(!session||session.id!==match[1]||session.expires<Date.now()||
    (!modalSubmit&&session.messageId!==interaction.message?.id))
   return interaction.reply({content:"That setup prompt is no longer active or belongs to another staff member.",
     flags:MessageFlags.Ephemeral});
 if(!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild))
   return interaction.reply({content:"Manage Server permission is required.",flags:MessageFlags.Ephemeral});
 const verb=match[2];
 if(verb.startsWith("displayEdit:")){
   const field=verb.slice("displayEdit:".length);
   if(session.mode!=="regular"||session.step!=="displayEditor"||
      !session.displayDraft||!REGULAR_DISPLAY_FIELDS.includes(field))
     return interaction.reply({content:"That display editor is no longer active.",flags:MessageFlags.Ephemeral});
   session.modalField=field;
   return interaction.showModal(displayEditModal(session,field));
 }
 await interaction.deferReply({flags:MessageFlags.Ephemeral});
 try{
   if(modalSubmit){
     const field=verb.slice("displaySubmit:".length);
     if(session.mode!=="regular"||session.step!=="displayEditor"||
        !session.displayDraft||session.modalField!==field||
        !REGULAR_DISPLAY_FIELDS.includes(field))
       throw Error("The text editor expired. Open the section again.");
     const text=cleanRegularDisplayField(field,interaction.fields.getTextInputValue("displayValue"));
     if(!text)throw Error("Enter text or use the Default button in the editor.");
     session.displayDraft[serverDisplayField(field)]=text;
     session.modalField=null;
     await refreshDisplayEditor(session);
     return interaction.editReply("Preview updated. Confirm Text to accept your changes.");
   }
   const value=["channel","roles","requiredRole","managerRole","excludedRole","edit","selectSavedBanner"].includes(verb)?
     interaction.values:null;
   await apply(session,verb,["channel","selectSavedBanner","edit"].includes(verb)?value?.[0]:value);
   return interaction.editReply("Updated setup step.");
 }catch(error){return interaction.editReply("Couldn't save that choice: "+String(error.message||error));}
}
export function activityGiveawaySetupReply(message){
 if(!message.guildId||message.author?.bot||(!message.content&&!message.attachments?.size))return false;
 const session=sessions.get(key(message.channelId,message.author.id));
 if(!session||session.expires<Date.now()||!["roleHelpText","instructionsText","hoursText","bannerText","bannerUpload"].includes(session.step))
   return false;
 void apply(session,session.step==="bannerUpload"?"upload":"text",
   session.step==="bannerUpload"?message:String(message.content||"").trim()).catch(error=>
   session.channel.send({content:"Setup error: "+String(error.message||error),allowedMentions:{parse:[]}}));
 return true;
}
