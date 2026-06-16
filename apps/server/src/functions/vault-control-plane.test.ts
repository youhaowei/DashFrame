/**
 * Vault control-plane tests.
 *
 * Acceptance criteria:
 *   AC1: No backend/vault instantiation in server functions (structural — grep).
 *   AC2: Creating/updating a data source with a credential persists a SecretRef
 *        into config jsonb; the config contains NO plaintext credential.
 *   AC3: hasApiKey reflects vault.has(ref) — store → true; absent → false.
 *   AC4: Existing plaintext rows are migrated by migrateDataSourceSecretsToVault;
 *        post-migration scan finds zero raw credentials.
 *   AC5: Control plane never calls withSecret (structural — grep).
 *
 * Test pattern: TestBackend is used IN TEST SETUP to compose a vault. TestBackend
 * is NEVER used in production (server functions) code — only here.
 */
import {
  migrateDataSourceSecretsToVault,
  openArtifactDb,
  schema,
} from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  isSecretRef,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { createWyStack, type WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { functions } from "../functions";

const { dataSources } = schema;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Compose a SecretVault backed by TestBackend. ONLY for test setup. */
function makeTestVault(): { vault: SecretVault; backend: TestBackend } {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault("connector-key", "test");
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  return { vault, backend };
}

/** Read the raw config jsonb from the artifact DB for a given data-source id. */
async function readConfig(
  db: Awaited<ReturnType<typeof openArtifactDb>>,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db.select().from(dataSources);
  const row = rows.find((r) => r.id === id);
  return row ? (row.config as Record<string, unknown>) : null;
}

describe("vault control-plane — store→ref + has→presence", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;
  let backend: TestBackend;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-vault-cp-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault, backend } = makeTestVault());
    // Inject vault via static context — mirrors createDashframeServer's seam.
    const rawApp = await createWyStack({ db, functions });
    // Wrap to inject vault into every call context, matching app.ts behaviour.
    // Static context (vault) spreads LAST so it cannot be shadowed by a caller-
    // supplied ctx — same ordering as the production createDashframeServer seam.
    app = {
      ...rawApp,
      async call(path, args, ctx) {
        return rawApp.call(path, args, { ...(ctx ?? {}), vault });
      },
      async runHandler(path, args, tracked, ctx) {
        return rawApp.runHandler(path, args, tracked, {
          ...(ctx ?? {}),
          vault,
        });
      },
    };
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // AC2: store → ref, NO plaintext in config
  // -------------------------------------------------------------------------

  it("AC2 — addDataSource stores a SecretRef, not plaintext, in config.apiKey", async () => {
    const { result } = await app.call("addDataSource", {
      type: "notion",
      name: "My Notion Source",
      apiKey: "secret-plaintext-key",
    });
    const id = (result as { id: string }).id;

    const config = await readConfig(db, id);
    expect(config).not.toBeNull();

    // The stored value must be a SecretRef, not plaintext.
    expect(isSecretRef(config!["apiKey"])).toBe(true);
    expect(config!["apiKey"]).not.toBe("secret-plaintext-key");
    // connectionString was not supplied — should be absent.
    expect(config!["connectionString"]).toBeUndefined();
  });

  it("AC2 — addDataSource with connectionString stores a SecretRef", async () => {
    const { result } = await app.call("addDataSource", {
      type: "postgres",
      name: "My PG Source",
      connectionString: "postgresql://user:pass@host/db",
    });
    const id = (result as { id: string }).id;

    const config = await readConfig(db, id);
    expect(isSecretRef(config!["connectionString"])).toBe(true);
    expect(config!["connectionString"]).not.toContain("pass");
    expect(config!["apiKey"]).toBeUndefined();
  });

  it("AC2 — updateDataSource replaces apiKey with a fresh SecretRef", async () => {
    // First create.
    const { result } = await app.call("addDataSource", {
      type: "notion",
      name: "Source",
      apiKey: "original-key",
    });
    const id = (result as { id: string }).id;
    const configBefore = await readConfig(db, id);
    const refBefore = configBefore!["apiKey"] as string;
    expect(isSecretRef(refBefore)).toBe(true);

    // Now update with a new apiKey.
    await app.call("updateDataSource", {
      id,
      apiKey: "new-key",
    });

    const configAfter = await readConfig(db, id);
    const refAfter = configAfter!["apiKey"] as string;
    expect(isSecretRef(refAfter)).toBe(true);
    // A fresh ref is minted — the old one is replaced.
    expect(refAfter).not.toBe(refBefore);
    // Still no plaintext in config.
    expect(configAfter!["apiKey"]).not.toBe("new-key");
  });

  it("AC2 — updateDataSource with empty apiKey CLEARS the credential", async () => {
    // Seed a credential.
    const { result } = await app.call("addDataSource", {
      type: "notion",
      name: "Source",
      apiKey: "to-be-cleared",
    });
    const id = (result as { id: string }).id;
    expect(isSecretRef((await readConfig(db, id))!["apiKey"])).toBe(true);

    // Empty string clears it: the config key is removed entirely.
    await app.call("updateDataSource", { id, apiKey: "" });

    const config = await readConfig(db, id);
    expect(config!["apiKey"]).toBeUndefined();

    // Presence now reads false — no usable credential remains.
    const { result: ds } = await app.call("getDataSource", { id });
    expect((ds as { hasApiKey: boolean }).hasApiKey).toBe(false);
  });

  it("AC2 — setDataSourceConfig with empty apiKey CLEARS the credential", async () => {
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "notion",
      name: "Source",
      apiKey: "to-be-cleared",
    });
    expect(isSecretRef((await readConfig(db, id))!["apiKey"])).toBe(true);

    await app.call("setDataSourceConfig", { id, apiKey: "" });

    expect((await readConfig(db, id))!["apiKey"]).toBeUndefined();
  });

  it("AC2 — clearing apiKey leaves a set connectionString untouched", async () => {
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "postgres",
      name: "Source",
      apiKey: "key",
      connectionString: "postgresql://u:p@h/db",
    });
    const csRef = (await readConfig(db, id))!["connectionString"] as string;
    expect(isSecretRef(csRef)).toBe(true);

    // Clear only apiKey; connectionString is undefined in this write → untouched.
    await app.call("updateDataSource", { id, apiKey: "" });

    const config = await readConfig(db, id);
    expect(config!["apiKey"]).toBeUndefined();
    expect(config!["connectionString"]).toBe(csRef);
  });

  it("AC2 — createDataSource command stores a SecretRef", async () => {
    const id = crypto.randomUUID();
    const { result } = await app.call("createDataSource", {
      id,
      type: "notion",
      name: "Cmd Source",
      apiKey: "cmd-plaintext-key",
    });
    expect((result as { id: string }).id).toBe(id);

    const config = await readConfig(db, id);
    expect(isSecretRef(config!["apiKey"])).toBe(true);
    expect(config!["apiKey"]).not.toBe("cmd-plaintext-key");
  });

  it("AC2 — setDataSourceConfig command stores a SecretRef", async () => {
    // Create a source without credentials.
    const id = crypto.randomUUID();
    await app.call("createDataSource", { id, type: "notion", name: "Source" });

    // Set config via the command.
    await app.call("setDataSourceConfig", {
      id,
      apiKey: "command-key",
    });

    const config = await readConfig(db, id);
    expect(isSecretRef(config!["apiKey"])).toBe(true);
    expect(config!["apiKey"]).not.toBe("command-key");
  });

  // -------------------------------------------------------------------------
  // AC3: hasApiKey reflects vault.has(ref)
  // -------------------------------------------------------------------------

  it("AC3 — hasApiKey is true after storing a credential", async () => {
    const { result: createResult } = await app.call("addDataSource", {
      type: "notion",
      name: "Source with key",
      apiKey: "real-key",
    });
    const id = (createResult as { id: string }).id;

    const { result } = await app.call("getDataSource", { id });
    const ds = result as { hasApiKey: boolean; hasConnectionString: boolean };
    expect(ds.hasApiKey).toBe(true);
    expect(ds.hasConnectionString).toBe(false);
  });

  it("AC3 — hasApiKey is false when no credential was stored", async () => {
    const { result: createResult } = await app.call("addDataSource", {
      type: "notion",
      name: "Source without key",
    });
    const id = (createResult as { id: string }).id;

    const { result } = await app.call("getDataSource", { id });
    const ds = result as { hasApiKey: boolean; hasConnectionString: boolean };
    expect(ds.hasApiKey).toBe(false);
    expect(ds.hasConnectionString).toBe(false);
  });

  it("AC3 — hasApiKey reflects backend.has(), not raw config truthiness", async () => {
    // Store a credential and verify the backend has it (has() is non-decrypting).
    const { result: createResult } = await app.call("addDataSource", {
      type: "notion",
      name: "Source",
      apiKey: "key-value",
    });
    const id = (createResult as { id: string }).id;

    // The backend has() must have been called (not withSecret).
    const { result } = await app.call("getDataSource", { id });
    const ds = result as { hasApiKey: boolean };
    expect(ds.hasApiKey).toBe(true);
    // Verify withSecret was NOT called (control plane never decrypts).
    expect(backend.resolveCallCount).toBe(0);
    // has() was called (presence check).
    expect(backend.hasCallCount).toBeGreaterThan(0);
  });

  it("AC3 — listDataSources reflects hasApiKey correctly", async () => {
    // One source with key, one without.
    await app.call("addDataSource", {
      type: "notion",
      name: "With key",
      apiKey: "some-key",
    });
    await app.call("addDataSource", {
      type: "csv",
      name: "Without key",
    });

    const { result } = await app.call("listDataSources", {});
    const sources = result as { name: string; hasApiKey: boolean }[];
    const withKey = sources.find((s) => s.name === "With key");
    const withoutKey = sources.find((s) => s.name === "Without key");
    expect(withKey?.hasApiKey).toBe(true);
    expect(withoutKey?.hasApiKey).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fail-closed: the server REFUSES to store a credential when no vault is
// injected. This is the regression guard for the plaintext-at-rest leak — the
// vault-absent branch must throw and persist NOTHING, never write the plaintext
// to config. A non-credential write must still succeed without a vault.
// ---------------------------------------------------------------------------

describe("vault control-plane — fail-closed when no vault is injected", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  // No vault wrapper: createWyStack's app is used directly, so ctx.vault is
  // undefined for every handler — exactly a server runtime that injected no vault.
  let app: WyStackApp;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-vault-failclosed-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    app = await createWyStack({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("addDataSource with an apiKey throws and persists no row", async () => {
    await expect(
      app.call("addDataSource", {
        type: "notion",
        name: "Leaky Source",
        apiKey: "should-never-persist",
      }),
    ).rejects.toThrow(/no vault/i);

    // Nothing was written — not the plaintext, not even a row.
    const rows = await db.select().from(dataSources);
    expect(rows).toHaveLength(0);
  });

  it("addDataSource with a connectionString throws and persists no row", async () => {
    await expect(
      app.call("addDataSource", {
        type: "postgres",
        name: "Leaky PG",
        connectionString: "postgresql://user:pass@host/db",
      }),
    ).rejects.toThrow(/no vault/i);

    const rows = await db.select().from(dataSources);
    expect(rows).toHaveLength(0);
  });

  it("createDataSource command with an apiKey throws and persists no row", async () => {
    const id = crypto.randomUUID();
    await expect(
      app.call("createDataSource", {
        id,
        type: "notion",
        name: "Leaky Cmd",
        apiKey: "should-never-persist",
      }),
    ).rejects.toThrow(/no vault/i);

    const rows = await db.select().from(dataSources);
    expect(rows).toHaveLength(0);
  });

  it("setDataSourceConfig command with an apiKey throws and leaves config unchanged", async () => {
    // A source with no credential can be created without a vault (below), then
    // a credential-setting config write must be refused.
    const id = crypto.randomUUID();
    await app.call("createDataSource", { id, type: "notion", name: "Source" });

    await expect(
      app.call("setDataSourceConfig", { id, apiKey: "should-never-persist" }),
    ).rejects.toThrow(/no vault/i);

    // config must NOT contain the plaintext (or any apiKey at all).
    const config = await readConfig(db, id);
    expect(config?.["apiKey"]).toBeUndefined();
  });

  it("updateDataSource with an apiKey throws and leaves config unchanged", async () => {
    const id = crypto.randomUUID();
    await app.call("createDataSource", { id, type: "notion", name: "Source" });

    await expect(
      app.call("updateDataSource", { id, apiKey: "should-never-persist" }),
    ).rejects.toThrow(/no vault/i);

    const config = await readConfig(db, id);
    expect(config?.["apiKey"]).toBeUndefined();
  });

  it("a write with NO credential still succeeds without a vault", async () => {
    // Only credential-bearing writes require the vault — a plain create must work.
    const { result } = await app.call("addDataSource", {
      type: "csv",
      name: "No-credential Source",
    });
    const id = (result as { id: string }).id;
    expect(id).toBeTruthy();

    const config = await readConfig(db, id);
    expect(config?.["apiKey"]).toBeUndefined();
    expect(config?.["connectionString"]).toBeUndefined();
  });

  it("renaming via updateDataSource (no credential) still succeeds without a vault", async () => {
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "notion",
      name: "Old Name",
    });

    await expect(
      app.call("updateDataSource", { id, name: "New Name" }),
    ).resolves.toBeDefined();

    const rows = await db.select().from(dataSources);
    expect(rows.find((r) => r.id === id)?.name).toBe("New Name");
  });
});

// ---------------------------------------------------------------------------
// AC4: migration — existing plaintext rows are migrated
// ---------------------------------------------------------------------------

describe("migrateDataSourceSecretsToVault — zero plaintext after migration", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-vault-migrate-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("AC4 — migrates plaintext apiKey to a SecretRef", async () => {
    // Simulate a pre-vault data source with plaintext credentials written
    // directly into the DB (bypassing the vault path).
    await db.insert(dataSources).values({
      id: crypto.randomUUID(),
      name: "Legacy Source",
      kind: "notion",
      storage: "live",
      config: { apiKey: "legacy-plaintext-key" },
      createdBy: { kind: "user" },
    });

    const { vault } = makeTestVault();
    const { migratedCount } = await migrateDataSourceSecretsToVault(db, vault);
    expect(migratedCount).toBe(1);

    // Post-migration: apiKey in config is a SecretRef.
    const rows = await db.select().from(dataSources);
    const config = rows[0]?.config as Record<string, unknown>;
    expect(isSecretRef(config["apiKey"])).toBe(true);
    expect(config["apiKey"]).not.toBe("legacy-plaintext-key");
  });

  it("AC4 — migrates plaintext connectionString to a SecretRef", async () => {
    await db.insert(dataSources).values({
      id: crypto.randomUUID(),
      name: "Legacy PG",
      kind: "postgres",
      storage: "live",
      config: { connectionString: "postgresql://u:p@host/db" },
      createdBy: { kind: "user" },
    });

    const { vault } = makeTestVault();
    await migrateDataSourceSecretsToVault(db, vault);

    const rows = await db.select().from(dataSources);
    const config = rows[0]?.config as Record<string, unknown>;
    expect(isSecretRef(config["connectionString"])).toBe(true);
    expect(String(config["connectionString"])).not.toContain("p@host");
  });

  it("AC4 — skips rows that already hold a SecretRef (idempotent)", async () => {
    const { vault } = makeTestVault();
    // Pre-store a ref so the config already has a SecretRef.
    const ref = await vault.store("already-stored", { class: "connector-key" });
    await db.insert(dataSources).values({
      id: crypto.randomUUID(),
      name: "Already migrated",
      kind: "notion",
      storage: "live",
      config: { apiKey: ref },
      createdBy: { kind: "user" },
    });

    const { migratedCount } = await migrateDataSourceSecretsToVault(db, vault);
    // Row already has a ref — nothing migrated.
    expect(migratedCount).toBe(0);

    // The ref is still present and unchanged.
    const rows = await db.select().from(dataSources);
    const config = rows[0]?.config as Record<string, unknown>;
    expect(config["apiKey"]).toBe(ref);
  });

  it("AC4 — zero plaintext remains after migrating multiple rows", async () => {
    // Insert multiple rows with various credential shapes.
    const rowsToInsert = [
      { kind: "notion", config: { apiKey: "key-1" } },
      { kind: "postgres", config: { connectionString: "pg://u:p@h/db" } },
      { kind: "csv", config: {} },
      {
        kind: "notion",
        config: { apiKey: "key-2", connectionString: "pg://u2:p2@h/db2" },
      },
    ];
    for (const r of rowsToInsert) {
      await db.insert(dataSources).values({
        id: crypto.randomUUID(),
        name: `Source ${r.kind}`,
        kind: r.kind,
        storage: "live",
        config: r.config,
        createdBy: { kind: "user" },
      });
    }

    const { vault } = makeTestVault();
    const { migratedCount } = await migrateDataSourceSecretsToVault(db, vault);
    // 3 rows had at least one plaintext credential (the csv row had none).
    expect(migratedCount).toBe(3);

    // Post-migration scan: NO config field should contain plaintext.
    const allRows = await db.select().from(dataSources);
    for (const row of allRows) {
      const cfg = (row.config as Record<string, unknown>) ?? {};
      if (cfg["apiKey"] !== undefined) {
        expect(
          isSecretRef(cfg["apiKey"]),
          `apiKey in ${row.name} must be a SecretRef`,
        ).toBe(true);
      }
      if (cfg["connectionString"] !== undefined) {
        expect(
          isSecretRef(cfg["connectionString"]),
          `connectionString in ${row.name} must be a SecretRef`,
        ).toBe(true);
      }
    }
  });

  it("AC4 — migration is idempotent (second run migrates 0 rows)", async () => {
    await db.insert(dataSources).values({
      id: crypto.randomUUID(),
      name: "Plaintext Source",
      kind: "notion",
      storage: "live",
      config: { apiKey: "plaintext" },
      createdBy: { kind: "user" },
    });

    const { vault } = makeTestVault();
    const { migratedCount: first } = await migrateDataSourceSecretsToVault(
      db,
      vault,
    );
    expect(first).toBe(1);

    // Second run — nothing to migrate.
    const { migratedCount: second } = await migrateDataSourceSecretsToVault(
      db,
      vault,
    );
    expect(second).toBe(0);
  });
});
