import type { InsightSourceGeneration } from "@dashframe/types";

/** A subscription carries the external revision atomically with its source pointer. */
export function isAutomaticSourcePublication(
  before: string,
  after: string,
): boolean {
  return (
    changedTables(before, after)?.every(
      ([prior, next]) => prior[4] === next[4],
    ) ?? false
  );
}

/** Only the operation's exact published generations can settle its unreadable failure. */
export function isSelfPublishedSourceRevision(
  before: string,
  after: string,
  sourceGenerations: readonly Readonly<InsightSourceGeneration>[],
): boolean {
  return (
    changedTables(before, after)?.every(
      ([prior, next]) =>
        prior[4] === next[4] &&
        sourceGenerations.some(
          ({ tableId, dataFrameId, lastFetchedAt }) =>
            tableId === next[1] &&
            dataFrameId === next[2] &&
            String(lastFetchedAt) === next[3],
        ),
    ) ?? false
  );
}

function changedTables(
  before: string,
  after: string,
): [string[], string[]][] | null {
  if (before === after) return null;
  const prior = before.split("|");
  const next = after.split("|");
  if (prior.length !== next.length) return null;
  const changed: [string[], string[]][] = [];
  for (let index = 0; index < prior.length; index += 1) {
    if (prior[index] === next[index]) continue;
    const priorTable = prior[index]!.split(":");
    const nextTable = next[index]!.split(":");
    if (
      priorTable.length !== 5 ||
      nextTable.length !== 5 ||
      priorTable[0] !== "table" ||
      nextTable[0] !== "table" ||
      priorTable[1] !== nextTable[1] ||
      !priorTable[4] ||
      !nextTable[4]
    )
      return null;
    changed.push([priorTable, nextTable]);
  }
  return changed.length ? changed : null;
}
