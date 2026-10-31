import CardAchievement from "../models/CardAchievement.js";
import CardCollector from "../models/CardCollector.js";
import GuildConfig from "../models/GuildConfig.js";
import {achievementSnapshot,achievementDefinitions,achievementStart} from "./card-achievement-engine.js";
export {CARD_ACHIEVEMENTS} from "./card-achievement-catalog.js";
const safe=s=>String(s??"").replace(/[@`*_~|<>]/g,"");
export async function getAchievementProgress(userId){return (await achievementSnapshot(userId)).progress;}
export async function listCardAchievements(userId){
 const snapshot=await achievementSnapshot(userId);
 const saved=await CardAchievement.find({discordUserId:userId}).lean();
 const byKey=new Map(saved.map(r=>[r.key,r]));
 const definitions=achievementDefinitions(snapshot);
 const rows=definitions.map(a=>({...a,...byKey.get(a.key),earned:byKey.has(a.key)}));
 // Preserve pre-launch badges and earned definitions even if a release is archived.
 for(const row of saved)if(!rows.some(a=>a.key===row.key))rows.push({...row,name:row.name||row.key,earned:true,legacy:!row.discoveryNumber});
 rows.wallet=await CardCollector.findOne({discordUserId:userId}).select("bonusGrabs bonusDrops").lean();
 return rows;
}
export function privateAchievementReceipt(a){
 return safe(a.name)+" — "+safe(a.description)+"\nYou are #"+a.discoveryNumber+" to earn this achievement!"+
  (a.releaseFirst?" First new unlock during "+safe(a.releaseId)+"!":"")+
  "\nRewards: +"+(a.rewardGrabs||0)+" Extra Grabs · +"+(a.rewardDrops||0)+" Extra Drops.";
}
export function publicSecretReceipt(a){
 return "🔮 <@"+a.discordUserId+"> discovered a secret Hatchem achievement! They are #"+a.discoveryNumber+
  " to discover it! · "+safe(a.anonymousId)+(a.releaseFirst?" · First new unlock during "+safe(a.releaseId):"");
}
export function achievementPages(rows){
 const secrets=rows.filter(a=>a.secret),visible=rows.filter(a=>!a.secret);
 const groups=new Map();for(const a of secrets){const category=(a.anonymousId||"Permanent").split(" · ")[0];
  const g=groups.get(category)||{earned:0,total:0};g.total++;if(a.earned)g.earned++;groups.set(category,g);}
 const overview=["🏆 **Your Hatchem Achievements**",
  "Extra Grabs: **"+(rows.wallet?.bonusGrabs||0)+"** · Extra Drops: **"+(rows.wallet?.bonusDrops||0)+"**",
  ...[...groups].map(([name,g])=>"🔒 "+safe(name)+" Secrets: "+g.earned+"/"+g.total+" discovered"),
  secrets.some(a=>!a.earned)?"❔ Undiscovered secrets":"",
  !achievementStart()?"Achievement rewards await the official start date.":"",
 ].filter(Boolean).join("\n");
 // Only next/recent recurring milestones are shown; earned records remain durable.
 const recurring=a=>/^(grab|drop)-\d+$/.test(a.key);
 const milestones=visible.filter(recurring);
 const recent=milestones.filter(a=>a.earned).sort((a,b)=>new Date(b.unlockedAt)-new Date(a.unlockedAt)).slice(0,6);
 const upcoming=["grab","drop"].flatMap(kind=>milestones.filter(a=>a.key.startsWith(kind+"-")&&!a.earned).sort((a,b)=>a.goal-b.goal).slice(0,1));
 const shown=[...visible.filter(a=>!recurring(a)),...recent,...upcoming,...secrets.filter(a=>a.earned)];
 const lines=shown.map(a=>a.earned?
  "✅ **"+safe(a.name)+"**"+(a.discoveryNumber?" · #"+a.discoveryNumber:" · Legacy badge")+
  (a.unlockedAt?" · <t:"+Math.floor(new Date(a.unlockedAt).getTime()/1000)+":d>":"")+
  "\n"+safe(a.description)+(a.rewardGrantedAt?" · Earned +"+(a.rewardGrabs||0)+" grabs / +"+(a.rewardDrops||0)+" drops":""):
  "▫️ **"+safe(a.name)+"** — "+Math.min(a.current||0,a.goal)+"/"+a.goal+"\n"+safe(a.description));
 const pages=[];let text=overview;
 for(const line of lines){if(text.length+line.length>1750){pages.push(text);text="🏆 **Your Hatchem Achievements**";}text+="\n\n"+line;}
 pages.push(text);return pages.map((p,i)=>p+"\n\nPage "+(i+1)+"/"+pages.length+" · `.achievements "+(i+2<=pages.length?i+2:1)+"`");
}
export function formatCardAchievements(rows,page=1){const pages=achievementPages(rows);return pages[Math.max(0,Math.min(pages.length-1,Number(page||1)-1))];}
export async function secretHallOfFame(page=1){
 const rows=await CardAchievement.find({secret:true,discoveryNumber:{$lte:3,$gte:1}}).sort({anonymousId:1,discoveryNumber:1}).lean();
 if(!rows.length)return "🏛️ **Secret Hall of Fame**\nNo secrets have been discovered yet.";
 const groups=new Map();for(const a of rows){const g=groups.get(a.key)||[];g.push(a);groups.set(a.key,g);}
 const entries=[...groups.values()];const pages=Math.ceil(entries.length/6),selected=Math.min(pages,Math.max(1,Number(page)||1));
 return ["🏛️ **Secret Hall of Fame**",...entries.slice((selected-1)*6,selected*6).map(g=>
  "🔒 **"+safe(g[0].anonymousId)+"**\n"+g.map(a=>["🥇","🥈","🥉"][a.discoveryNumber-1]+" <@"+a.discordUserId+"> · <t:"+Math.floor(new Date(a.unlockedAt).getTime()/1000)+":d>").join("\n")),
  "Page "+selected+"/"+pages+" · `.hof "+(selected<pages?selected+1:1)+"`"].join("\n\n");
}
export async function deliverAchievementNotices(client){
 if(!achievementStart())return;
 const rows=await CardAchievement.find({rewardGrantedAt:{$ne:null},noticeAttemptedAt:null}).sort({unlockedAt:1,discoveryNumber:1}).limit(20).lean();
 for(const row of rows){
  // At-most-once external delivery: earned records remain privately readable if a DM fails.
  const claimed=await CardAchievement.updateOne({_id:row._id,noticeAttemptedAt:null},{$set:{noticeAttemptedAt:new Date()}});
  if(!claimed.modifiedCount)continue;
  try{const user=await client.users.fetch(row.discordUserId);await user.send({content:privateAchievementReceipt(row),allowedMentions:{parse:[]}});}catch{ /* Private menu is durable fallback. */ }
  if(row.secret){try{
   const config=row.channelId?null:await GuildConfig.findOne({guildId:row.guildId}).select("hatchemChannelId").lean();
   const channel=await client.channels.fetch(row.channelId||config?.hatchemChannelId);
   if(channel?.send)await channel.send({content:publicSecretReceipt(row),allowedMentions:{parse:[]}});
  }catch{ /* Never expose the private title in error logs or public fallback. */ }}
 }
}
