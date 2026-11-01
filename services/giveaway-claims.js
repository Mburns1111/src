// Shared prize-claim presentation for ordinary giveaways and Court's Trials.
// The bot never creates tickets, adjudicates availability, or forfeits prizes.
export const MAX_CLAIM_HOURS = 24 * 30;
export const MAX_TRIAL_CLAIM_MINUTES = MAX_CLAIM_HOURS * 60;

// New Court's Trials use minutes; regular giveaways continue using hours.
// Preserve the original hours unit for trials created before this change.
function claimDuration(record) {
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
      lines.push("**Claim deadline:** <t:" + deadline + ":F> (<t:" + deadline + ":R>)");
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
    lines.push("*Staff arrange delivery manually. Claim deadlines are informational; no automatic forfeiture or ticket creation occurs.*");
  }
  return lines;
}
