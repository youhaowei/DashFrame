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
import { syncSchema } from "@wystack/db";
import { drizzlePglite } from "@wystack/db/pg";

import { schema } from "./schema";

export type ArtifactDb = ReturnType<typeof drizzlePglite<typeof schema>>;

export const ARTIFACT_DB_SCHEMA_VERSION = 1;

export interface OpenArtifactDbOptions {
  /** Filesystem path to the database file, e.g. "~/.DashFrame/default-project/artifacts.db". */
  path: string;
}

export async function openArtifactDb(
  options: OpenArtifactDbOptions,
): Promise<ArtifactDb> {
  const client = new PGlite(options.path);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  await syncSchema(db, schema);
  return db;
}
