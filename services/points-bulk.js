// Validate a pasted list of Discord member mentions or snowflake IDs. No
// role mentions, channel links, or arbitrary text can expand a grant.
const MEMBER_ID = /^\d{17,21}$/;
const MAX_RECIPIENTS = 20;

export const BULK_REASON_CHOICES = Object.freeze([
  { name: "Giveaway", value: "giveaway" },
  { name: "Participation", value: "participation" },
  { name: "Server Event", value: "event" },
  { name: "Helping Others", value: "helpfulness" },
  { name: "Other", value: "other" },
]);
export function parseBulkRecipients(text) {
  if (typeof text !== "string") throw new Error("Enter member mentions or Discord IDs.");
  const words = text.trim().split(/[\s,;]+/).filter(Boolean);
  if (!words.length) throw new Error("Enter at least one member.");
  if (words.length > MAX_RECIPIENTS) {
    throw new Error(`A grant may include at most ${MAX_RECIPIENTS} members. Split the list into batches.`);
  }
  const ids = words.map(word => {
    const match = /^<@!?(\d{17,21})>$/.exec(word);
    const id = match?.[1] ?? word;
    if (!MEMBER_ID.test(id)) throw new Error(`Invalid member ID or mention: ${word.slice(0,40)}`);
    return id;
  });
  return [...new Set(ids)];
}

export function bulkAwardDetails(reason, note = "", reference = "") {
  const selected = BULK_REASON_CHOICES.find(x => x.value === reason);
  if (!selected) throw new Error("Choose a valid award reason.");
  const description = note?.trim();
  if (description?.length > 100) throw new Error("Award note must be 100 characters or fewer.");
  const cleanRef = reference?.trim().toLowerCase();
  if (cleanRef && !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(cleanRef)) {
    throw new Error("Event reference must be 3–80 letters, numbers, underscores or dashes.");
  }
  return {
    description: `${selected.name}${description ? `: ${description}` : ""}`,
    category: selected.value,
    reference: cleanRef,
  };
}
