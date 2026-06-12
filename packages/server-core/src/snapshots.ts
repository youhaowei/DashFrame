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

export const SNAPSHOTS_DIRNAME = "snapshots";
export const SNAPSHOT_PREFIX = "snap-";
export const SNAPSHOT_EXT = ".tar.gz";
export const SNAPSHOT_KEEP_N = 3;

/** Milliseconds of inactivity after a write before a debounced snapshot fires. */
export const SNAPSHOT_DEBOUNCE_MS = 30_000;

export interface SnapshotMeta {
  filename: string;
  absPath: string;
  /** Human-readable ISO timestamp decoded from the filename. */
  timestamp: string;
}

/** Resolve the snapshots directory for a project dir. */
export function resolveSnapshotsDir(projectDir: string): string {
  return path.join(projectDir, SNAPSHOTS_DIRNAME);
}

/**
 * Write a snapshot of the current datadir to disk.
 *
 * The caller MUST only call this on a healthy, fully-open PGlite instance.
 * Returns the absolute path of the written snapshot file.
 */
export async function writeSnapshot(
  pgliteClient: PGlite,
  projectDir: string,
): Promise<string> {
  const snapshotsDir = resolveSnapshotsDir(projectDir);
  await fs.mkdir(snapshotsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${SNAPSHOT_PREFIX}${timestamp}${SNAPSHOT_EXT}`;
  const destPath = path.join(snapshotsDir, filename);

  const blob = await pgliteClient.dumpDataDir("gzip");
  const buffer = Buffer.from(await blob.arrayBuffer());
  await fs.writeFile(destPath, buffer);

  await pruneSnapshots(snapshotsDir);
  return destPath;
}

/**
 * List all snapshots for a project, sorted oldest-first.
 */
export async function listSnapshots(
  projectDir: string,
): Promise<SnapshotMeta[]> {
  const snapshotsDir = resolveSnapshotsDir(projectDir);
  let entries: string[];
  try {
    entries = await fs.readdir(snapshotsDir);
  } catch {
    return [];
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
  } catch {
    return;
  }

  const snaps = entries
    .filter((f) => f.startsWith(SNAPSHOT_PREFIX) && f.endsWith(SNAPSHOT_EXT))
    .sort(); // lexicographic = chronological given ISO timestamp prefix

  const toDelete = snaps.slice(0, Math.max(0, snaps.length - SNAPSHOT_KEEP_N));
  await Promise.all(
    toDelete.map((f) => fs.unlink(path.join(snapshotsDir, f)).catch(() => {})),
  );
}

/**
 * Restore the newest snapshot into the given target directory.
 *
 * Opens a temporary PGlite instance with `loadDataDir` (a constructor option
 * that imports a previously dumped tarball) pointing to `targetDataDir`, then
 * closes it so the datadir is materialized on disk.
 *
 * Returns the snapshot metadata that was restored, or null if no snapshot
 * exists (caller should create a fresh project).
 */
export async function restoreNewestSnapshot(
  projectDir: string,
  targetDataDir: string,
): Promise<SnapshotMeta | null> {
  const snaps = await listSnapshots(projectDir);
  if (snaps.length === 0) return null;

  const newest = snaps[snaps.length - 1]!;
  const rawBuffer = await fs.readFile(newest.absPath);
  const blob = new Blob([rawBuffer]);

  await fs.mkdir(targetDataDir, { recursive: true });
  const restored = new PGlite(targetDataDir, { loadDataDir: blob });
  await restored.waitReady;
  await restored.close();

  return newest;
}

/**
 * Manages the debounced post-write snapshot schedule.
 *
 * Usage:
 *   const scheduler = new SnapshotScheduler(pgliteClient, projectDir);
 *   scheduler.touch();   // call after any write; schedules/resets the timer
 *   scheduler.cancel();  // call on close (before writing the final snapshot)
 */
export class SnapshotScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(
    private readonly pgliteClient: PGlite,
    private readonly projectDir: string,
    debounceMs: number = SNAPSHOT_DEBOUNCE_MS,
  ) {
    this.debounceMs = debounceMs;
  }

  /** Notify the scheduler that a write just happened. */
  touch(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      writeSnapshot(this.pgliteClient, this.projectDir).catch((err) => {
        console.error("[dashframe] debounced snapshot failed:", err);
      });
    }, this.debounceMs);
  }

  /** Cancel any pending debounced snapshot (call before close). */
  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
