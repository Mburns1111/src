import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
  name:{type:String,required:true,maxlength:60},
  repeatMode:{type:String,enum:["once","hours","days"],default:"hours"},
  interval:{type:Number,default:12,min:1,max:720},
  durationDays:{type:Number,default:7,min:1,max:365},
  offsetHours:{type:Number,default:0,min:0,max:720},
  roleIds:{type:[String],default:[],validate:v=>v.length<=10},
  messages:{type:[String],default:[]},
},{_id:false});

const schema=new mongoose.Schema({
  guildId:{type:String,required:true,index:true},
  name:{type:String,required:true,maxlength:80},
  nameKey:{type:String,required:true},
  description:{type:String,default:"",maxlength:300},
  createdBy:{type:String,required:true},
  updatedBy:{type:String,default:""},
  groups:{type:[groupSchema],default:[],validate:v=>v.length>=1&&v.length<=10},
},{timestamps:true});
schema.index({guildId:1,nameKey:1},{unique:true});
export default mongoose.model("PingTemplate",schema);
