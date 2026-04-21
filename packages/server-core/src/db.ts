/**
 * Open / initialize a DashFrame project's artifact database.
 *
 * Each project has its own PGlite database at `<project>/artifacts.db`. On
 * first open, the schema is created via idempotent `CREATE TABLE IF NOT
 * EXISTS` statements. v0.2.x will migrate to drizzle-kit-generated migrations
 * once a second schema revision lands — for v0.2 the bootstrap DDL here is
 * the single source of truth.
 */

import { PGlite } from "@electric-sql/pglite";
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
  await ensureSchema(client);
  return drizzlePglite(client, { schema });
}

// DDL runs on the raw PGlite client — dialect-specific, kept out of the
// Drizzle query layer. PGlite 0.2.x exposes `gen_random_uuid()` natively so
// no pgcrypto extension is required for defaults.
async function ensureSchema(client: PGlite): Promise<void> {
  await client.exec(DDL);
}

const DDL = `
  CREATE TABLE IF NOT EXISTS project_meta (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      uuid        NOT NULL UNIQUE,
    name            text        NOT NULL,
    schema_version  integer     NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text        NOT NULL
  );

  CREATE TABLE IF NOT EXISTS data_sources (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text        NOT NULL,
    kind         text        NOT NULL,
    storage      text        NOT NULL,
    config       jsonb       NOT NULL,
    schema       jsonb,
    row_count    integer,
    last_import  timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS insights (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    definition  jsonb       NOT NULL,
    schema      jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS visualizations (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    insight_id  uuid        NOT NULL REFERENCES insights(id) ON DELETE CASCADE,
    name        text        NOT NULL,
    chart_type  text        NOT NULL,
    encoding    jsonb       NOT NULL,
    options     jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS dashboards (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text        NOT NULL,
    layout      jsonb       NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS secrets (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id    uuid        NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    secret_name  text        NOT NULL,
    ciphertext   bytea       NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT secrets_source_name_unique UNIQUE (source_id, secret_name)
  );
`;
