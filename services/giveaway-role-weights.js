import {randomInt} from "node:crypto";

// A single eligible member occupies one place in the pool. Roles increase
// drawing *weight*, not qualifying entries, and winners are unique.
export function normalizeRoleBonuses(bonuses=[]) {
  const seen=new Set();
  const result=[];
  for(const bonus of bonuses||[]) {
    const roleId=String(bonus.roleId||"");
    const extraEntries=Number(bonus.extraEntries);
    if(!/^\d{17,20}$/.test(roleId) || !Number.isSafeInteger(extraEntries) ||
       extraEntries<1 || extraEntries>20 || seen.has(roleId))
      throw Error("Each bonus requires a unique Discord role and 1–20 extra chances.");
    if(result.length>=20)throw Error("Set at most 20 bonus roles per giveaway.");
    result.push({roleId,extraEntries});
    seen.add(roleId);
  }
  return result;
}
export function weightForMember(member,bonuses=[]) {
  const roles=member?.roles?.cache;
  const has=roleId=>Boolean(roles?.has?.(roleId) || Array.isArray(member?.roles) && member.roles.includes(roleId));
  return 1+normalizeRoleBonuses(bonuses).reduce((total,bonus)=>
    total+(has(bonus.roleId)?bonus.extraEntries:0),0);
}
export function weightEntriesForMembers(members,bonuses=[]) {
  const ids=new Set();
  return members.filter(m=>m?.id && !m.user?.bot && !ids.has(m.id) && ids.add(m.id))
    .map(m=>({userId:m.id,weight:weightForMember(m,bonuses)}));
}
export function pickWeightedUnique(entrantIds,amount,entryWeights=[],excluded=[]) {
  if(!Number.isInteger(amount)||amount<0||amount>10)throw Error("Invalid number of winners.");
  const banned=new Set(excluded);
  const map=new Map((entryWeights||[]).map(item=>[String(item.userId),Number(item.weight)]));
  const ids=[...new Set(entrantIds)].filter(id=>!banned.has(id));
  const choices=ids.map(userId=>({userId,weight:map.get(userId)??1})).filter(x=>x.weight>=1);
  if(choices.some(x=>!Number.isSafeInteger(x.weight)||x.weight>401))
    throw Error("Invalid giveaway weight.");
  const selected=[];
  while(choices.length && selected.length<amount) {
    const total=choices.reduce((sum,x)=>sum+x.weight,0);
    let pick=randomInt(total);
    let index=0;
    for(;index<choices.length-1;index++){
      if(pick<choices[index].weight)break;
      pick-=choices[index].weight;
    }
    selected.push(choices[index].userId);
    choices.splice(index,1);
  }
  return selected;
}
