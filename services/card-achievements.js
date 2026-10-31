import CardClaim from "../models/CardClaim.js";
import CardLifecycleEvent from "../models/CardLifecycleEvent.js";
import CardTrade from "../models/CardTrade.js";
import CardAchievement from "../models/CardAchievement.js";

export const CARD_ACHIEVEMENTS=Object.freeze([
  {key:"first-grab",name:"First Hatch",icon:"🥚",metric:"grabs",goal:1},
  {key:"ten-grabs",name:"Egg Enthusiast",icon:"🐣",metric:"grabs",goal:10},
  {key:"fifty-grabs",name:"Dedicated Collector",icon:"🌟",metric:"grabs",goal:50},
  {key:"first-gift",name:"Generous Heart",icon:"💝",metric:"gifts",goal:1},
  {key:"five-gifts",name:"Gift Giver",icon:"🎁",metric:"gifts",goal:5},
  {key:"first-trade",name:"Trading Partners",icon:"🤝",metric:"trades",goal:1},
  {key:"ten-trades",name:"Trade Expert",icon:"💫",metric:"trades",goal:10},
  {key:"first-burn",name:"First Sparks",icon:"🔥",metric:"burns",goal:1},
  {key:"first-neon",name:"Neon Alchemist",icon:"✨",metric:"neons",goal:1},
  {key:"first-mega",name:"Mega Magic",icon:"🌈",metric:"megas",goal:1},
]);
export async function getAchievementProgress(userId){
  const [grabs,gifts,trades,burns,neons,megas]=await Promise.all([
    CardClaim.countDocuments({discordUserId:userId}),
    CardTrade.countDocuments({participants:userId,status:"completed",gift:true,
      "participants.0":userId}),
    CardTrade.countDocuments({participants:userId,status:"completed",gift:false}),
    CardLifecycleEvent.countDocuments({actorDiscordUserId:userId,eventType:"burn"}),
    CardLifecycleEvent.countDocuments({actorDiscordUserId:userId,eventType:"upgrade",targetUpgradeLevel:"neon"}),
    CardLifecycleEvent.countDocuments({actorDiscordUserId:userId,eventType:"upgrade",targetUpgradeLevel:"mega"}),
  ]);
  return {grabs,gifts,trades,burns,neons,megas};
}
export async function listCardAchievements(userId){
  const progress=await getAchievementProgress(userId);
  const unlocked=CARD_ACHIEVEMENTS.filter(a=>progress[a.metric]>=a.goal);
  if(unlocked.length)await Promise.all(unlocked.map(a=>CardAchievement.updateOne(
    {discordUserId:userId,key:a.key},
    {$setOnInsert:{discordUserId:userId,key:a.key,unlockedAt:new Date()}},
    {upsert:true},
  )));
  const rows=await CardAchievement.find({discordUserId:userId}).select("key unlockedAt").lean();
  const unlockedAt=new Map(rows.map(row=>[row.key,row.unlockedAt]));
  return CARD_ACHIEVEMENTS.map(a=>({...a,current:progress[a.metric],
    earned:unlockedAt.has(a.key),unlockedAt:unlockedAt.get(a.key)}));
}
export function formatCardAchievements(rows){
  const earned=rows.filter(x=>x.earned).length;
  return [
    "🏆 **Hatchem Achievements — "+earned+"/"+rows.length+" unlocked**",
    "*Badges are earned from real card activity; no Points are spent or awarded.*",
    ...rows.map(a=>a.icon+" **"+a.name+"** — "+
      (a.earned?"✅ Unlocked":"▫️ "+Math.min(a.current,a.goal)+"/"+a.goal)),
  ].join("\n");
}
