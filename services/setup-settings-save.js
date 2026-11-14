import GuildConfig from "../models/GuildConfig.js";

// A guided setup may stay open while other staff change shared settings.
// Update only fields deliberately changed by this session, then compare the
// previously read values atomically when writing. This prevents one wizard
// from restoring unrelated settings or silently overwriting another editor.
export function setupChangedFields(proposed,original={},fallbacks={}){
  const changes={};
  for(const [field,value] of Object.entries(proposed)){
    const before=original?.[field]??fallbacks[field]??null;
    if(JSON.stringify(before)!==JSON.stringify(value))changes[field]=value;
  }
  return changes;
}

export async function saveGuidedSetupFields({
  guildId,original,proposed,fallbacks={},extra={},
}){
  if(!guildId)throw Error("A server is required to save setup.");
  const dirty=setupChangedFields(proposed,original,fallbacks);
  const extras=setupChangedFields(extra,original);
  const changed={...dirty,...extras};
  if(!Object.keys(changed).length)return {changed:false,fields:[]};
  const filter={guildId};
  for(const field of Object.keys(changed)){
    // MongoDB equality to null matches both absent and explicit null, which
    // is correct for older config documents missing a newly added field.
    filter[field]=original?.[field]??null;
  }
  let saved;
  try{
    saved=await GuildConfig.findOneAndUpdate(filter,{$set:changed},
      {upsert:!original,new:true,runValidators:true,setDefaultsOnInsert:true});
  }catch(error){
    // An upsert racing another wizard can hit a duplicate guildId index.
    if(error?.code===11000)throw Error("Another staff member saved setup first. Reopen setup and review the current settings.");
    throw error;
  }
  if(!saved)throw Error("These settings were changed by another staff member. Reopen setup to review the current values.");
  return {changed:true,fields:Object.keys(changed)};
}
