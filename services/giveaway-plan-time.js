// Human-friendly Eastern event timestamps. Saved as absolute UTC instants so
// Discord and the bot agree on deadlines. Recurrences retain the same wall clock
// time even across daylight-saving switches.
const formatter=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",
  year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",
  hourCycle:"h23"});
function easternParts(date) {
 const parts=Object.fromEntries(formatter.formatToParts(date).map(p=>[p.type,p.value]));
 return {y:Number(parts.year),m:Number(parts.month),d:Number(parts.day),
   h:Number(parts.hour),min:Number(parts.minute)};
}
function localDigits(p){return [p.y,p.m,p.d,p.h,p.min].join("-");}
function easternToUtc(y,m,d,h,min) {
 const desired=Date.UTC(y,m-1,d,h,min);
 let guess=desired;
 for(let i=0;i<4;i++) {
  const p=easternParts(new Date(guess));
  const shown=Date.UTC(p.y,p.m-1,p.d,p.h,p.min);
  const delta=desired-shown;
  if (!delta) break;
  guess+=delta;
 }
 const result=new Date(guess);
 if(localDigits(easternParts(result))!==localDigits({y,m,d,h,min}))
   throw Error("That Eastern local time does not exist (daylight saving transition). Choose another time.");
 return result;
}
export function parseEasternAnnouncement(value,{now=new Date()}={}) {
 const match=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(value||"").trim());
 if(!match) throw Error("Use YYYY-MM-DD HH:mm in Eastern time, for example 2026-11-11 19:30.");
 const [,ys,ms,ds,hs,mins]=match;
 const [y,m,d,h,min]=[ys,ms,ds,hs,mins].map(Number);
 if(m<1||m>12||d<1||d>31||h>23||min>59||
    new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10)!==`${ys}-${ms}-${ds}`)
   throw Error("Invalid Eastern date or time.");
 const result=easternToUtc(y,m,d,h,min);
 if(result<=now) throw Error("Choose an announcement time in the future.");
 return result;
}
export function nextWeeklyAnnouncement(previous) {
 const p=easternParts(new Date(previous));
 const nextDate=new Date(Date.UTC(p.y,p.m-1,p.d+7,12));
 return easternToUtc(nextDate.getUTCFullYear(),nextDate.getUTCMonth()+1,nextDate.getUTCDate(),p.h,p.min);
}

/** Given an Eastern calendar date (YYYY-MM-DD), return the real UTC midnight.
 * This uses calendar dates instead of subtracting 24 hours: DST days may be 23/25 hours. */
export function easternMidnight(day) {
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day));
 if(!match) throw Error("Invalid Eastern calendar day.");
 const [,yy,mm,dd]=match;
 return easternToUtc(Number(yy),Number(mm),Number(dd),0,0);
}
export function shiftCalendarDay(day,days) {
 const d=new Date(day+"T12:00:00Z");
 if(!Number.isFinite(d.getTime())) throw Error("Invalid Eastern calendar day.");
 d.setUTCDate(d.getUTCDate()+days);
 return d.toISOString().slice(0,10);
}
export function nextDailyAnnouncement(previous) {
 const p=easternParts(new Date(previous));
 const next=shiftCalendarDay(`${String(p.y).padStart(4,"0")}-${String(p.m).padStart(2,"0")}-${String(p.d).padStart(2,"0")}`,1);
 const [y,m,d]=next.split("-").map(Number);
 return easternToUtc(y,m,d,p.h,p.min);
}
export function nextPlanAnnouncement(previous,mode,intervalMinutes) {
 if(mode==="daily") return nextDailyAnnouncement(previous);
 if(mode==="weekly") return nextWeeklyAnnouncement(previous);
 if(mode==="interval") {
   if(!Number.isSafeInteger(intervalMinutes)||intervalMinutes<60||intervalMinutes>43200)
     throw Error("Recurring interval must be between 60 and 43,200 minutes.");
   return new Date(new Date(previous).getTime()+intervalMinutes*60_000);
 }
 if(mode==="once") return new Date(previous);
 throw Error("Unsupported recurring schedule.");
}
