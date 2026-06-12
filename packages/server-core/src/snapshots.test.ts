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
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PGlite } from "@electric-sql/pglite";

import {
  ARTIFACTS_DB_FILENAME,
  openProject,
  type ProjectHandle,
} from "./project";
import {
  listSnapshots,
  resolveSnapshotsDir,
  SNAPSHOT_EXT,
  SNAPSHOT_KEEP_N,
  SNAPSHOT_PREFIX,
  writeSnapshot,
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
      // Write KEEP_N + 2 snapshots with a small delay so filenames differ.
      const written: string[] = [];
      for (let i = 0; i < SNAPSHOT_KEEP_N + 2; i++) {
        // Ensure timestamps differ by manipulating Date (vitest fake timers).
        vi.setSystemTime(new Date(2024, 0, 1, 0, 0, i));
        const p = await writeSnapshot(pg, projectDir);
        written.push(p);
      }
      vi.useRealTimers();

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
      vi.useRealTimers();
      await pg.close();
    }
  });

  test("listSnapshots returns empty array when no snapshots dir exists", async () => {
    const snaps = await listSnapshots(join(root, "nonexistent"));
    expect(snaps).toEqual([]);
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

    const handle = await openProject({ dir });
    openHandles.push(handle);

    expect(handle.recovery).not.toBeNull();
    expect(handle.recovery!.reason).toBe("wal-corruption");
    expect(handle.recovery!.restoredSnapshot).toBeNull();

    // Fresh project should be openable and seeded correctly.
    expect(handle.meta.name).toBe(dir.split("/").at(-1));
  });
});
