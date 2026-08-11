/**
 * Local-file ingestion has two memory boundaries: source text parsed in the
 * renderer and encoded Arrow IPC transferred to the server. Arrow string
 * vectors add offsets and validity data, so the source limit is deliberately
 * lower and the UI states both caps.
 */
export const LOCAL_FILE_SOURCE_LIMIT_MB = 16;
export const MAX_LOCAL_SOURCE_BYTES = LOCAL_FILE_SOURCE_LIMIT_MB * 1024 * 1024;
export const LOCAL_ARROW_LIMIT_MB = 100;
export const MAX_LOCAL_ARROW_BYTES = LOCAL_ARROW_LIMIT_MB * 1024 * 1024;
export const LOCAL_FILE_HELPER_TEXT =
  `Supports CSV and JSON source files up to ${LOCAL_FILE_SOURCE_LIMIT_MB}MB; ` +
  `encoded imports are limited to ${LOCAL_ARROW_LIMIT_MB}MB (stored locally)`;

export function localArrowSizeIsAllowed(byteLength: number): boolean {
  return (
    Number.isSafeInteger(byteLength) &&
    byteLength > 0 &&
    byteLength <= MAX_LOCAL_ARROW_BYTES
  );
}
