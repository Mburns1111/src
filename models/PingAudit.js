import mongoose from "mongoose";
const schema=new mongoose.Schema({
 guildId:{type:String,required:true,index:true},
 scheduleId:{type:mongoose.Schema.Types.ObjectId,ref:"PingSchedule",required:true,index:true},
 actorId:{type:String,required:true},
 event:{type:String,required:true,maxlength:60},
 details:{type:mongoose.Schema.Types.Mixed,default:{}},
},{timestamps:true});
schema.index({scheduleId:1,createdAt:1});
export default mongoose.model("PingAudit",schema);
