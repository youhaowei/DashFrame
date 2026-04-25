/**
 * Drizzle schemas for DashFrame v0.2 artifact storage.
 *
 * Artifacts live in `project/artifacts.db` (PGLite). Bulk data stays out of
 * the database as Parquet files under `project/data/sources/<id>.parquet`.
 * Secrets are encrypted at rest here; the decryption key lives outside the
 * folder (OS keychain in Electron, `DASHFRAME_PROJECT_KEY` env var in the
 * standalone `dashframe serve` mode).
 */

import {
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "@wystack/db/pg";

// bytea isn't a first-class column type in drizzle-orm/pg-core yet; wrap it.
const bytea = customType<{ data: Uint8Array; notNull: false; default: false }>({
  dataType() {
    return "bytea";
  },
});

// project_meta — exactly one row per project. Holds version + identity.
export const projectMeta = pgTable("project_meta", {
  id: uuid("id").primaryKey().defaultRandom(),
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
export const dataSources = pgTable("data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // 'csv' | 'json' | 'notion' | 'duckdb' | 'postgres'
  storage: text("storage").notNull(), // 'parquet' | 'live'
  config: jsonb("config").notNull(),
  schema: jsonb("schema"),
  rowCount: integer("row_count"),
  lastImport: timestamp("last_import", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// insights — query definitions. `definition` holds the structured IR
// (sources, fields, filters, aggregates, group-by, joins, sort, limit).
export const insights = pgTable("insights", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  definition: jsonb("definition").notNull(),
  schema: jsonb("schema"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// visualizations — Vega-Lite inputs. Spec is derived on render from
// chartType + encoding + options + Insight result schema (not stored).
export const visualizations = pgTable("visualizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  insightId: uuid("insight_id")
    .notNull()
    .references(() => insights.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  chartType: text("chart_type").notNull(), // 'bar' | 'line' | 'area' | 'scatter' | 'kpi' (v0.2)
  encoding: jsonb("encoding").notNull(),
  options: jsonb("options"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// dashboards — grid layout of Visualization tiles.
export const dashboards = pgTable("dashboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  layout: jsonb("layout").notNull(), // [{ vizId, x, y, w, h }]
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

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
  insights,
  visualizations,
  dashboards,
  secrets,
} as const;

export type Schema = typeof schema;
