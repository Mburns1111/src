// Source-dated owner review of trading values for official Series 1.
// This is separate from Adopt Me rarity, hatchWeight and card ownership.
// No internet scraping, inferred prices, or automatic value assignments.
export const SERIES1_VALUE_REVIEW_MIN = 20;
export const SERIES1_VALUE_RELEASE = "s1-r1";
const validDate = value => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now();

function approvedSeries1(definitions) {
  if (!Array.isArray(definitions) || definitions.length !== 108 ||
      new Set(definitions.map(d => String(d.petId))).size !== 108 ||
      definitions.some(d => d.releaseId !== SERIES1_VALUE_RELEASE ||
        !d.enabled || d.artStatus !== "approved" || !(Number(d.hatchWeight) > 0)))
    throw Error("Value review requires exactly 108 distinct enabled, approved Series 1 cards.");
  return [...definitions].sort((a,b) => String(a.petId).localeCompare(String(b.petId)));
}

export function series1ValueReviewTemplate(definitions) {
  const cards=approvedSeries1(definitions);
  return {
    releaseId: SERIES1_VALUE_RELEASE,
    reviewMethod: "",
    instructions: "Enter one comparable numeric relative trading-value score per reviewed pet, based on comparing at least two independent published trading-value sites. Leave unreviewed scores null. Keep official Adopt Me rarity and hatch weighting separate. Include source URLs and the actual ISO review time with timezone. Do not invent values.",
    reviews: cards.map(d => ({
      petId: String(d.petId), rarity: d.rarity,
      score: Number.isFinite(d.valueReview?.valueScore) ? d.valueReview.valueScore : null,
      sources: Array.isArray(d.valueReview?.sources) ? d.valueReview.sources.map(src=>({
        name:src.name, url:src.url,
      })) : [],
      checkedAt: d.valueReview?.checkedAt instanceof Date
        ? d.valueReview.checkedAt.toISOString()
        : d.valueReview?.checkedAt || "",
    })),
  };
}

function validateSources(sources, index) {
  if (!Array.isArray(sources) || sources.length < 2)
    throw Error("Value review row #"+index+" needs at least two independent trading-value sources.");
  const domains=new Set();
  return sources.map(source => {
    const name=String(source?.name || "").trim();
    const link=String(source?.url || "").trim();
    let hostname;
    try {
      const url=new URL(link);
      if(url.protocol!=="https:" || url.username || url.password)throw Error("unsafe");
      hostname=url.hostname.replace(/^www\./,"").toLowerCase();
    } catch {
      throw Error("Value review row #"+index+" has an invalid HTTPS source URL.");
    }
    if(!name || name.length>120 || link.length>1800)
      throw Error("Value review row #"+index+" needs valid source names and URLs.");
    if(domains.has(hostname))
      throw Error("Value review row #"+index+" must compare different trading-value websites.");
    domains.add(hostname);
    return {name,url:link};
  });
}

export function planSeries1ValueReviews({release,definitions,config}) {
  if (release?.releaseId!==SERIES1_VALUE_RELEASE || release.status!=="draft")
    throw Error("Only the official Series 1 draft may receive value reviews.");
  const cards=approvedSeries1(definitions);
  if (config?.releaseId!==SERIES1_VALUE_RELEASE ||
      !Array.isArray(config.reviews) || config.reviews.length!==108 ||
      !String(config.reviewMethod || "").trim())
    throw Error("Use a 108-row Series 1 review file with a documented, common scoring method.");
  const byPet=new Map(cards.map(d=>[String(d.petId),d]));
  const seen=new Set(), changes=[];
  let alreadyReviewed=0;
  for (const [index,row] of config.reviews.entries()) {
    const n=index+1, petId=String(row?.petId||"").trim();
    const card=byPet.get(petId);
    if (!card || seen.has(petId)) throw Error("Value review row #"+n+" has a duplicate or unknown Series 1 pet ID.");
    seen.add(petId);
    if (row.rarity!==card.rarity)
      throw Error("Value review row #"+n+" has a mismatched official rarity.");
    const existing=card.valueReview;
    if(Number.isFinite(existing?.valueScore)) {
      alreadyReviewed++;
      if(row.score!==existing.valueScore)
        throw Error("Value review row #"+n+" would overwrite a prior approved score. Resolve separately.");
      continue;
    }
    if(row.score===null || row.score==="" || row.score===undefined) {
      if((row.sources?.length||0)>0 || String(row.checkedAt||"").trim())
        throw Error("Value review row #"+n+" has sources or a date but no score.");
      continue;
    }
    if(typeof row.score!=="number" || !Number.isFinite(row.score) ||
        row.score<0 || row.score>1_000_000)
      throw Error("Value review row #"+n+" needs a finite numeric score on the agreed relative scale.");
    const sources=validateSources(row.sources,n);
    if(!validDate(row.checkedAt))
      throw Error("Value review row #"+n+" needs a real, nonfuture ISO review date with timezone.");
    changes.push({
      id:card._id,petId,
      valueReview:{
        valueScore:row.score,sourceName:sources.map(x=>x.name).join(" + "),
        sourceUrl:sources[0].url,checkedAt:new Date(row.checkedAt),
        reviewMethod:String(config.reviewMethod).trim(),sources,
      },
    });
  }
  if(seen.size!==108)throw Error("The review file is missing a Series 1 pet.");
  const reviewedAfter=alreadyReviewed+changes.length;
  return {
    releaseId:SERIES1_VALUE_RELEASE,
    existingReviewed:alreadyReviewed,
    pendingReviews:changes.length,
    reviewedAfter,
    unreviewedAfter:108-reviewedAfter,
    minimumForValueAchievements:SERIES1_VALUE_REVIEW_MIN,
    valueAchievementCoverageReady:reviewedAfter>=SERIES1_VALUE_REVIEW_MIN,
    changes,
  };
}
