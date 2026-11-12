// All schedule clock times are entered in the server's IANA time zone.
// UTC timestamps remain the durable source of truth for delivery.
export const COMMON_SERVER_TIME_ZONES=[
 {label:"Eastern (New York)",value:"America/New_York"},
 {label:"Central (Chicago)",value:"America/Chicago"},
 {label:"Mountain (Denver)",value:"America/Denver"},
 {label:"Arizona (Phoenix; no DST)",value:"America/Phoenix"},
 {label:"Pacific (Los Angeles)",value:"America/Los_Angeles"},
 {label:"Alaska (Anchorage)",value:"America/Anchorage"},
 {label:"Hawaii (Honolulu; no DST)",value:"Pacific/Honolulu"},
 {label:"UTC (world time)",value:"UTC"},
 {label:"United Kingdom (London)",value:"Europe/London"},
 {label:"Central Europe (Paris)",value:"Europe/Paris"},
 {label:"Australia East (Sydney)",value:"Australia/Sydney"},
];
const ALIASES=new Map(Object.entries({
 eastern:"America/New_York",et:"America/New_York",est:"America/New_York",edt:"America/New_York",
 central:"America/Chicago",ct:"America/Chicago",cst:"America/Chicago",cdt:"America/Chicago",
 mountain:"America/Denver",mt:"America/Denver",mst:"America/Denver",mdt:"America/Denver",
 pacific:"America/Los_Angeles",pt:"America/Los_Angeles",pst:"America/Los_Angeles",pdt:"America/Los_Angeles",
 arizona:"America/Phoenix",alaska:"America/Anchorage",hawaii:"Pacific/Honolulu",
 gmt:"UTC",utc:"UTC",uk:"Europe/London",
}));
const FORMATTERS=new Map();
export function validateServerTimeZone(value){
 const text=String(value||"").trim();
 if(!text)throw Error("Choose a server time zone in /setup general.");
 const zone=ALIASES.get(text.toLowerCase())||text;
 try{
  const normalized=new Intl.DateTimeFormat("en-US",{timeZone:zone}).resolvedOptions().timeZone;
  if(!normalized)throw Error("not found");
  return normalized;
 }catch{
  throw Error("Unknown time zone. Choose a preset or use an IANA name such as America/New_York or Europe/London.");
 }
}
function formatter(zone){
 const name=validateServerTimeZone(zone);
 if(!FORMATTERS.has(name))FORMATTERS.set(name,new Intl.DateTimeFormat("en-US",{
  timeZone:name,year:"numeric",month:"2-digit",day:"2-digit",
  hour:"2-digit",minute:"2-digit",hourCycle:"h23",
 }));
 return FORMATTERS.get(name);
}
export function serverDateParts(instant,zone){
 const date=new Date(instant);
 if(!Number.isFinite(date.getTime()))throw Error("Invalid date.");
 const parts=Object.fromEntries(formatter(zone).formatToParts(date).map(p=>[p.type,p.value]));
 return {
  year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),
  hour:Number(parts.hour),minute:Number(parts.minute),
 };
}
function calendarUTC(p){
 return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);
}
function exactLocal(p,c){
 return p.year===c.year&&p.month===c.month&&p.day===c.day&&p.hour===c.hour&&p.minute===c.minute;
}
function resolveLocal(p,zone,{allowGap=false}={}){
 const target=calendarUTC(p);
 // Examine offsets on both sides of the date, including DST transitions.
 const offsets=new Set();
 for(const delta of [-36,-12,0,12,36]){
  const time=target+delta*3600_000;
  const parts=serverDateParts(time,zone);
  offsets.add(calendarUTC(parts)-Math.floor(time/60_000)*60_000);
 }
 const candidates=[...offsets].map(offset=>target-offset)
  .filter(time=>exactLocal(serverDateParts(time,zone),p)).sort((a,b)=>a-b);
 if(candidates.length)return new Date(candidates[0]); // First occurrence if local clock repeats.
 if(allowGap){
  // A nonexistent recurrence (e.g. 2:30 AM on spring-forward day) moves
  // forward one hour on that day, and returns to its normal wall time afterward.
  for(let extra=1;extra<=3;extra++){
   const shifted=new Date(target+extra*3600_000);
   const attempt={
    year:shifted.getUTCFullYear(),month:shifted.getUTCMonth()+1,
    day:shifted.getUTCDate(),hour:shifted.getUTCHours(),minute:shifted.getUTCMinutes(),
   };
   try{return resolveLocal(attempt,zone);}catch{}
  }
 }
 throw Error("This local time does not exist on that date because of a daylight saving transition. Choose another clock time.");
}
function validCalendar(p){
 const time=calendarUTC(p);
 return Number.isFinite(time)&&p.year>=2000&&p.year<=2100&&
  exactLocal({
   year:new Date(time).getUTCFullYear(),month:new Date(time).getUTCMonth()+1,
   day:new Date(time).getUTCDate(),hour:new Date(time).getUTCHours(),minute:new Date(time).getUTCMinutes(),
  },p);
}
export function parseServerDateTime(dateValue,timeValue,zone){
 const date=String(dateValue||"").trim();
 const match=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
 if(!match)throw Error("Enter the date as YYYY-MM-DD (for example 2026-11-20).");
 const raw=String(timeValue||"").trim().toUpperCase().replace(/\s+/g," ");
 const time=/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/.exec(raw);
 if(!time)throw Error("Enter a time such as 9:00 AM, 6:30 PM, or 21:00.");
 let hour=Number(time[1]),minute=Number(time[2]);
 if(minute>59||hour<0||(time[3]?hour<1||hour>12:hour>23))
  throw Error("Choose a valid clock time.");
 if(time[3])hour=(hour%12)+(time[3]==="PM"?12:0);
 const parts={year:Number(match[1]),month:Number(match[2]),day:Number(match[3]),hour,minute};
 if(!validCalendar(parts))throw Error("Choose a real calendar date and time.");
 return resolveLocal(parts,validateServerTimeZone(zone));
}
export function addServerCalendarDays(instant,days,zone){
 if(!Number.isInteger(days))throw Error("The day interval must be a whole number.");
 const p=serverDateParts(instant,zone);
 const shifted=new Date(calendarUTC(p)+days*86400_000);
 const n={year:shifted.getUTCFullYear(),month:shifted.getUTCMonth()+1,
  day:shifted.getUTCDate(),hour:shifted.getUTCHours(),minute:shifted.getUTCMinutes()};
 return resolveLocal(n,zone,{allowGap:true});
}
export function formatServerClock(instant,zone){
 return new Intl.DateTimeFormat("en-US",{
  timeZone:validateServerTimeZone(zone),year:"numeric",month:"short",day:"numeric",
  hour:"numeric",minute:"2-digit",hour12:true,timeZoneName:"short",
 }).format(new Date(instant));
}
export function inputParts(instant,zone){
 const p=serverDateParts(instant,zone);
 return {date:[p.year,String(p.month).padStart(2,"0"),String(p.day).padStart(2,"0")].join("-"),
  time:String(p.hour).padStart(2,"0")+":"+String(p.minute).padStart(2,"0")};
}
