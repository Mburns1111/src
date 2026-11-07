import mongoose from "mongoose";

// A named, reusable Discord giveaway banner. Uploads are persisted in MongoDB
// so signed Discord CDN links do not expire between recurring draws.
const schema=new mongoose.Schema({
  guildId:{type:String,required:true},
  name:{type:String,required:true,trim:true,maxlength:60},
  nameKey:{type:String,required:true},
  mimeType:{type:String,required:true,enum:["image/png","image/jpeg","image/webp","image/gif"]},
  imageData:{type:Buffer,required:true},
},{timestamps:true});
schema.index({guildId:1,nameKey:1},{unique:true});
export const bannerNameKey=value=>String(value||"").trim().toLocaleLowerCase("en-US");
export default mongoose.models.GiveawayBanner ||
  mongoose.model("GiveawayBanner",schema);
