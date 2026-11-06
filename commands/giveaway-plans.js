import GiveawayPlan, {planNameKey} from "../models/GiveawayPlan.js";
import GiveawayWatchRule, {watchNameKey} from "../models/GiveawayWatchRule.js";
import {parseEasternAnnouncement} from "../services/giveaway-plan-time.js";
import {planRepeatMode} from "../services/giveaway-plans.js";
import {getConfiguredTextChannelAndConfig} from "./shared.js";

export const PLAN_OPERATIONS=new Set(["plan-create","plan-list","plan-view","plan-edit",
  "prize-add","prize-edit","prize-remove","prize-move"]);

export function addGiveawayPlanCommands(builder) {
 return builder
 .addSubcommand(c=>c.setName("plan-create").setDescription("Schedule an activity giveaway once, daily, weekly or at an interval")
   .addStringOption(o=>o.setName("name").setDescription("Unique saved plan name").setRequired(true).setMinLength(1).setMaxLength(60))
   .addStringOption(o=>o.setName("title").setDescription("Title for the announcement").setRequired(true).setMaxLength(100))
   .addStringOption(o=>o.setName("watch").setDescription("Saved watch rule name, or general for server-wide activity").setRequired(true).setMaxLength(60))
   .addStringOption(o=>o.setName("announce_at").setDescription("First winner announcement: YYYY-MM-DD HH:mm Eastern").setRequired(true))
   .addStringOption(o=>o.setName("prize").setDescription("First prize; add more with prize-add").setRequired(true).setMaxLength(1500))
   .addStringOption(o=>o.setName("repeat").setDescription("One-time, same Eastern time daily/weekly, or fixed elapsed interval")
     .addChoices({name:"One time",value:"once"},{name:"Daily (same Eastern time)",value:"daily"},
       {name:"Weekly (same Eastern day/time)",value:"weekly"},{name:"Every X hours",value:"interval"}))
   .addStringOption(o=>o.setName("period").setDescription("Check the previous Eastern day or the last completed Wed–Wed week")
     .addChoices({name:"Previous calendar day",value:"daily"},{name:"Previous Wed–Wed week",value:"weekly"}))
   .addIntegerOption(o=>o.setName("interval_hours").setDescription("Only for Every X hours; minimum 24h daily / 168h weekly")
     .setMinValue(1).setMaxValue(720))
   .addBooleanOption(o=>o.setName("repeat_prizes").setDescription("Loop through saved prizes when recurring (default: yes)"))
   .addIntegerOption(o=>o.setName("claim_hours").setDescription("Ticket claim period in hours (default 48)").setMinValue(1).setMaxValue(720))
   .addIntegerOption(o=>o.setName("winners").setDescription("Winners per drawing (default 1)").setMinValue(1).setMaxValue(10))
   .addIntegerOption(o=>o.setName("messages").setDescription("Total messages required in the selected daily/weekly period").setMinValue(1).setMaxValue(10000)))
 .addSubcommand(c=>c.setName("plan-list").setDescription("Review saved giveaway schedules and recurrence"))
 .addSubcommand(c=>c.setName("plan-view").setDescription("View editable prize list and schedule details")
   .addStringOption(o=>o.setName("name").setDescription("Saved plan name").setRequired(true)))
 .addSubcommand(c=>c.setName("plan-edit").setDescription("Edit a saved plan without changing existing drawings")
   .addStringOption(o=>o.setName("name").setDescription("Saved plan name").setRequired(true))
   .addStringOption(o=>o.setName("title").setDescription("New announcement title").setMaxLength(100))
   .addStringOption(o=>o.setName("watch").setDescription("Saved watch name, or general"))
   .addStringOption(o=>o.setName("announce_at").setDescription("Next run: YYYY-MM-DD HH:mm Eastern"))
   .addStringOption(o=>o.setName("repeat").setDescription("One-time, daily, weekly or repeat every X hours")
     .addChoices({name:"One time",value:"once"},{name:"Daily (same Eastern time)",value:"daily"},
       {name:"Weekly (same Eastern day/time)",value:"weekly"},{name:"Every X hours",value:"interval"}))
   .addStringOption(o=>o.setName("period").setDescription("Activity window: prior Eastern day or prior Wed–Wed week")
     .addChoices({name:"Previous calendar day",value:"daily"},{name:"Previous Wed–Wed week",value:"weekly"}))
   .addIntegerOption(o=>o.setName("interval_hours").setDescription("Required for Every X hours; 24h+ daily or 168h+ weekly")
     .setMinValue(1).setMaxValue(720))
   .addBooleanOption(o=>o.setName("repeat_prizes").setDescription("Cycle through the saved prize list"))
   .addBooleanOption(o=>o.setName("enabled").setDescription("Enable or pause the plan"))
   .addIntegerOption(o=>o.setName("claim_hours").setDescription("Hours to file ticket after each drawing").setMinValue(1).setMaxValue(720))
   .addIntegerOption(o=>o.setName("winners").setDescription("Number of winners").setMinValue(1).setMaxValue(10))
   .addIntegerOption(o=>o.setName("messages").setDescription("Override total messages needed per activity period").setMinValue(1).setMaxValue(10000)))
 .addSubcommand(c=>c.setName("prize-add").setDescription("Append an upcoming prize to a saved plan")
   .addStringOption(o=>o.setName("name").setDescription("Saved plan name").setRequired(true))
   .addStringOption(o=>o.setName("prize").setDescription("Prize details").setRequired(true).setMaxLength(1500)))
 .addSubcommand(c=>c.setName("prize-edit").setDescription("Change a prize in a saved plan's list")
   .addStringOption(o=>o.setName("name").setDescription("Saved plan name").setRequired(true))
   .addIntegerOption(o=>o.setName("position").setDescription("Prize number, starting at 1").setRequired(true).setMinValue(1).setMaxValue(50))
   .addStringOption(o=>o.setName("prize").setDescription("Replacement prize details").setRequired(true).setMaxLength(1500)))
 .addSubcommand(c=>c.setName("prize-remove").setDescription("Remove one prize from a saved plan")
   .addStringOption(o=>o.setName("name").setDescription("Saved plan name").setRequired(true))
   .addIntegerOption(o=>o.setName("position").setDescription("Prize number, starting at 1").setRequired(true).setMinValue(1).setMaxValue(50)))
 .addSubcommand(c=>c.setName("prize-move").setDescription("Reorder two prizes in a saved plan")
   .addStringOption(o=>o.setName("name").setDescription("Saved plan name").setRequired(true))
   .addIntegerOption(o=>o.setName("from").setDescription("Position to move, starting at 1").setRequired(true).setMinValue(1).setMaxValue(50))
   .addIntegerOption(o=>o.setName("to").setDescription("Destination position, starting at 1").setRequired(true).setMinValue(1).setMaxValue(50)));
}

const unix=date=>Math.floor(new Date(date).getTime()/1000);
export function validatePlanSchedule(mode,period,intervalHours) {
  if(!["once","daily","weekly","interval"].includes(mode)) throw Error("Invalid repeat setting.");
  if(!["daily","weekly"].includes(period)) throw Error("Invalid activity period.");
  if(mode==="daily" && period==="weekly")
    throw Error("A daily giveaway must check a daily activity window, not repeat the same weekly entries.");
  if(mode==="interval") {
    const minimum=period==="daily"?24:168;
    if(!Number.isSafeInteger(intervalHours)||intervalHours<minimum||intervalHours>720)
      throw Error(`For a ${period} activity window, repeat every ${minimum}–720 hours so the same period cannot be redrawn.`);
  }else if(intervalHours!==null && intervalHours!==undefined)
    throw Error("interval_hours is only used with repeat: Every X hours.");
  return {repeatMode:mode,activityPeriod:period,
    intervalMinutes:mode==="interval"?intervalHours*60:null,recurring:mode!=="once"};
}
function summary(plan,details=false) {
 const status=plan.status==="active"?"Active":plan.status==="paused"?"Paused":"Completed";
 const lines=[`**${plan.name} — ${status}**`,
   `Title: ${plan.title}`,
   `Activity: ${plan.watchNameKey==="general"?"General server activity":plan.watchNameKey}`,
   `Repeat: ${planRepeatMode(plan)==="interval" ? `Every ${plan.intervalMinutes/60} hours` : ({once:"One-time",daily:"Daily at the same Eastern time",weekly:"Weekly at the same Eastern time"})[planRepeatMode(plan)]}`,
   `Activity checked: ${(plan.activityPeriod||"weekly")==="daily" ? "Previous Eastern calendar day only" : "Previous Wednesday–Wednesday week"} · Prize cycle: ${plan.repeatPrizes?"Repeat list":"Stop after final prize"}`,
   `Next draw: <t:${unix(plan.nextRunAt)}:F> · Claim window: ${plan.claimWindowHours} hours · Winners: ${plan.winnerCount}`,
   `Required messages: ${plan.minimumTotalMessages??"from watched channel (1 for general activity)"} across selected activity period`];
 if(details){
  lines.push("**Prize list**");
  lines.push(...(plan.prizes.length ? plan.prizes.map((p,i)=>
   `${i+1}. ${i===plan.nextPrizeIndex?"**Next:** ":""}${p.replace(/[@`*_~|<>]/g,"").slice(0,120)}`).slice(0,25)
    : ["No prizes configured"]));
  if(plan.prizes.length>25) lines.push(`…and ${plan.prizes.length-25} more.`);
  if(plan.lastResult) lines.push(`Last run: ${plan.lastResult}`);
 }
 return lines.join("\n");
}
async function ensureRule(guildId,value) {
 const key=watchNameKey(value);
 if(key==="general")return "general";
 const rule=await GiveawayWatchRule.findOne({guildId,nameKey:key}).lean();
 if(!rule)throw Error("Save that watched channel first using /giveaway watch-save, or use general.");
 return key;
}
export async function executeGiveawayPlanAdmin(interaction) {
 const op=interaction.options.getSubcommand();
 if(!PLAN_OPERATIONS.has(op)) throw Error("Unknown giveaway plan action.");
 if(op==="plan-create"){
  const {channel}=await getConfiguredTextChannelAndConfig(interaction,"giveawayChannelId","giveaway");
  const name=interaction.options.getString("name",true).trim();
  const key=planNameKey(name);
  if(key==="general")throw Error("Choose a plan name other than general.");
  const watch=await ensureRule(interaction.guildId,interaction.options.getString("watch",true));
  const watchedRule=watch==="general"?null:await GiveawayWatchRule.findOne({
    guildId:interaction.guildId,nameKey:watch}).lean();
  const nextRunAt=parseEasternAnnouncement(interaction.options.getString("announce_at",true));
  const mode=interaction.options.getString("repeat") || "once";
  const period=interaction.options.getString("period") ||
    (mode==="daily"?"daily":watchedRule?.activityPeriod||"weekly");
  const schedule=validatePlanSchedule(mode,period,interaction.options.getInteger("interval_hours"));
  const prize=interaction.options.getString("prize",true).trim();
  if(!prize)throw Error("Enter a prize.");
  const plan=await GiveawayPlan.create({
   guildId:interaction.guildId,name,nameKey:key,
   title:interaction.options.getString("title",true).trim(),watchNameKey:watch,
   creatorId:interaction.user.id,channelId:channel.id,
   ...schedule,repeatPrizes:interaction.options.getBoolean("repeat_prizes")??true,
   nextRunAt,claimWindowHours:interaction.options.getInteger("claim_hours")??48,
   winnerCount:interaction.options.getInteger("winners")??1,
   minimumTotalMessages:interaction.options.getInteger("messages")??null,prizes:[prize],
  }).catch(error=>{if(error.code===11000)throw Error("A plan with that name already exists. Use plan-edit instead.");throw error;});
  return interaction.editReply({content:"Saved giveaway plan.\n"+summary(plan,true),allowedMentions:{parse:[]}});
 }
 if(op==="plan-list"){
  const plans=await GiveawayPlan.find({guildId:interaction.guildId}).sort({nameKey:1}).limit(30).lean();
  return interaction.editReply({content:plans.length?plans.map(x=>
    `• **${x.name}** (${x.status}, ${planRepeatMode(x)}, ${x.activityPeriod||"weekly"} window) · ${x.watchNameKey} · <t:${unix(x.nextRunAt)}:F>`).join("\n").slice(0,1900)
    :"No saved plans. Use /giveaway plan-create.",allowedMentions:{parse:[]}});
 }
 const key=planNameKey(interaction.options.getString("name",true));
 const plan=await GiveawayPlan.findOne({guildId:interaction.guildId,nameKey:key});
 if(!plan)throw Error("No saved plan with that name.");
 if(op==="plan-view")return interaction.editReply({content:summary(plan,true).slice(0,1950),allowedMentions:{parse:[]}});
 if(plan.leaseUntil && new Date(plan.leaseUntil)>new Date())
  throw Error("This plan is currently drawing. Retry the edit when its run completes.");
 if(op==="plan-edit") {
  let changed=false;
  for(const [option,field] of [["title","title"],["repeat_prizes","repeatPrizes"],
    ["claim_hours","claimWindowHours"],["winners","winnerCount"],["messages","minimumTotalMessages"]]){
   let value=option==="repeat_prizes"?interaction.options.getBoolean(option):
     option==="claim_hours"||option==="winners"||option==="messages"?interaction.options.getInteger(option):
     interaction.options.getString(option);
   if(value!==null && value!==undefined){plan[field]=value;changed=true;}
  }
  const watch=interaction.options.getString("watch");
  if(watch!==null){plan.watchNameKey=await ensureRule(interaction.guildId,watch);changed=true;}
  const mode=interaction.options.getString("repeat") || planRepeatMode(plan);
  const period=interaction.options.getString("period") ||
    (interaction.options.getString("repeat")==="daily"?"daily":plan.activityPeriod||"weekly");
  const intervalHours=interaction.options.getInteger("interval_hours") ??
    (mode==="interval"?plan.intervalMinutes/60:null);
  const requestedSchedule=interaction.options.getString("repeat")!==null ||
    interaction.options.getString("period")!==null || interaction.options.getInteger("interval_hours")!==null;
  if(requestedSchedule){
    Object.assign(plan,validatePlanSchedule(mode,period,intervalHours));
    changed=true;
  }
  const at=interaction.options.getString("announce_at");
  if(at){plan.nextRunAt=parseEasternAnnouncement(at);changed=true;}
  const enabled=interaction.options.getBoolean("enabled");
  if(enabled!==null){
    if(enabled && !plan.prizes.length) throw Error("Add at least one prize before enabling a plan.");
    if(enabled && new Date(plan.nextRunAt)<=new Date()) throw Error("Update announce_at to a future time before enabling.");
    plan.status=enabled?"active":"paused";changed=true;
  }
  if(!changed)throw Error("Choose at least one setting to change.");
  // Disabled plans remain paused; completed one-time plans may only resume
  // after staff explicitly set enabled:true and a future announcement.
  if(plan.status==="active" && plan.nextRunAt<=new Date())
    throw Error("Set a future announce_at for an active plan.");
  await plan.save();
 }else{
  const prizes=[...plan.prizes];
  const position=interaction.options.getInteger("position");
  if(op==="prize-add") {
    if(prizes.length>=50)throw Error("A plan can save at most 50 prizes.");
    const prize=interaction.options.getString("prize",true).trim();
    if(!prize)throw Error("Enter a prize.");
    prizes.push(prize);
  }else if(op==="prize-edit"||op==="prize-remove"){
    if(position<1||position>prizes.length)throw Error("That prize position does not exist.");
    if(op==="prize-edit")prizes[position-1]=interaction.options.getString("prize",true).trim();
    else {
      prizes.splice(position-1,1);
      if(position-1<plan.nextPrizeIndex)plan.nextPrizeIndex--;
      if(plan.nextPrizeIndex>=prizes.length)plan.nextPrizeIndex=0;
    }
  }else if(op==="prize-move"){
    const from=interaction.options.getInteger("from",true)-1,to=interaction.options.getInteger("to",true)-1;
    if(from<0||to<0||from>=prizes.length||to>=prizes.length)throw Error("Both prize positions must exist.");
    const [prize]=prizes.splice(from,1);
    prizes.splice(to,0,prize);
    // Editing the upcoming order selects the new first prize; prior drawing history is unchanged.
    plan.nextPrizeIndex=0;
  }
  plan.prizes=prizes;
  if(!prizes.length) plan.status="paused";
  if(plan.status==="paused" && prizes.length && planRepeatMode(plan)!=="once" && new Date(plan.nextRunAt)>new Date())
    plan.status="active";
  await plan.save();
 }
 return interaction.editReply({content:"Saved changes.\n"+summary(plan,true).slice(0,1800),allowedMentions:{parse:[]}});
}
