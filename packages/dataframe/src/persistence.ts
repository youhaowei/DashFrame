import { get, set, del } from "idb-keyval";

// ============================================================================
// Arrow IPC Storage (New Implementation)
// ============================================================================

/**
 * Save Arrow IPC buffer to IndexedDB
 *
 * Arrow IPC format is more efficient than Parquet for in-memory operations:
 * - Zero-copy deserialization
 * - Better for columnar data access patterns
 * - Smaller overhead for repeated reads/writes
 */
export async function persistArrowData(
  key: string,
  arrowBuffer: Uint8Array,
): Promise<void> {
  await set(key, arrowBuffer);
}

/**
 * Load Arrow IPC buffer from IndexedDB
 */
export async function loadArrowData(key: string): Promise<Uint8Array | null> {
  const buffer = await get(key);
  return buffer ?? null;
}

/**
 * Delete Arrow IPC buffer from IndexedDB
 */
export async function deleteArrowData(key: string): Promise<void> {
  await del(key);
}

// ============================================================================
// Storage Key Generation
// ============================================================================

/**
 * Generate consistent storage keys for Arrow IPC data
 */
export function generateArrowKey(dataFrameId: string): string {
  return `dashframe:arrow:${dataFrameId}`;
}

/**
 * Extract DataFrame ID from Arrow storage key
 */
export function extractDataFrameId(arrowKey: string): string | null {
  const match = arrowKey.match(/^dashframe:arrow:(.+)$/);
  return match ? match[1] : null;
}
