/**
 * Drizzle schemas for DashFrame v0.2 artifact storage.
 *
 * Artifacts live in `project/artifacts.db` (PGLite). Bulk data stays out of
 * the database as Parquet files under `project/data/sources/<id>.parquet`.
 * Credentials (apiKey, connectionString) in the `config` jsonb column of
 * `data_sources` are stored as SecretRefs (`secret:<uuid>`) — never plaintext.
 * The actual secrets live in the OS keychain via the SecretVault substrate; the
 * `secret_mappings` table persists the ref → backend/locator binding so refs
 * stay resolvable across restarts.
 *
 * Draft overlay tables (`<table>__draft`):
 * Six artifact tables have a parallel `__draft` shadow that the @wystack/db
 * `withDraft` primitive resolves against for coalesced reads and sparse writes.
 * Each shadow carries `draft_id TEXT NOT NULL` + the
 * canonical columns (sparse — NULLs mean "no override") + `__tombstone
 * BOOLEAN NOT NULL DEFAULT false`, keyed `(draft_id, id)`.
 *
 * SECURITY INVARIANT: credentials are NEVER drafted. `secret_mappings` and
 * `project_meta` have NO shadow — they are infrastructure/singleton tables
 * that route through the SecretVault, not the draft overlay. A
 * `secret_mappings__draft` table would be a credential-in-draft leak surface.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const PROJECT_META_ID = "project";
export const PROJECT_META_SINGLETON_KEY = 1;

export interface ArtifactProvenance {
  kind: "user" | "agent";
  id?: string;
  runId?: string;
}

// ─── Canonical tables ─────────────────────────────────────────────────────────

// project_meta — exactly one row per project. Holds version + identity.
// NOT drafted: singleton infrastructure, never modified via the draft overlay.
export const projectMeta = pgTable("project_meta", {
  id: text("id").primaryKey(),
  singletonKey: integer("singleton_key")
    .notNull()
    .unique()
    .default(PROJECT_META_SINGLETON_KEY),
  version: text("version").notNull(),
  projectId: uuid("project_id").notNull().unique(),
  name: text("name").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text("created_by").notNull(),
});

// data_sources — connector definitions. `config` + `schema` are JSON payloads
// whose shape depends on `kind` (see Data Sources spec).
export const dataSources = pgTable(
  "data_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // 'csv' | 'json' | 'parquet' | 'notion' | 'postgres'
    storage: text("storage").notNull(), // 'parquet' | 'live'
    config: jsonb("config").notNull(),
    schema: jsonb("schema"),
    contentHash: text("content_hash"),
    rowCount: integer("row_count"),
    lastImport: timestamp("last_import", { withTimezone: true }),
    createdBy: jsonb("created_by").$type<ArtifactProvenance>().notNull(),
    parentArtifactId: uuid("parent_artifact_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("data_sources_parent_artifact_id_idx").on(t.parentArtifactId)],
);

// data_tables — renderer-facing table metadata. Bulk rows remain outside
// PGLite; `dataFrameId` links to the browser-side DataFrame metadata row.
export const dataTables = pgTable(
  "data_tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dataSourceId: uuid("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    table: text("table").notNull(),
    sourceSchema: jsonb("source_schema"),
    fields: jsonb("fields").notNull(),
    metrics: jsonb("metrics").notNull(),
    dataFrameId: uuid("data_frame_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  },
  (t) => [index("data_tables_data_source_id_idx").on(t.dataSourceId)],
);

// data_frames — browser DataFrame metadata only. Arrow bytes remain in the
// renderer's IndexedDB storage via @dashframe/engine-browser.
export const dataFrames = pgTable(
  "data_frames",
  {
    id: uuid("id").primaryKey(),
    storage: jsonb("storage").notNull(),
    fieldIds: jsonb("field_ids").notNull(),
    primaryKey: jsonb("primary_key"),
    name: text("name").notNull(),
    insightId: uuid("insight_id"),
    rowCount: integer("row_count"),
    columnCount: integer("column_count"),
    analysis: jsonb("analysis"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("data_frames_insight_id_idx").on(t.insightId)],
);

// insights — query definitions. `definition` holds the structured IR
// (sources, fields, filters, aggregates, group-by, joins, sort, limit).
export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    definition: jsonb("definition").notNull(),
    schema: jsonb("schema"),
    createdBy: jsonb("created_by").$type<ArtifactProvenance>().notNull(),
    parentArtifactId: uuid("parent_artifact_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("insights_parent_artifact_id_idx").on(t.parentArtifactId)],
);

// visualizations — Vega-Lite inputs. Spec is derived on render from
// chartType + encoding + options + Insight result schema (not stored).
export const visualizations = pgTable(
  "visualizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    insightId: uuid("insight_id")
      .notNull()
      .references(() => insights.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    chartType: text("chart_type").notNull(), // 'bar' | 'line' | 'area' | 'scatter' | 'kpi' (v0.2)
    encoding: jsonb("encoding").notNull(),
    options: jsonb("options"),
    createdBy: jsonb("created_by").$type<ArtifactProvenance>().notNull(),
    parentArtifactId: uuid("parent_artifact_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("visualizations_parent_artifact_id_idx").on(t.parentArtifactId),
  ],
);

// dashboards — grid layout of Visualization and text/markdown tiles.
export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    layout: jsonb("layout").notNull(), // domain DashboardItem[]: [{ id, type, visualizationId?, content?, x, y, width, height }]
    controls: jsonb("controls"), // domain DashboardControl[]: [{id, field, label?, defaultValue?, boundInstances}]
    createdBy: jsonb("created_by").$type<ArtifactProvenance>().notNull(),
    parentArtifactId: uuid("parent_artifact_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("dashboards_parent_artifact_id_idx").on(t.parentArtifactId)],
);

// secret_mappings — the SecretVault ref → backend/locator binding, persisted.
//
// This is the join key between two stores that BOTH persist independently:
//   - `data_sources.config` holds the opaque ref (`secret:<uuid>`) on disk.
//   - the keychain backend holds the encrypted blob under its `locator` on disk.
// The mapping is the ONLY thing that knows which backend + locator a given ref
// resolves to. Holding it in memory (the substrate's InMemoryMappingStore) loses
// it on every restart, leaving every persisted ref permanently unresolvable —
// `vault.has(ref)` returns false and `vault.withSecret(ref, …)` throws. Persisting
// it in the SAME project DB as the ref keeps the two in one transactional/backup
// boundary so they can never drift. See DrizzleMappingStore in mapping-store.ts.
//
// NOT drafted: credential infrastructure. SECURITY BOUNDARY — a
// `secret_mappings__draft` would be a credential-in-draft leak surface.
export const secretMappings = pgTable("secret_mappings", {
  // The SecretRef (`secret:<uuid>`) — the stable handle minted by vault.store().
  ref: text("ref").primaryKey(),
  // The name the backend was registered under in the SecretRegistry.
  backend: text("backend").notNull(),
  // Backend-internal opaque identifier returned by SecretBackend.store().
  locator: text("locator").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Draft shadow tables ──────────────────────────────────────────────────────
//
// Each `<table>__draft` is the sparse overlay the @wystack/db `withDraft`
// primitive reads from (via FULL OUTER JOIN coalesce) and
// writes into (via sparse upsert + tombstone). Contract:
//
//   - Same columns as canonical, all NULLABLE (a NULL means "no override").
//   - `draft_id TEXT NOT NULL` — scopes rows to one open draft.
//   - `__tombstone BOOLEAN NOT NULL DEFAULT false` — marks deleted rows.
//   - Composite PK `(draft_id, id)` — the key the withDraft write-path
//     uses for ON CONFLICT upsert (must match exactly).
//
// Reads: canonical ⊕ draft delta — a no-draft read never touches these tables
// (zero-overhead property). Writes: only changed/created/tombstoned rows land
// here; the canonical table stays pristine until publish (replay via command log).
//
// SECURITY INVARIANT: credentials are never drafted. `secret_mappings` and
// `project_meta` have NO shadow. This is a hard boundary.

export const dataSourcesDraft = pgTable(
  "data_sources__draft",
  {
    draftId: text("draft_id").notNull(),
    id: uuid("id").notNull(),
    // Sparse overrides — nullable: a NULL means "no change to this column".
    name: text("name"),
    kind: text("kind"),
    storage: text("storage"),
    config: jsonb("config"),
    schema: jsonb("schema"),
    contentHash: text("content_hash"),
    rowCount: integer("row_count"),
    lastImport: timestamp("last_import", { withTimezone: true }),
    createdBy: jsonb("created_by").$type<ArtifactProvenance>(),
    parentArtifactId: uuid("parent_artifact_id"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    // Draft control columns — owned by the withDraft write-path.
    tombstone: boolean("__tombstone").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.id] })],
);

export const dataTablesDraft = pgTable(
  "data_tables__draft",
  {
    draftId: text("draft_id").notNull(),
    id: uuid("id").notNull(),
    // Sparse overrides.
    dataSourceId: uuid("data_source_id"),
    name: text("name"),
    table: text("table"),
    sourceSchema: jsonb("source_schema"),
    fields: jsonb("fields"),
    metrics: jsonb("metrics"),
    dataFrameId: uuid("data_frame_id"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    // Draft control columns.
    tombstone: boolean("__tombstone").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.id] })],
);

export const dataFramesDraft = pgTable(
  "data_frames__draft",
  {
    draftId: text("draft_id").notNull(),
    id: uuid("id").notNull(),
    // Sparse overrides.
    storage: jsonb("storage"),
    fieldIds: jsonb("field_ids"),
    primaryKey: jsonb("primary_key"),
    name: text("name"),
    insightId: uuid("insight_id"),
    rowCount: integer("row_count"),
    columnCount: integer("column_count"),
    analysis: jsonb("analysis"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    // Draft control columns.
    tombstone: boolean("__tombstone").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.id] })],
);

export const insightsDraft = pgTable(
  "insights__draft",
  {
    draftId: text("draft_id").notNull(),
    id: uuid("id").notNull(),
    // Sparse overrides.
    name: text("name"),
    definition: jsonb("definition"),
    schema: jsonb("schema"),
    createdBy: jsonb("created_by").$type<ArtifactProvenance>(),
    parentArtifactId: uuid("parent_artifact_id"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    // Draft control columns.
    tombstone: boolean("__tombstone").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.id] })],
);

export const visualizationsDraft = pgTable(
  "visualizations__draft",
  {
    draftId: text("draft_id").notNull(),
    id: uuid("id").notNull(),
    // Sparse overrides.
    insightId: uuid("insight_id"),
    name: text("name"),
    chartType: text("chart_type"),
    encoding: jsonb("encoding"),
    options: jsonb("options"),
    createdBy: jsonb("created_by").$type<ArtifactProvenance>(),
    parentArtifactId: uuid("parent_artifact_id"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    // Draft control columns.
    tombstone: boolean("__tombstone").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.id] })],
);

export const dashboardsDraft = pgTable(
  "dashboards__draft",
  {
    draftId: text("draft_id").notNull(),
    id: uuid("id").notNull(),
    // Sparse overrides.
    name: text("name"),
    description: text("description"),
    layout: jsonb("layout"),
    controls: jsonb("controls"),
    createdBy: jsonb("created_by").$type<ArtifactProvenance>(),
    parentArtifactId: uuid("parent_artifact_id"),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    // Draft control columns.
    tombstone: boolean("__tombstone").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.id] })],
);

// ─── Draft command log ────────────────────────────────────────────────────────
//
// Stores the ordered `DraftCommand[]` per draft for replay at publish time.
// Publish = command-log replay (NOT a row-delta copy): the command log
// preserves INTENT GROUPING that a row-delta cannot reconstruct.
//
// Compaction: each append compacts the log per compactionKey, collapsing
// add-tweak-delete chains to net effect so the log cannot grow unbounded.
// The compaction algorithm (from @wystack/server `compactLog`):
//   - create + later delete  → both dropped (row never existed canonically)
//   - redundant updates      → only the last survives
//   - create + later updates → create kept + last update kept (in order)
//   - delete of canonical    → kept, supersedes prior updates
//   - no compactionKey/kind  → kept as-is (order preserved)
//
// The delta tables answer reads; the command log is the PUBLISH source.
// Different artifacts, different jobs.
export const draftCommandLog = pgTable(
  "draft_command_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: text("draft_id").notNull(),
    // Sequence position within this draft (monotonically increasing per draft).
    // Used to preserve replay order after compaction.
    seq: integer("seq").notNull(),
    // The command envelope: path + args (opaque JSON). Mirrors DraftCommand from
    // @wystack/server — `path` names the handler, `args` are the call arguments.
    path: text("path").notNull(),
    args: jsonb("args"),
    // Compaction fields (nullable: a plain Command with no key is never
    // compacted). These mirror DraftCommand.compactionKey / DraftCommand.kind.
    compactionKey: text("compaction_key"),
    kind: text("kind"), // 'create' | 'update' | 'delete' | null
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("draft_command_log_draft_id_seq_idx").on(t.draftId, t.seq)],
);

// ─── Schema export ────────────────────────────────────────────────────────────

export const schema = {
  // Canonical artifact tables
  projectMeta,
  dataSources,
  dataTables,
  dataFrames,
  insights,
  visualizations,
  dashboards,
  // Credential infrastructure — NOT drafted (security boundary)
  secretMappings,
  // Draft shadow tables (artifact overlay)
  dataSourcesDraft,
  dataTablesDraft,
  dataFramesDraft,
  insightsDraft,
  visualizationsDraft,
  dashboardsDraft,
  // Draft command log — publish source (replay at publish, not for reads)
  draftCommandLog,
} as const;

export type Schema = typeof schema;

export type ProjectMetaRow = typeof projectMeta.$inferSelect;
