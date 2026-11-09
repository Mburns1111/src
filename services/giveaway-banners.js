import { AttachmentBuilder } from "discord.js";
import GuildConfig from "../models/GuildConfig.js";
import GiveawayBanner, { bannerNameKey } from "../models/GiveawayBanner.js";

export const MAX_GIVEAWAY_BANNER_BYTES=4*1024*1024;
const EXTENSION={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"};
const TRUSTED_CDN=new Set(["cdn.discordapp.com","media.discordapp.net","cdn.discordapp.net"]);

export function validateBannerUpload(attachment) {
  const mimeType=attachment?.contentType?.toLowerCase().split(";")[0];
  if(!EXTENSION[mimeType]) throw Error("Upload a PNG, JPG, WebP or GIF image.");
  if(!Number.isSafeInteger(attachment.size) || attachment.size<1 ||
     attachment.size>MAX_GIVEAWAY_BANNER_BYTES)
    throw Error("Giveaway banner must be under 4 MB.");
  let url;
  try {url=new URL(attachment.url);}catch {throw Error("Invalid banner attachment.");}
  if(url.protocol!=="https:" || !TRUSTED_CDN.has(url.hostname) ||
     url.username || url.password || url.port)
    throw Error("Use an image uploaded directly to this Discord command.");
  return {mimeType,url:url.toString()};
}
export async function saveGiveawayBanner({guildId,name,attachment,fetchImage=fetch}) {
  const key=bannerNameKey(name);
  if(!key || key.length>60)throw Error("Choose a banner name of up to 60 characters.");
  const {mimeType,url}=validateBannerUpload(attachment);
  const response=await fetchImage(url,{redirect:"error",signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error("Could not retrieve the Discord banner upload.");
  const bytes=Buffer.from(await response.arrayBuffer());
  if(!bytes.length || bytes.length>MAX_GIVEAWAY_BANNER_BYTES)
    throw Error("Downloaded banner exceeds the 4 MB limit.");
  await GiveawayBanner.findOneAndUpdate(
    {guildId,nameKey:key},
    {$set:{name:name.trim(),mimeType,imageData:bytes}},
    {upsert:true,new:true,runValidators:true});
  return key;
}
export async function ensureBannerRegistered(guildId,name) {
  const key=bannerNameKey(name);
  if(!key)return "";
  if(!await GiveawayBanner.exists({guildId,nameKey:key}))
    throw Error(`Banner "${name}" is not registered. Use /giveaway banner-save first.`);
  return key;
}
export async function getGiveawayBanner(guildId,nameKey="") {
  let key=bannerNameKey(nameKey);
  if(!key){
    const config=await GuildConfig.findOne({guildId});
    key=config?.giveawayDefaultBannerNameKey || "";
  }
  if(!key)return null;
  return GiveawayBanner.findOne({guildId,nameKey:key}).lean();
}
// MongoDB can return a BSON Binary from .lean() instead of a Node Buffer.
// Treat both as stored image bytes; otherwise a perfectly valid saved banner
// silently disappears from the Discord post.
export function giveawayBannerBytes(banner) {
  const data=banner?.imageData;
  if(Buffer.isBuffer(data))return data;
  if(data instanceof Uint8Array)return Buffer.from(data);
  if(typeof data?.value==="function"){
    const value=data.value(true);
    if(Buffer.isBuffer(value))return value;
    if(value instanceof Uint8Array)return Buffer.from(value);
  }
  if(data?.buffer instanceof Uint8Array){
    const end=Number.isSafeInteger(data.position)?data.position:data.buffer.length;
    return Buffer.from(data.buffer.subarray(0,end));
  }
  return null;
}
export function attachGiveawayBanner(payload,banner) {
  const bytes=giveawayBannerBytes(banner);
  if(!bytes?.length || !EXTENSION[banner?.mimeType])return payload;
  const filename=`giveaway-banner.${EXTENSION[banner.mimeType]}`;
  const embed=payload.embeds?.[0];
  if(!embed) return payload;
  embed.setImage(`attachment://${filename}`);
  return {...payload,files:[new AttachmentBuilder(bytes,{name:filename})],
    attachments:[]};
}
