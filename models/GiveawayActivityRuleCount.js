import mongoose from "mongoose";

// Compact per-day counts for named mention/phrase challenges. No message
// bodies, links, or individual mentions are retained.
const schema=new mongoose.Schema({
  guildId:{type:String,required:true},ruleId:{type:mongoose.Schema.Types.ObjectId,required:true},
  criteriaVersion:{type:Number,required:true},
  userId:{type:String,required:true},day:{type:String,required:true},week:{type:String,required:true},
  count:{type:Number,default:0},
},{timestamps:true});
schema.index({guildId:1,ruleId:1,criteriaVersion:1,userId:1,day:1},{unique:true});
schema.index({guildId:1,ruleId:1,criteriaVersion:1,week:1});
schema.index({guildId:1,ruleId:1,criteriaVersion:1,day:1});
schema.index({createdAt:1},{expireAfterSeconds:90*86400});
export default mongoose.models.GiveawayActivityRuleCount ||
  mongoose.model("GiveawayActivityRuleCount",schema);
