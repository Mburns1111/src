import { ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,MessageFlags,ModalBuilder,TextInputBuilder,TextInputStyle } from "discord.js";
import { createCardTrade,updateCardTradeMessageId,readCardTrade,cardTradeDetails,setCardTradeOffer,reviewCardTrade,finalizeCardTrade,cancelCardTrade } from "../services/card-trades.js";
import CardTrade from "../models/CardTrade.js";
const safe=s=>String(s??"").replace(/[@*_~|<>]/g,"").slice(0,80);
const mention=id=>"<@"+id+">";
const closed=t=>t.status!=="open"||new Date(t.expiresAt)<=new Date();
export function tradeButtons(t){
 if(closed(t))return [];
 const id=String(t._id),ready=t.participants.every(u=>t.reviewedBy.includes(u));
 return [new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("cards:trade:add0:"+id).setLabel("Add/Edit Player 1").setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId("cards:trade:add1:"+id).setLabel("Add/Edit Player 2").setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId("cards:trade:review:"+id).setLabel("Review (1/2)").setStyle(ButtonStyle.Secondary).setDisabled(ready),
  new ButtonBuilder().setCustomId("cards:trade:final:"+id).setLabel("Final Confirm (2/2)").setStyle(ButtonStyle.Success).setDisabled(!ready),
  new ButtonBuilder().setCustomId("cards:trade:cancel:"+id).setLabel("Cancel").setStyle(ButtonStyle.Danger))];
}
function offerFields(cards,user,validateEligibility=true){
 const tick=String.fromCharCode(96);
 const allReviewed=cards.length>0&&cards.every(c=>c.reviewedValue!==null);
 const total=allReviewed?
   "Total reviewed score: "+Number(cards.reduce((v,c)=>v+c.reviewedValue,0).toFixed(4)):
   "Total reviewed score: incomplete (unrated cards)";
 const header={name:mention(user)+" · "+cards.length+"/5 offered cards",
   value:total+(cards.length?"":"\nNo cards offered yet."),inline:false};
 const details=cards.map((c,i)=>{
  const stage=c.stage==="mega"?"Mega Neon":c.stage==="neon"?"Neon":"Normal";
  const value=c.reviewedValue===null?"Not reviewed":
    String(c.reviewedValue)+(c.valueSource?" ("+safe(c.valueSource)+")":"");
  const title="#"+(i+1)+" "+safe(c.name)+" "+tick+c.id+tick+" · "+safe(c.rarity)+" · "+stage;
  const attributes=[
   "Series: "+safe(c.seriesId)+" · Release: "+safe(c.releaseId),
   "Frame: "+safe(c.frame)+" · Reviewed value: "+value,
   c.artist?"Artist: "+safe(c.artist):"Artist: not credited on definition",
   c.source?"Obtained from: "+safe(c.source):"",
   c.originGuildId?"Origin server ID: "+safe(c.originGuildId):"",
   c.tag?"Current tag (cleared on trade): "+safe(c.tag):"",
   !validateEligibility||c.eligible?"":"⚠️ Card no longer eligible",
  ].filter(Boolean).join("\n");
  return {name:title.slice(0,256),value:attributes.slice(0,1024),inline:false};
 });
 return [header,...details];
}

export async function tradePanel(t){
 const d=await cardTradeDetails(t),ready=t.participants.every(u=>t.reviewedBy.includes(u));
 const status=t.status==="completed"?"Completed":t.status==="cancelled"?"Cancelled":closed(t)?"Expired":"Open";
 const steps=t.participants.map(u=>mention(u)+" · Review "+(t.reviewedBy.includes(u)?"✅":"⬜")+" · Final "+(t.finalBy.includes(u)?"✅":"⬜"));
 const embed=new EmbedBuilder().setTitle("🥚 Hatchem Trade — "+status)
  .setDescription([mention(t.participants[0])+" ⇄ "+mention(t.participants[1]),
   "Both players add/edit cards, both press Review (1/2), then both press Final Confirm (2/2).",
   "**Editing either offer resets every confirmation.**",
   ready&&!closed(t)?"Both reviews complete. Check the cards and final-confirm.":"",
   ...steps,
   closed(t)?"":"Expires <t:"+Math.ceil(new Date(t.expiresAt).getTime()/1000)+":R>",
   "Values are reviewed scores, NOT a real-money price or guarantee. Unrated cards say 'not reviewed'.",
   "Personal card tags are cleared on transfer."].filter(Boolean).join("\n"))
  .addFields(...offerFields(d.sides[0],t.participants[0],!closed(t)),...offerFields(d.sides[1],t.participants[1],!closed(t)))
  .setFooter({text:"No cards move until all four approvals are completed."});
 return {embeds:[embed],components:tradeButtons(t),allowedMentions:{parse:[]}};
}
export async function startCardTrade(i){
 const member=i.options.getUser("member");
 if(!member||member.bot||member.id===i.user.id)return i.editReply("Mention another human player, e.g. .trade @member.");
 if(!i.guildId||!i.channel?.send)return i.editReply("Trade in the Hatchem channel.");
 const present=await i.guild?.members.fetch(member.id).catch(()=>null);
 if(!present)return i.editReply("The other trader must be a member of this server.");
 try{
  const trade=await createCardTrade({guildId:i.guildId,channelId:i.channelId,inviterId:i.user.id,inviteeId:member.id});
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
 if(parts.length!==4||parts[0]!=="cards"||parts[1]!=="trade"||!["add0","add1","offer","review","final","cancel"].includes(action))return;
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
   const input=new TextInputBuilder().setCustomId("ids").setLabel("Up to five card IDs")
     .setStyle(TextInputStyle.Paragraph).setRequired(false).setPlaceholder("KxQOo Abc12 Def34");
   if(trade.offers[side].length)input.setValue(trade.offers[side].join(" "));
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
  if(action==="review")updated=await reviewCardTrade({tradeId:id,userId:i.user.id,guildId:i.guildId});
  else if(action==="cancel")updated=await cancelCardTrade({tradeId:id,userId:i.user.id,guildId:i.guildId});
  else{await finalizeCardTrade({tradeId:id,userId:i.user.id,guildId:i.guildId});updated=await readCardTrade(id);}
  await refresh(i,updated);
  return i.editReply(action==="cancel"?"Trade cancelled; no cards moved.":updated.status==="completed"?
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
