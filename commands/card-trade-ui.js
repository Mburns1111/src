import { ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,MessageFlags,ModalBuilder,TextInputBuilder,TextInputStyle } from "discord.js";
import { createCardTrade,updateCardTradeMessageId,readCardTrade,cardTradeDetails,setCardTradeOffer,reviewCardTrade,finalizeCardTrade,cancelCardTrade,moveCardTradePage,TRADE_DISPLAY_PAGE_SIZE } from "../services/card-trades.js";
import CardTrade from "../models/CardTrade.js";
const safe=s=>String(s??"").replace(/[@*_~|<>]/g,"").slice(0,80);
const mention=id=>"<@"+id+">";
const closed=t=>t.status!=="open"||new Date(t.expiresAt)<=new Date();
function traderName(t, side) {
 return safe(t.participantNames?.[side] || "Player " + (side + 1)).slice(0, 28);
}
export function tradeButtons(t){
 if(closed(t))return [];
 const id=String(t._id),ready=t.participants.every(u=>t.reviewedBy.includes(u));
 const main=new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("cards:trade:add0:"+id).setLabel("Add: "+traderName(t,0)).setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId("cards:trade:add1:"+id).setLabel("Add: "+traderName(t,1)).setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId("cards:trade:review:"+id).setLabel("Review 1/2").setStyle(ButtonStyle.Secondary).setDisabled(ready),
  new ButtonBuilder().setCustomId("cards:trade:final:"+id).setLabel("Confirm 2/2").setStyle(ButtonStyle.Success).setDisabled(!ready),
  new ButtonBuilder().setCustomId("cards:trade:cancel:"+id).setLabel("Cancel").setStyle(ButtonStyle.Danger));
 const pages=Math.max(1,Math.ceil(Math.max(...t.offers.map(x=>x.length))/TRADE_DISPLAY_PAGE_SIZE));
 if(pages===1)return [main];
 const page=Math.min(pages-1,t.viewPage||0);
 const pageRow=new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("cards:trade:prev:"+id).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page===0),
  new ButtonBuilder().setCustomId("cards:trade:next:"+id).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page>=pages-1));
 return [main,pageRow];
}
function offerColumn(cards,allCount,name,page){
 const tick=String.fromCharCode(96);
 const shown=cards.slice(page*TRADE_DISPLAY_PAGE_SIZE,(page+1)*TRADE_DISPLAY_PAGE_SIZE);
 const lines=shown.map((c,i)=>{
  const stage=c.stage==="mega"?"Mega Neon":c.stage==="neon"?"Neon":"Normal";
  const score=c.reviewedValue===null?"Not reviewed":String(c.reviewedValue);
  return "**"+(page*TRADE_DISPLAY_PAGE_SIZE+i+1)+". "+safe(c.name)+"** "+tick+c.id+tick+
   "\n"+safe(c.rarity)+" · "+stage+" · Value: "+score+
   "\nRelease: "+safe(c.releaseId)+" · Frame: "+safe(c.frame)+
   (c.artist?"\nArt: "+safe(c.artist):"")+
   (c.tag?"\nTag (cleared): "+safe(c.tag):"")+
   (c.eligible?"":"\n⚠️ No longer owned");
 });
 const total=allCount&&cards.every(c=>c.reviewedValue!==null)?
  "Base-pet score total: "+Number(cards.reduce((v,c)=>v+c.reviewedValue,0).toFixed(4)):
  "Base-pet score total: not fully reviewed";
 const txt=(lines.join("\n\n")||"*No cards offered.*")+"\n\n"+total;
 return {name:name+" · "+allCount+" cards",value:txt.slice(0,1024),inline:true};
}
export async function tradePanel(t){
 const d=await cardTradeDetails(t),ready=t.participants.every(u=>t.reviewedBy.includes(u));
 const status=t.status==="completed"?"Completed":t.status==="cancelled"?"Cancelled":closed(t)?"Expired":"Open";
 const steps=t.participants.map((u,i)=>traderName(t,i)+": Review "+(t.reviewedBy.includes(u)?"✅":"⬜")+" · Final "+(t.finalBy.includes(u)?"✅":"⬜"));
 const pages=Math.max(1,Math.ceil(Math.max(...t.offers.map(x=>x.length))/TRADE_DISPLAY_PAGE_SIZE));
 const page=Math.min(pages-1,t.viewPage||0);
 const embed=new EmbedBuilder().setTitle("🥚 Hatchem "+(t.gift?"Gift":"Trade")+" · "+status)
  .setDescription([
   "**"+traderName(t,0)+"** ⇄ **"+traderName(t,1)+"**",
   t.gift?"A gift: the receiver may offer nothing. Both players still approve twice.":"Either player can offer zero cards; the other may gift cards.",
   "Use your Add button. Offer card IDs or saved tags (one tag:Name per line).",
   "1. Both Review · 2. Both Final Confirm · **Edits reset approvals.**",
   ...steps,
   "Page "+(page+1)+"/"+pages,
   closed(t)?"":"Expires <t:"+Math.ceil(new Date(t.expiresAt).getTime()/1000)+":R>",
   "Values are reviewed base-pet scores, not real-money prices."
  ].filter(Boolean).join("\n"))
  .addFields(
   offerColumn(d.sides[0],t.offers[0].length,traderName(t,0),page),
   offerColumn(d.sides[1],t.offers[1].length,traderName(t,1),page)
  ).setFooter({text:"Cards retain their IDs/stages. Personal tags clear on transfer."});
 return {embeds:[embed],components:tradeButtons(t),allowedMentions:{parse:[]}};
}
export async function startCardTrade(i,{ gift = false } = {}){
 const member=i.options.getUser("member");
 if(!member||member.bot||member.id===i.user.id)return i.editReply("Mention another human player, e.g. .trade @member.");
 if(!i.guildId||!i.channel?.send)return i.editReply("Trade in the Hatchem channel.");
 const present=await i.guild?.members.fetch(member.id).catch(()=>null);
 if(!present)return i.editReply("The other trader must be a member of this server.");
 try{
  let trade=await createCardTrade({guildId:i.guildId,channelId:i.channelId,inviterId:i.user.id,inviteeId:member.id,
   gift,participantNames:[i.member?.displayName||i.user.globalName||i.user.username, present.displayName||member.globalName||member.username]});
  if(gift) {
   try { trade=await setCardTradeOffer({tradeId:String(trade._id),userId:i.user.id,guildId:i.guildId,rawIds:i.options.getString("cards",true)}); }
   catch(err) { await cancelCardTrade({tradeId:String(trade._id),userId:i.user.id,guildId:i.guildId}).catch(()=>{}); throw err; }
  }
  let m;
  try{m=await i.channel.send(await tradePanel(trade));await updateCardTradeMessageId(trade._id,m.id);}
  catch(error){await cancelCardTrade({tradeId:String(trade._id),userId:i.user.id,guildId:i.guildId}).catch(()=>{});if(m)await m.delete().catch(()=>{});throw error;}
  return i.editReply("Trade opened with "+mention(member.id)+". Use the two Add/Edit buttons, then review and final-confirm twice.");
 }catch(e){return i.editReply("Trade could not start: "+safe(e.message));}
}
async function refresh(i,t){
 const channel=i.channel?.messages?.fetch?i.channel:await i.client.channels.fetch(t.channelId);
 if(!channel?.messages?.fetch)throw Error("Trade channel unavailable");
 const msg=await channel.messages.fetch(t.messageId);
 await msg.edit(await tradePanel(t));
}
export async function handleCardTradeInteraction(i){
 const parts=String(i.customId).split(":"),action=parts[2],id=parts[3];
 if(parts.length!==4||parts[0]!=="cards"||parts[1]!=="trade"||!["add0","add1","offer","review","final","cancel","prev","next"].includes(action))return;
 const fail=e=>{
  const message="Trade: "+safe(e?.message||"Something went wrong.");
  return i.deferred||i.replied?i.editReply(message):i.reply({content:message,flags:MessageFlags.Ephemeral});
 };
 try{
  const trade=await readCardTrade(id);
  if(trade.guildId!==i.guildId|| (action!=="offer"&&trade.messageId&&i.message?.id!==trade.messageId))
   throw Error("Wrong server or trade message.");
  if(!trade.participants.includes(i.user.id))throw Error("Only the two traders may use these buttons.");
  if(closed(trade))throw Error("This trade is closed or expired.");
  if(action==="add0"||action==="add1"){
   const side=Number(action.slice(-1));
   if(trade.participants[side]!==i.user.id)throw Error("You may only edit your own offer.");
   const modal=new ModalBuilder().setCustomId("cards:trade:offer:"+id).setTitle("Add or edit your offered cards");
   const input=new TextInputBuilder().setCustomId("ids").setLabel("Card IDs or tag:Name (one per line)")
     .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000).setPlaceholder("KxQOo Abc12\ntag:cute\n+ NEWIDS to append");
   if(trade.offers[side].length && trade.offers[side].join(" ").length<=4000)
    input.setValue(trade.offers[side].join(" "));
   modal.addComponents(new ActionRowBuilder().addComponents(input));
   return i.showModal(modal);
  }
  await i.deferReply({flags:MessageFlags.Ephemeral});
  if(action==="offer"){
   if(!i.isModalSubmit())throw Error("Use your Add/Edit button.");
   const updated=await setCardTradeOffer({tradeId:id,userId:i.user.id,guildId:i.guildId,rawIds:i.fields.getTextInputValue("ids")});
   await refresh(i,updated);
   return i.editReply("Offer updated. Both reviews and final confirmations were reset.");
  }
  let updated;
  if(action==="prev"||action==="next")updated=await moveCardTradePage({tradeId:id,userId:i.user.id,guildId:i.guildId,direction:action==="next"?1:-1});
  else if(action==="review")updated=await reviewCardTrade({tradeId:id,userId:i.user.id,guildId:i.guildId});
  else if(action==="cancel")updated=await cancelCardTrade({tradeId:id,userId:i.user.id,guildId:i.guildId});
  else{await finalizeCardTrade({tradeId:id,userId:i.user.id,guildId:i.guildId});updated=await readCardTrade(id);}
  try {
   await refresh(i,updated);
  } catch(displayError) {
   console.warn("[Hatchem] Trade state saved but the panel could not refresh:",displayError.message);
   return i.editReply(updated.status==="completed"?
     "Trade completed and cards changed owners, but the trade panel could not refresh. Check .collection.":
     updated.status==="cancelled"?
       "Trade cancelled with no transfer, but the panel could not refresh.":
       "Your confirmation was saved, but the trade panel could not refresh. Try another button or start a new trade if it remains stuck.");
  }
  return i.editReply(action==="prev"||action==="next"?"Showing offer page "+((updated.viewPage||0)+1)+".":action==="cancel"?"Trade cancelled; no cards moved.":updated.status==="completed"?
   "Trade complete! Both collections have been updated.":action==="review"?
   "Review recorded. Both players must review before final confirmation.":
   "Final confirmation recorded. Waiting for the other player.");
 }catch(e){console.error("[Hatchem trade]",e);return fail(e);}
}


/** Expired trade buttons cannot remain interactive after a restart. */
export async function reconcileExpiredCardTrades(client) {
  const now = new Date();
  await CardTrade.updateMany(
    { status:"open", expiresAt:{ $lte:now } },
    { $set:{ status:"expired" } },
  );
  const pending = await CardTrade.find({
    status:"expired", displayClosedAt:null, messageId:{ $ne:"" },
  }).sort({ expiresAt:1 }).limit(30).lean();
  for(const trade of pending) {
    try {
      const channel=await client.channels.fetch(trade.channelId);
      if(!channel?.messages?.fetch)throw Error("Trade channel unavailable");
      const message=await channel.messages.fetch(trade.messageId);
      await message.edit(await tradePanel(trade));
      await CardTrade.updateOne({ _id:trade._id },{ $set:{displayClosedAt:new Date()} });
    }catch(error) {
      if([10003,10008].includes(Number(error?.code))) {
        await CardTrade.updateOne({ _id:trade._id },{ $set:{displayClosedAt:new Date()} });
      } else console.warn("[Hatchem] Could not close expired trade:",String(trade._id),error.message);
    }
  }
}
