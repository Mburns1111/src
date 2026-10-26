// Staff-only, offline, side-effect-free preview from existing reviewed evidence.
// NO MongoDB access, external requests, imports, card production, or rights approval.

export function buildPetCatalogPreview(matchedData, unmatchedData, curatedData, decisions, verificationReport) {
  const fail = message => { throw new Error("Pet catalogue preview: " + message); };
  const officialUrl = value => typeof value === "string" && /^https:\/\/www\.playadopt\.me\//.test(value);
  const matched = matchedData?.matched, onlyA = unmatchedData?.onlyAdoptmeValues, onlyB = unmatchedData?.onlyGamevaultFacts;
  const evidence = curatedData?.records, extras = decisions?.additionalOfficialPets, aliases = decisions?.canonicalAliases;
  const adjudications = decisions?.rarityAdjudications, pending = decisions?.identityConfirmedRarityPending;
  const rights = decisions?.rightsReview;
  if (![matched, onlyA, onlyB, evidence, extras, aliases, adjudications, pending].every(Array.isArray)) fail("invalid input collections");
  if (!rights || rights.approvedForDatabaseImport !== false || rights.approvedForArtworkUse !== false ||
      rights.requiresIndependentRightsClearance !== true) fail("rights gate must remain blocked");
  const totals = verificationReport?.totals;
  if (!totals || totals.bulkDataReuseCleared !== false || totals.matchedRaritiesSpotChecked + totals.rarityConflicts !== matched.length ||
      totals.unresolvedUnmatched !== 0 || totals.officialPetsMissingFromBothDatasets !== extras.length ||
      totals.canonicalAliasesDecided !== aliases.length || totals.additionalOfficialPetsStaged !== extras.length ||
      totals.officialRaritiesStillPendingOutsideMatchedSet !== pending.length ||
      totals.adjudicatedRarityDisagreements !== adjudications.length || totals.unresolvedRarityDisagreements !== 0) {
    fail("verification report is incomplete or not synchronized with exception decisions");
  }
  const index = (rows, key, description) => {
    const result = new Map();
    for (const row of rows) {
      const id = row?.[key];
      if (typeof id !== "string" || !id || result.has(id)) fail("missing or duplicate " + description + ": " + id);
      result.set(id, row);
    }
    return result;
  };
  const official = index(evidence, "petId", "official evidence");
  const aliasById = index(aliases, "aliasId", "alias");
  const adjudicatedById = index(adjudications, "petId", "rarity decision");
  const pendingById = index(pending, "petId", "pending rarity");
  const extrasById = index(extras, "petId", "additional pet");
  if (adjudications.length !== verificationReport.conflicting.length ||
      aliases.length !== verificationReport.aliases.length ||
      pending.length !== verificationReport.identityOnly.length) fail("exception groups must be fully accounted for");
  const groups = new Map();
  const allSourceIds = new Set();
  const sourceRows = [
    ...matched.map(x => ({ ...x, inputCategory: "matched" })),
    ...onlyA.map(x => ({ ...x, inputCategory: "only-adoptme-values" })),
    ...onlyB.map(x => ({ ...x, inputCategory: "only-gamevault" })),
    ...extras.map(x => ({ ...x, inputCategory: "additional-official" })),
  ];
  for (const source of sourceRows) {
    const sourceId = source.petId;
    if (!sourceId || allSourceIds.has(sourceId)) fail("duplicate source pet ID: " + sourceId);
    allSourceIds.add(sourceId);
    const evidenceRow = official.get(sourceId);
    if (!evidenceRow || !evidenceRow.sourceType?.startsWith("official-") ||
        !officialUrl(evidenceRow.sourceUrl) || !evidenceRow.name?.trim()) fail("missing official identity evidence for " + sourceId);
    const alias = aliasById.get(sourceId);
    const canonicalId = alias?.canonicalId || sourceId;
    if (!canonicalId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(canonicalId)) fail("invalid canonical ID for " + sourceId);
    if (alias && (alias.decision !== "canonical-identity-decided" ||
        alias.officialSourceUrl !== evidenceRow.sourceUrl || alias.rarity !== evidenceRow.rarity ||
        alias.canonicalName !== evidenceRow.name || alias.aliasId === alias.canonicalId)) {
      fail("invalid alias mapping for " + sourceId);
    }
    const decision = adjudicatedById.get(sourceId);
    if (decision && (source.inputCategory !== "matched" || decision.selectedRarity !== evidenceRow.rarity ||
        decision.officialRarity !== evidenceRow.rarity || source.rarity !== decision.originalRarity ||
        !decision.originalEvidenceRetained || !decision.sourceUrls.includes(evidenceRow.sourceUrl))) {
      fail("unreconciled rarity mismatch for " + sourceId);
    }
    if (source.inputCategory === "matched" && source.rarity !== evidenceRow.rarity && !decision) {
      fail("unadjudicated matched rarity mismatch for " + sourceId);
    }
    const pendingDecision = pendingById.get(sourceId);
    if (evidenceRow.rarity == null) {
      if (!pendingDecision || pendingDecision.officialRarity !== null ||
          pendingDecision.officialIdentitySourceUrl !== evidenceRow.sourceUrl) fail("missing pending rarity decision for " + sourceId);
    } else if (pendingDecision) fail("unexpected pending rarity for " + sourceId);
    const additional = extrasById.get(sourceId);
    if (additional && (source.inputCategory !== "additional-official" ||
        additional.rarity !== evidenceRow.rarity || additional.name !== evidenceRow.name ||
        additional.officialSourceUrl !== evidenceRow.sourceUrl ||
        additional.decision !== "verified-staged-for-later-catalogue-preview")) fail("invalid staged pet " + sourceId);
    let item = groups.get(canonicalId);
    if (item) {
      // The only permitted collision is a documented alias joining its canonical source record.
      const sourceIds = [ ...item.sourceRecordIds, sourceId ];
      if (!sourceIds.some(id => aliasById.get(id)?.canonicalId === canonicalId) ||
          item.name !== evidenceRow.name || item.officialRarity !== evidenceRow.rarity) {
        fail("unapproved canonical collision: " + canonicalId);
      }
    } else {
      item = {
        petId: canonicalId, name: evidenceRow.name,
        rarity: evidenceRow.rarity ?? "Unknown",
        officialRarity: evidenceRow.rarity ?? null,
        rarityEvidence: evidenceRow.rarity == null ? "official-identity-only" :
          decision ? "official-rarity-adjudicated" : "official-rarity-verified",
        reviewStatus: "pending", sourceRecordIds: [],
        inputCategories: [], aliasIds: [], flags: [],
        officialSourceUrls: [], verifiedOn: evidenceRow.verifiedOn,
        communityProvisionalRarity: null, historicalRarityConflict: null,
      };
      groups.set(canonicalId, item);
    }
    item.sourceRecordIds.push(sourceId);
    item.inputCategories.push(source.inputCategory);
    if (!item.officialSourceUrls.includes(evidenceRow.sourceUrl)) item.officialSourceUrls.push(evidenceRow.sourceUrl);
    if (alias) { item.aliasIds.push(sourceId); item.flags.push("canonical-alias"); }
    if (additional) item.flags.push("new-official-pet-staged");
    if (decision) {
      item.flags.push("historic-rarity-conflict-adjudicated");
      item.rarityEvidence = "official-rarity-adjudicated";
      item.historicalRarityConflict = { provisionalRarity: decision.originalRarity,
        officialRarity: decision.selectedRarity, historicalConflictRetained: true };
    }
    if (pendingDecision) {
      item.flags.push("official-rarity-pending");
      item.communityProvisionalRarity = pendingDecision.communityReportedRarity;
    }
  }
  if (allSourceIds.size !== evidence.length ||
      [...official.keys()].some(id => !allSourceIds.has(id))) fail("curated evidence and preview input IDs differ");
  for (const [aliasId, alias] of aliasById) {
    const target = groups.get(alias.canonicalId);
    if (!target || !target.aliasIds.includes(aliasId)) fail("unused alias " + aliasId);
  }
  if (adjudicatedById.size !== [...groups.values()].filter(x => x.historicalRarityConflict).length) fail("unused rarity decision");
  const pets = [...groups.values()].map(item => ({
    ...item,
    sourceRecordIds: item.sourceRecordIds.sort(),
    inputCategories: [...new Set(item.inputCategories)].sort(),
    aliasIds: item.aliasIds.sort(),
    flags: [...new Set(item.flags)].sort(),
    officialSourceUrls: item.officialSourceUrls.sort(),
  })).sort((a, b) => a.name.localeCompare(b.name, "en") || a.petId.localeCompare(b.petId, "en"));
  const petIds = new Set(pets.map(x => x.petId));
  if (petIds.size !== pets.length) fail("duplicate canonical pet ID");
  const normalizedNames = new Set();
  for (const pet of pets) {
    const normalized = pet.name.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    if (normalizedNames.has(normalized)) fail("duplicate canonical pet name: " + pet.name);
    normalizedNames.add(normalized);
  }
  const rarityCounts = Object.fromEntries(["Common","Uncommon","Rare","Ultra-Rare","Legendary","Unknown"].map(r => [r, pets.filter(x=>x.rarity===r).length]));
  const unknown = pets.filter(x=>x.officialRarity === null).length;
  if (unknown !== pending.length ||
      pets.filter(x=>x.flags.includes("new-official-pet-staged")).length !== extras.length) fail("preview status counts mismatch");
  return {
    schemaVersion: 1, generatedOn: decisions.reviewedOn,
    disclaimer: "INTERNAL STAFF DRY RUN ONLY. No legal/data-use clearance, staff approval, artwork license or MongoDB import.",
    summary: {
      originalMatched: matched.length, initiallyUnmatched: onlyA.length + onlyB.length,
      additionalOfficialPets: extras.length, inputEvidenceRecords: allSourceIds.size,
      canonicalPets: pets.length, duplicateSourceEntriesCollapsed: allSourceIds.size - pets.length,
      aliasesResolved: aliases.length, officialRarityConfirmed: pets.length - unknown,
      officialRarityPending: unknown, historicalDisagreementsAdjudicated: adjudications.length,
      reviewPending: pets.length, rightsClearedForImport: false, databaseWritesPerformed: false,
      rarityCounts,
    },
    pets,
  };
}

export function renderPetCatalogPreviewCsv(preview) {
  const fields = ["petId","name","rarity","rarityEvidence","reviewStatus","flags",
    "inputCategories","sourceRecordIds","aliasIds","officialSourceUrls","communityProvisionalRarity","historicProvisionalRarity"];
  const encode = value => {
    const str = String(value ?? "");
    return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [fields.join(",")];
  for (const pet of preview.pets) {
    const row = {
      ...pet, flags: pet.flags.join("; "), inputCategories: pet.inputCategories.join("; "),
      sourceRecordIds: pet.sourceRecordIds.join("; "), aliasIds: pet.aliasIds.join("; "),
      officialSourceUrls: pet.officialSourceUrls.join("; "),
      historicProvisionalRarity: pet.historicalRarityConflict?.provisionalRarity ?? "",
    };
    lines.push(fields.map(key => encode(row[key])).join(","));
  }
  return lines.join("\n") + "\n";
}

export function renderPetCatalogPreviewMarkdown(preview) {
  const escapeCell = value => String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const s = preview.summary, flagged = key => preview.pets.filter(p => p.flags.includes(key));
  const lines = [
    "# AM Isa — Staff pet catalogue preview (dry run)",
    "", "**Internal review only. Not approved for import, Discord posting, card printing, or art reuse.**",
    "", `Generated from source evidence dated **${preview.generatedOn}**. No MongoDB or network access is used by the generator.`,
    "",
    "## Overview", "",
    `- **${s.canonicalPets} distinct pets** from ${s.inputEvidenceRecords} source/evidence records (${s.duplicateSourceEntriesCollapsed} duplicate source entry consolidated).`,
    `- **${s.officialRarityConfirmed}** official rarities confirmed; **${s.officialRarityPending}** still unverified.`,
    `- **${s.aliasesResolved}** canonical aliases selected; **${s.additionalOfficialPets}** extra official pets staged.`,
    `- **${s.historicalDisagreementsAdjudicated}** historical rarity conflict adjudicated while preserving the provisional value.`,
    `- **All ${s.reviewPending} entries remain pending staff review.** Bulk source rights and artwork clearance: **NOT APPROVED**.`,
    "",
    "### Rarity totals", "",
    "| Common | Uncommon | Rare | Ultra-Rare | Legendary | Unknown |",
    "|---:|---:|---:|---:|---:|---:|",
    `| ${s.rarityCounts.Common} | ${s.rarityCounts.Uncommon} | ${s.rarityCounts.Rare} | ${s.rarityCounts["Ultra-Rare"]} | ${s.rarityCounts.Legendary} | ${s.rarityCounts.Unknown} |`,
    "",
    "## Items needing special attention", "",
    "### Official rarity still missing", "",
    ...preview.pets.filter(x => x.officialRarity === null).map(x =>
      `- **${x.name}** (\`${x.petId}\`): official rarity **Unknown**; community-provisional ${x.communityProvisionalRarity}. [Official identity evidence](${x.officialSourceUrls[0]}).`),
    "", "### Historical disagreement selected", "",
    ...flagged("historic-rarity-conflict-adjudicated").map(x =>
      `- **${x.name}**: selected **${x.rarity}** from [official source](${x.officialSourceUrls[0]}); original **${x.historicalRarityConflict.provisionalRarity}** kept in the audit. Not database-approved.`),
    "", "### Canonical aliases (no duplicate pets)", "",
    "| Original source ID | Canonical pet ID | Name |", "|---|---|---|",
    ...flagged("canonical-alias").flatMap(x => x.aliasIds.map(id => `| \`${id}\` | \`${x.petId}\` | ${escapeCell(x.name)} |`)),
    "", "### New official pets staged for staff", "",
    "| Name | Rarity | Official source |", "|---|---|---|",
    ...flagged("new-official-pet-staged").map(x =>
      `| ${escapeCell(x.name)} | ${x.rarity} | [Release notes](${x.officialSourceUrls[0]}) |`),
    "", "## Complete alphabetical catalogue", "",
    "Use the accompanying CSV for spreadsheet filtering. **Every entry is pending**, even where the official rarity is known.",
    "", "| Pet | ID | Rarity | Evidence | Flags | Official source |",
    "|---|---|---|---|---|---|",
    ...preview.pets.map(x =>
      `| ${escapeCell(x.name)} | \`${x.petId}\` | ${x.rarity} | ${x.rarityEvidence} | ${escapeCell(x.flags.join(", ")) || "—"} | [View](${x.officialSourceUrls[0]}) |`),
    "", "## Approval gates", "",
    "1. Resolve the official rarity or retain Unknown for Blue Cat and Pink Dog.",
    "2. Review upstream data-reuse rights and artwork permissions separately.",
    "3. Add staff authorization and an independently approved dry-run import diff before any MongoDB import.",
    "4. Keep this draft branch separate from production until authorized.",
    "",
  ];
  return lines.join("\n");
}
