import GiveawayBanner, {bannerNameKey} from "../models/GiveawayBanner.js";
import {saveGiveawayBanner} from "./giveaway-banners.js";

// Banner choices are always scoped to the current Discord server. The menu
// displays up to 25; the text path can select any registered banner by name.
export async function registeredSetupBanners(guildId){
  return GiveawayBanner.find({guildId}).sort({nameKey:1}).limit(40)
    .select("name nameKey").lean();
}

export function bannerCatalogText(banners){
  if(!banners?.length)
    return "**Registered banners:** None yet. You can upload your first banner here without leaving setup.";
  const names=banners.map((banner,i)=>
    (i+1)+". **"+String(banner.name||banner.nameKey).replace(/[\\\n\r@*_`~|<>]/g," ").trim().slice(0,60)+"**");
  return ("**Registered banners in this server:**\n"+names.join("\n")+
    "\nChoose from the menu or type the exact name.").slice(0,1650);
}

export function setupBannerOptions(banners){
  return (banners||[]).slice(0,25).map(b=>({
    label:String(b.name||b.nameKey).slice(0,100),
    value:String(b.nameKey||bannerNameKey(b.name)).slice(0,100),
  }));
}

export function bannerUploadFromMessage(message){
  const attachment=message.attachments?.first?.() ||
    (Array.isArray(message.attachments)?message.attachments[0]:null);
  if(!attachment)
    throw Error("Attach a PNG, JPG, WebP or GIF image (maximum 4 MB) to your message.");
  // A caption gives the banner its name. Otherwise use the filename as-is,
  // minus the extension; do not silently invent a random name.
  const caption=String(message.content||"").trim();
  const filename=String(attachment.name||"").replace(/\.[^.\/\\]+$/,"").trim();
  const name=caption||filename;
  const key=bannerNameKey(name);
  if(!key||name.length>60||key==="default")
    throw Error("Give this banner a name of 1–60 characters (not 'default'). Type a name with the attached image or rename the file.");
  return {name,attachment};
}

export async function registerSetupBanner(guildId,message,options={}){
  const {name,attachment}=bannerUploadFromMessage(message);
  return saveGiveawayBanner({guildId,name,attachment,...options});
}
