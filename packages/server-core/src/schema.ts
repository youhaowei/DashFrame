/**
 * Drizzle schemas for DashFrame v0.2 artifact storage.
 *
 * Artifacts live in `project/artifacts.db` (PGLite). Bulk data stays out of
 * the database as Parquet files under `project/data/sources/<id>.parquet`.
 * Secrets are encrypted at rest here; the decryption key lives outside the
 * folder (OS keychain in Electron).
 */

import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const PROJECT_META_ID = "project";
export const PROJECT_META_SINGLETON_KEY = 1;

export interface ArtifactProvenance {
  kind: "user" | "agent";
  id?: string;
  runId?: string;
}

// bytea isn't a first-class column type in drizzle-orm/pg-core yet; wrap it.
const bytea = customType<{ data: Uint8Array; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

// project_meta — exactly one row per project. Holds version + identity.
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

// secrets — encrypted API keys / passwords keyed by source + name.
// ciphertext format: [nonce(12B) | ciphertext | tag(16B)] under AES-256-GCM.
// The encryption key is NOT stored here — see SecretVault docs.
export const secrets = pgTable(
  "secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    secretName: text("secret_name").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("secrets_source_name_unique").on(t.sourceId, t.secretName)],
);

export const schema = {
  projectMeta,
  dataSources,
  dataTables,
  dataFrames,
  insights,
  visualizations,
  dashboards,
  secrets,
} as const;

export type Schema = typeof schema;

export type ProjectMetaRow = typeof projectMeta.$inferSelect;
