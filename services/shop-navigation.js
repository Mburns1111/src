/**
 * Pure shop-directory navigation helpers. The indexed view intentionally
 * excludes full Canvas image rendering so browsing a category stays quick.
 */
export const SHOP_INDEX_PAGE_SIZE = 20;

export function shopDirectorySlice(entries, requestedPage = 0) {
  const count = Math.max(1, Math.ceil(entries.length / SHOP_INDEX_PAGE_SIZE));
  const page = Math.max(0, Math.min(count - 1,
    Number.isSafeInteger(requestedPage) ? requestedPage : 0));
  const start = page * SHOP_INDEX_PAGE_SIZE;
  return {
    page,
    count,
    start,
    visible: entries.slice(start, start + SHOP_INDEX_PAGE_SIZE),
  };
}

// Item IDs are stable even when Halloween offers expire and indices shift.
export function shopItemIndexById(entries, itemId) {
  return entries.findIndex(entry => entry.id === itemId);
}
