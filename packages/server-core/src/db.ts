/**
 * Open / initialize a DashFrame project's artifact database.
 *
 * Each project has its own PGlite database at `<project>/artifacts.db`. On
 * first open, tables are materialized via `syncSchema` (idempotent CREATE
 * TABLE IF NOT EXISTS driven off the Drizzle schema). v0.2.x will layer
 * drizzle-kit migrations on top for real schema evolution; for v0.2 every
 * open converges to the current schema shape — no evolution yet.
 */

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import { schema } from "./schema";
import { syncSchema } from "./sync-schema";
import { DASHFRAME_PROJECT_VERSION } from "./version";

export type ArtifactDb = ReturnType<typeof drizzle<typeof schema>>;

export const ARTIFACT_DB_SCHEMA_VERSION = 2;

export interface OpenArtifactDbOptions {
  /** Filesystem path to the database file, e.g. "~/.DashFrame/default-project/artifacts.db". */
  path: string;
}

export async function openArtifactDb(
  options: OpenArtifactDbOptions,
): Promise<ArtifactDb> {
  const client = new PGlite(options.path);
  await client.waitReady;
  const db = drizzle(client, { schema });
  await runBootstrapMigrations(db);
  await syncSchema(db, schema);
  return db;
}

async function runBootstrapMigrations(db: ArtifactDb): Promise<void> {
  await addProjectVersionColumn(db);
  for (const tableName of [
    "data_sources",
    "insights",
    "visualizations",
    "dashboards",
  ]) {
    await addArtifactProvenanceColumns(db, tableName);
  }

  if (await tableExists(db, "project_meta")) {
    await db.execute(sql`
      UPDATE project_meta
      SET schema_version = ${ARTIFACT_DB_SCHEMA_VERSION}
      WHERE schema_version < ${ARTIFACT_DB_SCHEMA_VERSION}
    `);
  }
}

async function addProjectVersionColumn(db: ArtifactDb): Promise<void> {
  if (!(await tableExists(db, "project_meta"))) return;

  await db.execute(sql`
    ALTER TABLE project_meta
    ADD COLUMN IF NOT EXISTS version text
  `);
  await db.execute(sql`
    UPDATE project_meta
    SET version = ${DASHFRAME_PROJECT_VERSION}
    WHERE version IS NULL
  `);
  await db.execute(sql`
    ALTER TABLE project_meta
    ALTER COLUMN version SET NOT NULL
  `);
}

async function addArtifactProvenanceColumns(
  db: ArtifactDb,
  tableName: string,
): Promise<void> {
  if (!(await tableExists(db, tableName))) return;

  const table = sql.identifier(tableName);
  await db.execute(sql`
    ALTER TABLE ${table}
    ADD COLUMN IF NOT EXISTS created_by jsonb
  `);
  await db.execute(sql`
    UPDATE ${table}
    SET created_by = '{"kind":"user"}'::jsonb
    WHERE created_by IS NULL
  `);
  await db.execute(sql`
    ALTER TABLE ${table}
    ALTER COLUMN created_by SET NOT NULL
  `);
  await db.execute(sql`
    ALTER TABLE ${table}
    ADD COLUMN IF NOT EXISTS parent_artifact_id uuid
  `);
}

async function tableExists(
  db: ArtifactDb,
  tableName: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
    LIMIT 1
  `);
  return result.rows.length > 0;
}
