import {ButtonBuilder,ButtonStyle} from "discord.js";

// Keep choices lead each setup screen, regardless of which action row they were
// originally assigned to. Preserve all action IDs, other button order, row
// capacities, and any Discord channel/role/select pickers.
export function isSetupKeepChoice(label,action){
  return String(action||"")==="keep" || /^keep(?:\b|\s*\/)/i.test(String(label||""));
}
export function setupButtonStyle(label,action,style=ButtonStyle.Secondary){
  return isSetupKeepChoice(label,action)||/\bdefault\b/i.test(String(label||""))
    ? ButtonStyle.Primary : style;
}
export function preferSetupChoices(choices){
  return [...choices.filter(([label,action])=>isSetupKeepChoice(label,action)),
    ...choices.filter(([label,action])=>!isSetupKeepChoice(label,action))];
}
export function preferSetupButtons(components){
  const buttonRows=components.filter(row=>row.components?.length &&
    row.components.every(component=>component instanceof ButtonBuilder));
  const all=buttonRows.flatMap(row=>row.components);
  const action=button=>String(button.data?.custom_id||"").split(":").at(-1);
  for(const button of all)
    button.setStyle(setupButtonStyle(button.data?.label,action(button),
      button.data?.style??ButtonStyle.Secondary));
  const ordered=preferSetupChoices(all.map(button=>[button.data?.label,action(button),button]))
    .map(([, , button])=>button);
  let index=0;
  for(const row of buttonRows){
    const count=row.components.length;
    row.components.splice(0,count,...ordered.slice(index,index+count));
    index+=count;
  }
  return components;
}
