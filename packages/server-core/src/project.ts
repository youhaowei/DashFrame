/**
 * Open (or initialize) a DashFrame project on disk.
 *
 * Layout materialized:
 *   <dir>/
 *     artifacts.db          # PGLite, tables via syncSchema
 *     data/sources/         # Parquet files, one per imported DataSource
 *     snapshots/            # Rotating PGLite datadir tarballs (see snapshots.ts)
 *
 * On first open, `project_meta` is seeded with a freshly generated
 * `project_id`, creator version, `schema_version = ARTIFACT_DB_SCHEMA_VERSION`,
 * and the current OS user as `created_by`. Subsequent opens are no-ops on the
 * metadata row.
 *
 * Recovery path: if PGlite aborts during WAL replay (RuntimeError from
 * Emscripten), the damaged datadir is quarantined with a timestamp suffix and
 * the newest snapshot is restored. If no snapshot exists a fresh project is
 * created. The returned `ProjectHandle` carries a `recovery` notice the host
 * can surface to the user. See GitHub issue #88.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";

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
  dataFrames,
  PROJECT_META_ID,
  PROJECT_META_SINGLETON_KEY,
  projectMeta,
  type ProjectMetaRow,
} from "./schema";
import {
  restoreNewestSnapshot,
  SnapshotScheduler,
  writeSnapshot,
  type SnapshotMeta,
} from "./snapshots";
import { DASHFRAME_PROJECT_VERSION } from "./version";

export const ARTIFACTS_DB_FILENAME = "artifacts.db";
export const DATA_SOURCES_DIRNAME = path.join("data", "sources");

/** Set when openProject had to quarantine a damaged datadir. */
export interface ProjectRecoveryNotice {
  /** What happened. */
  reason: "wal-corruption";
  /**
   * The snapshot that was restored, or null when no snapshot was available
   * and the project was re-initialized as a fresh empty project.
   */
  restoredSnapshot: SnapshotMeta | null;
  /** Absolute path to the quarantined damaged datadir. */
  quarantinedPath: string;
}

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
  /**
   * Set when the project was recovered from a corrupt WAL; null on a normal
   * open. The desktop host reads this and surfaces a dialog to the user.
   */
  recovery: ProjectRecoveryNotice | null;
  /**
   * Notify the snapshot scheduler that a write just occurred.
   * Call this after any operation that mutates the artifact DB so the
   * debounced snapshot timer is reset.
   */
  touchSnapshot(): void;
  /** Flush pending writes, write a final snapshot, and close the underlying PGlite connection. */
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
  /**
   * Debounce interval in ms for the post-write snapshot timer.
   * Exposed for tests (set low to avoid real waits).
   * Defaults to SNAPSHOT_DEBOUNCE_MS (30 s).
   */
  snapshotDebounceMs?: number;
}

export async function openProject(
  options: OpenProjectOptions = {},
): Promise<ProjectHandle> {
  const dir = resolveProjectDir(options);
  const dbPath = path.join(dir, ARTIFACTS_DB_FILENAME);
  const dataSourcesDir = path.join(dir, DATA_SOURCES_DIRNAME);

  await fs.mkdir(dataSourcesDir, { recursive: true });

  // --- attempt normal open ---
  let db: ArtifactDb;
  let recovery: ProjectRecoveryNotice | null = null;

  try {
    db = await openArtifactDb({ path: dbPath });
  } catch (err) {
    // WAL-replay aborts surface as RuntimeError from Emscripten — check for
    // that pattern and attempt recovery, but re-throw any other error class.
    if (!isWalCorruptionError(err)) throw err;

    // Quarantine the damaged datadir.
    const quarantinedPath = await quarantineDamagedDb(dbPath);

    // Restore from snapshot (or start fresh).
    const restoredSnapshot = await restoreNewestSnapshot(dir, dbPath);

    // Open the restored (or fresh) datadir.
    db = await openArtifactDb({ path: dbPath });

    recovery = {
      reason: "wal-corruption",
      restoredSnapshot,
      quarantinedPath,
    };
  }

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

  const scheduler = new SnapshotScheduler(
    db.$client,
    dir,
    options.snapshotDebounceMs,
  );

  const close = async () => {
    // Cancel any pending debounced snapshot before writing the final one.
    scheduler.cancel();
    try {
      await writeSnapshot(db.$client, dir);
    } catch (err) {
      console.error("[dashframe] close-time snapshot failed:", err);
    }
    await db.$client.close();
  };

  return {
    dir,
    dbPath,
    dataSourcesDir,
    db,
    meta,
    recovery,
    touchSnapshot: () => scheduler.touch(),
    close,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true for the class of errors that indicate a PGlite WAL-replay
 * abort. Emscripten surfaces unrecoverable WASM errors as WebAssembly
 * RuntimeError instances thrown from `waitReady`. Observed forms:
 *   RuntimeError: Aborted()              — Emscripten ASSERTIONS build
 *   RuntimeError: Aborted(OOM)           — Emscripten ASSERTIONS build
 *   RuntimeError: unreachable            — release WASM trap
 *
 * Any RuntimeError thrown during PGlite startup is an unrecoverable WASM
 * abort; there is no pg_resetwal equivalent in WASM so recovery via snapshot
 * is the only option.
 *
 * We also match the string "Aborted()" for runtimes that may not preserve the
 * class name across module boundaries.
 */
function isWalCorruptionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // RuntimeError is the WebAssembly/Emscripten error class.
  return (
    err.constructor.name === "RuntimeError" || err.message.includes("Aborted()")
  );
}

/**
 * Rename the damaged artifacts.db aside to a timestamped quarantine path.
 * Returns the quarantine path.
 *
 * If the damaged path does not exist (shouldn't happen, but be defensive),
 * returns a synthetic path without touching the filesystem.
 */
async function quarantineDamagedDb(dbPath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantinedPath = `${dbPath}.damaged-${timestamp}`;
  try {
    await fs.rename(dbPath, quarantinedPath);
  } catch {
    // Directory may not exist yet or rename may fail; log but proceed.
    console.error(
      `[dashframe] could not quarantine ${dbPath} → ${quarantinedPath}`,
    );
  }
  return quarantinedPath;
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
    let meta = existing[0]!;
    if (meta.schemaVersion === 2) {
      // v2→v3 migration: strip raw sampleValues from all persisted
      // DataFrameAnalysis. `analysis` is a JSONB column whose `columns` array
      // may contain `sampleValues` arrays with raw cell values. The privacy
      // floor requires zero raw values at rest.
      //
      // The jsonb_set + jsonb_path_query_array call rewrites every element
      // of the `columns` array to remove the `sampleValues` key, leaving
      // all other profile fields (cardinality, nullCount, min/max, …) intact.
      // Rows where `analysis` IS NULL are untouched by the WHERE clause.
      await db.execute(sql`
        UPDATE ${dataFrames}
        SET analysis = jsonb_set(
          analysis,
          '{columns}',
          COALESCE(
            (
              SELECT jsonb_agg(jsonb_set(col, '{sampleValues}', '[]'::jsonb))
              FROM jsonb_array_elements(analysis->'columns') AS col
            ),
            '[]'::jsonb
          )
        )
        WHERE analysis IS NOT NULL
          AND analysis ? 'columns'
      `);
      // Bump schemaVersion to 3 so this migration does not re-run.
      const [updated] = await db
        .update(projectMeta)
        .set({ schemaVersion: ARTIFACT_DB_SCHEMA_VERSION })
        .where(eq(projectMeta.id, PROJECT_META_ID))
        .returning();
      meta = updated!;
    } else if (meta.schemaVersion !== ARTIFACT_DB_SCHEMA_VERSION) {
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
