import mongoose from "mongoose";

const schema=new mongoose.Schema({
  guildId:{type:String,required:true,index:true},
  scheduleId:{type:mongoose.Schema.Types.ObjectId,ref:"PingSchedule",required:true,index:true},
  sequence:{type:Number,required:true},
  groupIndex:{type:Number,required:true},
  dueAt:{type:Date,required:true},
  roleIds:{type:[String],default:[]},
  content:{type:String,default:"",maxlength:1900},
  status:{type:String,enum:["pending","sending","sent","failed","skipped"],default:"pending"},
  processingStartedAt:{type:Date,default:null},
  sentAt:{type:Date,default:null},
  messageId:{type:String,default:""},
  messageUrl:{type:String,default:""},
  error:{type:String,default:""},
  changedBy:{type:String,default:""},
},{timestamps:true});
schema.index({scheduleId:1,sequence:1},{unique:true});
schema.index({status:1,dueAt:1});
export default mongoose.model("PingDelivery",schema);
