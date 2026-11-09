import {activityRoster} from "./guided-activity.js";
import { randomInt } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import Giveaway from "../models/Giveaway.js";
import {ensureGiveawayStaffRecord} from "./giveaway-staff-records.js";
import { attachGiveawayBanner,getGiveawayBanner } from "./giveaway-banners.js";
import {pickWeightedUnique,weightEntriesForMembers} from "./giveaway-role-weights.js";
import {qualifyingActivity,qualifyingWatchActivity,countActivityParticipants} from "./giveaway-activity-counter.js";
import { prizeClaimLines, winnerClaimDeadline, winnerHasClaim, nextClaimCheckAt, hasOutstandingTicketClaims, giveawayHasNoEligibleWinner, automaticRerollLimit, automaticRerollsUsed } from "./giveaway-claims.js";
import { MAX_TRIAL_ENTRANTS, survivalAnnouncement, publishSurvivalAnnouncement } from "./survival-giveaways.js";

// Six calendar months (rather than a fixed 180 days) varies with the start date.
export const GIVEAWAY_MAX_MINUTES = 60 * 24 * 184;
export function sixCalendarMonthsAfter(value=new Date()){
  const start=new Date(value);
  if(!Number.isFinite(start.getTime()))throw Error("Invalid giveaway start date.");
  const monthIndex=start.getUTCFullYear()*12+start.getUTCMonth()+6;
  const year=Math.floor(monthIndex/12),month=monthIndex%12;
  const lastDay=new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return new Date(Date.UTC(year,month,Math.min(start.getUTCDate(),lastDay),
    start.getUTCHours(),start.getUTCMinutes(),
    start.getUTCSeconds(),start.getUTCMilliseconds()));
}
export function maxRegularGiveawayMinutes(start=new Date()){
  const from=new Date(start);
  return Math.min(GIVEAWAY_MAX_MINUTES,
    Math.floor((sixCalendarMonthsAfter(from)-from)/60000));
}

export const GIVEAWAY_MAX_WINNERS = 10;

export function chooseGiveawayWinners(entrantIds, count, excluded = []) {
  if (!Number.isInteger(count) || count < 0 || count > GIVEAWAY_MAX_WINNERS) throw Error("Invalid number of winners.");
  const excludedIds = new Set(excluded);
  const candidates = [...new Set(entrantIds)].filter(id => !excludedIds.has(id));
  for (let i = 0; i < Math.min(count, candidates.length); i += 1) {
    const j = i + randomInt(candidates.length - i);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, count);
}

export function giveawayAnnouncement(record) {
  if (record.mode === "survival") return survivalAnnouncement(record);
  const ended = record.status === "ended" || record.status === "rerolling";
  const finishing = record.status === "closing";
  const endUnix = Math.floor(new Date(record.endsAt).getTime() / 1000);
  const noEligibleWinner=giveawayHasNoEligibleWinner(record);
  const activeWinners=(record.winnerIds||[]).filter((id,i)=>
    id && !(record.claimResolvedSlots||[]).includes(i));
  const winners = (record.winnerIds || []).map((id, i) => (record.claimResolvedSlots || []).includes(i)
    ? `${i + 1}. **No eligible winner** — <@${id}> did not claim; no replacement available`
    : `${i + 1}. <@${id}>`);
  const changed = (record.rerollHistory || []).slice(-8).map(item =>
    `#${item.slot + 1}: <@${item.previousId}> → <@${item.replacementId}>`);
  const activity = record.mode === "activity";
  const foxStory = activity ? (ended ? "🥀 Activity giveaway concluded." : "🥀 Activity entries are locked; no manual entry.") : ended
    ? noEligibleWinner
      ? ((record.winnerIds||[]).length
        ? `🦊 **The fox sighs:** "No one could claim this prize, so it stays tucked away for another day."`
        : `🦊 **The fox sighs:** "No accomplice showed up, so the prize stays tucked away for another day."`)
      : activeWinners.length === 1
        ? `🦊 **The fox cackles:** "My sneaky helper <@${activeWinners[0]}> distracted <@${record.creatorId}> while I swiped the prize straight from their pocket! What a marvelous heist!"`
      : activeWinners.length > 1
        ? `🦊 **The fox cackles:** "My clever helpers pulled off the great pocket heist! We snatched the prizes right out of <@${record.creatorId}>'s pocket. Not a whisker out of place!"`
        : `🦊 **The fox sighs:** "No accomplice showed up, so the prize stays tucked in <@${record.creatorId}>'s pocket. Foiled again!"`
    : `🦊 **The fox whispers:** "Psst! I spotted something shiny in <@${record.creatorId}>'s pocket. Enter below and you might be the accomplice I need to swipe the prize!"`;
  const lines = [
    `**${String(record.title||"Giveaway").replace(/[\r\n]+/g," ").slice(0,180)}**`,"",
    foxStory,
    "",
    record.prize.slice(0, 1800),
    ...(record.description ? ["", "**Giveaway Details:**", String(record.description).slice(0,1000)] : []),
    "",
    `**Hosted by:** <@${record.creatorId}>`,
    ended ? `**Final entries:** ${record.entrantIds?.length || 0} · **Eligible winners:** ${activeWinners.length}` : activity ? `**Locked entries:** ${record.entrantIds?.length || 0} · **Winners:** ${record.winnerCount}` : `**Winners:** ${record.winnerCount} · Tap **Entry Count** for the live total`,
    ended
      ? `**Ended:** <t:${endUnix}:F>`
      : finishing ? "**Selecting winners…**" : `**Ends:** <t:${endUnix}:F> (<t:${endUnix}:R>)`,
    ...(!ended&&record.requiredRoleId ? [`**Required to enter:** <@&${record.requiredRoleId}>`,
      ...(record.showRequiredRoleInstructions!==false&&record.requiredRoleInstructions?
        [`**How to get the role:** ${String(record.requiredRoleInstructions).slice(0,500)}`]:[])] : []),
    ...(!ended&&record.roleBonuses?.length?["**Bonus drawing chances:** "+record.roleBonuses.map(b=>`<@&${b.roleId}> +${b.extraEntries}`).join(" · ")]:[]),
    ...(!ended ? prizeClaimLines(record) : []),
    ...(record.rules ? ["", "**Rules / Requirements:**", record.rules.slice(0, 1300)] : []),
  ];
  if (ended) {
    if(noEligibleWinner)
      lines.push("", "🏁 **Final outcome: No eligible winner.**",
        (record.winnerIds||[]).length
          ? "*The claim deadline passed and no eligible replacement was available.*"
          : "*Nobody entered or qualified for this giveaway.*");
    lines.push("", "**Winners / Results**", ...(winners.length ? winners : ["**No eligible winner** — no eligible entries."]));
    if (record.mode !== "survival" && (record.winnerIds || []).length) {
      lines.push("", "**Winner ticket claims**");
      for (let slot=0;slot<record.winnerIds.length;slot++) {
        const userId=record.winnerIds[slot];
        const claim=(record.winnerClaims || []).find(c=>c.slot===slot && c.userId===userId);
        const deadline=winnerClaimDeadline(record,slot);
        if (claim) {
          lines.push(`#${slot+1} <@${userId}> — **Claim submitted successfully**`);
        } else if ((record.claimResolvedSlots || []).includes(slot))
          lines.push(`#${slot+1} — **No eligible winner** · <@${userId}> forfeited their claim; no replacement available.`);
        else lines.push(`#${slot+1} <@${userId}> — **Awaiting ticket claim**${deadline ? ` · Due <t:${Math.floor(deadline.getTime()/1000)}:R>` : ""}`);
      }
    }
    const claims = prizeClaimLines(record, { finished: true });
    if (claims.length) lines.push("", "**Claiming your prize:** Follow the instructions below and use the claim button before the deadline.");
    if(record.mode==="activity" && !record.winnerIds?.length)
      lines.push("", "**Outcome:** No qualifying members won this drawing.");
    if (changed.length) lines.push("", "**Reroll history**", ...changed);
    lines.push("", "*Prize delivery is handled by the giveaway host.*");
  }
  const description = lines.join("\n").slice(0, 4000);
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x86738d : 0xb47e99)
    .setTitle(ended ? (noEligibleWinner ? "🦊 Giveaway Ended · No Eligible Winner" : "🦊 Heist Complete") : "🦊 The Fox’s Giveaway")
    .setDescription(description)
    .setFooter({ text: `Giveaway ID: ${record._id} · This announcement is kept after the giveaway ends` });
  if(ended && record.status==="ended" && (record.winnerIds||[]).length){
    const instructions=prizeClaimLines(record,{finished:true});
    for(const [index,line] of instructions.entries()){
      const headings=["Claim deadline","Prize collection instructions","Required ticket submission","⚠️ Forfeit deadline"];
      // Keep mandatory details outside the 4,000-character embed description.
      embed.addFields({name:headings[index]||"Claim information",
        value:String(line).slice(0,1024),inline:false});
    }

  }
  const components = ended && record.status === "ended" && record.mode !== "survival" && hasOutstandingTicketClaims(record)
    ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`giveaway:claim:${record._id}`).setLabel("Enter Ticket Claim info").setStyle(ButtonStyle.Primary),
      )]
    : (!activity && !ended && !finishing && record.status === "open")
    ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`giveaway:enter:${record._id}`).setLabel("Enter Giveaway").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`giveaway:leave:${record._id}`).setLabel("Leave").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`giveaway:count:${record._id}`).setLabel("Entry Count").setStyle(ButtonStyle.Secondary),
      )]
    : [];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

// Changing the default banner also refreshes current button-entry giveaways.
export async function refreshActiveStandardGiveawayBanners(client,guildId) {
  const posts=await Giveaway.find({guildId,mode:"standard",status:"open",
    bannerNameKey:"",messageId:{$type:"string",$ne:""}}).limit(100).lean();
  let refreshed=0;
  for(const post of posts){
    try {
      const channel=await client.channels.fetch(post.channelId);
      const message=await channel?.messages?.fetch(post.messageId);
      if(message?.author?.id!==client.user.id)continue;
      await message.edit(await giveawayAnnouncementWithBanner(post));
      refreshed++;
    }catch(error){console.error("[Giveaways] Default banner refresh failed:",String(post._id),error);}
  }
  return refreshed;
}
export async function giveawayAnnouncementWithBanner(record) {
  const announcement=giveawayAnnouncement(record);
  // Trial art is independent from the regular giveaway default banner.
  const banner=record.mode==="survival" && !record.bannerNameKey ? null :
    await getGiveawayBanner(record.guildId,record.bannerNameKey);
  return attachGiveawayBanner(announcement,banner);
}

export async function joinGiveaway({ id, guildId, userId, mode = "standard", now = new Date() }) {
  const updated = await Giveaway.updateOne({
    _id: id, guildId, status: "open", endsAt: { $gt: now },
    ...(mode === "survival" ? { mode: "survival", [`entrantIds.${MAX_TRIAL_ENTRANTS - 1}`]: { $exists: false } } : { mode: "standard" }),
  }, { $addToSet: { entrantIds: userId } });
  if (updated.modifiedCount) return "joined";
  const current = await Giveaway.findOne({ _id: id, guildId })
    .select("status endsAt entrantIds").lean();
  if (!current || current.status !== "open" || new Date(current.endsAt) <= now) return "ended";
  if (current.entrantIds?.includes(userId)) return "already";
  if (mode === "survival" && current.entrantIds?.length >= MAX_TRIAL_ENTRANTS) return "full";
  return "unavailable";
}

export async function leaveGiveaway({ id, guildId, userId, now = new Date() }) {
  const changed = await Giveaway.updateOne({
    _id: id, guildId, status: "open", endsAt: { $gt: now },
    mode: { $ne: "activity" }, entrantIds: userId,
  }, { $pull: { entrantIds: userId } });
  if (changed.modifiedCount) return "left";
  const current = await Giveaway.findOne({ _id: id, guildId })
    .select("status endsAt entrantIds").lean();
  if (!current || current.status !== "open" || new Date(current.endsAt) <= now) return "ended";
  return current.entrantIds?.includes(userId) ? "unavailable" : "not-entered";
}

async function verifyServerMembers(client,guildId,ids,{includeMembers=false}={}) {
  const guild=await client.guilds.fetch(guildId);
  const verified=[];
  for(const id of [...new Set(ids)]) {
    try {
      const member=await guild.members.fetch({user:id,force:true});
      if(member && !member.user?.bot)verified.push(includeMembers?{id:member.id||id,user:member.user,roles:member.roles}:id);
    }catch(error){
      if(error.code!==10007)throw error;
    }
  }
  return verified;
}

export async function closeGiveaway({ id, guildId, now = new Date(), client = null }) {
  let item = await Giveaway.findOneAndUpdate(
    { _id: id, guildId, mode: { $ne: "survival" }, status: "open" },
    { $set: { status: "closing" } },
    { returnDocument: "after" },
  ).lean();
  if (!item) item = await Giveaway.findOne({ _id: id, guildId }).lean();
  if (!item || item.mode === "survival" || !["closing", "ended"].includes(item.status)) return item;
  if (item.status === "ended") return item;
  let eligible = item.entrantIds || [];
  if (item.mode==="activity" && !client) throw Error("Discord client required to verify activity entrants.");
  let entries=[];
  if(client){
    const members=await verifyServerMembers(client,item.guildId,eligible,{includeMembers:true});
    const permitted=members.filter(m=>!item.requiredRoleId||m.roles?.cache?.has(item.requiredRoleId));
    eligible=permitted.map(m=>m.id);
    entries=weightEntriesForMembers(permitted,item.roleBonuses);
  }
  const winnerIds=client||item.roleBonuses?.length
    ?pickWeightedUnique(eligible,item.winnerCount,entries)
    :chooseGiveawayWinners(eligible,item.winnerCount);
  const changed = await Giveaway.findOneAndUpdate(
    { _id: id, guildId, status: "closing" },
    { $set: { status: "ended", winnerIds, activityVerifiedIds:eligible,entryWeights:entries,
      claimStartedAt:now,winnerAssignedAt:winnerIds.map(()=>now),
      claimCheckAt:nextClaimCheckAt({...item,status:"ended",winnerIds,claimStartedAt:now,winnerAssignedAt:winnerIds.map(()=>now)}),
      renderedAt:null }, $inc: { renderVersion: 1 } },
    { returnDocument: "after" },
  ).lean();
  return changed || Giveaway.findOne({ _id: id, guildId }).lean();
}

export async function rerollGiveaway({ id, guildId, staffId, slot, reason = "staff", now = new Date(), client = null }) {
  const item = await Giveaway.findOne({ _id: id, guildId, status: "ended" }).lean();
  if (!item) throw Error("That giveaway is not finished or does not exist.");
  if(item.publicListingRemovedAt) throw Error("This completed giveaway listing has already been deleted and cannot be rerolled.");
  if (!Number.isInteger(slot) || slot < 0 || slot >= item.winnerIds.length)
    throw Error("Choose an existing winner number to reroll.");
  if (reason==="claim-expired") {
    const deadline=winnerClaimDeadline(item,slot);
    if (!item.autoRerollClaims || !deadline || deadline>now || winnerHasClaim(item,slot) ||
        (item.claimResolvedSlots||[]).includes(slot))
      throw Error("A ticket was filed or this place is not eligible for an automatic reroll.");
    if(automaticRerollsUsed(item,slot)>=automaticRerollLimit(item))
      throw Error("The maximum automatic rerolls for this winning place have already been used.");
  }
  const used = [...item.winnerIds, ...(item.rerollHistory || []).flatMap(x => [x.previousId, x.replacementId])];
  const pool=(item.activityVerifiedIds?.length ? item.activityVerifiedIds : item.entrantIds || [])
    .filter(id=>!used.includes(id));
  const members=client?await verifyServerMembers(client,item.guildId,pool,{includeMembers:true}):null;
  const verified=members?members.filter(m=>!item.requiredRoleId||m.roles?.cache?.has(item.requiredRoleId)).map(m=>m.id):
    [...new Set(pool)];
  if (!verified.length) throw Error("There are no unused current server members left for a reroll.");
  const reserved = await Giveaway.findOneAndUpdate(
    { _id: id, guildId, status: "ended",
      ...(reason==="claim-expired" ? {winnerClaims:{$not:{$elemMatch:{slot,userId:item.winnerIds[slot]}}},claimResolvedSlots:{$ne:slot}} : {}) },
    { $set: { status: "rerolling", pendingRerollSlot: slot, pendingRerollStaffId: staffId,
      pendingRerollReason:reason,pendingRerollAt:now,pendingRerollEligibleIds:verified,renderedAt:null } },
    { returnDocument: "after" },
  ).lean();
  if (!reserved) throw Error("Another staff member is updating this giveaway. Try again.");
  return finishPendingReroll(reserved);
}

export async function finishPendingReroll(item) {
  if (item.status !== "rerolling") return item;
  const slot = item.pendingRerollSlot;
  if (!Number.isInteger(slot) || slot < 0 || slot >= item.winnerIds.length)
    throw Error("Giveaway reroll state requires staff repair.");
  const used = [...item.winnerIds, ...(item.rerollHistory || []).flatMap(x => [x.previousId, x.replacementId])];
  const eligible=item.pendingRerollEligibleIds?.length ? item.pendingRerollEligibleIds :
    (item.activityVerifiedIds?.length ? item.activityVerifiedIds : item.entrantIds||[]);
  const replacementId=pickWeightedUnique(eligible,1,item.entryWeights,used)[0];
  if (!replacementId) throw Error("No unused entrants remain.");
  const previousId = item.winnerIds[slot];
  const winnerIds = [...item.winnerIds];
  winnerIds[slot] = replacementId;
  const winnerAssignedAt=[...(item.winnerAssignedAt || [])];
  winnerAssignedAt[slot]=item.pendingRerollAt || new Date();
  const reissued={...item,status:"ended",winnerIds,winnerAssignedAt};
  const changed = await Giveaway.findOneAndUpdate({
    _id: item._id, status: "rerolling", pendingRerollSlot: slot,
  }, {
    $set: { winnerIds,winnerAssignedAt, status:"ended", pendingRerollSlot:null, pendingRerollStaffId:"",
      pendingRerollReason:"",pendingRerollAt:null,pendingRerollEligibleIds:[],claimCheckAt:nextClaimCheckAt(reissued),renderedAt:null },
    $push: { rerollHistory: { slot,previousId,replacementId,staffId:item.pendingRerollStaffId,
      reason:item.pendingRerollReason||"staff",at:item.pendingRerollAt||new Date() } },
    // A replacement receives its own claim window. Do not carry forward a
    // previous winner's exhausted/no-candidates flag to this prize place.
    $pull: { claimResolvedSlots: slot },
    $inc: { renderVersion: 1 },
  }, { returnDocument: "after" }).lean();
  return changed || Giveaway.findById(item._id).lean();
}

export async function publishGiveawayResult(client, item) {
  if(item && !["draft","publishing","failed"].includes(item.status)){
    try{await ensureGiveawayStaffRecord(client,item);}
    catch(error){console.error("[Giveaways] Private staff update failed:",item._id,error);}
  }
  if(item?.publicListingRemovedAt)return false; // Never republish a completed deleted listing.
  if(item?.mode==="activity" && item.status==="ended" && !item.winnerIds?.length &&
     item.announceEmptyResults===false){
    await Giveaway.updateOne({_id:item._id,status:"ended",renderVersion:item.renderVersion},
      {$set:{renderedAt:new Date()}});
    return true;
  }
  if (item?.mode === "survival") {
    if (!item?.messageId || !["ended", "cancelled", "running"].includes(item.status)) return false;
    await publishSurvivalAnnouncement(client, item);
    return true;
  }
  if (item?.mode === "activity" && item.status === "ended") {
    const channel = await client.channels.fetch(item.channelId);
    if (!channel?.messages?.fetch || !channel.send) throw Error("Activity announcement channel is unavailable.");
    let message = item.messageId ? await channel.messages.fetch(item.messageId).catch(e => {
      if (e.code === 10008) return null;
      throw e;
    }) : null;
    if (!message) {
      const recent = await channel.messages.fetch({limit:100});
      message = recent.find(m => m.author?.id === client.user?.id &&
        m.embeds?.some(e => e.footer?.text?.includes(`Giveaway ID: ${item._id}`)));
    }
    if (!message) message = await channel.send(await giveawayAnnouncementWithBanner(item));
    else {
      if (message.author?.id !== client.user?.id) throw Error("Activity announcement does not belong to the bot.");
      await message.edit(await giveawayAnnouncementWithBanner(item));
    }
    await Giveaway.updateOne({_id:item._id,status:"ended",renderVersion:item.renderVersion},
      {$set:{messageId:message.id,renderedAt:new Date()}});
    return true;
  }
  if (!item?.messageId || !["ended", "open"].includes(item.status)) return false;
  const channel = await client.channels.fetch(item.channelId);
  if (!channel?.messages?.fetch) throw Error("Giveaway channel is inaccessible.");
  const message = await channel.messages.fetch(item.messageId);
  if (message.author?.id !== client.user?.id) throw Error("Giveaway message is not authored by this bot.");
  await message.edit(await giveawayAnnouncementWithBanner(item));
  if (item.status === "ended") {
    await Giveaway.updateOne(
      { _id: item._id, status: "ended", renderVersion: item.renderVersion },
      { $set: { renderedAt: new Date() } },
    );
  }
  return true;
}

async function refreshCustomOneOffEntries(record,now){
  if(record.guidedSeries){
    const roster=await activityRoster(record);
    const entrantIds=roster.filter(row=>row.qualified).map(row=>row._id);
    return await Giveaway.findOneAndUpdate({_id:record._id,status:"open"},
      {$set:{entrantIds,activityCheckedAt:now,activityCandidateCount:roster.length}},
      {returnDocument:"after"}).lean() || record;
  }
  if(record.mode!=="activity"||record.scheduleId||
     !record.customActivityStartAt||!record.customActivityEndAt)return record;
  const window={startAt:record.customActivityStartAt,endAt:record.customActivityEndAt};
  if(new Date(window.endAt)>now)throw Error("Activity collection has not reached its cutoff.");
  const rule=record.activityRuleId?{
    _id:record.activityRuleId,criteriaVersion:record.activityRuleCriteriaVersion||0,
    channelId:record.activityChannelIds?.[0],minimumChars:record.activityMinChars,
    minimumMessages:record.activityMinimum,activeDays:record.activityDays,
    requiredMentionUserId:record.activityRequiredMentionUserId,
    requiredPhrase:record.activityRequiredPhrase,
  }:null;
  const options={guildId:record.guildId,
    minimum:record.activityMinimum,days:record.activityDays,
    minimumChars:record.activityMinChars,minimumTotalMessages:record.activityMinTotalMessages,
    ...window};
  const entrants=rule?await qualifyingWatchActivity({...options,rule}):
    await qualifyingActivity({...options,type:record.activityType,
      channelIds:record.activityChannelIds||[]});
  const distinct=[...new Set(entrants)];
  const candidateCount=record.requireStaffReview?
    await countActivityParticipants({
      guildId:record.guildId,type:record.activityType,
      channelIds:record.activityChannelIds||[],...window,
    }):record.activityCandidateCount||0;
  const changed=await Giveaway.findOneAndUpdate({_id:record._id,status:"open"},
    {$set:{entrantIds:distinct,activityCheckedAt:now,activityCandidateCount:candidateCount}},
    {returnDocument:"after"}).lean();
  return changed||record;
}
async function stageOneOffForReview(record,now){
  return Giveaway.findOneAndUpdate({_id:record._id,status:"open",mode:"activity"},
    {$set:{status:"pending_review",activityCheckedAt:now}},
    {returnDocument:"after"}).lean();
}
export async function reconcileGiveaways(client, { now = new Date(), limit = 30 } = {}) {
  const pending = await Giveaway.find({
    $or: [
      { status: "open", mode: { $ne: "survival" }, endsAt: { $lte: now } },
      { status: "closing" },
      { status: "rerolling" },
      { status: "ended", renderedAt: null },
      { status: "cancelled", mode: "survival", renderedAt: null },
      { status: "running", mode: "survival", renderedAt: null },
    ],
  }).sort({ endsAt: 1 }).limit(limit).lean();
  for (const candidate of pending) {
    try {
      let latest = candidate;
      if (candidate.status === "rerolling") latest = await finishPendingReroll(candidate);
      if(candidate.status==="open"&&candidate.mode==="activity"){
        latest=await refreshCustomOneOffEntries(candidate,now);
        if(latest.requireStaffReview){
          latest=await stageOneOffForReview(latest,now);
          continue; // Staff channel sweep posts an approval preview, not results.
        }
      }
      if (candidate.status === "open" || candidate.status === "closing")
        latest = await closeGiveaway({ id: candidate._id, guildId: candidate.guildId, now, client });
      if (["ended", "cancelled", "running"].includes(latest?.status) && !latest.renderedAt)
        await publishGiveawayResult(client, latest);
    } catch (error) {
      console.error("[Giveaways] Reconciliation failed for", String(candidate._id), error);
    }
  }
  return pending.length;
}
