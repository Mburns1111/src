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


/**
 * Read-only comparison of the owner-approved PRIVATE file to the release
 * already frozen in MongoDB. Never expose solutions, keys, design IDs or
 * names in results. This does not validate launch date or reviewed values.
 */
export function verifyFrozenReleaseSecrets({release, definitions, config}) {
  const compiled=compilePrivateReleaseSecrets(config,definitions);
  const approved=(definitions||[]).filter(d=>
    d.releaseId===config.releaseId && d.enabled &&
    d.artStatus==="approved" && Number(d.hatchWeight)>0);
  const expectedIds=new Set(approved.map(d=>id(d._id)));
  const frozenIds=(release?.achievementRoster||[]).map(id);
  const stored=release?.achievementSecrets||[];
  const rosterMatchesApproved=release?.releaseId===config.releaseId &&
    release?.status==="draft" && approved.length===definitions.length &&
    (config.releaseId!=="s1-r1" || approved.length===108) &&
    expectedIds.size===approved.length &&
    frozenIds.length===approved.length &&
    new Set(frozenIds).size===frozenIds.length &&
    frozenIds.every(value=>expectedIds.has(value));
  // Slot order determines the anonymous Secret 01/02 display, so compare it.
  // Definition ID order within one slot is immaterial to unlock conditions.
  const sameSecret=(a,b)=>Boolean(a&&b&&
    ["key","name","description","tier","metric"].every(field=>id(a[field])===id(b[field])) &&
    a.activeOnly===b.activeOnly &&
    Array.isArray(a.definitionIds) && Array.isArray(b.definitionIds) &&
    a.definitionIds.length===b.definitionIds.length &&
    new Set(a.definitionIds.map(id)).size===a.definitionIds.length &&
    [...a.definitionIds].map(id).sort().every((v,i)=>v===[...b.definitionIds].map(id).sort()[i]));
  const secretsMatch=Array.isArray(stored) &&
    stored.length===compiled.secrets.length &&
    stored.every((s,i)=>sameSecret(s,compiled.secrets[i]));
  const mismatches=[];
  if(!rosterMatchesApproved)mismatches.push("Frozen roster differs from current approved release cards.");
  if(!secretsMatch)mismatches.push("Frozen secret definitions differ from the private configuration.");
  return {
    releaseId:config.releaseId,
    mode:"VERIFY ONLY",
    privateSecretsInFile:compiled.secrets.length,
    privateSecretsInDatabase:stored.length,
    frozenRosterCards:frozenIds.length,
    approvedRosterCards:approved.length,
    rosterMatchesApproved,
    secretsMatchPrivateFile:secretsMatch,
    verified:mismatches.length===0,
    mismatches,changesMade:false,releaseRemainsDraft:release?.status==="draft",
  };
}
