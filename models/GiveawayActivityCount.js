import mongoose from "mongoose";
const schema = new mongoose.Schema({
  guildId:{type:String,required:true}, userId:{type:String,required:true},
  channelId:{type:String,required:true}, day:{type:String,required:true},
  week:{type:String,required:true}, count:{type:Number,default:0},
  // Histogram by actual character length, so a saved watch rule can change its threshold later.
  lengths:{type:Map,of:Number,default:()=>new Map()},
},{timestamps:true});
schema.index({guildId:1,userId:1,channelId:1,day:1},{unique:true});
schema.index({guildId:1,week:1,channelId:1});
schema.index({guildId:1,day:1,channelId:1});
schema.index({createdAt:1},{expireAfterSeconds:90*86400});
export default mongoose.models.GiveawayActivityCount || mongoose.model("GiveawayActivityCount",schema);
