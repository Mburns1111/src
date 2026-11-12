import mongoose from "mongoose";

const groupSchema=new mongoose.Schema({
  name:String,repeatMode:String,interval:Number,durationDays:Number,offsetHours:Number,
  roleIds:[String],messages:[String],
  messageMode:{type:String,enum:["single","rotate","per-ping","roles"]},
  perPingMessages:{type:[String],default:[]},
},{_id:false});
const schema=new mongoose.Schema({
  guildId:{type:String,required:true,index:true},
  templateId:{type:mongoose.Schema.Types.ObjectId,ref:"PingTemplate",default:null},
  templateName:{type:String,default:""},
  name:{type:String,required:true,maxlength:80},
  destinationChannelId:{type:String,required:true},
  timeZone:{type:String,default:"UTC"},
  archiveLeaseUntil:{type:Date,default:null},
  createdBy:{type:String,required:true},
  activatedBy:{type:String,required:true},
  status:{type:String,enum:["active","paused","completed","ended","archived"],default:"active",index:true},
  groups:{type:[groupSchema],default:[]},
  startsAt:{type:Date,required:true},
  endsAt:{type:Date,required:true},
  stoppedAt:{type:Date,default:null},
  stopReason:{type:String,default:""},
  plannedCount:{type:Number,default:0},
  sentCount:{type:Number,default:0},
  failedCount:{type:Number,default:0},
  skippedCount:{type:Number,default:0},
  archiveMessageId:{type:String,default:""},
  archivedAt:{type:Date,default:null},
},{timestamps:true});
schema.index({guildId:1,status:1,startsAt:1});
export default mongoose.model("PingSchedule",schema);
