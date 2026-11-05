import { CARD_EGG_BUCKET } from "./card-egg-artwork-upload.js";
import { EGG_ART_MAX_BYTES } from "./card-egg-artwork.js";

/**
 * The official release must have its own review record and GridFS file id:
 * CardEggArtwork has unique releaseId AND unique fileId.
 * Copy the bytes in MongoDB, not the test record or its approval state.
 */
export function planSeries1TestEggReuse({ sourceRelease, sourceArtwork, targetRelease, targetArtwork }) {
  if (sourceRelease?.releaseId !== "test-s1-r1" ||
      targetRelease?.releaseId !== "s1-r1" ||
      targetRelease.status !== "draft")
    throw Error("The only allowed transfer is test-s1-r1 to official draft s1-r1.");
  if (!sourceArtwork || sourceArtwork.releaseId !== "test-s1-r1" ||
      !sourceArtwork.fileId || !sourceRelease.eggImageFileId ||
      String(sourceArtwork.fileId) !== String(sourceRelease.eggImageFileId))
    throw Error("Source test-release artwork does not match its saved image reference.");
  if (sourceArtwork.bucket !== CARD_EGG_BUCKET ||
      sourceRelease.eggImageBucket !== CARD_EGG_BUCKET ||
      !sourceArtwork.artworkId)
    throw Error("Source egg artwork is not in the expected verified MongoDB bucket.");
  if (sourceArtwork.licenseReviewStatus === "rejected")
    throw Error("Rejected test artwork may not be copied into the official release.");
  if (targetArtwork || targetRelease.eggImageFileId || targetRelease.eggImageUrl || targetRelease.eggArtworkId)
    throw Error("Official s1-r1 already has egg artwork; never overwrite it.");
  const required = ["originalFilename", "creditText", "creatorName", "sourceArtist",
    "sourcePlatform", "sourceAssetId", "contentType"];
  if (required.some(field => !String(sourceArtwork[field] || "").trim()))
    throw Error("Source egg provenance or filename is incomplete.");
  if (!/\.(png|jpe?g|webp)$/i.test(sourceArtwork.originalFilename) ||
      !["image/png","image/jpeg","image/webp"].includes(sourceArtwork.contentType) ||
      !Number.isFinite(sourceArtwork.byteLength) ||
      sourceArtwork.byteLength < 1 || sourceArtwork.byteLength > EGG_ART_MAX_BYTES)
    throw Error("Source egg image format or size is unsafe.");
  return {
    sourceReleaseId:"test-s1-r1", targetReleaseId:"s1-r1",
    sourceFileId:String(sourceArtwork.fileId),
    sourceArtworkId:sourceArtwork.artworkId,
    sourceFilename:sourceArtwork.originalFilename,
    bytes:sourceArtwork.byteLength,
    contentType:sourceArtwork.contentType,
    artist:sourceArtwork.sourceArtist,
    platform:sourceArtwork.sourcePlatform,
    sourceId:sourceArtwork.sourceAssetId,
    creditText:sourceArtwork.creditText,
    sourceLicenseReview:sourceArtwork.licenseReviewStatus,
    targetLicenseReview:"needs-review",
  };
}
