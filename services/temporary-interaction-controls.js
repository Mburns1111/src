import {MessageFlags} from "discord.js";

// Only temporary, user-visible ephemeral interaction panels are replaced.
// Persistent public giveaway, claim, shop and staff-record controls must never
// be edited by this helper.
export function isTemporaryPanel(interaction){
  return interaction?.message?.flags?.has?.(MessageFlags.Ephemeral)===true;
}
export async function showTemporaryPanel(interaction,payload){
  if(isTemporaryPanel(interaction)&&typeof interaction.update==="function")
    return interaction.update(payload);
  return interaction.reply({...payload,flags:MessageFlags.Ephemeral});
}
export async function acknowledgeTemporaryAction(interaction){
  if(isTemporaryPanel(interaction)&&typeof interaction.deferUpdate==="function"){
    await interaction.deferUpdate();
    return true;
  }
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  return false;
}
export async function finishTemporaryAction(interaction,content){
  // This completes the current (ephemeral) interaction: never touch unrelated
  // permanent messages or change the underlying action implementation.
  return interaction.editReply(typeof content==="string"?
    {content,components:[]}:{...content,components:[]});
}
