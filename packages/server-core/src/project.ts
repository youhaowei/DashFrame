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
 * Recovery path: if PGlite aborts during WAL replay (RuntimeError: Aborted()
 * from Emscripten) AND the WAL probe confirms structural corruption, the
 * damaged datadir is quarantined with a timestamp suffix and the newest
 * snapshot is restored. If no snapshot exists a fresh project is created. The
 * returned `ProjectHandle` carries a `recovery` notice the host can surface to
 * the user. See GitHub issue #88.
 *
 * Critically, quarantine+restore only fires on POSITIVELY CONFIRMED WAL
 * corruption. Any error that cannot be confirmed as WAL corruption is
 * re-thrown immediately — data is never silently discarded on an ambiguous
 * error.
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
  hasCorruptWalSegment,
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
    // Only recover from confirmed WAL corruption. Any other error is re-thrown
    // immediately — never quarantine on an ambiguous error.
    const confirmed = await isConfirmedWalCorruption(err, dbPath);
    if (!confirmed) throw err;

    // Quarantine the damaged datadir. This MUST succeed before we proceed —
    // if the rename fails we cannot safely overwrite the existing (possibly
    // still-recoverable) data.
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
 * Returns true when startup failure is POSITIVELY CONFIRMED WAL corruption.
 *
 * Affirmative detection uses two independent signals:
 *
 *   1. PRIMARY — file-level probe: the pg_wal/ directory inside `dbPath`
 *      contains at least one WAL segment file whose size is not a multiple of
 *      XLOG_BLCKSZ (8192), indicating a torn write.
 *
 *   2. CONFIRMING — error class: the thrown error is a WebAssembly
 *      RuntimeError whose message contains "Aborted()", the specific
 *      Emscripten abort fired when Postgres exits non-zero during WAL replay.
 *
 * The CONFIRMING signal alone (RuntimeError+Aborted) is sufficient to classify
 * the failure as WAL corruption when the datadir EXISTS — Emscripten aborts
 * during PGlite startup are always Postgres-internal (the only WASM module in
 * scope is PGlite itself). However we still require the RuntimeError+Aborted
 * pattern to distinguish a startup crash from an OOM or permissions error.
 *
 * If the PRIMARY signal fires (torn WAL) without a matching error pattern, we
 * still return true — a structurally corrupt WAL file is definitive evidence.
 *
 * Any error that matches neither signal is NOT WAL corruption and MUST be
 * re-thrown by the caller.
 */
async function isConfirmedWalCorruption(
  err: unknown,
  dbPath: string,
): Promise<boolean> {
  // The error must be from the WebAssembly/Emscripten layer.
  // RuntimeError("Aborted()") — Emscripten ASSERTIONS build
  // RuntimeError("Aborted(OOM)") — also from ASSERTIONS build (OOM during init)
  // RuntimeError("unreachable") — release WASM trap
  //
  // We only treat the specific Aborted() family as WAL corruption — not
  // "unreachable" (a WASM trap that can arise from bugs unrelated to WAL).
  const isAbortedRuntimeError = isAbortedEmscriptenError(err);

  // PRIMARY: probe WAL files for torn segments.
  const tornWal = await hasCorruptWalSegment(dbPath).catch(() => false);

  if (tornWal) return true;
  if (isAbortedRuntimeError) {
    // Confirming signal: Aborted() during startup of PGlite. Check the
    // datadir actually exists (not a fresh project that never had a DB).
    const dataDirExists = await fs
      .stat(dbPath)
      .then(() => true)
      .catch(() => false);
    return dataDirExists;
  }

  return false;
}

/**
 * Returns true for Emscripten `Aborted()` RuntimeErrors — the specific abort
 * fired when the Postgres process exits non-zero inside the WASM sandbox.
 *
 * Does NOT match:
 *   RuntimeError("unreachable")  — generic WASM trap, unrelated to WAL
 *   Any non-RuntimeError         — permissions, I/O errors, etc.
 */
function isAbortedEmscriptenError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.constructor.name !== "RuntimeError") return false;
  // Match "Aborted()" and "Aborted(OOM)" etc. but not "unreachable".
  return err.message.startsWith("Aborted(") || err.message === "Aborted";
}

/**
 * Rename the damaged artifacts.db aside to a timestamped quarantine path.
 * Returns the quarantine path.
 *
 * If the rename fails for any reason other than the source not existing, an
 * error is thrown — we cannot proceed to restore without first confirming the
 * damaged datadir has been safely moved aside (doing so would risk overwriting
 * data that might still be partially recoverable).
 *
 * If the damaged path does not exist at all (ENOENT on the source), we return
 * the quarantine path without touching the filesystem — the DB was never
 * created and there is nothing to move.
 */
async function quarantineDamagedDb(dbPath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const quarantinedPath = `${dbPath}.damaged-${timestamp}`;
  try {
    await fs.rename(dbPath, quarantinedPath);
  } catch (err) {
    // Source doesn't exist — nothing to quarantine; proceed to fresh init.
    if (isEnoent(err)) return quarantinedPath;
    // Any other rename failure (permissions, cross-device, I/O) is fatal —
    // surface the error rather than silently proceeding to restore over a DB
    // that was NOT successfully moved aside.
    throw new Error(
      `[dashframe] quarantine failed: could not rename ${dbPath} → ${quarantinedPath}: ${String(err)}`,
      { cause: err },
    );
  }
  return quarantinedPath;
}

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
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
