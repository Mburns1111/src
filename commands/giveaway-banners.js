import GuildConfig from "../models/GuildConfig.js";
import GiveawayBanner, {bannerNameKey} from "../models/GiveawayBanner.js";
import {ensureBannerRegistered,saveGiveawayBanner} from "../services/giveaway-banners.js";
import GiveawayPlan from "../models/GiveawayPlan.js";
import {reconcileActivityGiveawayListings} from "../services/giveaway-directory.js";
import {refreshActiveStandardGiveawayBanners} from "../services/giveaways.js";

// Legacy banner-* command identifiers are accepted briefly for cached Discord
// clients, but newly registered commands live under /giveaway banner <action>.
export const BANNER_OPERATIONS=new Set(["banner-save","banner-list","banner-default","banner-clear","banner-remove"]);
export const BANNER_SUBCOMMANDS=new Set(["save","list","default","clear","remove"]);

export function resolveGiveawayBannerOperation(interaction) {
  const operation=interaction.options.getSubcommand();
  const group=interaction.options.getSubcommandGroup?.(false)||null;
  if(group==="banner"&&BANNER_SUBCOMMANDS.has(operation))return operation;
  if(!group&&BANNER_OPERATIONS.has(operation))return operation.slice("banner-".length);
  return null;
}

export function addGiveawayBannerCommands(builder) {
  return builder.addSubcommandGroup(group=>group
    .setName("banner").setDescription("Manage reusable giveaway banner images")
    .addSubcommand(c=>c.setName("save").setDescription("Register or replace a reusable giveaway embed banner")
      .addStringOption(o=>o.setName("name").setDescription("Banner name, e.g. Roses").setRequired(true).setMinLength(1).setMaxLength(60))
      .addAttachmentOption(o=>o.setName("image").setDescription("PNG/JPG/WebP/GIF image, maximum 4 MB").setRequired(true)))
    .addSubcommand(c=>c.setName("list").setDescription("List saved reusable giveaway banner images"))
    .addSubcommand(c=>c.setName("default").setDescription("Select the default giveaway banner, including activity posts")
      .addStringOption(o=>o.setName("name").setDescription("Registered banner name").setRequired(true)))
    .addSubcommand(c=>c.setName("clear").setDescription("Remove the default banner (saved images remain registered)"))
    .addSubcommand(c=>c.setName("remove").setDescription("Delete a saved banner that no active plan uses")
      .addStringOption(o=>o.setName("name").setDescription("Registered banner name").setRequired(true))));
}
async function refreshCurrentBannerPosts(interaction){
  if(!interaction.client)return;
  const results=await Promise.allSettled([
    reconcileActivityGiveawayListings(interaction.client,{guildId:interaction.guildId}),
    refreshActiveStandardGiveawayBanners(interaction.client,interaction.guildId),
  ]);
  for(const r of results)if(r.status==="rejected")
    console.error("[Giveaways] Banner post refresh failed:",r.reason);
}
export async function executeGiveawayBannerAdmin(interaction) {
  const op=resolveGiveawayBannerOperation(interaction);
  if(!op)throw Error("Unknown banner action.");
  const guildId=interaction.guildId;
  if(op==="save") {
    const name=interaction.options.getString("name",true).trim();
    if(bannerNameKey(name)==="default") throw Error("Choose a banner name other than default.");
    const key=await saveGiveawayBanner({guildId,name,attachment:interaction.options.getAttachment("image",true)});
    return interaction.editReply(`Registered **${name}** (${key}). Use /giveaway banner default to apply it server-wide, or select it on a saved giveaway plan.`);
  }
  if(op==="list") {
    const [banners,config]=await Promise.all([
      GiveawayBanner.find({guildId}).sort({nameKey:1}).limit(40).select("name nameKey mimeType").lean(),
      GuildConfig.findOne({guildId}).select("giveawayDefaultBannerNameKey").lean(),
    ]);
    const lines=banners.map(b=>`• **${b.name.replace(/[@`*_~|<>]/g,"")}** (${b.mimeType})${config?.giveawayDefaultBannerNameKey===b.nameKey?" · **Default**":""}`);
    return interaction.editReply({content:lines.length?lines.join("\n").slice(0,1900):"No registered banners. Use /giveaway banner save with an uploaded image.",
      allowedMentions:{parse:[]}});
  }
  if(op==="default"){
    const name=interaction.options.getString("name",true);
    const key=await ensureBannerRegistered(guildId,name);
    await GuildConfig.findOneAndUpdate({guildId},{$set:{giveawayDefaultBannerNameKey:key}},
      {upsert:true,returnDocument:"after"});
    await refreshCurrentBannerPosts(interaction);
    return interaction.editReply("Default giveaway banner updated. Active activity listings and regular giveaway posts have been refreshed where accessible.");
  }
  if(op==="clear"){
    await GuildConfig.updateOne({guildId},{$set:{giveawayDefaultBannerNameKey:""}});
    await refreshCurrentBannerPosts(interaction);
    return interaction.editReply("Default banner cleared. Active posts have been refreshed where accessible; saved named banners remain available.");
  }
  const name=interaction.options.getString("name",true);
  const key=bannerNameKey(name);
  const [used,config]=await Promise.all([
    GiveawayPlan.exists({guildId,bannerNameKey:key,status:{$in:["active","paused"]}}),
    GuildConfig.findOne({guildId}).select("giveawayDefaultBannerNameKey").lean(),
  ]);
  if(used)throw Error("An active or paused giveaway plan uses this banner. Change the plan's banner first.");
  if(config?.giveawayDefaultBannerNameKey===key)
    throw Error("Clear or change the default banner before removing it.");
  const result=await GiveawayBanner.deleteOne({guildId,nameKey:key});
  return interaction.editReply(result.deletedCount?"Banner removed. Previous Discord posts are unchanged until edited.":"No registered banner found under that name.");
}
