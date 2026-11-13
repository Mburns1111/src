// Optional per-giveaway story wording. Required prize, eligibility, claims,
// deadlines and entry buttons are rendered by the normal giveaway presenter.
export const REGULAR_DISPLAY_TEXT_MAX=400;

export function cleanRegularDisplayText(value){
  const text=String(value??"").trim();
  if(text.length>REGULAR_DISPLAY_TEXT_MAX)
    throw Error("Display text must be "+REGULAR_DISPLAY_TEXT_MAX+" characters or fewer.");
  // Staff can deliberately use {host} and {winners}, but arbitrary mentions
  // must never trigger a mass ping or smuggle in a user/role ping.
  return text.replace(/@/g,"＠");
}

export function renderRegularDisplayText(value,{hostId,winnerIds=[]}={}){
  const text=cleanRegularDisplayText(value);
  const host=/^\d{17,20}$/.test(String(hostId||""))?"<@"+hostId+">":"the host";
  const winners=[...new Set(winnerIds)].filter(id=>/^\d{17,20}$/.test(String(id)))
    .map(id=>"<@"+id+">").join(", ")||"the winner(s)";
  return text.replace(/\{host\}/gi,host).replace(/\{winners\}/gi,winners);
}
