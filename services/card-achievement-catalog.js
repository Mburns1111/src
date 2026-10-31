export const REWARDS=Object.freeze({basic:{grabs:1,drops:0},medium:{grabs:0,drops:1},advanced:{grabs:2,drops:1}});
const a=(key,name,tier,metric,goal,description)=>({key,name,tier,metric,goal,description,secret:false});
export const CARD_ACHIEVEMENTS=Object.freeze([
 a("first-hatch","🥚 First Hatch","basic","grabs",1,"Win your first card from a player egg."),
 a("ten-grabs","🐣 Egg Enthusiast","basic","grabs",10,"Win 10 cards from player eggs."),
 a("first-drop","🪺 Egg Starter","basic","drops",1,"Create your first player egg."),
 a("ten-drops","🌻 Egg Gardener","basic","drops",10,"Create 10 player eggs."),
 a("first-trade","🤝 Trading Partners","basic","trades",1,"Complete a two-sided trade."),
 a("first-gift","💝 Generous Heart","basic","gifts",1,"Send a completed gift."),
 a("first-burn","🔥 First Sparks","basic","burns",1,"Burn a physical card."),
 a("first-neon","✨ Neon Alchemist","basic","neons",1,"Create a Neon."),
 a("five-pet-types","🐾 New Faces","basic","petTypes",5,"Acquire five distinct pet designs."),
 a("first-lock","🔒 Keeper","basic","locks",1,"Lock a card for the first time."),
 a("all-rarities","🌈 Taste the Rainbow","medium","rarities",5,"Acquire all five rarities."),
 a("ten-of-a-kind","🃏 Ten of a Kind","medium","copies",10,"Acquire 10 distinct copies of one release design."),
 a("twenty-five-pets","📚 Curious Collector","medium","petTypes",25,"Acquire 25 pet designs."),
 a("five-trades","⚖️ Trusted Trader","medium","trades",5,"Complete five two-sided trades."),
 a("five-gifts","🎁 Gift Giver","medium","gifts",5,"Send five completed gifts."),
 a("ten-burns","🪵 Ember Keeper","medium","burns",10,"Burn 10 physical cards."),
 a("three-neons","💡 Neon Crafter","medium","neons",3,"Create three Neons."),
 a("first-mega","🌌 Mega Magic","medium","megas",1,"Create a Mega Neon."),
 a("legendary-grab","💛 Golden Find","medium","legendaryGrabs",1,"Win a Legendary from a player egg."),
 a("ten-legendary-grabs","🦁 Legend Seeker","medium","legendaryGrabs",10,"Win 10 Legendaries from player eggs."),
 a("three-gift-recipients","🎀 Making Friends","medium","recipients",3,"Send gifts to three different collectors."),
 a("twenty-five-drops","🌺 Egg Planter","medium","drops",25,"Create 25 player eggs."),
 a("hundred-pet-types","🌍 World Collector","advanced","petTypes",100,"Acquire 100 distinct pet designs."),
 a("ten-neons","🌟 Neon Artisan","advanced","neons",10,"Create 10 Neons."),
 a("three-megas","🌠 Mega Crafter","advanced","megas",3,"Create three Mega Neons."),
 a("twenty-trades","👑 Trade Master","advanced","trades",20,"Complete 20 two-sided trades."),
 a("twenty-gifts","🌷 Giving Tree","advanced","gifts",20,"Send 20 completed gifts."),
 a("fifty-burns","🔥 Eternal Flame","advanced","burns",50,"Burn 50 physical cards."),
 a("ten-distinct-legendaries","💎 Legendary Library","advanced","legendaryTypes",10,"Acquire 10 Legendary pet designs."),
 a("rainbow-neons","🎇 Neon Spectrum","advanced","neonRarities",5,"Own a Neon of each rarity."),
 a("triple-stages","🪄 Evolution Set","advanced","tripleStages",1,"Own Normal, Neon and Mega of one release design."),
 a("ultra-collector","🧸 Pet Parade","advanced","ownedPetTypes",75,"Own 75 distinct pet designs."),
 a("five-megas","🦋 Mega Menagerie","advanced","megas",5,"Create five Mega Neons."),
 a("diamond-in-the-rough","💠 Diamond in the Rough","medium","top20Acquired",1,"Acquire a reviewed top-20% release card."),
 a("crown-jewel","💎 Crown Jewel","advanced","top10Acquired",1,"Acquire a reviewed top-10% release card."),
 a("treasure-trove","🔮 Treasure Trove","advanced","top20Owned",3,"Own three distinct reviewed top-20% pet designs."),
 a("high-stakes-trade","🌟 High-Stakes Trade","advanced","highTrade",1,"Receive a reviewed top-10% card in a two-sided trade."),
]);
const secrets=[
 ["matchy-matchy","🧩 Matchy Matchy","medium","matchy",1,"Drop an egg revealing three copies of one design."],
 ["triple-trouble","🎰 Triple Trouble","basic","tripleRarity",1,"Drop an egg revealing three different rarities."],
 ["copycat","🪅 Copycat","basic","copycat",1,"Send two copies of one design in a single gift."],
 ["friends-everywhere","🧡 Friends Everywhere","medium","recipients",5,"Send gifts to five different collectors."],
 ["alphabet-soup","🔠 Alphabet Soup","medium","alphabet",5,"Own five different pet designs starting with the same letter."],
 ["lucky-seven","🍀 Lucky Seven","medium","copies",7,"Acquire seven distinct copies of one design."],
 ["precious-cargo","🧷 Precious Cargo","medium","locked",10,"Have ten cards locked at the same time."],
 ["beautiful-disaster","🔥 Beautiful Disaster","advanced","burnMega",1,"Burn a Mega Neon."],
 ["alchemy-is-expensive","🪄 Alchemy Is Expensive","advanced","dustMega",1,"Complete a dust-assisted Mega upgrade."],
 ["full-breakfast","🍳 Full Breakfast","medium","breakfast",1,"Win a grab, drop an egg and complete a trade on one UTC date."],
 ["twins-again","👀 Twins Again","medium","legendaryCopies",2,"Win two distinct Legendary copies of one design from player eggs."],
 ["vintage-keeper","🕯️ Vintage Keeper","advanced","vintage",1,"Own a card from a retired release."],
];
export const SECRET_ACHIEVEMENTS=Object.freeze(secrets.map((x,i)=>({...a("secret:global:"+x[0],...x.slice(1)),secret:true,anonymousId:"Permanent · Secret "+String(i+1).padStart(2,"0")})));
export function milestoneTier(n){return n>=500?"advanced":n>=200?"medium":"basic";}
export function recurringAchievements(progress){
 const result=[];
 for(const [kind,metric] of [["grab","grabs"],["drop","drops"]]){
  const count=progress[metric]||0;
  for(let n=50;n<=Math.floor(count/50)*50+50;n+=50)
   result.push(a(kind+"-"+n,(kind==="grab"?"🐣 ":"🥚 ")+n+" "+metric,milestoneTier(n),metric,n,"Complete "+n+" successful player "+metric+"."));
 }
 return result;
}
export function reviewedSets(definitions){
 const groups=new Map(),top20=new Set(),top10=new Set();
 for(const d of definitions){
  const v=d.valueReview;
  if(!Number.isFinite(v?.valueScore)||!v.checkedAt||!v.sourceName||d.artStatus==="test-placeholder")continue;
  const list=groups.get(d.releaseId)||[];list.push(d);groups.set(d.releaseId,list);
 }
 for(const list of groups.values()){
  if(list.length<20)continue;
  list.sort((a,b)=>b.valueReview.valueScore-a.valueReview.valueScore);
  for(const [percent,set] of [[.2,top20],[.1,top10]]){
   const cutoff=list[Math.ceil(list.length*percent)-1].valueReview.valueScore;
   for(const d of list)if(d.valueReview.valueScore>=cutoff)set.add(String(d._id));
  }
 }
 return {top20,top10};
}
export function rewardFor(tier,releaseFirst=false){
 const r=REWARDS[tier];if(!r)throw Error("Invalid achievement tier.");
 return {grabs:r.grabs+(releaseFirst&&tier!=="basic"?1:0),drops:r.drops};
}
