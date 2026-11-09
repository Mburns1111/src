import test from "node:test";
import assert from "node:assert/strict";
import {PermissionFlagsBits} from "discord.js";
import {memberCanManageGiveaways,canManageGiveaways} from "../services/giveaway-manager-permissions.js";
import {data as giveawayCommand,trialData as trialCommand} from "../commands/giveaway.js";
import {data as roleCommand} from "../commands/giveaway-role-bonuses.js";
import {data as setupCommand} from "../commands/setup.js";
import GuildConfig from "../models/GuildConfig.js";

const guildId="123456789012345678";
const managerId="234567890123456789";
const otherRole="345678901234567890";
const userId="456789012345678901";
const config={giveawayManagerRoleId:managerId};
const permissions=has=>({has:perm=>has&&perm===PermissionFlagsBits.ManageGuild});
const member=(roles,canAdmin=false)=>({
  guildId,user:{id:userId},member:{roles},
  memberPermissions:permissions(canAdmin),
});
const mockConfig=async action=>{
 const old=GuildConfig.findOne;
 GuildConfig.findOne=()=>({select:()=>({lean:async()=>config})});
 try{return await action();}
 finally{GuildConfig.findOne=old;}
};

test("manager-role membership allows giveaway management even without Manage Server",async()=>{
 const roles=[otherRole,managerId];
 const interaction=member(roles);
 assert.equal(memberCanManageGiveaways(interaction,config),true);
 assert.equal(await mockConfig(()=>canManageGiveaways(interaction)),true);
 assert.equal(memberCanManageGiveaways(member([otherRole]),config),false);
 assert.equal(await mockConfig(()=>canManageGiveaways(member([otherRole]))),false);
});

test("Manage Server remains authorized even when no Giveaway Manager role is selected",async()=>{
 assert.equal(memberCanManageGiveaways(member([],true),{}),true);
 assert.equal(await canManageGiveaways(member([],true)),true);
 assert.equal(memberCanManageGiveaways(member([managerId]),{}),false);
 assert.equal(memberCanManageGiveaways(member([managerId]),{giveawayManagerRoleId:""}),false);
});

test("cached GuildMember role lookup and role-ID array lookup both work",()=>{
 assert.equal(memberCanManageGiveaways(member({cache:new Map([[managerId,true]])}),config),true);
 assert.equal(memberCanManageGiveaways(member({cache:new Map([[otherRole,true]])}),config),false);
 assert.equal(memberCanManageGiveaways(member({has:id=>id===managerId}),config),true);
});

test("managers are denied across guilds whose config does not grant their role",()=>{
 const interaction=member([managerId]);
 assert.equal(memberCanManageGiveaways(interaction,{giveawayManagerRoleId:otherRole}),false);
 assert.equal(memberCanManageGiveaways(interaction,{giveawayManagerRoleId:""}),false);
 assert.equal(memberCanManageGiveaways({...interaction,guildId:null},config),false);
});

test("when interaction has no role collection, verify actual member membership",async()=>{
 const interaction={guildId,user:{id:userId},memberPermissions:permissions(false),
  guild:{members:{fetch:async()=>({roles:{cache:new Map([[managerId,true]])}})}}};
 assert.equal(await mockConfig(()=>canManageGiveaways(interaction)),true);
 const denied={...interaction,guild:{members:{fetch:async()=>({roles:{cache:new Map()}})}}};
 assert.equal(await mockConfig(()=>canManageGiveaways(denied)),false);
});

test("giveaway commands are registered for delegated staff but setup remains administrator-only",()=>{
 for(const cmd of [giveawayCommand,trialCommand,roleCommand]){
   assert.equal(cmd.toJSON().default_member_permissions,undefined,
     "Discord must not hide the delegated giveaway command from non-admin staff");
 }
 assert.equal(setupCommand.toJSON().default_member_permissions,
   String(PermissionFlagsBits.ManageGuild),"setup must remain Manage Server only");
});

test("without Manage Server or the saved role, manager permission is denied",async()=>{
 const interaction=member([otherRole]);
 assert.equal(await mockConfig(()=>canManageGiveaways(interaction)),false);
});
