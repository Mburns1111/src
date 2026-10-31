import { ActionRowBuilder,ButtonBuilder,ButtonStyle,EmbedBuilder,MessageFlags } from "discord.js";
import { prepareCardBurn,getPendingCardBurn,cancelCardBurn,confirmCardBurn,BURN_RARITIES } from "../services/card-burns.js";
import { canPlayCardGame,cardRegistrationReminder } from "../services/card-collector-registration.js";

const clean=value=>String(value??"").replace(/[@*_~|<>]/g,"").slice(0,95);
export function formatDustRewards(dust) {
  return Object.entries(dust).filter(([,n])=>n>0).map(([rarity,n])=>n+" "+rarity+" Dust").join(" · ")||"No dust";
}
export function dustBalanceText(balance) {
  return [
    "✨ **Your Hatchem Dust**",
    ...BURN_RARITIES.map(r=>"• **"+r+":** "+Number(balance[r]||0)),
    "Dust is rarity-specific. Spending dust on upgrades is not available yet.",
  ].join("\n");
}

export function cardBurnPreview(request) {
  const tick=String.fromCharCode(96);
  const shown=request.cards.slice(0,12).map(c=>{
    const stage=c.upgradeLevel==="mega"?"Mega Neon":c.upgradeLevel==="neon"?"Neon":"Normal";
    return "• **"+clean(c.name)+"** · "+tick+c.publicId+tick+" · "+clean(c.rarity)+" · "+stage;
  });
  if(request.cards.length>12) shown.push("…and **"+(request.cards.length-12)+"** more.");
  const embed=new EmbedBuilder()
    .setColor(0xA0556B).setTitle("🔥 Burn Cards?")
    .setDescription([
      "**"+request.cards.length+" card"+(request.cards.length===1?"":"s")+"** will be permanently destroyed.",
      "",
      shown.join("\n"),
      "",
      "**You will receive:** "+formatDustRewards(request.dust),
      "",
      "⚠️ **This cannot be undone.** Any decorative frames or attachments on burned cards are lost.",
      "Tagged cards are protected; untag them first.",
      "Your dust is saved globally. Expires in 2 minutes.",
    ].join("\n"));
  // The preview abbreviates long pet names, but NEVER hides an ID that
  // will be permanently destroyed. Every selected card ID remains visible.
  if (request.cards.length>12) embed.addFields({
    name:"All selected card IDs",
    value:request.cards.map(c=>tick+c.publicId+tick).join(" ").slice(0,1024),
    inline:false,
  });
  const buttons=new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("cards:burn:yes:"+request.token)
      .setStyle(ButtonStyle.Danger).setLabel("Burn "+request.cards.length+" Card"+(request.cards.length===1?"":"s")),
    new ButtonBuilder().setCustomId("cards:burn:no:"+request.token)
      .setStyle(ButtonStyle.Secondary).setLabel("Keep Cards"),
  );
  return {embeds:[embed],components:[buttons],allowedMentions:{parse:[]}};
}

export async function startCardBurn(interaction) {
  if(!await canPlayCardGame(interaction.user.id,interaction.guild))
    return interaction.editReply(await cardRegistrationReminder(interaction.guildId));
  try{
    const request=await prepareCardBurn({
      ownerId:interaction.user.id,guildId:interaction.guildId,
      cardReferences:interaction.options.getString("card_ids",true),
    });
    return interaction.editReply(cardBurnPreview(request));
  }catch(error){
    return interaction.editReply({content:clean(error.message),allowedMentions:{parse:[] }});
  }
}

export async function handleCardBurnInteraction(interaction) {
  const [, ,action,token]=String(interaction.customId||"").split(":");
  if(!["yes","no"].includes(action)||!token)
    return interaction.reply({content:"Invalid burn confirmation.",flags:MessageFlags.Ephemeral});
  try {
    getPendingCardBurn(token,interaction.user.id,interaction.guildId);
  } catch(error){
    return interaction.reply({content:clean(error.message),flags:MessageFlags.Ephemeral});
  }
  if(action==="yes"&&!await canPlayCardGame(interaction.user.id,interaction.guild))
    return interaction.reply({
      content:await cardRegistrationReminder(interaction.guildId),flags:MessageFlags.Ephemeral,
      allowedMentions:{parse:[]},
    });
  await interaction.deferUpdate();
  try {
    if(action==="no") {
      cancelCardBurn(token,interaction.user.id,interaction.guildId);
      return interaction.editReply({
        embeds:[],components:[],content:"🌿 **Cards kept.** Nothing was burned and no dust changed.",
        allowedMentions:{parse:[]},
      });
    }
    const result=await confirmCardBurn(token,interaction.user.id,interaction.guildId);
    return interaction.editReply({
      embeds:[],components:[],content:[
        "🔥 **Burn complete!**",
        "**"+result.count+" card"+(result.count===1?"":"s")+"** turned to dust.",
        "✨ **Earned:** "+formatDustRewards(result.dust),
        "Use .dust to check your balance.",
      ].join("\n"),allowedMentions:{parse:[]},
    });
  }catch(error){
    console.warn("[Hatchem] Burn failed:",error.message);
    return interaction.editReply({
      embeds:[],components:[],content:"Burn cancelled: "+clean(error.message),
      allowedMentions:{parse:[]},
    });
  }
}
