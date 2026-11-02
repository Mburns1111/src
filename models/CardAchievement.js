import mongoose from "mongoose";
const schema=new mongoose.Schema({
  discordUserId:{type:String,required:true,index:true},
  key:{type:String,required:true},
  discoveryNumber:{type:Number,min:1},
  name:String,description:String,tier:String,secret:{type:Boolean,default:false},
  anonymousId:String,releaseId:String,eventId:String,
  releaseFirst:{type:Boolean,default:false},
  rewardGrabs:{type:Number,default:0},rewardDrops:{type:Number,default:0},
  rewardGrantedAt:Date,noticeAttemptedAt:Date,channelId:String,guildId:String,
  unlockedAt:{type:Date,default:Date.now},
},{timestamps:true});
schema.index({discordUserId:1,key:1},{unique:true});
schema.index({key:1,discoveryNumber:1},{unique:true,partialFilterExpression:{discoveryNumber:{$type:"number"}}});
export default mongoose.models.CardAchievement||mongoose.model("CardAchievement",schema);
