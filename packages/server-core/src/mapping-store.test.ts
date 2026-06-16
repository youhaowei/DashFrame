/**
 * DrizzleMappingStore tests.
 *
 * The load-bearing test is "restart-survives": it proves the ref → backend/locator
 * mapping persists when the MappingStore instance is thrown away and recreated
 * from the same DB. This is the regression guard for the bug where an in-memory
 * mapping store dropped every binding on restart, leaving persisted credentials
 * permanently unresolvable.
 */
import {
  SecretRegistry,
  SecretVault,
  TestBackend,
  isSecretRef,
  makeSecretRef,
} from "@wystack/secret-vault";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openArtifactDb, type ArtifactDb } from "./db";
import { DrizzleMappingStore } from "./mapping-store";
import { secretMappings } from "./schema";

describe("DrizzleMappingStore", () => {
  let dir: string;
  let dbPath: string;
  let db: ArtifactDb;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-mapping-store-"));
    dbPath = join(dir, "artifacts.db");
    db = await openArtifactDb({ path: dbPath });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("get returns the record written by set", async () => {
    const store = new DrizzleMappingStore(db);
    const ref = makeSecretRef();
    await store.set(ref, { backend: "electron-keychain", locator: "kc:abc" });

    const record = await store.get(ref);
    expect(record).toEqual({ backend: "electron-keychain", locator: "kc:abc" });
  });

  it("get returns undefined for an unknown ref", async () => {
    const store = new DrizzleMappingStore(db);
    const record = await store.get(makeSecretRef());
    expect(record).toBeUndefined();
  });

  it("has reflects presence without reading the record", async () => {
    const store = new DrizzleMappingStore(db);
    const ref = makeSecretRef();
    expect(await store.has(ref)).toBe(false);
    await store.set(ref, { backend: "b", locator: "l" });
    expect(await store.has(ref)).toBe(true);
  });

  it("delete removes the mapping", async () => {
    const store = new DrizzleMappingStore(db);
    const ref = makeSecretRef();
    await store.set(ref, { backend: "b", locator: "l" });
    await store.delete(ref);
    expect(await store.has(ref)).toBe(false);
    expect(await store.get(ref)).toBeUndefined();
  });

  it("set upserts on the same ref (rotation replaces the binding)", async () => {
    const store = new DrizzleMappingStore(db);
    const ref = makeSecretRef();
    await store.set(ref, { backend: "b", locator: "old-locator" });
    await store.set(ref, { backend: "b", locator: "new-locator" });

    const record = await store.get(ref);
    expect(record?.locator).toBe("new-locator");
    // Exactly one row — the upsert replaced rather than inserting a duplicate.
    const rows = await db.select().from(secretMappings);
    expect(rows.filter((r) => r.ref === ref)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // The regression guard: the mapping must survive a store instance being
  // thrown away and recreated from the SAME persisted DB.
  // -------------------------------------------------------------------------
  it("restart-survives: a fresh store + vault still resolves a ref stored before 'restart'", async () => {
    // --- BEFORE restart: compose a vault, store a secret, get a ref. ---
    // The backend stands in for the keychain (persists on disk in production).
    // We keep the SAME backend instance across the restart to model the keychain
    // blob surviving on disk; what we throw away and recreate is the vault and
    // the MappingStore — exactly the components that lost state in the bug.
    const backend = new TestBackend();
    const registry = new SecretRegistry();
    registry.register("test", backend, { fallback: true });
    registry.setClassDefault("connector-key", "test");

    const ref = await new SecretVault(
      registry,
      new DrizzleMappingStore(db),
    ).store("super-secret-token", { class: "connector-key" });

    expect(isSecretRef(ref)).toBe(true);

    // --- SIMULATE RESTART: brand-new MappingStore + vault against the SAME db. ---
    // (In production the same DB file is reopened; here we reuse the open handle,
    // which holds the identical persisted rows — the mapping is read from the DB,
    // not from any in-memory carry-over.) A fresh registry proves nothing is
    // smuggled through the vault either.
    const registryAfter = new SecretRegistry();
    registryAfter.register("test", backend, { fallback: true });
    registryAfter.setClassDefault("connector-key", "test");
    const vaultAfter = new SecretVault(
      registryAfter,
      new DrizzleMappingStore(db),
    );

    // has() must be true — the ref → backend/locator binding was read from the DB.
    expect(await vaultAfter.has(ref)).toBe(true);

    // withSecret() must resolve the original plaintext — the locator was recovered
    // from the persisted mapping, then handed to the backend.
    const resolved = await vaultAfter.withSecret(ref, async (pt) => pt);
    expect(resolved).toBe("super-secret-token");
  });

  it("restart-survives: a fresh store reopened from the same DB FILE resolves the ref", async () => {
    // Stronger variant: actually close and reopen the DB from disk, proving the
    // mapping is durable on the filesystem, not just in the live PGlite session.
    const backend = new TestBackend();
    const registry = new SecretRegistry();
    registry.register("test", backend, { fallback: true });
    registry.setClassDefault("connector-key", "test");

    const ref = await new SecretVault(
      registry,
      new DrizzleMappingStore(db),
    ).store("durable-token", { class: "connector-key" });

    // Close the DB and reopen the same file — a real process restart for the DB.
    await db.$client.close();
    db = await openArtifactDb({ path: dbPath });

    const vaultAfter = new SecretVault(registry, new DrizzleMappingStore(db));
    expect(await vaultAfter.has(ref)).toBe(true);
    expect(await vaultAfter.withSecret(ref, async (pt) => pt)).toBe(
      "durable-token",
    );
  });
});
