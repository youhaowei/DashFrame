/**
 * Open (or initialize) a DashFrame project on disk.
 *
 * Layout materialized:
 *   <dir>/
 *     artifacts.db          # PGLite, tables via syncSchema
 *     data/sources/         # Parquet files, one per imported DataSource
 *
 * On first open, `project_meta` is seeded with a freshly generated
 * `project_id`, `schema_version = ARTIFACT_DB_SCHEMA_VERSION`, and the current
 * OS user as `created_by`. Subsequent opens are no-ops on the metadata row.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  ARTIFACT_DB_SCHEMA_VERSION,
  openArtifactDb,
  type ArtifactDb,
} from "./db";
import {
  resolveProjectDir,
  type ResolveProjectDirOptions,
} from "./project-dir";
import { projectMeta } from "./schema";

export const ARTIFACTS_DB_FILENAME = "artifacts.db";
export const DATA_SOURCES_DIRNAME = path.join("data", "sources");

export interface ProjectHandle {
  /** Resolved absolute path to the project folder. */
  dir: string;
  /** Path to the PGLite artifact database file. */
  dbPath: string;
  /** Path to the Parquet storage directory. */
  dataSourcesDir: string;
  /** Opened artifact DB. */
  db: ArtifactDb;
  /** The single `project_meta` row. */
  meta: ProjectMetaRow;
}

export interface ProjectMetaRow {
  id: string;
  projectId: string;
  name: string;
  schemaVersion: number;
  createdAt: Date;
  createdBy: string;
}

export interface OpenProjectOptions extends ResolveProjectDirOptions {
  /** Project display name used on first-run seed. Defaults to folder name. */
  name?: string;
  /** Creator identity stamp. Defaults to `os.userInfo().username`. */
  createdBy?: string;
}

export async function openProject(
  options: OpenProjectOptions = {},
): Promise<ProjectHandle> {
  const dir = resolveProjectDir(options);
  const dbPath = path.join(dir, ARTIFACTS_DB_FILENAME);
  const dataSourcesDir = path.join(dir, DATA_SOURCES_DIRNAME);

  await fs.mkdir(dataSourcesDir, { recursive: true });

  const db = await openArtifactDb({ path: dbPath });
  const meta = await ensureProjectMeta(db, {
    name: options.name ?? path.basename(dir),
    createdBy: options.createdBy ?? safeUsername(),
  });

  return { dir, dbPath, dataSourcesDir, db, meta };
}

async function ensureProjectMeta(
  db: ArtifactDb,
  seed: { name: string; createdBy: string },
): Promise<ProjectMetaRow> {
  const existing = await db.select().from(projectMeta).limit(1);
  if (existing.length > 0) return existing[0]!;

  const [inserted] = await db
    .insert(projectMeta)
    .values({
      name: seed.name,
      projectId: crypto.randomUUID(),
      schemaVersion: ARTIFACT_DB_SCHEMA_VERSION,
      createdBy: seed.createdBy,
    })
    .returning();
  return inserted!;
}

function safeUsername(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "unknown";
  }
}
