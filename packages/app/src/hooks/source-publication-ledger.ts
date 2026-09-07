import type { InsightSourceGeneration } from "@dashframe/types";

type SourceGeneration = Readonly<InsightSourceGeneration>;

type SourcePublication = Readonly<{
  before: string;
  sourceGenerations: readonly SourceGeneration[];
  recordedAt: number;
}>;

const MAX_PUBLICATIONS_PER_RUNTIME = 64;
const PUBLICATION_TTL_MS = 10_000;
const publicationsByRuntime = new WeakMap<object, SourcePublication[]>();

export function isSelfPublishedSourceRevision(
  before: string,
  after: string,
  sourceGenerations: readonly SourceGeneration[],
): boolean {
  if (before === after) return false;
  const prior = before.split("|");
  const next = after.split("|");
  if (prior.length !== next.length) return false;
  let changed = false;
  const published = new Map(
    sourceGenerations.map(({ tableId, dataFrameId, lastFetchedAt }) => [
      tableId,
      `${dataFrameId}:${lastFetchedAt}`,
    ]),
  );
  for (let index = 0; index < prior.length; index += 1) {
    if (prior[index] === next[index]) continue;
    const priorTable = prior[index]?.split(":");
    const nextTable = next[index]?.split(":");
    if (
      priorTable?.[0] !== "table" ||
      nextTable?.[0] !== "table" ||
      priorTable[1] !== nextTable[1] ||
      published.get(nextTable[1] ?? "") !== nextTable.slice(2).join(":")
    )
      return false;
    changed = true;
  }
  return changed;
}

export function recordAutomaticSourcePublication(
  runtimeScope: object,
  before: string,
  sourceGenerations: readonly SourceGeneration[],
  recordedAt = Date.now(),
): void {
  if (sourceGenerations.length === 0) return;
  const active = activePublications(runtimeScope, recordedAt);
  active.push({ before, sourceGenerations, recordedAt });
  publicationsByRuntime.set(
    runtimeScope,
    active.slice(-MAX_PUBLICATIONS_PER_RUNTIME),
  );
}

export function isAutomaticSourcePublication(
  runtimeScope: object,
  before: string,
  after: string,
  now = Date.now(),
): boolean {
  if (before === after) return false;
  const prior = before.split("|");
  const next = after.split("|");
  if (prior.length !== next.length) return false;

  const publishedEdges = sourcePublicationEdges(
    activePublications(runtimeScope, now),
  );
  let changed = false;
  for (let index = 0; index < prior.length; index += 1) {
    if (prior[index] === next[index]) continue;
    const priorTable = prior[index]?.split(":");
    const nextTable = next[index]?.split(":");
    if (
      priorTable?.[0] !== "table" ||
      nextTable?.[0] !== "table" ||
      priorTable[1] !== nextTable[1] ||
      !hasPublishedPath(
        publishedEdges.get(priorTable[1] ?? ""),
        priorTable.slice(2).join(":"),
        nextTable.slice(2).join(":"),
      )
    )
      return false;
    changed = true;
  }
  return changed;
}

function sourcePublicationEdges(
  publications: readonly SourcePublication[],
): Map<string, Map<string, Set<string>>> {
  // Connect exact revisions, not frame IDs: RefreshDataTable can reuse a
  // retained frame with a new timestamp. Undirected edges still let concurrent
  // publications A -> B and A -> C settle the observed B -> C transition.
  const byTable = new Map<string, Map<string, Set<string>>>();
  for (const publication of publications) {
    const before = sourceRevisions(publication.before);
    for (const {
      tableId,
      dataFrameId,
      lastFetchedAt,
    } of publication.sourceGenerations) {
      const publishedRevision = `${dataFrameId}:${lastFetchedAt}`;
      const priorRevision = before.get(tableId);
      if (priorRevision === undefined) continue;
      const bySource = byTable.get(tableId) ?? new Map<string, Set<string>>();
      const targets = bySource.get(priorRevision) ?? new Set<string>();
      targets.add(publishedRevision);
      bySource.set(priorRevision, targets);
      const priorFrames = bySource.get(publishedRevision) ?? new Set<string>();
      priorFrames.add(priorRevision);
      bySource.set(publishedRevision, priorFrames);
      byTable.set(tableId, bySource);
    }
  }
  return byTable;
}

function hasPublishedPath(
  edges: Map<string, Set<string>> | undefined,
  before: string,
  after: string,
): boolean {
  if (!edges) return false;
  const visited = new Set([before]);
  const pending = [before];
  while (pending.length > 0) {
    const source = pending.shift()!;
    for (const target of edges.get(source) ?? []) {
      if (target === after) return true;
      if (visited.has(target)) continue;
      visited.add(target);
      pending.push(target);
    }
  }
  return false;
}

function sourceRevisions(revision: string): Map<string, string> {
  const frames = new Map<string, string>();
  for (const part of revision.split("|")) {
    const [kind, tableId, ...generation] = part.split(":");
    if (kind === "table" && tableId) frames.set(tableId, generation.join(":"));
  }
  return frames;
}

function activePublications(
  runtimeScope: object,
  now: number,
): SourcePublication[] {
  const current = publicationsByRuntime.get(runtimeScope) ?? [];
  const active = current.filter(
    ({ recordedAt }) => now - recordedAt <= PUBLICATION_TTL_MS,
  );
  if (active.length !== current.length)
    publicationsByRuntime.set(runtimeScope, active);
  return active;
}
