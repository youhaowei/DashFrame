/**
 * Duplicate-join detection helpers for the Join configuration surface.
 *
 * Double-joining the same right table on *different* keys is fully legitimate
 * (e.g. orders → users on created_by AND approved_by). These helpers surface
 * that situation clearly so the user can disambiguate instances rather than
 * silently producing confusing output.
 *
 * Per the YW-295 decision these functions never prevent creation — they only
 * classify the pending join so the UI can label it correctly.
 */

import type { InsightJoinConfig } from "@dashframe/types";

/**
 * Returns the subset of existing joins that target the given right-table ID.
 *
 * An empty array means this will be the first join to that table (no
 * disambiguation needed). One or more results means the user is adding an
 * additional join to the same table.
 */
export function findExistingJoinsToTable(
  joins: InsightJoinConfig[] | undefined,
  rightTableId: string,
): InsightJoinConfig[] {
  if (!joins || joins.length === 0) return [];
  return joins.filter((j) => j.rightTableId === rightTableId);
}

/**
 * Candidate join shape used for exact-duplicate detection. Uses the stored
 * column name strings (leftKey / rightKey) rather than field UUIDs so the
 * comparison is against what is actually persisted.
 */
export interface JoinCandidate {
  leftKey: string;
  rightKey: string;
  type: InsightJoinConfig["type"];
}

/**
 * Returns true when the candidate join exactly matches one of the existing
 * joins (same table assumed — caller already filtered to the right table).
 *
 * An exact duplicate (same keys + same type) produces redundant columns in the
 * result but is not blocked — the user is warned via the UI.
 */
export function isExactDuplicateJoin(
  existingJoins: InsightJoinConfig[],
  candidate: JoinCandidate,
): boolean {
  return existingJoins.some(
    (j) =>
      j.leftKey === candidate.leftKey &&
      j.rightKey === candidate.rightKey &&
      j.type === candidate.type,
  );
}
