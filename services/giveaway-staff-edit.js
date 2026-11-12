import {ActionRowBuilder,ModalBuilder,TextInputBuilder,TextInputStyle} from "discord.js";
import {maxRegularGiveawayMinutes} from "./giveaways.js";

const EDIT_FIELDS={
  title:{label:"Giveaway title",max:100,min:2},
  prize:{label:"Prize",max:1500,min:2,paragraph:true},
  description:{label:"Giveaway details",max:1000,min:0,paragraph:true},
  rules:{label:"Entry instructions / rules",max:1200,min:0,paragraph:true},
  winnerCount:{label:"Number of winners (1–10)",max:2,min:1,type:"integer",lower:1,upper:10},
  claimInstructions:{label:"How to claim prize",max:1000,min:0,paragraph:true},
  claimWindowHours:{label:"Claim deadline (hours, 1–720)",max:3,min:1,type:"integer",lower:1,upper:720},
  claimWindowMinutes:{label:"Trial claim deadline (minutes)",max:5,min:1,type:"integer",lower:1,upper:43200},
  durationMinutes:{label:"Minutes until giveaway ends",max:6,min:1,type:"integer",lower:1},
  bannerNameKey:{label:"Saved banner name (or default)",max:60,min:0},
};

export function giveawayStaffEditableFields(record) {
  if(record?.status!=="open"||record?.publicListingRemovedAt||record?.guidedSeries)return [];
  const general=["title","prize","description","rules","winnerCount","claimInstructions","bannerNameKey"];
  if(record.mode==="survival")return [...general,"claimWindowMinutes","durationMinutes"];
  if(record.mode==="standard")return [...general,"enforceExclusionRole","claimWindowHours","durationMinutes"];
  return [...general,"claimWindowHours","durationMinutes"];
}

export function giveawayStaffEditModal(record,field) {
  if(!giveawayStaffEditableFields(record).includes(field))throw Error("This setting can't be edited on this giveaway.");
  const config=EDIT_FIELDS[field];
  if(!config)throw Error("Unknown editable setting.");
  const input=new TextInputBuilder().setCustomId("value")
    .setLabel(config.label).setRequired(config.min>0)
    .setMaxLength(config.max).setStyle(config.paragraph?TextInputStyle.Paragraph:TextInputStyle.Short);
  if(field==="durationMinutes"){
    const current=Math.max(1,Math.ceil((+new Date(record.endsAt)-Date.now())/60000));
    input.setValue(String(current));
  }else if(field==="bannerNameKey")input.setValue(record.bannerNameKey||"default");
  else if(record[field]!==undefined&&record[field]!==null&&String(record[field]).length)
    input.setValue(String(record[field]).slice(0,config.max));
  return new ModalBuilder()
    .setCustomId("giveawaystaff:editsave:"+record._id+":"+field)
    .setTitle("Edit: "+config.label.slice(0,39))
    .addComponents(new ActionRowBuilder().addComponents(input));
}

export function validateGiveawayStaffEdit(record,field,raw,{now=new Date()}={}){
  if(!giveawayStaffEditableFields(record).includes(field))throw Error("This setting can only be edited before entries close.");
  const config=EDIT_FIELDS[field];
  const value=String(raw||"").trim();
  if(value.length<config.min||value.length>config.max)
    throw Error(config.label+" must have "+config.min+"–"+config.max+" characters.");
  if(field==="durationMinutes"){
    const max=record.mode==="survival"?1440:maxRegularGiveawayMinutes(now);
    if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>max)
      throw Error("Choose from 1 to "+max+" minutes (up to six calendar months for regular giveaways).");
    return {endsAt:new Date(+now+Number(value)*60000)};
  }
  if(config.type==="integer"){
    if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||
        Number(value)<config.lower||Number(value)>config.upper)
      throw Error("Enter a whole number from "+config.lower+" to "+config.upper+".");
    return {[field]:Number(value)};
  }
  if(field==="bannerNameKey")
    return {bannerNameKey:/^(default|none|clear)$/i.test(value)?"":value};
  return {[field]:value};
}

export function giveawayStaffEditMenuOptions(record){
  return giveawayStaffEditableFields(record).map(field=>({
    label:EDIT_FIELDS[field].label,
    value:field
  }));
}
