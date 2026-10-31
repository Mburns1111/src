import { ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,MessageFlags,ModalBuilder,TextInputBuilder,TextInputStyle } from "discord.js";
import { createCardTrade,updateCardTradeMessageId,readCardTrade,cardTradeDetails,setCardTradeOffer,reviewCardTrade,finalizeCardTrade,confirmCardGift,cancelCardTrade,moveCardTradePage,TRADE_DISPLAY_PAGE_SIZE } from "../services/card-trades.js";
import CardTrade from "../models/CardTrade.js";
import { canPlayCardGame, cardRegistrationReminder } from "../services/card-collector-registration.js";
const safe=s=>String(s??"").replace(/[@*_~|<>]/g,"").slice(0,80);
const mention=id=>"<@"+id+">";
const closed=t=>t.status!=="open"||new Date(t.expiresAt)<=new Date();
function traderName(t, side) {
 return safe(t.participantNames?.[side] || "Player " + (side + 1)).slice(0, 28);
}
function pageInfo(t) {
 const pages=Math.max(1,Math.ceil(Math.max(...t.offers.map(x=>x.length))/TRADE_DISPLAY_PAGE_SIZE));
 return {pages,page:Math.max(0,Math.min(pages-1,t.viewPage||0))};
}

const ornament = "──────────────";
function shortGiftList(cards, count = 4) {
 const visible = cards.slice(0,count);
 const lines = visible.map(c=>"• **"+safe(c.name)+"** · "+String.fromCharCode(96)+c.id+String.fromCharCode(96));
 if (cards.length > count) lines.push("🎀 *+"+(cards.length-count)+" more inside*");
 return lines.join("\n") || "*No cards selected.*";
}
export function tradeButtons(t){
 if(closed(t)) return [];
 const id=String(t._id),{pages,page}=pageInfo(t);
 if(t.gift) return [new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId("cards:trade:giftconfirm:"+id).setStyle(ButtonStyle.Success)
      .setEmoji("💝").setLabel("Send Gift"),
   new ButtonBuilder().setCustomId("cards:trade:giftcancel:"+id).setStyle(ButtonStyle.Secondary)
      .setEmoji("✖️").setLabel("Cancel"),
   new ButtonBuilder().setCustomId("cards:trade:giftdetails:"+id).setStyle(ButtonStyle.Secondary)
      .setEmoji("📋").setLabel("View Cards"),
 )];
 const ready=t.participants.every(u=>t.reviewedBy.includes(u));
 const rows=[new ActionRowBuilder().addComponents(
   new ButtonBuilder().setCustomId("cards:trade:add0:"+id).setLabel("Add: "+traderName(t,0)).setStyle(ButtonStyle.Primary),
   new ButtonBuilder().setCustomId("cards:trade:add1:"+id).setLabel("Add: "+traderName(t,1)).setStyle(ButtonStyle.Primary),
   new ButtonBuilder().setCustomId("cards:trade:review:"+id).setLabel("Review 1/2").setStyle(ButtonStyle.Secondary).setDisabled(ready),
   new ButtonBuilder().setCustomId("cards:trade:final:"+id).setLabel("Confirm 2/2").setStyle(ButtonStyle.Success).setDisabled(!ready),
   new ButtonBuilder().setCustomId("cards:trade:cancel:"+id).setLabel("Cancel").setStyle(ButtonStyle.Danger),
 )];
 const extras=[
   new ButtonBuilder().setCustomId("cards:trade:details:"+id).setLabel("Card Details").setStyle(ButtonStyle.Secondary),
 ];
 if(pages>1)extras.push(
   new ButtonBuilder().setCustomId("cards:trade:prev:"+id).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page===0),
   new ButtonBuilder().setCustomId("cards:trade:next:"+id).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page===pages-1));
 rows.push(new ActionRowBuilder().addComponents(extras));
 return rows;
}
function summaryCards(cards,page){
 const tick=String.fromCharCode(96);
 const shown=cards.slice(page*TRADE_DISPLAY_PAGE_SIZE,(page+1)*TRADE_DISPLAY_PAGE_SIZE);
 if(!shown.length) return "*Nothing offered*";
 return shown.map((c,j)=>{
  const stage=c.stage==="mega"?"Mega":c.stage==="neon"?"Neon":"Normal";
  const value=c.reviewedValue===null?"Not reviewed":String(c.reviewedValue);
  return "**"+(page*TRADE_DISPLAY_PAGE_SIZE+j+1)+". "+safe(c.name)+"** · "+tick+c.id+tick+
   "\n"+safe(c.rarity)+" · "+stage+" · Score: "+value+
   (c.tag?" · #"+safe(c.tag):"");
 }).join("\n\n").slice(0,1024);
}
export async function tradePanel(t){
 const d=await cardTradeDetails(t),{pages,page}=pageInfo(t);
 const status=t.status==="completed"?"Completed":t.status==="cancelled"?"Cancelled":closed(t)?"Expired":"Open";
 const embed=new EmbedBuilder();
 if(t.gift){
  const names="**"+traderName(t,0)+"** → **"+traderName(t,1)+"**";
  const completed=t.status==="completed";
  embed.setColor(completed?0xBC8FBC:0xEDB4CF)
    .setTitle(completed?"🎀 Gift Sent!":status==="Open"?"🎁 Hatchem Gift":"🎁 Gift "+status)
    .setDescription(completed?
      "💝 "+names+"\n**"+t.offers[0].length+" card"+(t.offers[0].length===1?"":"s")+"** delivered!":
      status==="Open"?
        "💌 "+names+"\n**"+t.offers[0].length+" card"+(t.offers[0].length===1?"":"s")+"** wrapped up for you! 🎀":
        "🎀 "+names+"\nThis gift was "+status.toLocaleLowerCase()+". No cards were sent.")
    .addFields({name:"🎁 Inside the gift",value:shortGiftList(d.sides[0]),inline:false});
  if(status==="Open") embed.setFooter({text:"Only the sender can send this gift · Cards are transferred immediately"});
 } else {
  const steps=t.participants.map((u,i)=>{
    const review=t.reviewedBy.includes(u)?"✅":"▫️";
    const final=t.finalBy.includes(u)?"✅":"▫️";
    return "**"+traderName(t,i)+"**  "+review+" Review  ·  "+final+" Final";
  });
  embed.setColor(0x9A8BB9).setTitle("🥚 Hatchem Trade · "+status)
    .setDescription([
      "🌸 **"+traderName(t,0)+"** ⇄ **"+traderName(t,1)+"**",
      ornament,
      "**Confirmations**",
      ...steps,
      ornament,
      "*Add cards → Both review → Both confirm*",
      status==="Open"?"*Edits reset approvals*":"",
      pages>1?"Page "+(page+1)+" of "+pages:"",
    ].filter(Boolean).join("\n"))
    .addFields(
      {name:"🌷 "+traderName(t,0)+" · "+t.offers[0].length+" cards",value:summaryCards(d.sides[0],page),inline:true},
      {name:"🪻 "+traderName(t,1)+" · "+t.offers[1].length+" cards",value:summaryCards(d.sides[1],page),inline:true}
    )
    .setFooter({text:"Reviewed scores are not market prices · Tags clear on transfer"});
 }
 return {embeds:[embed],components:tradeButtons(t),allowedMentions:{parse:[]}};
}

export async function giftCardDetails(t,page=0){
 const all=(await cardTradeDetails(t)).sides[0];
 const size=8,total=Math.max(1,Math.ceil(all.length/size));
 const current=Math.max(0,Math.min(total-1,Number.isFinite(page)?page:0));
 const cards=all.slice(current*size,(current+1)*size);
 const lines=cards.map((c,i)=>{
  const stage=c.stage==="mega"?"Mega Neon":c.stage==="neon"?"Neon":"Normal";
  const score=c.reviewedValue===null?"Not reviewed":String(c.reviewedValue);
  return "**"+(current*size+i+1)+". "+safe(c.name)+"** · "+String.fromCharCode(96)+c.id+String.fromCharCode(96)+
    "\n"+safe(c.rarity)+" · "+stage+" · Score: "+score+
    "\nRelease: "+safe(c.releaseId)+" · Frame: "+safe(c.frame)+
    (c.tag?" · Tag clears: "+safe(c.tag):"");
 });
 const details=new EmbedBuilder().setColor(0xEDB4CF)
  .setTitle("🎀 Cards in your gift")
  .setDescription(lines.join("\n\n").slice(0,3900)||"No cards selected.")
  .setFooter({text:"Page "+(current+1)+" of "+total+" · Check card IDs before sending"});
 const components=total<=1?[]:[new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId("cards:trade:giftpage:"+t._id+":"+(current-1))
    .setStyle(ButtonStyle.Secondary).setLabel("Previous").setDisabled(current===0),
  new ButtonBuilder().setCustomId("cards:trade:giftpage:"+t._id+":"+(current+1))
    .setStyle(ButtonStyle.Secondary).setLabel("Next").setDisabled(current===total-1),
 )];
 return {embeds:[details],components,allowedMentions:{parse:[]}};
}
export async function startCardTrade(i,{ gift = false } = {}){
 const member=i.options.getUser("member");
 if(!member||member.bot||member.id===i.user.id)return i.editReply("Mention another human player, e.g. .trade @member.");
 if(!i.guildId||!i.channel?.send)return i.editReply("Trade in the Hatchem channel.");
 const present=await i.guild?.members.fetch(member.id).catch(()=>null);
 if(!present)return i.editReply("The other trader must be a member of this server.");
 if (!await canPlayCardGame(i.user.id,i.guild))
  return i.editReply(await cardRegistrationReminder(i.guildId));
 if (!await canPlayCardGame(member.id,i.guild))
  return i.editReply("The other player must use .register to restore their Card role before trading.");

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
  if(gift && i.suppressGiftReply) return i.suppressGiftReply();
  return i.editReply(gift ? "Gift ready: review the card list and press Confirm Gift. The receiver does not need to click." :
    "Trade opened with "+mention(member.id)+". Add cards, then both review and confirm.");
 }catch(e){return i.editReply("Trade could not start: "+safe(e.message));}
}
// Post a normal channel message; the button interaction was deferred privately.
// Discord cannot reliably turn an ephemeral deferred reply public afterward.
export function giftSentAnnouncement(t) {
 return {
  content:"🎁 **Gift sent!** <@"+t.participants[0]+"> gave **"+t.offers[0].length+
   " card(s)** to <@"+t.participants[1]+">.",
  allowedMentions:{parse:[]},
 };
}
async function refresh(i,t){
 const channel=i.channel?.messages?.fetch?i.channel:await i.client.channels.fetch(t.channelId);
 if(!channel?.messages?.fetch)throw Error("Trade channel unavailable");
 const msg=await channel.messages.fetch(t.messageId);
 await msg.edit(await tradePanel(t));
}
export async function handleCardTradeInteraction(i){
 const parts=String(i.customId).split(":"),action=parts[2],id=parts[3];
 if((parts.length!==4&&!(parts.length===5&&action==="giftpage"))||parts[0]!=="cards"||parts[1]!=="trade"||!["add0","add1","offer","review","final","cancel","prev","next","details","giftdetails","giftpage","giftconfirm","giftcancel"].includes(action))return;
 const fail=e=>{
  const message="Trade: "+safe(e?.message||"Something went wrong.");
  return i.deferred||i.replied?i.editReply(message):i.reply({content:message,flags:MessageFlags.Ephemeral});
 };
 try{
  const trade=await readCardTrade(id);
  if(trade.guildId!==i.guildId|| (action!=="offer"&&action!=="giftpage"&&trade.messageId&&i.message?.id!==trade.messageId))
   throw Error("Wrong server or trade message.");
  if(!trade.participants.includes(i.user.id))throw Error("Only the two traders may use these buttons.");
  if(closed(trade))throw Error("This trade is closed or expired.");
  if(trade.gift && !["giftconfirm","giftcancel","giftdetails","giftpage"].includes(action))
   throw Error("A gift only needs the sender's confirmation.");
  if(trade.gift && i.user.id!==trade.participants[0] && !["giftdetails","giftpage"].includes(action))
   throw Error("Only the sender can approve or cancel this gift.");
  if(!trade.gift && ["giftconfirm","giftcancel"].includes(action))
   throw Error("This is a two-person trade, not a gift.");
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
  if(action==="giftpage"){
   const page=Number(parts[4]);
   if(!Number.isInteger(page)||page<0) throw Error("Invalid gift page.");
   await i.deferUpdate();
   return i.editReply(await giftCardDetails(trade,page));
  }
  await i.deferReply({flags:MessageFlags.Ephemeral});
  if(action==="giftdetails")
   return i.editReply(await giftCardDetails(trade,0));
  if(action==="details"){
   const d=await cardTradeDetails(trade);
   const page=pageInfo(trade).page,from=page*TRADE_DISPLAY_PAGE_SIZE;
   const values=[0,1].flatMap(side=>{
    const label=traderName(trade,side);
    return d.sides[side].slice(from,from+TRADE_DISPLAY_PAGE_SIZE).map(c=>
      "**"+label+": "+safe(c.name)+"** `"+c.id+"`"+
      "\n"+safe(c.rarity)+" · "+safe(c.stage)+" · Reviewed score: "+
      (c.reviewedValue===null?"Not reviewed":c.reviewedValue)+
      "\nSeries: "+safe(c.seriesId)+" | Release: "+safe(c.releaseId)+
      "\nFrame: "+safe(c.frame)+(c.artist?" | Artist: "+safe(c.artist):"")+
      (c.tag?" | Tag (cleared): "+safe(c.tag):""));
   });
   return i.editReply({content:("**Trade card details — page "+(page+1)+"**\n\n"+
     (values.join("\n\n")||"No cards offered on this page.")).slice(0,1950)});
  }
  if(action==="offer"){
   if(!i.isModalSubmit())throw Error("Use your Add/Edit button.");
   const updated=await setCardTradeOffer({tradeId:id,userId:i.user.id,guildId:i.guildId,rawIds:i.fields.getTextInputValue("ids")});
   await refresh(i,updated);
   return i.editReply("Offer updated. Both reviews and final confirmations were reset.");
  }
  let updated;
  let giftAnnouncementPosted=false;
  if(action==="giftconfirm"){
   await confirmCardGift({tradeId:id,userId:i.user.id,guildId:i.guildId});
   updated=await readCardTrade(id);
   try {
    if (!i.channel?.send) throw new Error("Channel is unavailable");
    await i.channel.send(giftSentAnnouncement(updated));
    giftAnnouncementPosted=true;
   } catch (publishError) {
    // Ownership already transferred atomically. Never retry the transfer
    // just because Discord could not send the public notification.
    console.warn("[Hatchem] Gift sent but public notice failed:",publishError.message);
   }
  }
  else if(action==="giftcancel")updated=await cancelCardTrade({tradeId:id,userId:i.user.id,guildId:i.guildId});
  else if(action==="prev"||action==="next")updated=await moveCardTradePage({tradeId:id,userId:i.user.id,guildId:i.guildId,direction:action==="next"?1:-1});
  else if(action==="review")updated=await reviewCardTrade({tradeId:id,userId:i.user.id,guildId:i.guildId});
  else if(action==="cancel")updated=await cancelCardTrade({tradeId:id,userId:i.user.id,guildId:i.guildId});
  else{await finalizeCardTrade({tradeId:id,userId:i.user.id,guildId:i.guildId});updated=await readCardTrade(id);}
  try {
   await refresh(i,updated);
  } catch(displayError) {
   console.warn("[Hatchem] Trade state saved but the panel could not refresh:",displayError.message);
   if (action==="giftconfirm" && giftAnnouncementPosted && i.deleteReply)
    return i.deleteReply();
   return i.editReply(updated.status==="completed"?
     "Trade completed and cards changed owners, but the trade panel could not refresh. Check .collection.":
     updated.status==="cancelled"?
       "Trade cancelled with no transfer, but the panel could not refresh.":
       "Your confirmation was saved, but the trade panel could not refresh. Try another button or start a new trade if it remains stuck.");
  }
  if (action==="giftconfirm" && giftAnnouncementPosted && i.deleteReply)
   return i.deleteReply();
  return i.editReply(action==="giftconfirm"?
   "Gift sent! Cards were transferred, but I couldn't post the public notice.":
   action==="giftcancel"?"Gift cancelled. No cards moved.":
   action==="prev"||action==="next"?"Page "+((updated.viewPage||0)+1)+".":
   action==="cancel"?"Trade cancelled; no cards moved.":updated.status==="completed"?
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
