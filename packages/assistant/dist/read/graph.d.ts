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
/** Resolve a node's name (structure). Returns null if the node doesn't exist. */
export declare function summarize(reader: GraphReader, ref: NodeRef): Promise<NodeSummary | null>;
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
export declare function neighbors(reader: GraphReader, ref: NodeRef): Promise<Neighborhood | null>;
/** A node reached during traversal, with its hop distance from the origin. */
export interface ReachedNode {
    ref: NodeRef;
    name: string;
    depth: number;
}
/**
 * Breadth-first structure traversal from a node out to `depth` hops. Visits each
 * node once (cycle-safe via a visited set keyed by kind+id). Structure only —
 * this is the grep+ls "navigate to it" reach, deliberately NOT the ambient
 * default (that's readNeighborhood). `depth` is clamped to a sane ceiling so a
 * runaway agent can't walk the whole graph in one call.
 */
export declare function traverse(reader: GraphReader, origin: NodeRef, depth: number): Promise<ReachedNode[]>;
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
export declare function search(reader: GraphReader, q: SearchQuery): Promise<SearchHit[]>;
//# sourceMappingURL=graph.d.ts.map