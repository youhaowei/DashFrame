/**
 * Client helpers for draft lifecycle RPCs: publishDraft, discardDraft,
 * getDraftLog.
 *
 * These parallel the pattern in data-sources.ts / preview-diff.ts: imperative
 * helpers for direct async calls.
 */
import { api } from "./api";
import { getWyStackClient } from "./client";
import type { PreviewCommand } from "./preview-diff";

/**
 * Publish a draft: replay its command log onto canonical tables, then clean up
 * the draft's log and shadow rows.
 *
 * Returns the set of canonical table names written (for caller correlation).
 * WS reactive invalidation fires automatically — callers do not need to
 * manually refetch after a publish.
 */
export async function publishDraft(
  draftId: string,
): Promise<{ tablesWritten: string[] }> {
  return getWyStackClient().mutate(api.publishDraft, { draftId });
}

/**
 * Discard a draft: delete its command log and sweep all shadow rows. Canonical
 * tables are never touched.
 */
export async function discardDraft(draftId: string): Promise<void> {
  return getWyStackClient().mutate(api.discardDraft, { draftId });
}

/**
 * Read the compacted command log for a draft, in replay order. Used by the
 * client to build a PreviewDiff before showing the review dialog.
 *
 * Returns commands in the same shape as `PreviewCommand` (structurally
 * identical; no server package import needed on the client side).
 */
export async function getDraftLog(draftId: string): Promise<PreviewCommand[]> {
  return getWyStackClient().query(api.getDraftLog, { draftId });
}
