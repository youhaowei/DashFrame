/**
 * Tests for the PGlite snapshot layer (see GitHub issue #88).
 *
 * All tests use temp dirs — never touch ~/.DashFrame.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { PGlite } from "@electric-sql/pglite";

import { ARTIFACT_DB_SCHEMA_VERSION, openArtifactDb } from "./db";
import {
  ARTIFACTS_DB_FILENAME,
  openProject,
  type ProjectHandle,
} from "./project";
import { projectMeta } from "./schema";
import {
  hasCorruptWalSegment,
  listSnapshots,
  resolveSnapshotsDir,
  restoreNewestSnapshot,
  SNAPSHOT_EXT,
  SNAPSHOT_KEEP_N,
  SNAPSHOT_PREFIX,
  SnapshotScheduler,
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
// SnapshotScheduler — debounce + max-wait cap
// ---------------------------------------------------------------------------

describe("SnapshotScheduler", () => {
  let root: string;

  beforeEach(() => {
    root = tempDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // A fake PGlite whose dumpDataDir records each call (a fired snapshot) and
  // resolves to a tiny blob. The fire counter increments synchronously at the
  // start of each dump. Tests await `sched.flush()` to drain the scheduler's
  // serialization chain — which covers both the dump AND the real writeSnapshot
  // fs work — so no stray fs rename races the afterEach rmSync (ENOENT).
  function fakeClient(): { client: PGlite; fires: () => number } {
    let count = 0;
    const client = {
      dumpDataDir: async () => {
        count += 1;
        return new Blob([Buffer.from("snap")]);
      },
    } as unknown as PGlite;
    return { client, fires: () => count };
  }

  test("N rapid touches within the debounce window fire exactly ONE snapshot", async () => {
    const projectDir = join(root, "debounce-once");
    mkdirSync(projectDir, { recursive: true });
    const { client, fires } = fakeClient();

    let now = 0;
    const sched = new SnapshotScheduler(
      client,
      projectDir,
      1000, // debounceMs
      100_000, // maxWaitMs (far away; debounce wins here)
      () => now,
    );

    // 5 touches, each 10ms apart — all inside the 1000ms debounce, max-wait far.
    for (let i = 0; i < 5; i++) {
      now = i * 10;
      sched.touch();
    }
    expect(fires()).toBe(0); // nothing fired yet — still debouncing

    // Quiet gap lets the single debounced real-timer fire fireNow(); then await
    // the scheduler's in-flight chain so the chained dump + fs write completed.
    await new Promise((r) => setTimeout(r, 1100));
    await sched.flush();
    expect(fires()).toBe(1);

    sched.cancel();
    await sched.flush();
  });

  test("a continuous touch stream still snapshots once max-wait is exceeded (no infinite deferral)", async () => {
    const projectDir = join(root, "maxwait-cap");
    mkdirSync(projectDir, { recursive: true });
    const { client, fires } = fakeClient();

    let now = 0;
    const debounceMs = 1000;
    const maxWaitMs = 5000;
    const sched = new SnapshotScheduler(
      client,
      projectDir,
      debounceMs,
      maxWaitMs,
      () => now,
    );

    // Writes arrive every 500ms — faster than the 1000ms debounce, so a pure
    // debounce would NEVER fire. With the cap, once writes have been pending
    // maxWaitMs (5000ms) the next touch fires immediately.
    // First write at t=0 anchors the burst.
    sched.touch();
    for (let t = 500; t < 5000; t += 500) {
      now = t;
      sched.touch();
      expect(fires()).toBe(0); // still under the cap — keeps deferring
    }

    // At t=5000 the burst has been pending exactly maxWaitMs → fire now.
    // Await the scheduler's own in-flight chain (not a bare tick): fireNow now
    // chains the dump through the serialization tail, so the counter increments
    // a couple of microtasks later — `sched.flush()` resolves once it has run.
    now = 5000;
    sched.touch();
    await sched.flush();
    expect(fires()).toBe(1);

    // The burst tracker reset: subsequent fast touches defer again until the
    // next cap window, so we don't snapshot on every write after the first cap.
    now = 5200;
    sched.touch();
    expect(fires()).toBe(1);

    sched.cancel();
    await sched.flush();
  });

  test("cancel() clears a pending debounced snapshot and resets the burst anchor", async () => {
    const projectDir = join(root, "cancel");
    mkdirSync(projectDir, { recursive: true });
    const { client, fires } = fakeClient();

    const now = 0;
    const sched = new SnapshotScheduler(
      client,
      projectDir,
      1000,
      100_000,
      () => now,
    );
    sched.touch();
    sched.cancel();

    // The debounce timer was cleared — even after the window elapses, no fire.
    await new Promise((r) => setTimeout(r, 1100));
    await sched.flush();
    expect(fires()).toBe(0);
  });

  test("serializes overlapping snapshot writes — dumps never run concurrently", async () => {
    const projectDir = join(root, "serialize");
    mkdirSync(projectDir, { recursive: true });

    // A client whose dumpDataDir is slow and records peak concurrency. If two
    // snapshots ran in parallel, `active` would exceed 1 at some point.
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const client = {
      dumpDataDir: async () => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 30));
        active -= 1;
        return new Blob([Buffer.from("snap")]);
      },
    } as unknown as PGlite;

    let now = 0;
    const maxWaitMs = 1000;
    const sched = new SnapshotScheduler(
      client,
      projectDir,
      500, // debounceMs
      maxWaitMs,
      () => now,
    );

    // Force two immediate max-wait fires back-to-back: anchor at t=0, then jump
    // past the cap twice so fireNow runs twice without the first dump finishing.
    sched.touch(); // anchor at t=0
    now = 1000;
    sched.touch(); // cap reached → fire #1 (dump in flight, ~30ms)
    sched.touch(); // anchor resets to t=1000
    now = 2000;
    sched.touch(); // cap reached again → fire #2, chained behind #1

    // Await the serialized chain.
    await sched.flush();

    expect(calls).toBe(2);
    // The contract: the two dumps were serialized, never concurrent.
    expect(maxActive).toBe(1);

    sched.cancel();
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

  test("Aborted(OOM) with a STRUCTURALLY-INTACT datadir does NOT quarantine — data survives", async () => {
    // The regression this pins (PR #90 P1): an out-of-memory abort
    // (`RuntimeError: Aborted(OOM)`) leaves the on-disk datadir intact, so it
    // must NEVER trigger quarantine + restore. The decision keys solely on a
    // torn WAL segment — and here the WAL is block-aligned (healthy), so the
    // abort must propagate and the live datadir must be preserved untouched.
    const dir = join(root, "oom-intact");
    const dbPath = join(dir, ARTIFACTS_DB_FILENAME);

    // Build a structurally-intact datadir: a block-aligned WAL segment so
    // hasCorruptWalSegment returns false. A sentinel file lets us prove the
    // exact bytes survive (not silently overwritten by a fresh/restored DB).
    mkdirSync(join(dir, ARTIFACTS_DB_FILENAME, "pg_wal"), { recursive: true });
    writeFileSync(
      join(dir, ARTIFACTS_DB_FILENAME, "pg_wal", "000000010000000000000001"),
      Buffer.alloc(XLOG_BLCKSZ * 128),
    );
    const sentinel = join(dir, ARTIFACTS_DB_FILENAME, "PG_VERSION");
    writeFileSync(sentinel, "INTACT-DATADIR\n");

    // Inject an open that fails with the OOM abort — the documented case the
    // broad `startsWith("Aborted(")` match would have mis-classified as WAL
    // corruption. WebAssembly.RuntimeError reproduces the exact shape PGlite's
    // Emscripten layer throws (constructor.name === "RuntimeError").
    const oomAbort = new WebAssembly.RuntimeError("Aborted(OOM)");
    const openDb = () => Promise.reject(oomAbort);

    // The OOM abort must propagate — recovery must NOT swallow it.
    await expect(openProject({ dir, openDb })).rejects.toBe(oomAbort);

    // The live datadir is preserved: not quarantined, bytes untouched.
    expect(existsSync(dbPath)).toBe(true);
    const parentDir = await readdir(dir);
    expect(parentDir.filter((f) => f.includes(".damaged-"))).toHaveLength(0);
    expect(readFileSync(sentinel, "utf8")).toBe("INTACT-DATADIR\n");
  });

  test("Aborted(OOM) paired with a TORN WAL segment DOES quarantine — the probe, not the message, decides", async () => {
    // The contrast case: the same OOM-shaped abort, but now the datadir has a
    // torn (misaligned) WAL segment — positive, on-disk corruption evidence.
    // Recovery keys on the probe, so this DOES quarantine + restore despite the
    // abort message being identical to the intact-datadir case above.
    const dir = join(root, "oom-torn-wal");
    const dbPath = join(dir, ARTIFACTS_DB_FILENAME);

    // 1. Seed a healthy project + snapshot so there is something to restore to.
    const h1 = await openProject({ dir, name: "TornWalOOM" });
    openHandles.splice(0);
    await h1.close();
    expect((await listSnapshots(dir)).length).toBeGreaterThan(0);

    // 2. Corrupt the datadir with a TORN WAL segment (not block-aligned).
    rmSync(dbPath, { recursive: true, force: true });
    mkdirSync(join(dir, ARTIFACTS_DB_FILENAME, "pg_wal"), { recursive: true });
    writeFileSync(
      join(dir, ARTIFACTS_DB_FILENAME, "pg_wal", "000000010000000000000001"),
      Buffer.alloc(XLOG_BLCKSZ - 1),
    );
    writeFileSync(join(dir, ARTIFACTS_DB_FILENAME, "PG_VERSION"), "GARBAGE\n");

    // 3. Open with the OOM-shaped abort on the FIRST open attempt. The recovery
    // path's second open uses the real openArtifactDb (restored datadir).
    let firstOpen = true;
    const openDb = (opts: { path: string }) => {
      if (firstOpen) {
        firstOpen = false;
        return Promise.reject(new WebAssembly.RuntimeError("Aborted(OOM)"));
      }
      return openArtifactDb(opts);
    };

    const handle = await openProject({ dir, openDb });
    openHandles.push(handle);

    // The torn WAL drove recovery: quarantined + restored, despite the OOM message.
    expect(handle.recovery).not.toBeNull();
    expect(handle.recovery!.reason).toBe("wal-corruption");
    expect(handle.recovery!.quarantinedPath).toMatch(/\.damaged-/);
    expect(existsSync(handle.recovery!.quarantinedPath)).toBe(true);
    expect(handle.meta.name).toBe("TornWalOOM");
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

  test("rejects a readable-but-empty newest snapshot and falls back to a valid older one", async () => {
    // PR #90 P2: PGlite does NOT throw on a truncated/garbage tarball — it
    // silently loads a FRESH EMPTY datadir. So a "successful" load is not proof
    // the data survived. restoreNewestSnapshot must validate (project_meta
    // present) and reject the empty restore, falling back to a valid older
    // snapshot rather than accepting an empty DB as recovered.
    const dir = join(root, "empty-newest-snap");
    const dbPath = join(dir, ARTIFACTS_DB_FILENAME);

    // 1. Healthy project → a real (valid) snapshot on close.
    const h1 = await openProject({ dir, name: "ValidOlder" });
    openHandles.splice(0);
    await h1.close();

    const snaps = await listSnapshots(dir);
    expect(snaps.length).toBeGreaterThanOrEqual(1);
    const validOlder = snaps[snaps.length - 1]!;

    // 2. Plant a NEWER snapshot file that is a readable but garbage .tar.gz.
    // Its filename sorts last (newer timestamp), so it is tried first. PGlite
    // will load it as an empty datadir — which validation must reject.
    const newerName = `${SNAPSHOT_PREFIX}2999-01-01T00-00-00-000Z${SNAPSHOT_EXT}`;
    const newerPath = join(resolveSnapshotsDir(dir), newerName);
    writeFileSync(newerPath, Buffer.from("not a real gzip tarball"));

    // 3. Corrupt the datadir (torn WAL) so recovery triggers.
    rmSync(dbPath, { recursive: true, force: true });
    mkdirSync(join(dir, ARTIFACTS_DB_FILENAME, "pg_wal"), { recursive: true });
    writeFileSync(
      join(dir, ARTIFACTS_DB_FILENAME, "pg_wal", "000000010000000000000001"),
      Buffer.alloc(XLOG_BLCKSZ - 1),
    );
    writeFileSync(join(dir, ARTIFACTS_DB_FILENAME, "PG_VERSION"), "GARBAGE\n");

    // 4. Recovery must SKIP the empty newest and restore the valid older one.
    const h2 = await openProject({ dir });
    openHandles.push(h2);

    expect(h2.recovery).not.toBeNull();
    expect(h2.recovery!.restoredSnapshot).not.toBeNull();
    expect(h2.recovery!.restoredSnapshot!.absPath).toBe(validOlder.absPath);
    // The restored project carries the real data, not an empty fresh DB.
    expect(h2.meta.name).toBe("ValidOlder");
  });

  test("metadata failure on a restored snapshot still surfaces the quarantine path", async () => {
    // PR #90 P2: if recovery restores a snapshot that opens but then fails
    // ensureProjectMeta (e.g. an unsupported-schema snapshot after a downgrade),
    // the error must still tell the operator where their preserved data is —
    // the original datadir has already been renamed aside.
    const dir = join(root, "meta-fail-recovery");
    const dbPath = join(dir, ARTIFACTS_DB_FILENAME);

    // 1. Healthy project, then poison project_meta with an unsupported schema
    // version and snapshot that poisoned state.
    const h1 = await openProject({ dir, name: "PoisonedSchema" });
    openHandles.splice(0);
    await h1.db
      .update(projectMeta)
      .set({ schemaVersion: ARTIFACT_DB_SCHEMA_VERSION + 99 });
    await writeSnapshot(h1.db.$client, dir);
    await h1.db.$client.close();

    // 2. Corrupt the live datadir (torn WAL) so recovery triggers.
    rmSync(dbPath, { recursive: true, force: true });
    mkdirSync(join(dir, ARTIFACTS_DB_FILENAME, "pg_wal"), { recursive: true });
    writeFileSync(
      join(dir, ARTIFACTS_DB_FILENAME, "pg_wal", "000000010000000000000001"),
      Buffer.alloc(XLOG_BLCKSZ - 1),
    );
    writeFileSync(join(dir, ARTIFACTS_DB_FILENAME, "PG_VERSION"), "GARBAGE\n");

    // 3. Recovery restores the poisoned snapshot; ensureProjectMeta then rejects
    // the unsupported schema. The thrown error must carry the quarantine path so
    // the user can recover their preserved data.
    await expect(openProject({ dir })).rejects.toThrow(
      /preserved at:.*\.damaged-/,
    );

    // The quarantined original must exist on disk.
    const parentDir = await readdir(dir);
    expect(parentDir.filter((f) => f.includes(".damaged-")).length).toBe(1);
  });

  test("recovery with ALL corrupt snapshots → fresh project + failedRestoreAttempts populated", async () => {
    // Integration test: openProject recovery plumbing from restoreNewestSnapshot
    // → recovery.failedRestoreAttempts. The field must be non-empty when corrupt-but-present
    // snapshots were tried and rejected, distinguishing "no snapshots" from "all corrupt."
    const dir = join(root, "all-corrupt-snaps");

    // 1. Write a garbage "snapshot" file (corrupt tarball) — present but unrestorable.
    const snapsDir = resolveSnapshotsDir(dir);
    mkdirSync(snapsDir, { recursive: true });
    const fakeName = `${SNAPSHOT_PREFIX}2024-06-01T00-00-00-000Z${SNAPSHOT_EXT}`;
    writeFileSync(
      join(snapsDir, fakeName),
      Buffer.from("not a real gzip tarball"),
    );

    // 2. Create a datadir with a torn WAL segment so recovery triggers.
    mkdirSync(join(dir, ARTIFACTS_DB_FILENAME, "pg_wal"), { recursive: true });
    writeFileSync(
      join(dir, ARTIFACTS_DB_FILENAME, "pg_wal", "000000010000000000000001"),
      Buffer.alloc(XLOG_BLCKSZ - 1),
    );
    writeFileSync(join(dir, ARTIFACTS_DB_FILENAME, "PG_VERSION"), "GARBAGE\n");

    // 3. openProject should recover: quarantine the damaged DB, try the corrupt
    //    snapshot, reject it (empty datadir — no project_meta), seed a fresh project,
    //    and populate recovery.failedRestoreAttempts with the rejected attempt.
    const handle = await openProject({ dir });
    openHandles.push(handle);

    expect(handle.recovery).not.toBeNull();
    expect(handle.recovery!.reason).toBe("wal-corruption");
    // No snapshot successfully restored — fresh project seeded.
    expect(handle.recovery!.restoredSnapshot).toBeNull();
    // But the attempt WAS made — distinguishable from "no snapshots existed".
    expect(handle.recovery!.failedRestoreAttempts).toHaveLength(1);
    expect(handle.recovery!.failedRestoreAttempts[0]!.snapshot.filename).toBe(
      fakeName,
    );
    expect(handle.recovery!.failedRestoreAttempts[0]!.error).toBeInstanceOf(
      Error,
    );

    // The quarantined original must exist on disk.
    const parentDir = await readdir(dir);
    expect(parentDir.filter((f) => f.includes(".damaged-")).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed durability — site-by-site contracts
// ---------------------------------------------------------------------------

// Site 1 + 2 in project.ts: close() surfaces snapshot failures
describe("ProjectHandle.close() — surfaces snapshot failure (site 1)", () => {
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

  test("returns snapshotError: null on a successful close", async () => {
    const dir = join(root, "close-ok");
    const handle = await openProject({ dir });
    openHandles.splice(0);

    const result = await handle.close();
    expect(result.snapshotError).toBeNull();
  });

  test("close() returns snapshotError when writeSnapshot fails — not swallowed", async () => {
    // Open a fresh project with a long debounce so no mid-session snapshot fires.
    const dir = join(root, "close-snap-fail");
    const handle = await openProject({ dir, snapshotDebounceMs: 100_000 });
    openHandles.splice(0);

    // Poison the snapshots dir AFTER opening (so the initial DB open works) by
    // writing a regular file at the path that writeSnapshot expects to mkdir.
    // fs.mkdir(..., { recursive: true }) will throw EEXIST/ENOTDIR on a non-directory.
    const snapsDir = resolveSnapshotsDir(dir);
    writeFileSync(snapsDir, "not-a-directory");

    const result = await handle.close();

    // Contract 1: the snapshot failure surfaces in snapshotError — not swallowed.
    expect(result.snapshotError).toBeInstanceOf(Error);

    // Contract 2: the PGlite connection is closed even when the snapshot failed.
    // Verify by querying the DB after close — it must reject because the client
    // was torn down regardless of the snapshot outcome.
    // Use the raw PGlite client's query() method rather than drizzle's execute()
    // so the call returns a genuine promise (drizzle's execute returns a lazy builder).
    await expect(handle.db.$client.query("SELECT 1")).rejects.toThrow();
  });
});

// Site 2: hasCorruptWalSegment — stat() failure propagates (not swallowed)
describe("hasCorruptWalSegment — stat() failure propagates (site 2)", () => {
  let root: string;

  beforeEach(() => {
    root = tempDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("throws when a WAL segment is listed by readdir but stat() fails (broken symlink)", async () => {
    // Pre-fix: `fs.stat().catch(() => null)` swallowed stat errors, treating
    // an unconfirmable segment as healthy → returned false (silent data-loss risk).
    // The interim fix returned true, which falsely triggered quarantine on a healthy DB.
    // Post-fix: stat() throws → propagates to caller. The isConfirmedWalCorruption
    // caller wraps hasCorruptWalSegment in .catch(() => false), so a probe failure
    // resolves to "not confirmed" — preserving the datadir (DESTRUCTIVE-RECOVERY invariant).
    //
    // A broken symlink causes readdir to see the entry (the link itself exists)
    // while stat() throws ENOENT (the link target does not exist) — exactly the
    // failure mode we want to test without requiring root or FUSE.
    const dbPath = join(root, "stat-fail.db");
    const walDir = join(dbPath, "pg_wal");
    mkdirSync(walDir, { recursive: true });

    // Create a WAL-filename-shaped broken symlink. readdir sees "000000…001",
    // stat() follows the symlink and throws ENOENT on the missing target.
    const segPath = join(walDir, "000000010000000000000001");
    symlinkSync("/nonexistent-target-for-stat-fail-test", segPath);

    // hasCorruptWalSegment must throw, not silently return true or false.
    await expect(hasCorruptWalSegment(dbPath)).rejects.toThrow();

    // The caller's .catch(() => false) makes the probe resolve to false (no quarantine).
    // This documents the contract between hasCorruptWalSegment and its caller.
    const confirmedByProbe = await hasCorruptWalSegment(dbPath).catch(
      () => false,
    );
    expect(confirmedByProbe).toBe(false);
  });
});

// Site 3: pruneSnapshots — deletion failures surface via AggregateError
describe("pruneSnapshots — deletion failures surface (site 3)", () => {
  let root: string;

  beforeEach(() => {
    root = tempDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("writeSnapshot throws when a to-prune snapshot cannot be deleted", async () => {
    // To trigger pruneSnapshots deletion failures, we need SNAPSHOT_KEEP_N + 1
    // snapshots so one is queued for deletion. Then we make the target file
    // undeletable by replacing it with a directory (unlink() throws EISDIR on most OSes).
    const projectDir = join(root, "prune-fail");
    const dbPath = join(projectDir, "artifacts.db");
    mkdirSync(projectDir, { recursive: true });

    const pg = await openFreshPGlite(dbPath);
    try {
      const BASE_MS = new Date(2024, 0, 1).getTime();
      // Write exactly SNAPSHOT_KEEP_N snapshots — no pruning yet.
      const written: string[] = [];
      for (let i = 0; i < SNAPSHOT_KEEP_N; i++) {
        const p = await writeSnapshot(pg, projectDir, () => BASE_MS + i * 1000);
        written.push(p);
      }

      // Replace the oldest snapshot file with a directory so unlink() fails.
      const oldest = written[0]!;
      rmSync(oldest);
      mkdirSync(oldest, { recursive: true });

      // Writing one more snapshot triggers pruneSnapshots → tries to unlink
      // the oldest → EISDIR/EPERM → should throw, not swallow.
      await expect(
        writeSnapshot(pg, projectDir, () => BASE_MS + SNAPSHOT_KEEP_N * 1000),
      ).rejects.toThrow();
    } finally {
      await pg.close();
    }
  });
});

// Site 4: pruneSnapshots readdir — non-ENOENT surfaced
// The ENOENT-only-swallow contract is covered by the existing
// "prunes old snapshots" test (happy path) and the site-3 prune-fail test
// (which traverses the same updated `catch` branch). The non-ENOENT readdir
// error case (EACCES, EIO, etc.) cannot be triggered portably without root or
// FUSE; it requires OS-level privilege manipulation. The code change is: catch(err)
// re-throws non-ENOENT errors instead of returning silently — structurally
// verified by typecheck and by the site-3 deletion-failure test.
describe("pruneSnapshots readdir — non-ENOENT error surfaces (site 4)", () => {
  test.todo(
    "non-ENOENT readdir error propagates — requires EACCES/EIO simulation (mock or OS privilege)",
  );
});

// Site 5: restoreNewestSnapshot — returns failedAttempts metadata
describe("restoreNewestSnapshot — surfaces failed attempts (site 5)", () => {
  let root: string;

  beforeEach(() => {
    root = tempDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("returns { restored: null, failedAttempts: [] } when no snapshots exist", async () => {
    const result = await restoreNewestSnapshot(
      join(root, "no-snaps"),
      join(root, "target"),
    );
    expect(result.restored).toBeNull();
    expect(result.failedAttempts).toEqual([]);
  });

  test("returns { restored: snap, failedAttempts: [] } on first-attempt success", async () => {
    const projectDir = join(root, "restore-ok");
    mkdirSync(projectDir, { recursive: true });

    // Build a real project + snapshot so restoreNewestSnapshot can validate project_meta.
    const handle = await openProject({ dir: projectDir });
    await handle.close();

    const snaps = await listSnapshots(projectDir);
    expect(snaps.length).toBeGreaterThan(0);

    // Restore into a fresh target dir.
    const targetDir = join(root, "target-ok");
    const result = await restoreNewestSnapshot(projectDir, targetDir);

    expect(result.restored).not.toBeNull();
    expect(result.restored!.absPath).toBe(snaps[snaps.length - 1]!.absPath);
    expect(result.failedAttempts).toHaveLength(0);

    rmSync(targetDir, { recursive: true, force: true });
  });

  test("populates failedAttempts when newest snapshot is corrupt/unreadable", async () => {
    const projectDir = join(root, "restore-fail");
    mkdirSync(projectDir, { recursive: true });

    // Build a real project + snapshot.
    const handle = await openProject({ dir: projectDir });
    await handle.close();

    const snaps = await listSnapshots(projectDir);
    expect(snaps.length).toBeGreaterThan(0);

    // Corrupt the newest snapshot by overwriting with garbage.
    const newest = snaps[snaps.length - 1]!;
    writeFileSync(newest.absPath, Buffer.from("not a gzip tarball"));

    // Restore: the corrupt newest should fail, populate failedAttempts,
    // and since there are no older valid snapshots, restored should be null.
    const targetDir = join(root, "target-fail");
    const result = await restoreNewestSnapshot(projectDir, targetDir);

    // The corrupt snapshot is a bad tarball that PGlite loads as empty — so it
    // fails the snapshotLooksRestorable() validation, not with an exception.
    // failedAttempts should contain that attempt.
    expect(result.failedAttempts.length).toBeGreaterThan(0);
    expect(result.failedAttempts[0]!.snapshot.absPath).toBe(newest.absPath);
    expect(result.failedAttempts[0]!.error).toBeInstanceOf(Error);

    rmSync(targetDir, { recursive: true, force: true });
  });

  test("caller can distinguish 'no snapshots' from 'all corrupt'", async () => {
    const projectDir = join(root, "restore-distinguish");
    mkdirSync(projectDir, { recursive: true });

    // No snapshots at all.
    const noSnaps = await restoreNewestSnapshot(
      projectDir,
      join(root, "target-empty"),
    );
    expect(noSnaps.restored).toBeNull();
    expect(noSnaps.failedAttempts).toHaveLength(0);

    // Plant a garbage snapshot file.
    const snapsDir = resolveSnapshotsDir(projectDir);
    mkdirSync(snapsDir, { recursive: true });
    const fakeName = `${SNAPSHOT_PREFIX}2024-01-01T00-00-00-000Z${SNAPSHOT_EXT}`;
    writeFileSync(join(snapsDir, fakeName), Buffer.from("garbage"));

    // All corrupt: restored is null but failedAttempts is non-empty.
    const allCorrupt = await restoreNewestSnapshot(
      projectDir,
      join(root, "target-corrupt"),
    );
    expect(allCorrupt.restored).toBeNull();
    expect(allCorrupt.failedAttempts.length).toBeGreaterThan(0);
  });
});
