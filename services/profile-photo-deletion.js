/**
 * Delete the bytes before deleting their metadata. Otherwise a failed
 * GridFS removal creates invisible storage that still counts toward a user's
 * album quota, with no way for them to remove it from the UI.
 */
export async function deletePhotoFilesBeforeRecords(fileIds, deleteFiles, deleteRecords) {
  if (fileIds.length) await deleteFiles(fileIds);
  return deleteRecords();
}
