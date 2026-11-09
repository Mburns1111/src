import mongoose from "mongoose";
import {ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags} from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import {parseEasternAnnouncement} from "../services/giveaway-plan-time.js";
import {ensureBannerRegistered} from "../services/giveaway-banners.js";
import {publishActivityOneOffListing} from "../services/giveaway-directory.js";
import {shouldRequestMessageContent} from "../services/observation-intents.js";
import {weekdays,windowEnd,nextOpening,maxActiveDays,repeatText,createGuidedActivity,ensureStaffCard} from "../services/guided-activity.js";

const sessions=new Map();
const sessionKey=(channelId,userId)=>channelId+":"+userId;
const hour=3600000;
const stamp=date=>'<t:'+Math.floor(+date/1000)+':F>';
const choice=(label,value=label)=>[label,value];
const weekChoices=weekdays.map((day,n)=>choice(day,String(n)));
const prompts={
  scope:["Where should messages count?",[choice("All server channels","all"),choice("Watch a channel","channel")]],
  channel:["Reply with the watched channel mention or paste its Discord channel link."],
  period:["How long should I count activity once you create the giveaway?",["24 hours","Weekly","Custom days","Custom hours"].map(x=>choice(x))],
  startDay:["Which weekday should a regular weekly window start at midnight Eastern?",weekChoices],
  endDay:["Which weekday should counting end at midnight Eastern? Choose the same weekday for a full week.",weekChoices],
  length:["Reply with a positive whole number for the duration."],
  minimum:["How many qualifying messages must a member send per active day? Reply with a number, such as 1."],
  days:["On how many different days must they meet that requirement? Reply with a whole number. The minimum is 1."],
  filters:["Which messages should count?",["Any message","Member ping","Word or phrase","Ping and phrase"].map(x=>choice(x))],
  mention:["Which member must the message explicitly ping? Paste their member mention or Discord user ID."],
  phrase:["Which word or phrase must the message contain? Letter case does not matter."],
  title:["What should the giveaway be called? Reply with the title."],
  prize:["What prize are you giving away? Reply with the prize details."],
  winners:["How many winners should I draw?",["1","2","3","Other"].map(x=>choice(x))],
  winnerNumber:["Reply with the number of winners, from 1 to 10."],
  draw:["",[choice("When counting ends","end"),choice("Choose a later time","later")]],
  later:["Enter the first drawing date and time in Eastern time, for example 2026-12-04 19:30. Repeats use the same delay after counting ends."],
  extras:["Optional giveaway settings",[]],
  role:["Paste a role mention or role ID for extra drawing chances."],
  bonus:["How many extra chances does this role add? Reply with a number from 1 to 20."],
  claim:["How many hours do winners have to claim? Reply with a number from 1 to 720."],
  banner:["Reply with a registered banner name, or default for the server banner."],
  repeat:["How often should a new activity giveaway start?",[choice("One time","once"),choice("Every 24 hours","daily"),choice("Every week","weekly"),choice("Custom interval","custom")]],
  unit:["Which unit should I use for the repeat interval?",["Minutes","Hours","Days"].map(x=>choice(x))],
  amount:["How many units between the start of each giveaway? Reply with a positive whole number."],
  summary:["",[choice("Create activity","create"),choice("Edit settings","edit"),choice("Cancel","cancel")]],
  edit:["Which setting would you like to edit?",[
    ["Watched channel","scope"],["Counting period","period"],["Message goal","minimum"],["Ping or phrase","filters"],
    ["Title","title"],["Prize","prize"],["Winners","winners"],["Draw time","draw"],["Optional settings","extras"],["Repeat schedule","repeat"],
  ]],
};
function number(input,min,max){
  const value=Number(input);
  if(!/^\d+$/.test(input)||!Number.isSafeInteger(value)||value<min||value>max)
    throw Error('Enter a whole number from '+min+' to '+max+'.');
  return value;
}
function words(input,max){
  const value=input.trim();
  if(!value||value.length>max)throw Error('Enter 1–'+max+' characters.');
  return value;
}
function checkSchedule(s,start) {
  const end=windowEnd(s,start);
  if(s.days>maxActiveDays(start,end))throw Error("There are fewer active days available in this first window. Edit the message goal or counting period.");
  if(s.repeat==="weekly" && s.period==="weekly"){
    const span=(s.endDay-s.startDay+7)%7||7;
    if(s.days>span)throw Error("The regular weekly window has only "+span+" active day(s). Edit the message goal.");
  }
  if(s.repeat!=="once" && nextOpening(s,start)<end)
    throw Error("A new giveaway would start before this one finishes counting. Choose a longer repeat interval or shorter counting period.");
  if(s.firstDraw && +new Date(s.firstDraw)<+end)
    throw Error("The chosen drawing time is before counting finishes. Edit the draw time.");
  return end;
}
function describe(session){
  const s=session.settings,start=new Date(),end=windowEnd(s,start);
  const upcoming=[];
  if(s.repeat!=="once"){
    upcoming.push("**Upcoming giveaways if you create this activity now**");
    let opening=start;
    for(let n=1;n<=2;n++){
      opening=nextOpening(s,opening);
      upcoming.push("Repeat "+n+" · Starts "+stamp(opening)+" · Ends "+stamp(windowEnd(s,opening)));
    }
  }
  return [
    '**Review your activity giveaway**',s.title,'Prize · '+s.prize,
    'Count messages in '+(s.channel?'<#'+s.channel+'>':'all eligible server channels'),
    'Counting starts when you click Create activity. Estimated cutoff '+stamp(end),
    s.period==="weekly"?'Weekly boundaries · '+weekdays[s.startDay]+' to '+weekdays[s.endDay]+' at midnight Eastern':null,
    'Requirement · '+s.minimum+' message(s) '+(end-start<=24*hour?'during the window':'per day on at least '+s.days+' different day(s)'),
    s.mention?'Required ping · <@'+s.mention+'>':null,s.phrase?'Required word or phrase · '+s.phrase:null,
    'Winners · '+s.winners+' · Draw '+stamp(s.firstDraw?new Date(s.firstDraw):end),
    'Manual approval '+(s.approval?'on':'off')+' · Member progress '+(s.progress?'on':'off'),
    'Claim time · '+s.claimHours+' hours · Banner · '+(s.banner||'Server default'),
    s.bonuses.length?'Bonus roles · '+s.bonuses.map(b=>'<@&'+b.roleId+'> +'+b.extraEntries).join(', '):null,
    'Repeat · '+repeatText(s),
    ...upcoming,
  ].filter(Boolean).join('\n');
}
async function show(session,step){
  const s=session.settings;
  let [content,choices]=prompts[step];
  if(step==="draw")content='When should I draw and announce the winners? If you create this activity now, counting ends '+stamp(windowEnd(s,new Date()))+'.';
  if(step==="minimum" && windowEnd(s,new Date())-Date.now()<=24*hour)
    content="How many qualifying messages must a member send during this activity? Reply with a number, such as 1.";
  if(step==="length")content='How many '+(s.period==="Custom days"?'days':'hours')+' should I count? Reply with a whole number.';
  if(step==="amount")content='How many '+s.unit+' between giveaway starts? Reply with a number, such as 3.';
  if(step==="extras")choices=[
    ['Manual approval '+(s.approval?'ON':'OFF'),'approval'],['Member progress '+(s.progress?'ON':'OFF'),'progress'],
    ['Add bonus role','role'],['Claim time','claim'],['Banner','banner'],['Done','done'],
  ];
  if(step==="summary")content=describe(session);
  const controls=[...(choices||[])];
  if(step!=="summary")controls.push(["Cancel setup","cancel"]);
  const components=[];
  for(let n=0;n<controls.length;n+=5)components.push(new ActionRowBuilder().addComponents(
    controls.slice(n,n+5).map(([label,value])=>new ButtonBuilder().setCustomId('activitysetup:'+session.id+':'+value)
      .setLabel(label).setStyle(value==="create"||value==="done"?ButtonStyle.Success:ButtonStyle.Secondary))));
  const payload=step==="summary"?{embeds:[{description:content}]}:{content};
  const message=await session.channel.send({...payload,content:'**Activity setup** · <@'+session.owner+'>\n'+(payload.content||""),components,allowedMentions:{parse:[]}});
  Object.assign(session,{step,messageId:message.id,choices:controls.map(x=>x[1]),acceptText:!choices?.length,expires:Date.now()+30*60000});
}
async function configFor(guild,channelId){
  const c=await GuildConfig.findOne({guildId:guild.id}).lean();
  if(!c?.commandChannelId)throw Error("Use /setup channels to choose the commands channel first.");
  if(c.commandChannelId!==channelId)throw Error("Start /giveaway activity in <#"+c.commandChannelId+">.");
  for(const [field,label] of [["activityGiveawayListChannelId","activity_giveaway_list"],["activityGiveawayWinnersChannelId","activity_winners"],["activityGiveawayReviewChannelId","activity_review"]]){
    const channel=c?.[field]&&await guild.channels.fetch(c[field]);
    if(!channel?.send)throw Error("Use /setup channels to set "+label+" first.");
    if(label==="activity_review" && channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel))
      throw Error("Choose a private staff channel for activity_review.");
  }
}
export async function startActivityWizard(i){
  if(!shouldRequestMessageContent())throw Error("Enable Message Content Intent and set ENABLE_MESSAGE_CONTENT_INTENT=1 to count activity.");
  await configFor(i.guild,i.channelId);
  const key=sessionKey(i.channelId,i.user.id);
  const previous=sessions.get(key);
  if(previous && previous.expires>Date.now())return i.editReply("You already have an activity setup in this channel. Finish or cancel it here.");
  const session={id:new mongoose.Types.ObjectId().toString(),guild:i.guild,owner:i.user.id,key,channel:i.channel,
    settings:{creator:i.user.id,days:1,approval:false,bonuses:[],progress:false,claimHours:48,repeat:"once"}};
  await show(session,"scope");
  sessions.set(key,session);
  return i.editReply("Your activity setup is open in this channel.");
}
const finishGroup=(session,next)=>session.editing?(session.editing=false,"summary"):next;
async function accept(session,v,client){
  const s=session.settings,step=session.step,now=new Date();
  const done=next=>finishGroup(session,next);
  const dayStep=()=>windowEnd(s,now)-now>24*hour?"days":(s.days=1,done("filters"));
  if(/^cancel setup$/i.test(v)){
    sessions.delete(session.key); return session.channel.send("Setup cancelled.");
  }
  let next;
  switch(step){
    case "scope":s.channel="";next=v==="all"?done("period"):"channel";break;
    case "channel":{
      const match=/^<#(\d{17,20})>$/.exec(v);
      const link=/^https?:\/\/(?:www\.)?discord\.com\/channels\/(\d+)\/(\d+)\/?$/.exec(v);
      const id=match?.[1] || (link?.[1]===session.guild.id && link[2]);
      const ch=id && await session.guild.channels.fetch(id).catch(()=>null);
      if(!ch?.isTextBased() || !ch.permissionsFor(session.guild.members.me)?.has(PermissionFlagsBits.ViewChannel))
        throw Error("Paste a channel mention or Copy Channel Link from a text channel I can see in this server.");
      s.channel=id;next=done("period");break;
    }
    case "period":s.period=v==="Weekly"?"weekly":v;s.hours=24;
      next=s.period==="weekly"?"startDay":v==="24 hours"?"minimum":"length";break;
    case "startDay":s.startDay=Number(v);next="endDay";break;
    case "endDay":s.endDay=Number(v);next="minimum";break;
    case "length":s.hours=number(v,1,s.period==="Custom days"?365:8760)*(s.period==="Custom days"?24:1);next="minimum";break;
    case "minimum":s.minimum=number(v,1,10000);next=dayStep();break;
    case "days":s.days=number(v,1,maxActiveDays(now,windowEnd(s,now)));next=done("filters");break;
    case "filters":s.mention="";s.phrase="";s.both=v==="Ping and phrase";next=s.both||v==="Member ping"?"mention":v==="Word or phrase"?"phrase":done("title");break;
    case "mention":{
      const id=/^(?:<@!?(\d{17,20})>|(\d{17,20}))$/.exec(v);
      const member=id&&await session.guild.members.fetch(id[1]||id[2]).catch(()=>null);
      if(!member||member.user.bot)throw Error("Paste a mention or user ID for a member of this server.");
      s.mention=member.id;next=s.both?"phrase":done("title");break;
    }
    case "phrase":s.phrase=words(v,120);next=done("title");break;
    case "title":s.title=words(v,100);next=done("prize");break;
    case "prize":s.prize=words(v,1500);next=done("winners");break;
    case "winners":case "winnerNumber":
      if(v==="Other"){next="winnerNumber";break;}s.winners=number(v,1,10);next=done("draw");break;
    case "draw":s.firstDraw=null;next=v==="later"?"later":done("extras");break;
    case "later":{
      const date=parseEasternAnnouncement(v);
      if(date<windowEnd(s,now))throw Error("Choose a time after activity counting ends.");
      s.firstDraw=date;next=done("extras");break;
    }
    case "extras":
      if(v==="approval"||v==="progress"){s[v]=!s[v];next="extras";}
      else next=v==="done"?done("repeat"):v;break;
    case "claim":s.claimHours=number(v,1,720);next="extras";break;
    case "banner":s.banner=v.toLowerCase()==="default"?"":await ensureBannerRegistered(session.guild.id,v);next="extras";break;
    case "role":{
      const match=/^(?:<@&(\d+)>|(\d{17,20}))$/.exec(v);
      const role=match && await session.guild.roles.fetch(match[1]||match[2]).catch(()=>null);
      if(!role)throw Error("Paste a role mention or role ID from this server.");
      session.role=role.id;next="bonus";break;
    }
    case "bonus":{
      const extraEntries=number(v,1,20);
      const bonuses=s.bonuses.filter(b=>b.roleId!==session.role);
      if(bonuses.length>=20)throw Error("At most 20 roles can have bonus chances.");
      s.bonuses=[...bonuses,{roleId:session.role,extraEntries}];next="extras";break;
    }
    case "repeat":s.repeat=v;next=v==="custom"?"unit":done("summary");break;
    case "unit":s.unit=v.toLowerCase();next="amount";break;
    case "amount":s.amount=number(v,1,525600);s.interval=s.amount*({minutes:1,hours:60,days:1440}[s.unit]);next=done("summary");break;
    case "edit":session.editing=true;next=v;break;
    case "summary":{
      if(v==="edit"){next="edit";break;}
      const host=await session.guild.members.fetch({user:session.owner,force:true});
      if(!host.permissions.has(PermissionFlagsBits.ManageGuild))throw Error("Manage Server permission is required.");
      await configFor(session.guild,session.channel.id);
      const start=new Date(),end=checkSchedule(s,start);
      s.delay=s.firstDraw?new Date(s.firstDraw)-end:0;
      const record=await createGuidedActivity(session.id,session.guild.id,s,start);
      sessions.delete(session.key);
      const posts=await Promise.allSettled([publishActivityOneOffListing(client,record),ensureStaffCard(client,record)]);
      return session.channel.send('Activity created. Counting ends '+stamp(record.activityEndAt)+'. '+(posts.every(p=>p.status==="fulfilled")?'The activity list and staff cards are ready.':'The bot will retry any missing channel post.'));
    }
  }
  return show(session,next);
}
async function respond(session,input,client){
  if(session.busy)return;
  session.busy=true;
  try{await accept(session,input,client);}
  catch(error){await session.channel.send({content:error.message,allowedMentions:{parse:[]}});}
  finally{session.busy=false;}
}
export async function wizardButton(i){
  const session=sessions.get(sessionKey(i.channelId,i.user.id));
  const [,id,value]=i.customId.split(":");
  if(!session || session.expires<Date.now() || session.id!==id || session.messageId!==i.message.id || !session.choices.includes(value))
    return i.reply({content:"Only the staff member who started this setup can use its current prompt.",flags:MessageFlags.Ephemeral});
  await i.deferUpdate();
  if(value==="cancel"){sessions.delete(session.key);return session.channel.send("Setup cancelled.");}
  return respond(session,value,i.client);
}
// Route only the host's text at a text-input step in this channel.
export function wizardReply(message){
  if(!message.guildId || message.author?.bot || message.webhookId)return false;
  const session=sessions.get(sessionKey(message.channelId,message.author.id));
  if(!session || !session.acceptText)return false;
  if(session.expires<Date.now()){sessions.delete(session.key);return false;}
  if(message.reference?.messageId && message.reference.messageId!==session.messageId)return false;
  void respond(session,message.content.trim(),message.client)
    .catch(error=>console.error("[Giveaways] Channel setup reply failed:",error));
  return true;
}
