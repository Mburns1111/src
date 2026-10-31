import CardDefinition from "../models/CardDefinition.js";
import CardRelease from "../models/CardRelease.js";
import CardSeries from "../models/CardSeries.js";
import PetCatalog from "../models/PetCatalog.js";
import { loadCardArtwork } from "./card-artwork-assets.js";
import { renderCollectibleCardPreview } from "./card-preview-renderer.js";
import { escapePetNameSearch } from "./card-owned-selection.js";

export async function suggestShowCards(search="") {
  const term=String(search||"").trim().slice(0,100);
  if(term.length<2)return [];
  const pets=await PetCatalog.find({
    name:new RegExp(escapePetNameSearch(term),"i"),
  }).select("petId name").limit(80).lean();
  if(!pets.length)return [];
  const active=await CardRelease.find({status:"active"}).select("releaseId").lean();
  const defs=await CardDefinition.find({
    petId:{$in:pets.map(p=>p.petId)},
    releaseId:{$in:active.map(r=>r.releaseId)},enabled:true,
  }).select("_id petId releaseId rarity").limit(150).lean();
  const names=new Map(pets.map(p=>[p.petId,p.name]));
  return defs.slice(0,25).map(d=>({
    name:(names.get(d.petId)+" · "+d.rarity+" · "+d.releaseId).slice(0,100),
    value:String(d._id),
  }));
}

export async function resolveShowCard(reference){
  const input=String(reference||"").trim().slice(0,120);
  if(!input)throw Error("Use .show Pet Name or /cards show to search.");
  const mongoose=(await import("mongoose")).default;
  if(mongoose.isValidObjectId(input)){
    const def=await CardDefinition.findById(input).lean();
    if(!def||!def.enabled)throw Error("That card is not available in an active release.");
    const release=await CardRelease.findOne({releaseId:def.releaseId,status:"active"}).lean();
    if(!release)throw Error("That card is not available in an active release.");
    return def;
  }
  const choices=await suggestShowCards(input);
  if(!choices.length)throw Error("No released card matches that name. Try a different pet name.");
  // Prefer exact pet-name matches; if several pets share a prefix, ask
  // the user to enter a longer name rather than silently choosing one.
  const exact=choices.filter(x=>x.name.split(" · ")[0].toLocaleLowerCase()===input.toLocaleLowerCase());
  const matches=exact.length?exact:choices;
  const petNames=new Set(matches.map(x=>x.name.split(" · ")[0].toLocaleLowerCase()));
  if(petNames.size>1)throw Error("Several cards match: "+matches.slice(0,6).map(x=>x.name.split(" · ")[0]).join(", ")+". Type a longer pet name or use /cards show autocomplete.");
  const definitions=await CardDefinition.find({_id:{$in:matches.map(x=>new mongoose.Types.ObjectId(x.value))}}).lean();
  if(definitions.length===1)return definitions[0];
  const releases=await CardRelease.find({releaseId:{$in:definitions.map(x=>x.releaseId)}}).select("releaseId status").lean();
  const active=new Set(releases.filter(r=>r.status==="active").map(r=>r.releaseId));
  return definitions.find(d=>active.has(d.releaseId))||definitions[0];
}

export async function renderShownCard(reference){
  const definition=await resolveShowCard(reference);
  const [pet,release,series]=await Promise.all([
    PetCatalog.findOne({petId:definition.petId}).select("name").lean(),
    CardRelease.findOne({releaseId:definition.releaseId})
      .select("name cardBackgroundKey cardFrameKey status").lean(),
    CardSeries.findOne({seriesId:definition.seriesId}).select("name").lean(),
  ]);
  const [petImage,backgroundImage,frameImage]=await Promise.all([
    loadCardArtwork(definition.petArtworkKey,"pet"),
    loadCardArtwork(release?.cardBackgroundKey,"background"),
    loadCardArtwork(release?.cardFrameKey,"frame"),
  ]);
  const name=pet?.name||definition.petId;
  const png=await renderCollectibleCardPreview({
    petImageSource:petImage?.bytes,backgroundImageSource:backgroundImage?.bytes,
    frameImageSource:frameImage?.bytes,petName:name,rarity:definition.rarity,
    releaseName:release?.name||definition.releaseId,
    seriesName:series?.name||definition.seriesId,
    publicId:"PREVIEW",artStatus:definition.artStatus,artUrl:definition.artUrl,
    artistCredit:definition.artistCredit,
  });
  return {png,name,rarity:definition.rarity,release:release?.name||definition.releaseId};
}
