// Shared prize-claim presentation for ordinary giveaways and Court's Trials.
// The bot never creates tickets, adjudicates availability, or forfeits prizes.
export const MAX_CLAIM_HOURS = 24 * 30;
export const DEFAULT_CLAIM_HOURS = 12;
export const DEFAULT_MAX_AUTO_REROLLS = 2;
export const MAX_AUTO_REROLLS = 10;
export const MAX_TRIAL_CLAIM_MINUTES = MAX_CLAIM_HOURS * 60;

// New Court's Trials use minutes; regular giveaways continue using hours.
// Preserve the original hours unit for trials created before this change.
export function claimDuration(record) {
  const minutes = Number(record.claimWindowMinutes);
  if (record.mode === "survival" &&
      Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= MAX_TRIAL_CLAIM_MINUTES) {
    return { count: minutes, unit: "minute", milliseconds: minutes * 60_000 };
  }

  const hours = Number(record.claimWindowHours);
  if (Number.isSafeInteger(hours) && hours >= 1 && hours <= MAX_CLAIM_HOURS) {
    return { count: hours, unit: "hour", milliseconds: hours * 3_600_000 };
  }
  return null;
}

/** A real Discord timestamp is displayed in each reader's local timezone. */
export function winnerClaimDeadline(record, slot) {
  const duration=claimDuration(record);
  const start=record.winnerAssignedAt?.[slot] || record.claimStartedAt;
  if (!duration || !start) return null;
  const timestamp=new Date(start).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp+duration.milliseconds) : null;
}
export function winnerHasClaim(record, slot) {
  return (record.winnerClaims || []).some(c => c.slot === slot && c.userId === record.winnerIds?.[slot]);
}
export function automaticRerollLimit(record) {
  const n=record.maxAutoRerolls;
  return Number.isSafeInteger(n)&&n>=0&&n<=MAX_AUTO_REROLLS?n:DEFAULT_MAX_AUTO_REROLLS;
}
export function automaticRerollsUsed(record,slot) {
  return (record.rerollHistory||[]).filter(r=>r.slot===slot && r.reason==="claim-expired").length;
}
export function nextClaimCheckAt(record) {
  if (!record.autoRerollClaims || record.mode === "survival" || record.status !== "ended") return null;
  const deadlines=(record.winnerIds || []).map((_,slot)=>({
    slot,deadline:winnerClaimDeadline(record,slot),
  })).filter(({slot,deadline})=>deadline && !winnerHasClaim(record,slot) && !(record.claimResolvedSlots||[]).includes(slot));
  return deadlines.length ? new Date(Math.min(...deadlines.map(({deadline})=>deadline.getTime()))) : null;
}

export function prizeClaimDeadline(record) {
  const duration = claimDuration(record);
  const start = record.claimStartedAt || record.gameEndedAt;
  if (!duration || !start) return null;
  const timestamp = new Date(start).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.floor((timestamp + duration.milliseconds) / 1000);
}

export const DEFAULT_CLAIM_INSTRUCTIONS="Open a support ticket in this server to arrange prize delivery. Keep its ticket number and copy the Discord message link from the ticket. You may share available collection times with staff.";
export function prizeClaimLines(record,{finished=false}={}){
  const duration=claimDuration(record);
  const instructions=String(record.claimInstructions||"").trim().slice(0,1000)||DEFAULT_CLAIM_INSTRUCTIONS;
  const lines=[];
  if(duration){
    const deadline=finished?prizeClaimDeadline(record):null;
    if(deadline){
      const label=record.mode!=="survival"&&(record.rerollHistory||[]).length?"Original claim deadline":"Claim deadline";
      lines.push("**"+label+":** <t:"+deadline+":F> (<t:"+deadline+":R>)");
    }else{
      lines.push("**Claim window:** "+duration.count+" "+duration.unit+(duration.count===1?"":"s")+" after winners are announced");
    }
  }
  if(!finished){
    lines.push("**Prize collection:** "+instructions);
    return lines;
  }
  if(!(record.winnerIds||[]).length)return lines;
  lines.push("**How to claim:** "+instructions);
  if(record.mode!=="survival"){
    lines.push("**Submit your claim:** Press **Enter Ticket Claim info** and provide your **ticket number** and the **Discord message link** from your ticket. Creating a support ticket alone does not register your claim with the bot.");
    lines.push("⚠️ **IMPORTANT — CLAIM BEFORE THE DEADLINE OR FORFEIT YOUR WIN.** If your ticket number and message link are not entered into the bot before the claim window closes, your winning place is forfeited."+
      (record.autoRerollClaims?" The bot can choose another eligible winner (up to "+automaticRerollLimit(record)+" automatic rerolls per place).":""));
  }else lines.push("*Court's Trial claims are coordinated by staff; these deadlines do not trigger automated rerolls.*");
  return lines;
}
