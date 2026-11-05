/**
 * Compile an owner-authored PRIVATE secret file into immutable CardDefinition IDs.
 * This file intentionally contains no unpublished secret names or pet solutions.
 * It supports the existing database model and player achievement engine without
 * inventing a new type of reward or public hint.
 */
const ALLOWED_METRICS = new Set(["acquiredDesigns","ownedDesigns","neonDesigns","megaDesigns"]);
const ALLOWED_TIERS = new Set(["basic","medium","advanced"]);
const id = v => String(v ?? "").trim();

export function compilePrivateReleaseSecrets(config, definitions) {
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id(config.releaseId)) ||
      !Array.isArray(config.secrets)) {
    throw Error("Invalid private release secret configuration.");
  }
  const byPet = new Map(), byId = new Map();
  for (const definition of definitions || []) {
    if (definition.releaseId !== config.releaseId || !definition.enabled ||
        definition.artStatus !== "approved" || !(Number(definition.hatchWeight) > 0))
      continue;
    if (byPet.has(id(definition.petId))) throw Error("Approved release pet IDs must be unique.");
    byPet.set(id(definition.petId),definition);
    byId.set(id(definition._id),definition);
  }
  const keys=new Set();
  const secrets=config.secrets.map((secret,index)=>{
    const n=index+1;
    const key=id(secret?.key);
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(key) || keys.has(key))
      throw Error("Private secret #"+n+" needs a unique stable key.");
    keys.add(key);
    if (!id(secret?.name) || !id(secret?.description) ||
        !ALLOWED_TIERS.has(secret.tier) || !ALLOWED_METRICS.has(secret.metric) ||
        typeof secret.activeOnly!=="boolean")
      throw Error("Private secret #"+n+" has incomplete owner-authored metadata.");
    const usesPetIds=Object.prototype.hasOwnProperty.call(secret,"petIds");
    const usesDefinitionIds=Object.prototype.hasOwnProperty.call(secret,"definitionIds");
    if (usesPetIds===usesDefinitionIds)
      throw Error("Private secret #"+n+" must use petIds OR definitionIds, not both.");
    const values=usesPetIds?secret.petIds:secret.definitionIds;
    if (!Array.isArray(values)||!values.length || values.some(v=>!id(v)) ||
        new Set(values.map(id)).size!==values.length)
      throw Error("Private secret #"+n+" must list distinct, nonempty release pets.");
    const matches=values.map(value=>usesPetIds?byPet.get(id(value)):byId.get(id(value)));
    if (matches.some(match=>!match))
      throw Error("Private secret #"+n+" references pet(s) absent from the approved, enabled release roster.");
    return {
      key,name:id(secret.name),description:id(secret.description),
      tier:secret.tier,metric:secret.metric,
      definitionIds:matches.map(x=>id(x._id)),activeOnly:secret.activeOnly,
    };
  });
  return {releaseId:config.releaseId,secrets};
}
