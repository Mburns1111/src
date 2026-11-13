// Server-wide regular giveaway display template. Each new giveaway snapshots
// these choices so subsequent /setup giveaways changes never rewrite old posts.
export const REGULAR_DISPLAY_TEXT_MAX=400;
export const REGULAR_DISPLAY_TITLE_MAX=120;
export const REGULAR_DISPLAY_FIELDS=Object.freeze([
  "displayOpenTitle","displayEndedTitle","displayEntryText","displayWinnerText"
]);
export const REGULAR_DISPLAY_DEFAULTS=Object.freeze({
  displayOpenTitle:"🦊 The Fox’s Giveaway",
  displayEndedTitle:"🦊 Heist Complete",
  displayEntryText:"🦊 **The fox whispers:** \"Psst! I spotted something shiny in {host}'s pocket. Enter below and you might be the accomplice I need to swipe the prize!\"",
  displayWinnerText:"🦊 **The fox cackles:** \"My sneaky helpers pulled off the great pocket heist! We snatched the prize right out of {host}'s pocket. What a marvelous heist, {winners}!\"",
});
export function cleanRegularDisplayText(value){
  const text=String(value??"").trim();
  if(text.length>REGULAR_DISPLAY_TEXT_MAX)
    throw Error("Display text must be "+REGULAR_DISPLAY_TEXT_MAX+" characters or fewer.");
  return text.replace(/@/g,"＠");
}
export function cleanRegularDisplayTitle(value){
  const title=String(value??"").trim().replace(/[\r\n]+/g," ");
  if(title.length>REGULAR_DISPLAY_TITLE_MAX)
    throw Error("Display title must be "+REGULAR_DISPLAY_TITLE_MAX+" characters or fewer.");
  return title.replace(/@/g,"＠");
}
export function cleanRegularDisplayField(field,value){
  if(!REGULAR_DISPLAY_FIELDS.includes(field))throw Error("Unknown giveaway display field.");
  return field.endsWith("Title")?cleanRegularDisplayTitle(value):cleanRegularDisplayText(value);
}
export function regularDisplaySetting(record,field){
  return cleanRegularDisplayField(field,record?.[field]||"")
    ||REGULAR_DISPLAY_DEFAULTS[field];
}
export function renderRegularDisplayText(value,{hostId,winnerIds=[]}={}){
  const text=cleanRegularDisplayText(value);
  const host=/^\d{17,20}$/.test(String(hostId||""))?"<@"+hostId+">":"the host";
  const winners=[...new Set(winnerIds)].filter(id=>/^\d{17,20}$/.test(String(id)))
    .map(id=>"<@"+id+">").join(", ")||"the winner(s)";
  return text.replace(/\{host\}/gi,host).replace(/\{winners\}/gi,winners);
}
