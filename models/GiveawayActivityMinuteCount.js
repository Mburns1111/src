import mongoose from "mongoose";
// Per-minute summary, never message bodies. Supports exact custom giveaway windows.
const schema=new mongoose.Schema({
 guildId:{type:String,required:true},userId:{type:String,required:true},
 channelId:{type:String,required:true},day:{type:String,required:true},
 minute:{type:Date,required:true},count:{type:Number,default:0},
 lengths:{type:Map,of:Number,default:()=>new Map()},
},{timestamps:true});
schema.index({guildId:1,userId:1,channelId:1,minute:1},{unique:true});
schema.index({guildId:1,minute:1,channelId:1});
schema.index({createdAt:1},{expireAfterSeconds:90*86400});
export default mongoose.models.GiveawayActivityMinuteCount ||
 mongoose.model("GiveawayActivityMinuteCount",schema);
