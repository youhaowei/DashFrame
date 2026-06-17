/**
 * PGlite snapshot layer for DashFrame projects.
 *
 * Rotating snapshots guard against unrecoverable WAL corruption caused by
 * unclean shutdown (RuntimeError: Aborted() from Emscripten during WAL
 * replay). See GitHub issue #88.
 *
 * Layout under <projectDir>/snapshots/:
 *   snap-<ISO-timestamp>.tar.gz   — gzipped PGlite datadir tarballs
 *
 * N=3 snapshots are kept; the oldest is pruned after each write.
 * Snapshots are written:
 *   - on clean project close (via writeSnapshot)
 *   - debounced after write bursts (the caller drives the debounce via
 *     SnapshotScheduler)
 *
 * Snapshots are NEVER written to a damaged handle — callers must only call
 * writeSnapshot on a healthy, open PGlite client.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * WAL block size used by PGlite's embedded Postgres. Every WAL page (and
 * therefore every WAL file) must be a multiple of this value; a file whose
 * byte count is not a multiple indicates a torn write and therefore WAL
 * corruption.
 *
 * PGlite ships with a 1 MB WAL segment size (128 × XLOG_BLCKSZ) rather than
 * the standard 16 MB, but the page granularity is the same.
 */
export const XLOG_BLCKSZ = 8192;

/**
 * Pattern that matches a standard PostgreSQL WAL segment filename (24 hex
 * characters, no extension). These live under <dataDir>/pg_wal/.
 */
const WAL_SEGMENT_FILENAME_RE = /^[0-9A-F]{24}$/i;

export const SNAPSHOTS_DIRNAME = "snapshots";
export const SNAPSHOT_PREFIX = "snap-";
export const SNAPSHOT_EXT = ".tar.gz";
export const SNAPSHOT_KEEP_N = 3;

/** Milliseconds of inactivity after a write before a debounced snapshot fires. */
export const SNAPSHOT_DEBOUNCE_MS = 30_000;

/**
 * Maximum milliseconds a snapshot may be deferred by a continuous write stream.
 * The pure debounce resets on every write, so a session that writes faster than
 * SNAPSHOT_DEBOUNCE_MS would NEVER snapshot until it goes quiet — an unclean
 * shutdown mid-burst would then fall back to the last clean-close snapshot and
 * lose the whole active session. This cap forces a snapshot once writes have
 * been pending this long, so a long burst still produces periodic snapshots and
 * the crash window stays bounded. Default 5 min (10× the debounce).
 */
export const SNAPSHOT_MAX_WAIT_MS = 300_000;

export interface SnapshotMeta {
  filename: string;
  absPath: string;
  /** Human-readable ISO timestamp decoded from the filename. */
  timestamp: string;
}

/** Metadata about a snapshot attempt that failed during restore. */
export interface FailedRestoreAttempt {
  snapshot: SnapshotMeta;
  error: Error;
}

/** Resolve the snapshots directory for a project dir. */
export function resolveSnapshotsDir(projectDir: string): string {
  return path.join(projectDir, SNAPSHOTS_DIRNAME);
}

/**
 * Probe the WAL directory of a PGlite datadir for structurally corrupt
 * (torn/truncated) segments.
 *
 * Returns true when the datadir exists, has a `pg_wal/` subdirectory, and at
 * least one WAL segment file has a byte length that is not a multiple of
 * XLOG_BLCKSZ. A healthy database may also have no WAL files yet (right after
 * initdb), so an empty pg_wal is not considered corrupt.
 *
 * This is the PRIMARY affirmative-detection signal for WAL corruption. It runs
 * BEFORE attempting to open PGlite so the caller can distinguish corruption
 * from completely unrelated startup failures.
 */
export async function hasCorruptWalSegment(dataDir: string): Promise<boolean> {
  const walDir = path.join(dataDir, "pg_wal");
  let entries: string[];
  try {
    entries = await fs.readdir(walDir);
  } catch {
    // pg_wal doesn't exist → can't be WAL corruption; fresh DB or wrong path.
    return false;
  }

  const segmentFiles = entries.filter((f) => WAL_SEGMENT_FILENAME_RE.test(f));
  if (segmentFiles.length === 0) return false;

  for (const seg of segmentFiles) {
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(path.join(walDir, seg));
    } catch {
      // stat() failed — health is unconfirmable; fail-closed and assume
      // corruption so the caller does not treat this segment as healthy.
      return true;
    }
    if (stat.size % XLOG_BLCKSZ !== 0) {
      return true;
    }
  }
  return false;
}

/**
 * Write a snapshot of the current datadir to disk.
 *
 * The write is atomic: the tarball is first flushed to a temporary file in the
 * same directory, then renamed over the destination. A crash mid-write cannot
 * leave a partial .tar.gz visible to restoreNewestSnapshot.
 *
 * The caller MUST only call this on a healthy, fully-open PGlite instance.
 * Returns the absolute path of the written snapshot file.
 */
export async function writeSnapshot(
  pgliteClient: PGlite,
  projectDir: string,
  /** Injected for testing — returns the timestamp to embed in the filename. */
  nowMs: () => number = Date.now,
): Promise<string> {
  const snapshotsDir = resolveSnapshotsDir(projectDir);
  await fs.mkdir(snapshotsDir, { recursive: true });

  const timestamp = new Date(nowMs()).toISOString().replace(/[:.]/g, "-");
  const filename = `${SNAPSHOT_PREFIX}${timestamp}${SNAPSHOT_EXT}`;
  const destPath = path.join(snapshotsDir, filename);
  const tempPath = path.join(snapshotsDir, `.tmp-${filename}`);

  const blob = await pgliteClient.dumpDataDir("gzip");
  const buffer = Buffer.from(await blob.arrayBuffer());

  // Write to a temp file first; rename to final path atomically.
  try {
    await fs.writeFile(tempPath, buffer);
    await fs.rename(tempPath, destPath);
  } catch (err) {
    // Clean up temp file on any error so it doesn't accumulate.
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }

  await pruneSnapshots(snapshotsDir);
  return destPath;
}

/**
 * List all snapshots for a project, sorted oldest-first.
 *
 * Returns an empty array only when the snapshots directory does not exist yet
 * (ENOENT). All other readdir failures are propagated as thrown errors.
 */
export async function listSnapshots(
  projectDir: string,
): Promise<SnapshotMeta[]> {
  const snapshotsDir = resolveSnapshotsDir(projectDir);
  let entries: string[];
  try {
    entries = await fs.readdir(snapshotsDir);
  } catch (err) {
    // Only swallow "directory doesn't exist yet"; propagate all other errors
    // (permission denied, I/O error, …) so callers know something is wrong.
    if (isEnoent(err)) return [];
    throw err;
  }

  const snaps: SnapshotMeta[] = entries
    .filter((f) => f.startsWith(SNAPSHOT_PREFIX) && f.endsWith(SNAPSHOT_EXT))
    .map((f) => ({
      filename: f,
      absPath: path.join(snapshotsDir, f),
      // Decode the filename timestamp back to an ISO string.
      // Encoding replaces ":" and "." with "-"; we reverse the last three
      // substitutions in the time part (HH-mm-ss-mmmZ → HH:mm:ss.mmmZ).
      timestamp: f
        .slice(SNAPSHOT_PREFIX.length, -SNAPSHOT_EXT.length)
        .replace(
          /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
          "$1:$2:$3.$4Z",
        ),
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename));

  return snaps;
}

/**
 * Prune snapshots, keeping only the N most recent.
 */
async function pruneSnapshots(snapshotsDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(snapshotsDir);
  } catch (err) {
    // ENOENT: directory doesn't exist yet — nothing to prune.
    if (isEnoent(err)) return;
    throw err;
  }

  const snaps = entries
    .filter((f) => f.startsWith(SNAPSHOT_PREFIX) && f.endsWith(SNAPSHOT_EXT))
    .sort(); // lexicographic = chronological given ISO timestamp prefix

  const toDelete = snaps.slice(0, Math.max(0, snaps.length - SNAPSHOT_KEEP_N));
  const results = await Promise.allSettled(
    toDelete.map((f) => fs.unlink(path.join(snapshotsDir, f))),
  );
  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  if (failures.length > 0) {
    // Surface prune failures: silently accumulating stale snapshots risks disk
    // exhaustion and masks write-permission regressions.
    throw new AggregateError(
      failures.map((f) => f.reason),
      `[dashframe] pruneSnapshots: ${failures.length} of ${toDelete.length} deletion(s) failed`,
    );
  }
}

/**
 * Restore the newest snapshot into the given target directory.
 *
 * Attempts snapshots from newest to oldest. A snapshot is ACCEPTED only when it
 * both loads AND validates — see {@link snapshotLooksRestorable}. This matters
 * because PGlite does NOT throw on a truncated/corrupt `loadDataDir` blob: it
 * silently initializes a fresh empty datadir. Without validation,
 * `restoreNewestSnapshot` would return that empty DB as a "successful" restore,
 * and `openProject` would seed a brand-new project over the user's data while
 * reporting recovery succeeded. So after load we positively confirm the
 * project's singleton `project_meta` row survived; if it did not (empty/corrupt
 * tarball), we reject this snapshot and fall through to the next-oldest.
 *
 * A partial targetDataDir created by a failed or rejected attempt is cleaned up
 * before retrying.
 *
 * Returns the snapshot metadata that was restored, or null if no snapshot
 * exists or none restored to a valid datadir (caller creates a fresh project).
 * `failedAttempts` is populated with every snapshot that was tried and
 * rejected, so the caller can distinguish "no snapshots" from "all corrupt".
 */
export async function restoreNewestSnapshot(
  projectDir: string,
  targetDataDir: string,
): Promise<{
  restored: SnapshotMeta | null;
  failedAttempts: FailedRestoreAttempt[];
}> {
  const snaps = await listSnapshots(projectDir);
  if (snaps.length === 0) return { restored: null, failedAttempts: [] };

  const failedAttempts: FailedRestoreAttempt[] = [];

  // Iterate newest-first.
  for (let i = snaps.length - 1; i >= 0; i--) {
    const snap = snaps[i]!;
    try {
      const rawBuffer = await fs.readFile(snap.absPath);
      const blob = new Blob([rawBuffer]);

      await fs.mkdir(targetDataDir, { recursive: true });
      const restored = new PGlite(targetDataDir, { loadDataDir: blob });
      await restored.waitReady;
      // Validate BEFORE accepting: a truncated/corrupt tarball loads as a fresh
      // empty datadir (PGlite does not throw), so a successful waitReady is not
      // proof the data survived. Confirm the project_meta singleton is present.
      const valid = await snapshotLooksRestorable(restored);
      await restored.close();

      if (!valid) {
        const err = new Error(
          `[dashframe] snapshot ${snap.filename} restored to an empty/invalid datadir (missing project_meta)`,
        );
        console.error(err.message + "; trying older snapshot");
        failedAttempts.push({ snapshot: snap, error: err });
        await fs
          .rm(targetDataDir, { recursive: true, force: true })
          .catch(() => {});
        continue;
      }

      return { restored: snap, failedAttempts };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[dashframe] snapshot restore failed for ${snap.filename}:`,
        err,
      );
      failedAttempts.push({ snapshot: snap, error });
      // Clean up any partial targetDataDir before trying the next snapshot.
      await fs
        .rm(targetDataDir, { recursive: true, force: true })
        .catch(() => {});
    }
  }

  // No snapshot restored to a valid datadir.
  return { restored: null, failedAttempts };
}

/**
 * Confirm a freshly-restored PGlite datadir actually carries project data —
 * the singleton `project_meta` row. PGlite silently creates a fresh empty
 * datadir when `loadDataDir` is given a truncated/corrupt blob, so this is the
 * positive check that distinguishes a real restore from a phantom one.
 *
 * Returns false on any failure (missing table, query error, zero rows) — i.e.
 * fail closed: an unverifiable restore is treated as not-restorable so the
 * caller falls back rather than seeding over live data with an empty DB.
 */
async function snapshotLooksRestorable(client: PGlite): Promise<boolean> {
  try {
    const res = await client.query<{ count: number }>(
      "SELECT COUNT(*)::int AS count FROM project_meta",
    );
    const count = res.rows[0]?.count ?? 0;
    return count > 0;
  } catch {
    // Table missing or query failed → not a valid project datadir.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Manages the debounced post-write snapshot schedule, with a max-wait cap so a
 * sustained write stream still produces periodic snapshots.
 *
 * Debounce: each `touch()` resets a `debounceMs` timer, so a quiet gap after a
 * burst triggers one snapshot rather than one-per-write.
 *
 * Max-wait: a pure debounce would never fire while writes keep arriving faster
 * than `debounceMs`. So the scheduler also remembers when the FIRST
 * un-snapshotted write of the current burst arrived; once writes have been
 * pending `maxWaitMs`, the next `touch()` snapshots immediately instead of
 * deferring again. This bounds the crash window during a long active session
 * (import/autosave) to at most `maxWaitMs`, not "until the session goes quiet".
 *
 * Usage:
 *   const scheduler = new SnapshotScheduler(pgliteClient, projectDir);
 *   scheduler.touch();   // call after any write; schedules/resets the timer
 *   scheduler.cancel();  // call on close (before writing the final snapshot)
 */
export class SnapshotScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  /**
   * Timestamp (ms) of the first write since the last snapshot/cancel — the
   * anchor the max-wait is measured from. null when no write is pending.
   */
  private firstPendingAt: number | null = null;
  /**
   * Serializes snapshot writes. `writeSnapshot` reads the live PGlite client
   * (dumpDataDir) and writes a temp file + rename, all async. Two overlapping
   * writes would race the same client and the same temp/destination paths — and
   * worse, `ProjectHandle.close()` could start its final snapshot (and close the
   * client) while a debounced/max-wait dump is still mid-flight, turning the
   * clean-close snapshot into a logged failure. Every snapshot chains onto this
   * tail so they run strictly one-at-a-time; `flush()` lets `close()` await the
   * in-flight write before its own.
   */
  private inFlight: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly pgliteClient: PGlite,
    private readonly projectDir: string,
    debounceMs: number = SNAPSHOT_DEBOUNCE_MS,
    maxWaitMs: number = SNAPSHOT_MAX_WAIT_MS,
    /** Injected for tests; the clock the max-wait is measured against. */
    private readonly nowMs: () => number = Date.now,
  ) {
    this.debounceMs = debounceMs;
    // The cap must be at least the debounce, otherwise it would fire before a
    // normal quiet-gap debounce ever could. Clamp defensively.
    this.maxWaitMs = Math.max(maxWaitMs, debounceMs);
  }

  /** Notify the scheduler that a write just happened. */
  touch(): void {
    const now = this.nowMs();
    if (this.firstPendingAt === null) this.firstPendingAt = now;

    // Max-wait reached: writes have been pending at least maxWaitMs and the
    // debounce keeps resetting. Snapshot now instead of deferring again, so a
    // continuous burst still produces periodic snapshots.
    if (now - this.firstPendingAt >= this.maxWaitMs) {
      this.fireNow();
      return;
    }

    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fireNow(), this.debounceMs);
  }

  /** Write a snapshot now and reset the pending-burst tracking. */
  private fireNow(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.firstPendingAt = null;
    // Chain onto the in-flight tail so writes never overlap on the shared
    // client. A failed write is logged and swallowed so it doesn't poison the
    // chain for the next snapshot.
    this.inFlight = this.inFlight
      .catch(() => {})
      .then(() =>
        writeSnapshot(this.pgliteClient, this.projectDir).catch((err) => {
          console.error("[dashframe] debounced snapshot failed:", err);
        }),
      );
  }

  /**
   * Await any in-flight snapshot write. `ProjectHandle.close()` calls this
   * before its own final `writeSnapshot` so the final dump never overlaps (or
   * outlives, into a closed client) a debounced/max-wait dump still in flight.
   */
  async flush(): Promise<void> {
    await this.inFlight.catch(() => {});
  }

  /** Cancel any pending debounced snapshot (call before close). */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.firstPendingAt = null;
  }
}
