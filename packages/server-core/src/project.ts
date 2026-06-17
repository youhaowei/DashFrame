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
 * Recovery path: if a startup failure is accompanied by a structurally torn WAL
 * segment on disk (a `pg_wal/` file whose size is not a multiple of XLOG_BLCKSZ),
 * the damaged datadir is quarantined with a timestamp suffix and the newest
 * snapshot is restored. If no snapshot exists a fresh project is created. The
 * returned `ProjectHandle` carries a `recovery` notice the host can surface to
 * the user. See GitHub issue #88.
 *
 * Critically, quarantine+restore only fires on a POSITIVELY CONFIRMED torn WAL
 * segment. An Emscripten abort alone is NOT sufficient — `RuntimeError("Aborted(OOM)")`
 * (out of memory) and any other non-WAL abort leave the on-disk datadir intact,
 * so recovering on them would overwrite a healthy database. Any failure that
 * cannot be tied to a torn WAL segment is re-thrown immediately — data is never
 * silently discarded on an ambiguous error.
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
  type FailedRestoreAttempt,
  type SnapshotMeta,
} from "./snapshots";
import { DASHFRAME_PROJECT_VERSION } from "./version";

export const ARTIFACTS_DB_FILENAME = "artifacts.db";
export const DATA_SOURCES_DIRNAME = path.join("data", "sources");

/**
 * Result of closing a project.
 *
 * Scope: `CloseResult` models snapshot durability only. A snapshot failure
 * does not prevent the underlying PGlite connection from closing — the
 * connection is always torn down, and the outcome is surfaced here so the
 * caller can log a warning, show a dialog, or handle it appropriately.
 *
 * PGlite connection-close errors (`db.$client.close()`) are NOT modeled here;
 * they propagate as thrown exceptions rather than settled fields. This is a
 * deliberate boundary: the snapshot layer and the connection layer have
 * independent failure modes, and merging them would conflate two distinct
 * concerns. Callers that need to handle both should wrap `close()` in
 * try/catch in addition to inspecting the returned `CloseResult`.
 *
 * Fail-closed: a caller that ignores this result will miss a snapshot
 * durability failure.
 */
export interface CloseResult {
  /**
   * The error thrown by writeSnapshot during close, or null on success.
   * The PGlite connection has been closed in both cases.
   */
  snapshotError: Error | null;
}

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
  /**
   * Snapshots that were attempted but rejected during restore (corrupt,
   * missing project_meta, or unreadable). Empty when the first attempt
   * succeeds or no snapshots exist.
   */
  failedRestoreAttempts: FailedRestoreAttempt[];
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
  close(): Promise<CloseResult>;
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
  /**
   * Injected DB-open function. Exposed for tests so the open-time failure that
   * drives the recovery decision can be simulated deterministically — e.g. a
   * `RuntimeError("Aborted(OOM)")` against an intact datadir, which must NOT
   * trigger quarantine. Defaults to {@link openArtifactDb}.
   */
  openDb?: (opts: { path: string }) => Promise<ArtifactDb>;
}

export async function openProject(
  options: OpenProjectOptions = {},
): Promise<ProjectHandle> {
  const dir = resolveProjectDir(options);
  const dbPath = path.join(dir, ARTIFACTS_DB_FILENAME);
  const dataSourcesDir = path.join(dir, DATA_SOURCES_DIRNAME);

  await fs.mkdir(dataSourcesDir, { recursive: true });

  // Injected DB-open seam (defaults to the real openArtifactDb). Used by tests
  // to simulate the open-time failure that drives the recovery decision.
  const openDb = options.openDb ?? openArtifactDb;

  // --- attempt normal open ---
  let db: ArtifactDb;
  let recovery: ProjectRecoveryNotice | null = null;

  try {
    db = await openDb({ path: dbPath });
  } catch (err) {
    // Only recover when a torn WAL segment is positively confirmed on disk. Any
    // other failure — including an Aborted(OOM) abort whose datadir is intact —
    // is re-thrown immediately; we never quarantine on ambiguous evidence.
    const confirmed = await isConfirmedWalCorruption(err, dbPath);
    if (!confirmed) throw err;

    // Quarantine the damaged datadir. This MUST succeed before we proceed —
    // if the rename fails we cannot safely overwrite the existing (possibly
    // still-recoverable) data.
    const quarantinedPath = await quarantineDamagedDb(dbPath);

    try {
      // Restore from snapshot (or start fresh).
      const {
        restored: restoredSnapshot,
        failedAttempts: restoreFailedAttempts,
      } = await restoreNewestSnapshot(dir, dbPath);

      // Open the restored (or fresh) datadir.
      db = await openArtifactDb({ path: dbPath });

      recovery = {
        reason: "wal-corruption",
        restoredSnapshot,
        quarantinedPath,
        failedRestoreAttempts: restoreFailedAttempts,
      };
    } catch (recoveryErr) {
      // The damaged DB has ALREADY been renamed aside to `quarantinedPath`, but
      // the restore/re-open failed — so `dbPath` now has no usable database. A
      // bare throw here would leave the operator with a missing DB and no clue
      // where their data went. Surface the quarantine location in the error so
      // the data is recoverable by hand, and chain the original cause.
      throw new Error(
        `[dashframe] recovery failed after quarantining the damaged database. ` +
          `Your previous data has been preserved at: ${quarantinedPath}. ` +
          `Restore/reopen error: ${recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)}`,
        { cause: recoveryErr },
      );
    }
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
    // If we got here via recovery, the original datadir is already quarantined
    // aside and the restored one just failed its metadata check (e.g. an
    // unsupported-schema snapshot after a downgrade, or a tarball that loaded
    // but is partially corrupt). A bare throw would leave the next startup
    // seeing only the bad restored datadir, with the user never told where their
    // preserved data is. Surface the quarantine path, same as the recovery
    // catch above.
    if (recovery) {
      throw new Error(
        `[dashframe] recovery restored a snapshot but it failed metadata validation. ` +
          `Your previous data has been preserved at: ${recovery.quarantinedPath}. ` +
          `Validation error: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    throw err;
  }

  const scheduler = new SnapshotScheduler(
    db.$client,
    dir,
    options.snapshotDebounceMs,
  );

  const close = async (): Promise<CloseResult> => {
    // Cancel the pending debounced timer, then await any snapshot already in
    // flight before writing (and closing). Without the flush, a debounced/max-
    // wait dump still running here would overlap the final dump on the same
    // client — or worse, still be using the client when `close()` tears it down.
    scheduler.cancel();
    await scheduler.flush();
    let snapshotError: Error | null = null;
    try {
      await writeSnapshot(db.$client, dir);
    } catch (err) {
      snapshotError = err instanceof Error ? err : new Error(String(err));
    }
    await db.$client.close();
    return { snapshotError };
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
 * Returns true ONLY when startup failure is POSITIVELY CONFIRMED WAL corruption.
 *
 * Guiding rule — fail toward PRESERVING data: quarantine + restore DESTROYS the
 * live datadir (it renames the database aside and overwrites it with an older
 * snapshot), so it must fire only on definitive, file-level evidence of
 * corruption. When the evidence is ambiguous the caller re-throws and surfaces
 * the real error; it never quarantines on a signal it cannot positively tie to a
 * structurally torn WAL.
 *
 * The SOLE sufficient signal is the WAL-segment probe (`hasCorruptWalSegment`):
 * a `pg_wal/` segment file whose byte length is not a multiple of XLOG_BLCKSZ —
 * a torn/misaligned write, direct on-disk proof the WAL is damaged.
 *
 * What is deliberately NOT trusted: the Emscripten abort signature. Earlier this
 * helper treated any `RuntimeError("Aborted(...)")` as corruption, but that class
 * covers unrelated failures — most importantly `Aborted(OOM)`, an out-of-memory
 * abort that leaves the on-disk datadir perfectly intact. Recovering on an OOM
 * would overwrite a healthy database under memory pressure: the exact data-loss
 * mode this whole path exists to prevent. So the abort message is never an
 * independent trigger — only a torn WAL segment authorizes recovery.
 *
 * Net rule:
 *   torn WAL segment present  → confirmed corruption  → quarantine + restore
 *   anything else (incl. any  → NOT confirmed         → re-throw (preserve data)
 *   abort, OOM, EACCES probe
 *   failure, unreachable trap)
 *
 * `err` is currently unused for the decision — recovery keys solely on the
 * file-level probe — but is kept in the signature so a future, precisely
 * WAL-attributable error class could become a corroborating signal alongside
 * (never instead of) the torn-WAL probe.
 */
async function isConfirmedWalCorruption(
  _err: unknown,
  dbPath: string,
): Promise<boolean> {
  // The ONLY sufficient signal: a structurally torn WAL segment on disk. A probe
  // failure (EACCES/EPERM/etc.) resolves to false — absence of positive evidence
  // is never grounds to destroy the datadir. Every other startup failure
  // (Aborted(OOM), a bare abort with an intact datadir, an `unreachable` trap, a
  // permissions error) falls through to false and the caller re-throws.
  return hasCorruptWalSegment(dbPath).catch(() => false);
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
