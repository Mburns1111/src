import test from "node:test";
import assert from "node:assert/strict";
import {normalizeRoleBonuses,weightForMember,weightEntriesForMembers,pickWeightedUnique}
 from "../services/giveaway-role-weights.js";
import {data as roleCommand} from "../commands/giveaway-role-bonuses.js";

const A="123456789012345678",B="234567890123456789",C="345678901234567890";
const vip="456789012345678901",donor="567890123456789012";
test("staff can configure several roles separately with an explicit extra-chances amount",()=>{
 const cmd=roleCommand.toJSON();
 assert.equal(cmd.name,"giveaway-role");
 assert.deepEqual(cmd.options.map(x=>x.name),["bonus-add","bonus-remove","bonus-list"]);
 assert.ok(cmd.options[0].options.some(x=>x.name==="extra"));
 const targets=cmd.options[0].options.find(x=>x.name==="target").choices.map(x=>x.value);
 assert.deepEqual(targets,["watch","plan","event"]);
 assert.throws(()=>normalizeRoleBonuses([{roleId:vip,extraEntries:0}]),/1–20/);
 assert.throws(()=>normalizeRoleBonuses([{roleId:vip,extraEntries:2},{roleId:vip,extraEntries:3}]),/unique/);
});
test("messages and mentions do not create multiple entries, while roles stack drawing weights",()=>{
 const roleBonuses=[{roleId:vip,extraEntries:2},{roleId:donor,extraEntries:3}];
 const member={id:A,user:{bot:false},roles:{cache:new Map([[vip,{}],[donor,{}]])}};
 assert.equal(weightForMember(member,roleBonuses),6);
 assert.equal(weightForMember({id:B,roles:{cache:new Map()}},roleBonuses),1);
 const entries=weightEntriesForMembers([member,member,
   {id:B,roles:{cache:new Map()}}, {id:C,user:{bot:true},roles:{cache:new Map()}}],roleBonuses);
 assert.deepEqual(entries.map(e=>e.userId),[A,B]);
 assert.deepEqual(entries.map(e=>e.weight),[6,1]);
 assert.deepEqual(pickWeightedUnique([A,A,B],2,entries).sort(),[A,B].sort());
 assert.deepEqual(pickWeightedUnique([A,A],3,entries),[A]);
 assert.deepEqual(pickWeightedUnique([A,B],1,entries,[A]),[B]);
});
test("role bonuses shift selection probability without letting a member win twice",()=>{
 const entries=[{userId:A,weight:21},{userId:B,weight:1}];
 let a=0;
 for(let i=0;i<300;i++)if(pickWeightedUnique([A,B],1,entries)[0]===A)a++;
 assert.ok(a>225);
});
