/**
 * GraphReader — the READ seam the assistant's perception layer resolves against.
 *
 * THE MODEL (steal GraphQL's mental model, NOT its machinery): a typed-graph
 * resolver. The assistant navigates NODES (artifacts), follows EDGES (the id
 * references between them), and selects FIELDS. There is no SDL, no query
 * language, no codegen — the agent calls ~4 FIXED tools (see ./tools.ts). The
 * defining property is THE FLOOR LIVES IN THE RESOLVER: STRUCTURE (names, types,
 * edges) resolves freely; every resolver that returns a VALUE passes it through
 * the privacy floor (see ./floor.ts).
 *
 * ARCHITECTURAL BOUNDARY — why this is a port, not a direct call:
 * `@dashframe/server` (apps/server) DEPENDS ON `@dashframe/assistant`, so the
 * assistant package cannot import the server (circular). It also must not read
 * the raw DB — the single-egress invariant requires every read to go through the
 * SERVER SEAM (the renderer's read path: `getInsight`, `getDataTable`, … in
 * apps/server/src/functions/app-artifacts.ts + dashboards.ts), against the
 * DRAFT-OVERLAY view so the assistant perceives its own in-progress draft edits.
 * So the assistant defines this PORT, and the HOST (apps/server) binds it to a
 * draft-scoped WyStack app: every `query()` call routes through
 * `app.runHandler(path, args, tracked, { draftId })` — the withDraftSeam read
 * path. The assistant never sees the DB, the draftId wiring, or the canonical-vs-
 * draft choice; the host owns that and hands back a reader already scoped to the
 * draft. The reader is the single egress boundary for structure; ./floor.ts is
 * the single egress boundary for values.
 */

import type {
  ArtifactKind,
  DataSource,
  DataTable,
  Insight,
  UUID,
  Visualization,
} from "@dashframe/types";

// ---------------------------------------------------------------------------
// Node identity
// ---------------------------------------------------------------------------

/**
 * A node in the artifact graph: an artifact's kind + id. The kind is the
 * canonical `ArtifactKind` from @dashframe/types — the same enum the server's
 * polymorphic rename/delete handlers resolve against, so the assistant's graph
 * vocabulary never forks from the artifact model.
 */
export interface NodeRef {
  kind: ArtifactKind;
  id: UUID;
}

/**
 * A dataframe's read shape — the STRUCTURE the assistant navigates. A minimal,
 * self-owned view (id, name, the insight back-edge, field ids, shape counts);
 * the assistant deliberately does NOT couple to the server-private DataFrameEntry
 * type (it would be a circular import and carries storage internals the read
 * layer must not see). The host maps the server row down to this shape.
 */
export interface DataFrameRead {
  id: UUID;
  name: string;
  /** Back-edge: the insight whose result this dataframe materializes. */
  insightId?: UUID;
  fieldIds: UUID[];
  rowCount?: number;
  columnCount?: number;
}

/** A dashboard's read shape (apps/server dashboards.ts `getDashboard`). */
export interface DashboardRead {
  id: UUID;
  name: string;
  description?: string;
  items: Array<{
    id: UUID;
    type: "visualization" | "markdown";
    visualizationId?: UUID;
    content?: string;
  }>;
}

// ---------------------------------------------------------------------------
// GraphReader port
// ---------------------------------------------------------------------------

/**
 * The structure-read surface. Each method maps 1:1 to a server read function
 * (the host binds it to `app.runHandler("<path>", args, …, { draftId })`).
 *
 * STRUCTURE FLOWS UNGATED. Every value returned here is a DEFINITION (names,
 * types, edge ids, encoding shape) — never row data. Row/value data is a
 * separate egress: it flows ONLY through `readDataProfile` (and ./floor.ts).
 * DataSource configs already arrive credential-free from the server seam
 * (presence booleans, never secrets — see app-artifacts.ts `rowToDataSource`).
 */
export interface GraphReader {
  // --- single-artifact definition reads (structure, ungated) ---
  getDataSource(id: UUID): Promise<DataSource | null>;
  getDataTable(id: UUID): Promise<DataTable | null>;
  getDataFrameEntry(id: UUID): Promise<DataFrameRead | null>;
  getInsight(id: UUID): Promise<Insight | null>;
  getVisualization(id: UUID): Promise<Visualization | null>;
  getDashboard(id: UUID): Promise<DashboardRead | null>;

  // --- list / find (structure, ungated) ---
  listDataSources(): Promise<DataSource[]>;
  listDataTables(dataSourceId?: UUID): Promise<DataTable[]>;
  listDataFrames(): Promise<DataFrameRead[]>;
  listInsights(): Promise<Insight[]>;
  listVisualizations(insightId?: UUID): Promise<Visualization[]>;
  listDashboards(): Promise<DashboardRead[]>;
  /** Back-edge: the DataFrame an insight's result is materialized into. */
  getDataFrameByInsight(insightId: UUID): Promise<DataFrameRead | null>;

  /**
   * Tiered DATA read for one artifact (a table or an insight result). This is
   * the VALUE egress — the host implementation MUST route the returned payload
   * through the privacy floor (./floor.ts). Returns column PROFILES only in
   * v0.3 (the conservative floor until the perception assembler lands;
   * see ./floor.ts). The reader exposes it so the data tool (./tools.ts) never
   * reaches past the port for row data.
   */
  readDataProfile(node: NodeRef): Promise<DataReadResult>;

  /**
   * Open a project SOURCE file as text — the agent's BACKUP/verification path
   * for the command vocabulary (the crafted guide in ./command-guide.ts is the
   * PRIMARY reference; this lets the agent fall back to `commands.ts` when the
   * guide is insufficient or suspected stale). Host-scoped to an allowlist of
   * readable source files; returns `null` for anything not allowlisted.
   */
  readSource(file: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Data-read result (value egress shape)
// ---------------------------------------------------------------------------

/**
 * Per-column profile — SHAPE, never raw rows. The floor-held default until the
 * perception assembler can produce the tiered profile→obfuscated→real
 * sample. `sensitivity` is the column's own classification (inherit-source key).
 */
export interface ColumnProfile {
  name: string;
  type: string;
  sensitivity: "unclassified" | "sensitive" | "cleared";
  /** Non-row statistics safe to surface at every tier (counts, null-rate). */
  stats?: {
    rowCount?: number;
    nullCount?: number;
    distinctCount?: number;
  };
}

/**
 * The result of a tiered data read. STRUCTURE (the column profiles' names/types/
 * sensitivity) is always present and ungated. Whether the read is MASKED is the
 * binary inherit-source decision (./floor.ts): any source column sensitive →
 * masked. `sample` is reserved for the post-assembler tiered real/obfuscated rows;
 * it is ALWAYS `undefined` in v0.3 (profiles-only).
 */
export interface DataReadResult {
  node: NodeRef;
  /** True when any contributing source column is sensitive (inherit-source). */
  masked: boolean;
  /** Per-column profiles — the only value data v0.3 emits. */
  columns: ColumnProfile[];
  /**
   * Reserved seam: tiered row sample (real | obfuscated). Wires to the
   * perception assembler when it lands; ALWAYS `undefined` until then.
   */
  sample?: never;
}
