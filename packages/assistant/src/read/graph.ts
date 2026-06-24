/**
 * Graph navigation — STRUCTURE resolution over the GraphReader port.
 *
 * The artifact graph's edges are the id references between artifacts. This file
 * resolves a node's neighbors (one hop), traverses to a bounded depth, and finds
 * nodes by name/type. EVERYTHING HERE IS STRUCTURE — names, types, edge ids — so
 * it flows UNGATED (the floor lives in the data path, ./floor.ts, not here).
 *
 * The edge map (who references whom):
 *
 *   dataSource ─owns→ dataTable ─reads→ insight ─renders→ visualization ─placed→ dashboard
 *                          │                 │                                       │
 *                          └─materializes──→ dataFrame ←─result───┘                 │
 *                                                                                    │
 *   insight ─joins→ dataTable (rightTableId)                                         │
 *   dashboard.items[].visualizationId → visualization ──────────────────────────────┘
 *
 * Edges are bidirectional for navigation: from an insight you can reach its base
 * table (down) and the visualizations that render it (up). `neighbors()` returns
 * BOTH directions so the agent perceives the full local context.
 */

import type { UUID } from "@dashframe/types";

import type { GraphReader, NodeRef } from "./port.js";

/** A node's structural summary — what the agent perceives without a deep read. */
export interface NodeSummary {
  ref: NodeRef;
  name: string;
}

/** A node plus its one-hop neighbors, both directions, structure only. */
export interface Neighborhood {
  center: NodeSummary;
  /** Edges OUT of center (things center references / owns / reads from). */
  downstream: NodeSummary[];
  /** Edges INTO center (things that reference center). */
  upstream: NodeSummary[];
}

// ---------------------------------------------------------------------------
// Node summary
// ---------------------------------------------------------------------------

/** Resolve a node's name (structure). Returns null if the node doesn't exist. */
export async function summarize(
  reader: GraphReader,
  ref: NodeRef,
): Promise<NodeSummary | null> {
  switch (ref.kind) {
    case "dataSource": {
      const n = await reader.getDataSource(ref.id);
      return n ? { ref, name: n.name } : null;
    }
    case "dataTable": {
      const n = await reader.getDataTable(ref.id);
      return n ? { ref, name: n.name } : null;
    }
    case "dataFrame": {
      const n = await reader.getDataFrameEntry(ref.id);
      return n ? { ref, name: n.name } : null;
    }
    case "insight": {
      const n = await reader.getInsight(ref.id);
      return n ? { ref, name: n.name } : null;
    }
    case "visualization": {
      const n = await reader.getVisualization(ref.id);
      return n ? { ref, name: n.name } : null;
    }
    case "dashboard": {
      const n = await reader.getDashboard(ref.id);
      return n ? { ref, name: n.name } : null;
    }
    default: {
      // Exhaustive over ArtifactKind — a new kind makes this a compile error.
      const _exhaustive: never = ref.kind;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// One-hop neighbors (the edges, both directions)
// ---------------------------------------------------------------------------

/**
 * An accumulator for a node's neighbors. Each per-kind resolver pushes the edges
 * it knows about; keeping the push helpers here (not inlined in a big switch)
 * keeps each resolver flat and the dispatcher trivial.
 */
class NeighborAcc {
  readonly downstream: NodeSummary[] = [];
  readonly upstream: NodeSummary[] = [];
  constructor(private readonly reader: GraphReader) {}
  /** Resolve a target's name and push it onto a list (drop dangling refs). */
  async push(into: NodeSummary[], target: NodeRef): Promise<void> {
    const s = await summarize(this.reader, target);
    if (s !== null) into.push(s);
  }
  /** Push a target whose name we already have (no extra read). */
  add(into: NodeSummary[], ref: NodeRef, name: string): void {
    into.push({ ref, name });
  }
}

/** dataSource → owns → dataTable (down). */
async function dataSourceNeighbors(
  reader: GraphReader,
  acc: NeighborAcc,
  id: UUID,
): Promise<void> {
  for (const t of await reader.listDataTables(id))
    acc.add(acc.downstream, { kind: "dataTable", id: t.id }, t.name);
}

/** dataTable: up to its source + insights that read it; down to its dataframe. */
async function dataTableNeighbors(
  reader: GraphReader,
  acc: NeighborAcc,
  id: UUID,
): Promise<void> {
  const t = await reader.getDataTable(id);
  if (t) {
    await acc.push(acc.upstream, { kind: "dataSource", id: t.dataSourceId });
    if (t.dataFrameId)
      await acc.push(acc.downstream, { kind: "dataFrame", id: t.dataFrameId });
  }
  for (const i of await reader.listInsights()) {
    const readsThisTable =
      i.baseTableId === id ||
      (i.joins ?? []).some((j) => j.rightTableId === id);
    if (readsThisTable)
      acc.add(acc.upstream, { kind: "insight", id: i.id }, i.name);
  }
}

/** dataFrame → up → the insight it is the result of. */
async function dataFrameNeighbors(
  reader: GraphReader,
  acc: NeighborAcc,
  id: UUID,
): Promise<void> {
  const df = await reader.getDataFrameEntry(id);
  if (df?.insightId)
    await acc.push(acc.upstream, { kind: "insight", id: df.insightId });
}

/**
 * Resolve an insight's base-source ref. `Insight.baseTableId` is polymorphic:
 * for a dataTable source it is a table id; for an insight source (insight-on-
 * insight composition) it holds the UPSTREAM INSIGHT id. The domain `Insight`
 * type carries no `sourceType` discriminator (only `baseTableId`), so the kind
 * must be probed — table-first, then insight, the same probe order the server's
 * own polymorphic rename/delete resolvers use.
 *
 * Probe order is unambiguous because artifact ids are globally-unique UUIDs: a
 * single id resolves to AT MOST one artifact kind, so "table-first" can only win
 * when the id IS a table. A cross-table id collision would be a server data-
 * integrity violation (duplicate UUID across tables), not a case this read layer
 * papers over. Returns the correctly-kinded ref, or null if neither resolves (a
 * dangling base — dropped, not errored).
 */
async function resolveBaseSource(
  reader: GraphReader,
  baseId: UUID,
): Promise<NodeRef | null> {
  if ((await reader.getDataTable(baseId)) !== null)
    return { kind: "dataTable", id: baseId };
  if ((await reader.getInsight(baseId)) !== null)
    return { kind: "insight", id: baseId };
  return null;
}

/** insight: down to base source (table OR upstream insight) + join tables +
 * result dataframe; up to its vizzes AND any insights composed ON this one. */
async function insightNeighbors(
  reader: GraphReader,
  acc: NeighborAcc,
  id: UUID,
): Promise<void> {
  const i = await reader.getInsight(id);
  if (i) {
    // Base source is polymorphic (dataTable | upstream insight) — resolve its
    // real kind so a composed insight's edge isn't silently dropped.
    const base = await resolveBaseSource(reader, i.baseTableId);
    if (base !== null) await acc.push(acc.downstream, base);
    for (const j of i.joins ?? [])
      await acc.push(acc.downstream, { kind: "dataTable", id: j.rightTableId });
    const df = await reader.getDataFrameByInsight(id);
    if (df) acc.add(acc.downstream, { kind: "dataFrame", id: df.id }, df.name);
  }
  for (const v of await reader.listVisualizations(id))
    acc.add(acc.upstream, { kind: "visualization", id: v.id }, v.name);
  // up: insights COMPOSED on this insight (insight-on-insight). Their
  // `baseTableId` holds THIS insight's id — the reverse of the base edge above,
  // so a composed child appears in its parent's neighborhood.
  for (const child of await reader.listInsights()) {
    if (child.id !== id && child.baseTableId === id)
      acc.add(acc.upstream, { kind: "insight", id: child.id }, child.name);
  }
}

/** visualization: down to its insight; up to dashboards that place it. */
async function visualizationNeighbors(
  reader: GraphReader,
  acc: NeighborAcc,
  id: UUID,
): Promise<void> {
  const v = await reader.getVisualization(id);
  if (v) await acc.push(acc.downstream, { kind: "insight", id: v.insightId });
  for (const d of await reader.listDashboards()) {
    if (d.items.some((it) => it.visualizationId === id))
      acc.add(acc.upstream, { kind: "dashboard", id: d.id }, d.name);
  }
}

/** dashboard → down → the visualizations it places. */
async function dashboardNeighbors(
  reader: GraphReader,
  acc: NeighborAcc,
  id: UUID,
): Promise<void> {
  const d = await reader.getDashboard(id);
  for (const it of d?.items ?? []) {
    if (it.type === "visualization" && it.visualizationId)
      await acc.push(acc.downstream, {
        kind: "visualization",
        id: it.visualizationId,
      });
  }
}

/** Per-kind neighbor resolvers — the fixed, schema-owned edge map. */
const NEIGHBOR_RESOLVERS: Record<
  NodeRef["kind"],
  (reader: GraphReader, acc: NeighborAcc, id: UUID) => Promise<void>
> = {
  dataSource: dataSourceNeighbors,
  dataTable: dataTableNeighbors,
  dataFrame: dataFrameNeighbors,
  insight: insightNeighbors,
  visualization: visualizationNeighbors,
  dashboard: dashboardNeighbors,
};

/**
 * Resolve the one-hop neighbors of a node, BOTH directions. Structure only.
 * Returns `null` if the center node doesn't exist.
 *
 * Each kind's edges are walked explicitly (the `NEIGHBOR_RESOLVERS` map above) —
 * no runtime edge-discovery: the artifact model is a fixed, schema-owned shape,
 * so the edges are enumerated exactly like the server's typed-edge cascade does.
 * Missing neighbor targets (a dangling ref) are dropped, not errored — a read
 * layer surfaces what exists.
 */
export async function neighbors(
  reader: GraphReader,
  ref: NodeRef,
): Promise<Neighborhood | null> {
  const center = await summarize(reader, ref);
  if (center === null) return null;
  const acc = new NeighborAcc(reader);
  await NEIGHBOR_RESOLVERS[ref.kind](reader, acc, ref.id);
  return { center, downstream: acc.downstream, upstream: acc.upstream };
}

// ---------------------------------------------------------------------------
// Bounded traversal (readGraph)
// ---------------------------------------------------------------------------

/** A node reached during traversal, with its hop distance from the origin. */
export interface ReachedNode {
  ref: NodeRef;
  name: string;
  depth: number;
}

const MAX_TRAVERSAL_DEPTH = 6;

/**
 * Breadth-first structure traversal from a node out to `depth` hops. Visits each
 * node once (cycle-safe via a visited set keyed by kind+id). Structure only —
 * this is the grep+ls "navigate to it" reach, deliberately NOT the ambient
 * default (that's readNeighborhood). `depth` is clamped to a sane ceiling so a
 * runaway agent can't walk the whole graph in one call.
 */
export async function traverse(
  reader: GraphReader,
  origin: NodeRef,
  depth: number,
): Promise<ReachedNode[]> {
  const clamped = Math.max(0, Math.min(depth, MAX_TRAVERSAL_DEPTH));
  const seen = new Set<string>();
  const key = (r: NodeRef) => `${r.kind}:${r.id}`;
  const result: ReachedNode[] = [];

  const originSummary = await summarize(reader, origin);
  if (originSummary === null) return [];
  seen.add(key(origin));
  result.push({ ref: origin, name: originSummary.name, depth: 0 });

  /** Expand one frontier node: return its not-yet-seen neighbors (marking them). */
  const expand = async (node: NodeRef, d: number): Promise<NodeRef[]> => {
    const hood = await neighbors(reader, node);
    if (hood === null) return [];
    const fresh: NodeRef[] = [];
    for (const n of [...hood.downstream, ...hood.upstream]) {
      const k = key(n.ref);
      if (seen.has(k)) continue;
      seen.add(k);
      result.push({ ref: n.ref, name: n.name, depth: d });
      fresh.push(n.ref);
    }
    return fresh;
  };

  let frontier: NodeRef[] = [origin];
  for (let d = 1; d <= clamped && frontier.length > 0; d++) {
    const expansions = await Promise.all(
      frontier.map((node) => expand(node, d)),
    );
    frontier = expansions.flat();
  }
  return result;
}

// ---------------------------------------------------------------------------
// Find by name / type (search)
// ---------------------------------------------------------------------------

/** A search hit — node identity + name + kind (structure). */
export interface SearchHit {
  ref: NodeRef;
  name: string;
}

export interface SearchQuery {
  /** Substring matched case-insensitively against the node name. Optional. */
  name?: string;
  /** Restrict to one artifact kind. Optional. */
  kind?: NodeRef["kind"];
}

/**
 * Find nodes by name substring and/or kind across the whole graph. Structure
 * only — the global REACH the agent navigates to on demand. An empty query
 * (no name, no kind) returns every node, so this doubles as `ls`.
 */
export async function search(
  reader: GraphReader,
  q: SearchQuery,
): Promise<SearchHit[]> {
  const needle = q.name?.toLowerCase();
  const hits: SearchHit[] = [];

  // The fixed enumeration of searchable kinds → their list reader. A query
  // pinning a kind walks only that one (efficiency); an empty query walks all
  // (the `ls`). dataFrames are searchable too — KindSchema accepts them.
  const lists: Array<{
    kind: NodeRef["kind"];
    list: () => Promise<ReadonlyArray<{ id: UUID; name: string }>>;
  }> = [
    { kind: "dataSource", list: () => reader.listDataSources() },
    { kind: "dataTable", list: () => reader.listDataTables() },
    { kind: "dataFrame", list: () => reader.listDataFrames() },
    { kind: "insight", list: () => reader.listInsights() },
    { kind: "visualization", list: () => reader.listVisualizations() },
    { kind: "dashboard", list: () => reader.listDashboards() },
  ];

  for (const { kind, list } of lists) {
    if (q.kind && q.kind !== kind) continue;
    for (const n of await list()) {
      if (needle && !n.name.toLowerCase().includes(needle)) continue;
      hits.push({ ref: { kind, id: n.id }, name: n.name });
    }
  }

  return hits;
}
