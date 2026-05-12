/**
 * Open (or initialize) a DashFrame project on disk.
 *
 * Layout materialized:
 *   <dir>/
 *     artifacts.db          # PGLite, tables via syncSchema
 *     data/sources/         # Parquet files, one per imported DataSource
 *
 * On first open, `project_meta` is seeded with a freshly generated
 * `project_id`, creator version, `schema_version = ARTIFACT_DB_SCHEMA_VERSION`,
 * and the current OS user as `created_by`. Subsequent opens are no-ops on the
 * metadata row.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";

import {
  ARTIFACT_DB_SCHEMA_VERSION,
  openArtifactDb,
  type ArtifactDb,
} from "./db";
import {
  resolveProjectDir,
  type ResolveProjectDirOptions,
} from "./project-dir";
import {
  PROJECT_META_ID,
  PROJECT_META_SINGLETON_KEY,
  projectMeta,
  type ProjectMetaRow,
} from "./schema";
import { DASHFRAME_PROJECT_VERSION } from "./version";

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
  /** Flush pending writes and close the underlying PGlite connection. */
  close(): Promise<void>;
}

export type { ProjectMetaRow };

export interface OpenProjectOptions extends ResolveProjectDirOptions {
  /** Project display name used on first-run seed. Defaults to folder name. */
  name?: string;
  /** Creator identity stamp. Defaults to `os.userInfo().username`. */
  createdBy?: string;
  /** DashFrame semver that created the project. */
  version?: string;
}

export async function openProject(
  options: OpenProjectOptions = {},
): Promise<ProjectHandle> {
  const dir = resolveProjectDir(options);
  const dbPath = path.join(dir, ARTIFACTS_DB_FILENAME);
  const dataSourcesDir = path.join(dir, DATA_SOURCES_DIRNAME);

  await fs.mkdir(dataSourcesDir, { recursive: true });

  const db = await openArtifactDb({ path: dbPath });
  let meta: ProjectMetaRow;
  try {
    meta = await ensureProjectMeta(db, {
      name: options.name ?? path.basename(dir),
      createdBy: options.createdBy ?? safeUsername(),
      version: options.version ?? DASHFRAME_PROJECT_VERSION,
    });
  } catch (err) {
    await db.$client.close().catch(() => {});
    throw err;
  }

  const close = () => db.$client.close();
  return { dir, dbPath, dataSourcesDir, db, meta, close };
}

async function ensureProjectMeta(
  db: ArtifactDb,
  seed: { name: string; createdBy: string; version: string },
): Promise<ProjectMetaRow> {
  const existing = await db
    .select()
    .from(projectMeta)
    .where(eq(projectMeta.id, PROJECT_META_ID))
    .limit(1);
  if (existing.length > 0) {
    const meta = existing[0]!;
    if (meta.schemaVersion !== ARTIFACT_DB_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported project schema version ${meta.schemaVersion}; expected ${ARTIFACT_DB_SCHEMA_VERSION}.`,
      );
    }
    return meta;
  }

  const [inserted] = await db
    .insert(projectMeta)
    .values({
      id: PROJECT_META_ID,
      singletonKey: PROJECT_META_SINGLETON_KEY,
      version: seed.version,
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
