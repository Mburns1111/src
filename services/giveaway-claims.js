// Shared prize-claim presentation for ordinary giveaways and Court's Trials.
// The bot never creates tickets, adjudicates availability, or forfeits prizes.
export const MAX_CLAIM_HOURS = 24 * 30;
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

export function prizeClaimLines(record, { finished = false } = {}) {
  const duration = claimDuration(record);
  const instructions = String(record.claimInstructions || "").trim().slice(0, 400);
  const lines = [];
  if (duration) {
    const deadline = finished ? prizeClaimDeadline(record) : null;
    if (deadline) {
      const label=record.mode!=="survival" && (record.rerollHistory || []).length ? "Original claim deadline" : "Claim deadline";
      lines.push("**" + label + ":** <t:" + deadline + ":F> (<t:" + deadline + ":R>)");
    } else {
      lines.push("**Claim window:** " + duration.count + " " + duration.unit +
        (duration.count === 1 ? "" : "s") + " after winners are announced");
    }
  }
  // A saved custom note may also be useful before joining.
  if (!finished) {
    if (instructions) lines.push("**Claim notes:** " + instructions);
    return lines;
  }

  if ((record.winnerIds || []).length) {
    lines.push("**How to claim:** Open a support ticket in this server and include 2–3 dates/times you're available to collect your prize. Generate Discord timestamps at https://hammertime.cyou and paste them into your ticket; everyone sees the times in their own time zone.");
    if (instructions) lines.push("**Host's claim instructions:** " + instructions);
    if (record.mode !== "survival") {
      lines.push("**How to report a claim:** Winners press **File Ticket Claim** below and provide the ticket number and URL. Staff still deliver prizes.");
      if (record.autoRerollClaims) lines.push("*The bot rerolls a winning place when the deadline passes with no submitted ticket claim, if another eligible entrant remains.*");
    } else lines.push("*Staff arrange delivery manually. Trial claim deadlines are informational; no automatic ticket creation occurs.*");
  }
  return lines;
}
