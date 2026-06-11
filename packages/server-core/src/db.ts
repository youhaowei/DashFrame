/**
 * Open / initialize a DashFrame project's artifact database.
 *
 * Each project has its own PGlite database at `<project>/artifacts.db`. On
 * first open, tables are materialized via `syncSchema` (idempotent CREATE
 * TABLE IF NOT EXISTS driven off the Drizzle schema). Pre-release: every
 * open converges to the current schema shape, no migration ladder.
 */

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { schema } from "./schema";
import { syncSchema } from "./sync-schema";

export type ArtifactDb = ReturnType<typeof drizzle<typeof schema>>;

// Bump on any artifact-schema change. syncSchema is CREATE TABLE IF NOT EXISTS
// (no ALTER), so existing project DBs do NOT pick up column additions. The
// version check in openProject() rejects a stale DB with an explicit
// "Unsupported project schema version" error instead of letting a later query
// fail on a missing column. Pre-release policy is wipe-and-recreate, not a
// migration ladder.
// v2: added dashboards.description; added data_tables, data_frames.
// v3: strip raw sampleValues from data_frames.analysis (privacy floor).
export const ARTIFACT_DB_SCHEMA_VERSION = 3;

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
  await syncSchema(db, schema);
  return db;
}
