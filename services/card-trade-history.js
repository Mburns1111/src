import CardTrade from "../models/CardTrade.js";

export function formatTradeHistoryItem(trade,userId) {
  const side=trade.participants.indexOf(userId);
  if(side<0)throw Error("Cannot display another player's trade history.");
  const partner=trade.participants[1-side];
  const sent=trade.offers?.[side]||[];
  const received=trade.offers?.[1-side]||[];
  const kind=trade.gift?(side===0?"Gift sent":"Gift received"):"Trade";
  return {
    kind,partner,sent,received,
    date:trade.completedAt||trade.updatedAt||trade.createdAt,
    id:String(trade._id),
  };
}
export async function getCardTradeHistory(userId,{limit=12}={}) {
  const rows=await CardTrade.find({
    participants:userId,status:"completed",
  }).select("participants offers gift completedAt updatedAt createdAt").sort({
    completedAt:-1,_id:-1,
  }).limit(Math.min(25,Math.max(1,limit))).lean();
  return rows.map(row=>formatTradeHistoryItem(row,userId));
}
export function formatTradeHistory(rows) {
  if(!rows.length)return "📜 **Your Hatchem History**\nNo completed gifts or trades yet.";
  const tick=String.fromCharCode(96);
  return ["📜 **Your Hatchem History**","*Most recent completed gifts and trades*",
    ...rows.map((row,i)=>{
      const date=row.date?"<t:"+Math.floor(new Date(row.date).getTime()/1000)+":d>":"";
      const summary=ids=>ids.length?ids.slice(0,6).map(id=>tick+id+tick).join(" ")+(ids.length>6?" +"+(ids.length-6)+" more":""):"none";
      return "**"+(i+1)+". "+row.kind+"** · <@"+row.partner+"> · "+date+
        "\nSent: "+summary(row.sent)+"\nReceived: "+summary(row.received);
    }),
  ].join("\n\n").slice(0,1950);
}
