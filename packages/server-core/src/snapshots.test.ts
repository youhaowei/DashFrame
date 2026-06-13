/**
 * Tests for the PGlite snapshot layer (see GitHub issue #88).
 *
 * All tests use temp dirs — never touch ~/.DashFrame.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { PGlite } from "@electric-sql/pglite";

import {
  ARTIFACTS_DB_FILENAME,
  openProject,
  type ProjectHandle,
} from "./project";
import {
  hasCorruptWalSegment,
  listSnapshots,
  resolveSnapshotsDir,
  SNAPSHOT_EXT,
  SNAPSHOT_KEEP_N,
  SNAPSHOT_PREFIX,
  writeSnapshot,
  XLOG_BLCKSZ,
} from "./snapshots";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dashframe-snap-"));
}

async function openFreshPGlite(dbPath: string): Promise<PGlite> {
  mkdirSync(dbPath, { recursive: true });
  const pg = new PGlite(dbPath);
  await pg.waitReady;
  return pg;
}

// ---------------------------------------------------------------------------
// Snapshot write / list / rotate
// ---------------------------------------------------------------------------

describe("writeSnapshot + listSnapshots", () => {
  let root: string;

  beforeEach(() => {
    root = tempDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("writes a .tar.gz file under <project>/snapshots/ and lists it", async () => {
    const projectDir = join(root, "proj");
    const dbPath = join(projectDir, "artifacts.db");
    mkdirSync(projectDir, { recursive: true });

    const pg = await openFreshPGlite(dbPath);
    try {
      const snapPath = await writeSnapshot(pg, projectDir);

      expect(snapPath).toMatch(/\.tar\.gz$/);
      expect(existsSync(snapPath)).toBe(true);

      const snaps = await listSnapshots(projectDir);
      expect(snaps).toHaveLength(1);
      expect(snaps[0]!.absPath).toBe(snapPath);
      expect(snaps[0]!.filename).toMatch(
        new RegExp(`^${SNAPSHOT_PREFIX}.*${SNAPSHOT_EXT.replace(".", "\\.")}$`),
      );
    } finally {
      await pg.close();
    }
  });

  test("prunes old snapshots, keeping only SNAPSHOT_KEEP_N most recent", async () => {
    const projectDir = join(root, "rotate");
    const dbPath = join(projectDir, "artifacts.db");
    mkdirSync(projectDir, { recursive: true });

    const pg = await openFreshPGlite(dbPath);
    try {
      // Write KEEP_N + 2 snapshots with deterministic, distinct timestamps.
      // We inject a nowMs function so filenames are guaranteed unique without
      // fake timers — vi.useFakeTimers() breaks PGlite's WASM async I/O.
      const BASE_MS = new Date(2024, 0, 1).getTime();
      const written: string[] = [];
      for (let i = 0; i < SNAPSHOT_KEEP_N + 2; i++) {
        const p = await writeSnapshot(pg, projectDir, () => BASE_MS + i * 1000);
        written.push(p);
      }

      const snaps = await listSnapshots(projectDir);
      expect(snaps).toHaveLength(SNAPSHOT_KEEP_N);

      // The oldest N snapshots should have been pruned.
      const kept = new Set(snaps.map((s) => s.absPath));
      const pruned = written.slice(0, written.length - SNAPSHOT_KEEP_N);
      for (const p of pruned) {
        expect(kept.has(p)).toBe(false);
        expect(existsSync(p)).toBe(false);
      }
    } finally {
      await pg.close();
    }
  });

  test("listSnapshots returns empty array when no snapshots dir exists", async () => {
    const snaps = await listSnapshots(join(root, "nonexistent"));
    expect(snaps).toEqual([]);
  });

  test("writeSnapshot is atomic: no .tmp- file left on disk after write", async () => {
    const projectDir = join(root, "atomic");
    const dbPath = join(projectDir, "artifacts.db");
    mkdirSync(projectDir, { recursive: true });

    const pg = await openFreshPGlite(dbPath);
    try {
      await writeSnapshot(pg, projectDir);

      const snapsDir = resolveSnapshotsDir(projectDir);
      const files = await readdir(snapsDir);
      const tmpFiles = files.filter((f) => f.startsWith(".tmp-"));
      expect(tmpFiles).toHaveLength(0);
    } finally {
      await pg.close();
    }
  });
});

// ---------------------------------------------------------------------------
// WAL probe
// ---------------------------------------------------------------------------

describe("hasCorruptWalSegment", () => {
  let root: string;

  beforeEach(() => {
    root = tempDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("returns false for a healthy PGlite datadir", async () => {
    const dbPath = join(root, "healthy.db");
    const pg = await openFreshPGlite(dbPath);
    await pg.close();

    const corrupt = await hasCorruptWalSegment(dbPath);
    expect(corrupt).toBe(false);
  });

  test("returns false when pg_wal does not exist", async () => {
    const corrupt = await hasCorruptWalSegment(join(root, "nonexistent"));
    expect(corrupt).toBe(false);
  });

  test("returns true when a WAL segment has a torn size", async () => {
    const dbPath = join(root, "torn.db");
    const walDir = join(dbPath, "pg_wal");
    mkdirSync(walDir, { recursive: true });
    // Write a 24-hex-char WAL segment file with a non-block-aligned size.
    const tornSize = XLOG_BLCKSZ - 1; // deliberately not a multiple of 8192
    writeFileSync(
      join(walDir, "000000010000000000000001"),
      Buffer.alloc(tornSize),
    );

    const corrupt = await hasCorruptWalSegment(dbPath);
    expect(corrupt).toBe(true);
  });

  test("returns false when WAL segment is correctly block-aligned", async () => {
    const dbPath = join(root, "clean.db");
    const walDir = join(dbPath, "pg_wal");
    mkdirSync(walDir, { recursive: true });
    // Write a 24-hex-char WAL segment file with a block-aligned size.
    writeFileSync(
      join(walDir, "000000010000000000000001"),
      Buffer.alloc(XLOG_BLCKSZ * 128), // 1 MB — canonical PGlite segment size
    );

    const corrupt = await hasCorruptWalSegment(dbPath);
    expect(corrupt).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// openProject — snapshot on close
// ---------------------------------------------------------------------------

describe("openProject snapshot on close", () => {
  let root: string;
  let openHandles: ProjectHandle[];

  beforeEach(() => {
    root = tempDir();
    openHandles = [];
  });

  afterEach(async () => {
    await Promise.allSettled(openHandles.map((h) => h.close()));
    rmSync(root, { recursive: true, force: true });
  });

  async function openTestProject(dir: string) {
    const handle = await openProject({ dir });
    openHandles.push(handle);
    return handle;
  }

  test("writes a snapshot to <project>/snapshots/ on clean close", async () => {
    const dir = join(root, "closesnap");
    const handle = await openTestProject(dir);

    // Remove from openHandles since we close manually.
    openHandles.splice(openHandles.indexOf(handle), 1);
    await handle.close();

    const snapsDir = resolveSnapshotsDir(dir);
    expect(existsSync(snapsDir)).toBe(true);

    const files = await readdir(snapsDir);
    const snapFiles = files.filter(
      (f) => f.startsWith(SNAPSHOT_PREFIX) && f.endsWith(SNAPSHOT_EXT),
    );
    expect(snapFiles.length).toBeGreaterThan(0);
  });

  test("second open after close finds the snapshot and lists it", async () => {
    const dir = join(root, "reopen");
    const h1 = await openTestProject(dir);
    openHandles.splice(openHandles.indexOf(h1), 1);
    await h1.close();

    const snapsBefore = await listSnapshots(dir);
    expect(snapsBefore.length).toBeGreaterThan(0);

    // Re-open (healthy path) — should not produce a recovery notice.
    const h2 = await openProject({ dir });
    openHandles.push(h2);
    expect(h2.recovery).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// openProject — WAL corruption recovery
// ---------------------------------------------------------------------------

describe("openProject WAL corruption recovery", () => {
  let root: string;
  let openHandles: ProjectHandle[];

  beforeEach(() => {
    root = tempDir();
    openHandles = [];
  });

  afterEach(async () => {
    await Promise.allSettled(openHandles.map((h) => h.close()));
    rmSync(root, { recursive: true, force: true });
  });

  test("corrupted datadir with snapshot → quarantine + restore + notice", async () => {
    const dir = join(root, "corrupt-with-snap");
    const dbPath = join(dir, ARTIFACTS_DB_FILENAME);

    // 1. Create a healthy project and write a snapshot.
    const h1 = await openProject({ dir, name: "BeforeCorruption" });
    openHandles.splice(0); // Will be closed manually
    await h1.close(); // writes snapshot

    const snapsBefore = await listSnapshots(dir);
    expect(snapsBefore.length).toBeGreaterThan(0);

    // 2. Corrupt the datadir by replacing it with garbage.
    rmSync(dbPath, { recursive: true, force: true });
    mkdirSync(join(dir, ARTIFACTS_DB_FILENAME), { recursive: true });
    // Write garbage into the expected pg_wal directory so PGlite sees corrupt layout.
    mkdirSync(join(dir, ARTIFACTS_DB_FILENAME, "pg_wal"), { recursive: true });
    writeFileSync(
      join(dir, ARTIFACTS_DB_FILENAME, "PG_VERSION"),
      "THIS IS GARBAGE\n",
    );
    // Write a torn WAL segment (not block-aligned) for affirmative WAL detection.
    writeFileSync(
      join(dir, ARTIFACTS_DB_FILENAME, "pg_wal", "000000010000000000000001"),
      Buffer.alloc(XLOG_BLCKSZ - 1),
    );

    // 3. Open — should trigger recovery.
    const h2 = await openProject({ dir });
    openHandles.push(h2);

    expect(h2.recovery).not.toBeNull();
    expect(h2.recovery!.reason).toBe("wal-corruption");
    expect(h2.recovery!.restoredSnapshot).not.toBeNull();
    expect(h2.recovery!.restoredSnapshot!.absPath).toBe(
      snapsBefore[snapsBefore.length - 1]!.absPath,
    );

    // Quarantine path must exist and be outside the live dbPath.
    expect(h2.recovery!.quarantinedPath).toMatch(/\.damaged-/);
    expect(existsSync(h2.recovery!.quarantinedPath)).toBe(true);

    // The live project is usable — project_meta is accessible.
    expect(h2.meta.name).toBe("BeforeCorruption");
  });

  test("corrupted datadir with NO snapshot → fresh project + notice with null restoredSnapshot", async () => {
    const dir = join(root, "corrupt-no-snap");

    // Create a corrupt artifacts.db (directory with garbage) without any
    // prior snapshot.
    mkdirSync(join(dir, ARTIFACTS_DB_FILENAME, "pg_wal"), { recursive: true });
    writeFileSync(join(dir, ARTIFACTS_DB_FILENAME, "PG_VERSION"), "GARBAGE\n");
    // Torn WAL segment for affirmative detection.
    writeFileSync(
      join(dir, ARTIFACTS_DB_FILENAME, "pg_wal", "000000010000000000000001"),
      Buffer.alloc(XLOG_BLCKSZ - 1),
    );

    const handle = await openProject({ dir });
    openHandles.push(handle);

    expect(handle.recovery).not.toBeNull();
    expect(handle.recovery!.reason).toBe("wal-corruption");
    expect(handle.recovery!.restoredSnapshot).toBeNull();

    // Fresh project should be openable and seeded correctly.
    // Use path.basename() instead of split("/").at(-1) for cross-platform safety.
    expect(handle.meta.name).toBe(basename(dir));
  });

  test("non-WAL RuntimeError does NOT trigger quarantine — data is preserved", async () => {
    // Verify that the openProject catch path only fires for confirmed WAL
    // corruption. An unrelated Error (e.g. permissions, schema mismatch) must
    // bubble up unchanged and must NOT move the datadir aside.
    const dir = join(root, "non-wal-error");
    const dbPath = join(dir, ARTIFACTS_DB_FILENAME);

    // Create a valid-looking datadir with a properly-sized WAL segment so
    // hasCorruptWalSegment returns false. The directory layout is otherwise
    // garbage (not a real PGlite DB) but the WAL probe must pass.
    mkdirSync(join(dir, ARTIFACTS_DB_FILENAME, "pg_wal"), { recursive: true });
    // Block-aligned WAL segment → hasCorruptWalSegment returns false.
    writeFileSync(
      join(dir, ARTIFACTS_DB_FILENAME, "pg_wal", "000000010000000000000001"),
      Buffer.alloc(XLOG_BLCKSZ * 128),
    );
    writeFileSync(join(dir, ARTIFACTS_DB_FILENAME, "PG_VERSION"), "GARBAGE\n");

    // The open should throw (garbage datadir, no corruption signal).
    await expect(openProject({ dir })).rejects.toThrow();

    // The original datadir must NOT have been quarantined.
    expect(existsSync(dbPath)).toBe(true);
    // No .damaged- quarantine path should have been created.
    const parentDir = await readdir(dir);
    const quarantined = parentDir.filter((f) => f.includes(".damaged-"));
    expect(quarantined).toHaveLength(0);
  });

  test("restoreNewestSnapshot falls back to older snapshot when newest is missing", async () => {
    const dir = join(root, "fallback-snap");
    const dbPath = join(dir, ARTIFACTS_DB_FILENAME);

    // 1. Create a healthy project and write two snapshots.
    const h1 = await openProject({ dir, name: "FallbackTest" });
    openHandles.splice(0);

    const BASE_MS = new Date(2024, 0, 1).getTime();
    // Write first (older) snapshot via the public writeSnapshot.
    await writeSnapshot(h1.db.$client, dir, () => BASE_MS);
    // Write second (newer) snapshot.
    await writeSnapshot(h1.db.$client, dir, () => BASE_MS + 1000);
    await h1.close(); // writes a third snapshot

    const snaps = await listSnapshots(dir);
    expect(snaps.length).toBeGreaterThanOrEqual(2);

    // 2. Delete the newest snapshot so fs.readFile throws ENOENT.
    // NOTE: PGlite silently ignores a corrupt/truncated tarball (it just
    // creates a fresh DB), so to test the fallback path we need readFile to
    // throw, which only happens if the file is missing or unreadable.
    const newest = snaps[snaps.length - 1]!;
    const secondNewest = snaps[snaps.length - 2]!;
    rmSync(newest.absPath);

    // 3. Corrupt the datadir with a torn WAL segment so recovery triggers.
    rmSync(dbPath, { recursive: true, force: true });
    mkdirSync(join(dir, ARTIFACTS_DB_FILENAME, "pg_wal"), { recursive: true });
    writeFileSync(
      join(dir, ARTIFACTS_DB_FILENAME, "pg_wal", "000000010000000000000001"),
      Buffer.alloc(XLOG_BLCKSZ - 1),
    );
    writeFileSync(join(dir, ARTIFACTS_DB_FILENAME, "PG_VERSION"), "GARBAGE\n");

    // 4. Open should recover using the second-newest snapshot.
    const h2 = await openProject({ dir });
    openHandles.push(h2);

    expect(h2.recovery).not.toBeNull();
    expect(h2.recovery!.restoredSnapshot).not.toBeNull();
    // Should have fallen back to the second-newest snapshot.
    expect(h2.recovery!.restoredSnapshot!.absPath).toBe(secondNewest.absPath);
    expect(h2.meta.name).toBe("FallbackTest");
  });
});
