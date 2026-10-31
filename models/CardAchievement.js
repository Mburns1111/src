import mongoose from "mongoose";
const schema=new mongoose.Schema({
  discordUserId:{type:String,required:true,index:true},
  key:{type:String,required:true},
  unlockedAt:{type:Date,default:Date.now},
},{timestamps:true});
schema.index({discordUserId:1,key:1},{unique:true});
export default mongoose.models.CardAchievement||mongoose.model("CardAchievement",schema);
