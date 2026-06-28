/**
 * Vault control-plane tests.
 *
 * Acceptance criteria:
 *   AC1: No backend/vault instantiation in server functions (structural — grep).
 *   AC2: Creating/updating a data source with a credential persists a SecretRef
 *        into config jsonb; the config contains NO plaintext credential.
 *   AC3: hasApiKey reflects vault.has(ref) — store → true; absent → false.
 *   AC4: A credential write with NO vault fails closed (throws, persists nothing).
 *   AC5: Control plane never calls withSecret (structural — grep).
 *
 * Test pattern: TestBackend is used IN TEST SETUP to compose a vault. TestBackend
 * is NEVER used in production (server functions) code — only here.
 */
import { openArtifactDb, schema } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  isSecretRef,
  makeSecretRef,
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
import { cmd } from "./commands";
import { buildPreviewDiff } from "./preview-diff";
import { type DataSourceConfig, releaseCredentialRefs } from "./utils";

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
    expect((ds as { config: { hasApiKey: boolean } }).config.hasApiKey).toBe(
      false,
    );
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
    const ds = result as {
      config: { hasApiKey: boolean; hasConnectionString: boolean };
    };
    expect(ds.config.hasApiKey).toBe(true);
    expect(ds.config.hasConnectionString).toBe(false);
    // The SecretRef must NOT appear in the public DTO — only the boolean flag.
    // Absence here proves rowToDataSource redacts the ref, not just the name.
    expect((ds.config as Record<string, unknown>)["apiKey"]).toBeUndefined();
  });

  it("AC3 — hasApiKey is false when no credential was stored", async () => {
    const { result: createResult } = await app.call("addDataSource", {
      type: "notion",
      name: "Source without key",
    });
    const id = (createResult as { id: string }).id;

    const { result } = await app.call("getDataSource", { id });
    const ds = result as {
      config: { hasApiKey: boolean; hasConnectionString: boolean };
    };
    expect(ds.config.hasApiKey).toBe(false);
    expect(ds.config.hasConnectionString).toBe(false);
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
    const ds = result as { config: { hasApiKey: boolean } };
    expect(ds.config.hasApiKey).toBe(true);
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
    const sources = result as {
      name: string;
      config: { hasApiKey: boolean };
    }[];
    const withKey = sources.find((s) => s.name === "With key");
    const withoutKey = sources.find((s) => s.name === "Without key");
    expect(withKey?.config.hasApiKey).toBe(true);
    expect(withoutKey?.config.hasApiKey).toBe(false);
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
// Connector factory fail-closed — mintBoundResolver guards
//
// These tests exercise the two fail-closed throws in mintBoundResolver:
//   (a) no vault injected → "no vault injected"
//   (b) config.apiKey is not a well-formed SecretRef → "no valid SecretRef"
//
// Both must throw so the data-plane never reaches the Notion API in degraded state.
// ---------------------------------------------------------------------------

describe("connector factory — mintBoundResolver fail-closed", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("listNotionDatabases throws when no vault is injected", async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-factory-novault-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    // No vault wrapper — ctx.vault is undefined
    const rawApp = await createWyStack({ db, functions });

    // Create a notion DataSource row (no vault needed for a credential-free create)
    const id = crypto.randomUUID();
    await rawApp.call("createDataSource", { id, type: "notion", name: "Src" });

    // listNotionDatabases must throw — no vault to resolve the credential
    await expect(
      rawApp.call("listNotionDatabases", { dataSourceId: id }),
    ).rejects.toThrow(/no vault/i);
  });

  it("listNotionDatabases throws when config.apiKey is not a SecretRef", async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-factory-noref-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    const { vault } = makeTestVault();
    const rawApp = await createWyStack({ db, functions });
    const vaultApp: WyStackApp = {
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

    // Insert a DataSource row that has plaintext (not a ref) in config.apiKey.
    // We bypass the normal addDataSource (which would store a ref) by inserting directly.
    const id = crypto.randomUUID();
    await db.insert(dataSources).values({
      id,
      kind: "notion",
      name: "Legacy Source",
      storage: "live",
      config: { apiKey: "plaintext-not-a-ref" },
      createdBy: { kind: "user" as const },
    });

    // mintBoundResolver must reject — config.apiKey is not a SecretRef
    await expect(
      vaultApp.call("listNotionDatabases", { dataSourceId: id }),
    ).rejects.toThrow(/no valid SecretRef/i);
  });

  it("queryNotionDatabase throws when no vault is injected", async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-factory-q-novault-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    const rawApp = await createWyStack({ db, functions });

    const id = crypto.randomUUID();
    await rawApp.call("createDataSource", { id, type: "notion", name: "Src" });

    // queryNotionDatabase resolves the credential via the same factory seam;
    // with no vault it must fail closed BEFORE any Notion API call.
    await expect(
      rawApp.call("queryNotionDatabase", {
        dataSourceId: id,
        databaseId: "db-123",
        tableId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/no vault/i);
  });

  it("queryNotionDatabase throws when the source is not a notion source", async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-factory-q-kind-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    const { vault } = makeTestVault();
    const rawApp = await createWyStack({ db, functions });
    const vaultApp: WyStackApp = {
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

    // A csv source — querying it as notion must be rejected by the kind guard,
    // before any credential resolution or network call.
    const id = crypto.randomUUID();
    await db.insert(dataSources).values({
      id,
      kind: "csv",
      name: "Not Notion",
      storage: "parquet",
      config: {},
      createdBy: { kind: "user" as const },
    });

    await expect(
      vaultApp.call("queryNotionDatabase", {
        dataSourceId: id,
        databaseId: "db-123",
        tableId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/not a notion source/i);
  });
});

// ---------------------------------------------------------------------------
// SecretVault lifecycle coupling — delete releases SecretRefs
// ---------------------------------------------------------------------------
//
// Contract: when a data-source that holds SecretRefs is deleted (by either
// path — removeDataSource handler or deleteNode command), the refs are removed
// from the vault BEFORE the row is dropped. After the delete, vault.has(ref)
// must return false for every ref that was stored on that source.
//
// Both handlers route through releaseCredentialRefs() in utils.ts, which calls
// vault.delete(ref) for each live ref in the config jsonb. The tests below pin
// that end-to-end invariant: vault presence is verifiable via vault.has() (a
// non-decrypting call that reads the mapping store + backend presence index).
//
// A source with NO credential fields must not cause any error during delete
// (releaseCredentialRefs early-returns when the config has no live refs).
// ---------------------------------------------------------------------------

describe("vault lifecycle — delete releases SecretRefs (removeDataSource)", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;
  let backend: TestBackend;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-vault-rm-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault, backend } = makeTestVault());
    const rawApp = await createWyStack({ db, functions });
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

  it("removeDataSource — vault.has(apiKeyRef) is false after deleting a source that had an apiKey", async () => {
    // Arrange: create a source with an apiKey so a SecretRef is minted and stored.
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "notion",
      name: "Cred Source",
      apiKey: "secret-api-key",
    });
    // Capture the ref from the config jsonb before deletion.
    const config = await readConfig(db, id);
    const apiKeyRef = config!["apiKey"] as string;
    expect(isSecretRef(apiKeyRef)).toBe(true);
    // Confirm the secret is live before we delete.
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );

    // Act: delete the source via the removeDataSource handler.
    await app.call("removeDataSource", { id });

    // Assert: the vault no longer holds the ref.
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      false,
    );
  });

  it("removeDataSource — vault.has(apiKeyRef) and vault.has(csRef) are false after deleting a source with both credentials", async () => {
    // Arrange: source with both credential fields.
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "postgres",
      name: "Full Cred Source",
      apiKey: "ak",
      connectionString: "postgresql://u:p@h/db",
    });
    const config = await readConfig(db, id);
    const apiKeyRef = config!["apiKey"] as string;
    const csRef = config!["connectionString"] as string;
    expect(isSecretRef(apiKeyRef)).toBe(true);
    expect(isSecretRef(csRef)).toBe(true);

    // Act.
    await app.call("removeDataSource", { id });

    // Assert: both refs are gone from the vault.
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      false,
    );
    expect(await vault.has(csRef as Parameters<typeof vault.has>[0])).toBe(
      false,
    );
  });

  it("removeDataSource — deleting a no-credential source succeeds without touching the vault", async () => {
    // Arrange: source with no credentials.
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "csv",
      name: "Clean Source",
    });
    const resolveCountBefore = backend.resolveCallCount;
    const hasCountBefore = backend.hasCallCount;

    // Act: must not throw.
    await expect(app.call("removeDataSource", { id })).resolves.toBeDefined();

    // Assert: vault was not consulted for resolve or has (no refs to check).
    expect(backend.resolveCallCount).toBe(resolveCountBefore);
    expect(backend.hasCallCount).toBe(hasCountBefore);
  });
});

describe("vault lifecycle — delete releases SecretRefs (DeleteNode)", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-vault-del-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault } = makeTestVault());
    const rawApp = await createWyStack({ db, functions });
    // flushSnapshot is required by the fail-closed credential-release gate: refs are
    // only released after a confirmed durable snapshot. Wire a no-op for tests
    // exercising the direct canonical path (no actual snapshot needed here).
    const ctx = { vault, flushSnapshot: async () => {} };
    app = {
      ...rawApp,
      async call(path, args, extraCtx) {
        return rawApp.call(path, args, { ...ctx, ...(extraCtx ?? {}) });
      },
      async runHandler(path, args, tracked, extraCtx) {
        return rawApp.runHandler(path, args, tracked, {
          ...ctx,
          ...(extraCtx ?? {}),
        });
      },
    };
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("deleteNode (DataSource) — vault.has(apiKeyRef) is false after the delete command", async () => {
    // Arrange: mint a source with an apiKey through the command vocabulary.
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "notion",
      name: "To Delete",
      apiKey: "delete-me",
    });
    const config = await readConfig(db, id);
    const apiKeyRef = config!["apiKey"] as string;
    expect(isSecretRef(apiKeyRef)).toBe(true);
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );

    // Act: delete via the deleteNode command path (commands.ts ~L1738).
    await app.call("deleteNode", { id });

    // Assert: the SecretRef was released from the vault before the row dropped.
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      false,
    );
  });

  it("deleteNode (DataSource) — both credential refs are released when source has apiKey + connectionString", async () => {
    // Arrange.
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "postgres",
      name: "PG Source",
      apiKey: "ak",
      connectionString: "postgresql://u:p@h/db",
    });
    const config = await readConfig(db, id);
    const apiKeyRef = config!["apiKey"] as string;
    const csRef = config!["connectionString"] as string;

    // Act.
    await app.call("deleteNode", { id });

    // Assert: both refs are gone.
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      false,
    );
    expect(await vault.has(csRef as Parameters<typeof vault.has>[0])).toBe(
      false,
    );
  });

  it("deleteNode (DataSource) — no-credential source delete succeeds without error", async () => {
    // A source without any credential fields must be deletable via deleteNode
    // without the vault being involved (releaseCredentialRefs is a no-op when
    // the config carries no SecretRefs).
    const id = crypto.randomUUID();
    await app.call("createDataSource", { id, type: "csv", name: "No Creds" });

    await expect(app.call("deleteNode", { id })).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SecretVault lifecycle coupling — releaseCredentialRefs partial-failure
// ---------------------------------------------------------------------------
//
// Contract: releaseCredentialRefs deletes every ref via Promise.allSettled, NOT
// a short-circuiting sequential loop. A failure deleting one ref must NOT skip
// the others (a sequential await loop would leave later refs orphaned while the
// row is still slated for deletion). All deletes are attempted; any failures
// surface as an AggregateError so the caller can roll back / retry.
// ---------------------------------------------------------------------------

describe("releaseCredentialRefs — partial-failure attempts every ref", () => {
  it("a failing delete on the first ref still attempts the second, then throws AggregateError", async () => {
    // A source config holding TWO live refs. We make the apiKey delete reject and
    // record which refs delete() was actually called with.
    const apiKeyRef = makeSecretRef();
    const csRef = makeSecretRef();
    const config: DataSourceConfig = {
      apiKey: apiKeyRef,
      connectionString: csRef,
    };
    const deletedRefs: string[] = [];
    const fakeVault = {
      async delete(ref: string) {
        deletedRefs.push(ref);
        // The apiKey ref fails; the connectionString ref succeeds.
        if (ref === apiKeyRef) {
          throw new Error("keychain unavailable for apiKey ref");
        }
      },
    } as unknown as SecretVault;

    // A sequential await loop would throw on the first ref and never reach the
    // second — deletedRefs would have length 1. allSettled attempts both.
    await expect(
      releaseCredentialRefs(config, fakeVault),
    ).rejects.toBeInstanceOf(AggregateError);

    expect(deletedRefs).toContain(apiKeyRef);
    expect(deletedRefs).toContain(csRef);
    expect(deletedRefs).toHaveLength(2);
  });

  it("succeeds silently when every ref deletes cleanly", async () => {
    const config: DataSourceConfig = {
      apiKey: makeSecretRef(),
    };
    const fakeVault = {
      async delete() {
        /* ok */
      },
    } as unknown as SecretVault;

    await expect(
      releaseCredentialRefs(config, fakeVault),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SecretVault lifecycle coupling — preview mode skips vault store
// ---------------------------------------------------------------------------
//
// Contract: when `buildPreviewDiff` runs a credential-bearing batch (e.g.
// CreateDataSource with an apiKey), the handlers detect `ctx.mode === "preview"`
// via `modeFromCtx()` and call `storeCredential(..., preview=true)`. In that
// branch, `storeCredential` returns the sentinel `"secret:preview-noop"` without
// ever calling `vault.store()`. This means the backend receives no `store()` call
// and its presence index remains empty for the whole preview.
//
// The canonical DB row is also absent (the preview transaction rolled back), so
// after a preview run: no vault entry exists, no data-source row persists.
// ---------------------------------------------------------------------------

describe("vault lifecycle — preview mode skips vault store", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;
  let storeCallCount: number;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-vault-preview-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault } = makeTestVault());
    storeCallCount = 0;

    // Wrap vault.store() with a spy so we can assert it was NEVER called
    // during a preview dispatch. This is the only direct witness for the
    // "preview-safe store" invariant: storeCredential(preview=true) returns
    // the sentinel WITHOUT calling vault.store(). backend.hasCallCount is
    // not a reliable witness because nothing in the preview path calls
    // vault.has() (no getDataSource in the batch), so it stays 0 regardless.
    const realStore = vault.store.bind(vault);
    vault.store = async (...args: Parameters<typeof vault.store>) => {
      storeCallCount++;
      return realStore(...args);
    };

    // No vault wrapper on the raw app: buildPreviewDiff threads the vault through
    // the `context` arg it passes to applyCommands, so the handlers receive it
    // via ctx — the same path as the production seam.
    app = await createWyStack({ db, functions });
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("preview mode — CreateDataSource with apiKey never calls vault.store()", async () => {
    // Arrange: a credential-bearing CreateDataSource in a preview batch.
    const sourceId = crypto.randomUUID();

    // Baseline: store has not been called yet.
    expect(storeCallCount).toBe(0);

    // Act: run preview (execute-then-rollback) with vault injected in context.
    await buildPreviewDiff(
      app,
      db,
      [
        cmd("CreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "Preview Src",
          apiKey: "secret-key",
        }),
      ],
      { vault },
    );

    // Assert: storeCredential(preview=true) returns "secret:preview-noop"
    // without calling vault.store(). The spy confirms no call was made.
    expect(storeCallCount).toBe(0);
  });

  it("preview mode — CreateDataSource + SetDataSourceConfig leave canonical DB with no data-source row and make zero vault.store() calls", async () => {
    // Arrange: two credential-bearing commands targeting the same source.
    const sourceId = crypto.randomUUID();

    // Act: preview the create-then-configure sequence.
    await buildPreviewDiff(
      app,
      db,
      [
        cmd("CreateDataSource", {
          id: sourceId,
          type: "notion",
          name: "Preview Src",
          apiKey: "key-v1",
        }),
        cmd("SetDataSourceConfig", { id: sourceId, apiKey: "key-v2" }),
      ],
      { vault },
    );

    // Assert — canonical DB is untouched (the preview transaction rolled back).
    const rows = await db.select().from(dataSources);
    expect(rows.find((r) => r.id === sourceId)).toBeUndefined();
    // Both createDataSource and setDataSourceConfig called storeCredential with
    // preview=true; neither should have reached vault.store().
    expect(storeCallCount).toBe(0);
  });

  it("preview mode — DeleteNode for a credential-bearing DataSource does NOT call vault.delete() (refs survive rollback)", async () => {
    // Arrange: create a real source with a credential (commit mode, separate
    // vault-injected app so the ref is live and verifiable via vault.has()).
    const setupDir = mkdtempSync(join(tmpdir(), "dashframe-vault-del-setup-"));
    const setupDb = await openArtifactDb({
      path: join(setupDir, "artifacts.db"),
    });
    const rawSetupApp = await createWyStack({ db: setupDb, functions });
    const setupApp: WyStackApp = {
      ...rawSetupApp,
      async call(path, args, ctx) {
        return rawSetupApp.call(path, args, { ...(ctx ?? {}), vault });
      },
      async runHandler(path, args, tracked, ctx) {
        return rawSetupApp.runHandler(path, args, tracked, {
          ...(ctx ?? {}),
          vault,
        });
      },
    };
    const sourceId = crypto.randomUUID();
    await setupApp.call("createDataSource", {
      id: sourceId,
      type: "notion",
      name: "To Preview Delete",
      apiKey: "live-key",
    });
    const rows = await setupDb.select().from(dataSources);
    const apiKeyRef = (
      rows.find((r) => r.id === sourceId)!.config as Record<string, string>
    )["apiKey"];
    expect(isSecretRef(apiKeyRef)).toBe(true);
    // Confirm the ref is live before the preview.
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );

    // Act: preview a DeleteNode on the SAME db (the source row is visible to
    // the handler inside the preview transaction).
    await buildPreviewDiff(
      setupApp,
      setupDb,
      [cmd("DeleteNode", { id: sourceId })],
      { vault },
    );

    // Assert: the vault entry MUST still be live after the preview.
    // The preview rolled back the DB delete, so the source row (and its ref)
    // survived. If vault.delete() had fired — which it must not — the ref
    // would be gone and the source would have an unresolvable credential.
    // The modeFromCtx(ctx) !== "preview" guard in deleteNode prevents this.
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );

    await setupDb.$client.close();
    rmSync(setupDir, { recursive: true, force: true });
  });

  it("preview mode — storeCallCount is 0 but would be >0 in a real commit (spy confirms the guard fires)", async () => {
    // This test acts as a calibration: it shows that the spy is functional
    // (a real commit path DOES increment storeCallCount) so the 0-assertions
    // above are meaningful, not trivially satisfied by a broken spy.
    //
    // We compose a separate vault-injected app (same pattern as the delete
    // tests' beforeEach) and call createDataSource via commit — not preview.
    const commitDir = mkdtempSync(
      join(tmpdir(), "dashframe-vault-commit-cal-"),
    );
    const commitDb = await openArtifactDb({
      path: join(commitDir, "artifacts.db"),
    });
    const rawApp = await createWyStack({ db: commitDb, functions });
    const commitApp: WyStackApp = {
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

    await commitApp.call("createDataSource", {
      id: crypto.randomUUID(),
      type: "notion",
      name: "Commit Source",
      apiKey: "real-key",
    });

    // The commit path must have called vault.store() — spy confirms it.
    expect(storeCallCount).toBeGreaterThan(0);

    await commitDb.$client.close();
    rmSync(commitDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// SecretVault lifecycle coupling — preview mode skips vault delete
// ---------------------------------------------------------------------------
//
// Mirror of the preview-safe-store invariant on the DELETE side. A preview is
// execute-then-rollback: the DB transaction is undone, so a previewed
// `DeleteNode` (or `removeDataSource`) leaves the data-source row — and its
// SecretRefs — intact in the canonical DB. vault.delete() is a keychain
// side-effect OUTSIDE that transaction; if it fired during a preview, it would
// permanently orphan the surviving row's refs (vault.has(ref) → false while the
// row still references it). The handlers detect `ctx.mode === "preview"` via
// modeFromCtx() and skip releaseCredentialRefs entirely.
//
// Witness: a spy on vault.delete() that must stay at 0 during a previewed
// delete, plus a calibration showing a REAL commit delete DOES release the ref.
// ---------------------------------------------------------------------------

describe("vault lifecycle — preview mode skips vault delete", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let commitApp: WyStackApp;
  let previewApp: WyStackApp;
  let vault: SecretVault;
  let deleteCallCount: number;

  function wrapWithVault(rawApp: WyStackApp): WyStackApp {
    // flushSnapshot is required by the fail-closed credential-release gate:
    // refs are only released after a confirmed durable snapshot. Wire a no-op
    // for tests exercising the direct canonical path.
    const ctx = { vault, flushSnapshot: async () => {} };
    return {
      ...rawApp,
      async call(path, args, extraCtx) {
        return rawApp.call(path, args, { ...ctx, ...(extraCtx ?? {}) });
      },
      async runHandler(path, args, tracked, extraCtx) {
        return rawApp.runHandler(path, args, tracked, {
          ...ctx,
          ...(extraCtx ?? {}),
        });
      },
    };
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-vault-del-preview-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault } = makeTestVault());
    deleteCallCount = 0;

    // Spy on vault.delete() — the only direct witness that the preview guard
    // fires. A previewed delete must never reach it.
    const realDelete = vault.delete.bind(vault);
    vault.delete = async (...args: Parameters<typeof vault.delete>) => {
      deleteCallCount++;
      return realDelete(...args);
    };

    const rawApp = await createWyStack({ db, functions });
    // commitApp threads the vault via a wrapper (commit-mode call path).
    commitApp = wrapWithVault(rawApp);
    // previewApp runs DeleteNode through buildPreviewDiff, which threads the
    // vault via the context arg it passes to applyCommands — the production seam.
    previewApp = rawApp;
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("preview mode — previewing a DeleteNode never calls vault.delete() and the ref survives", async () => {
    // Arrange: commit a credentialed source so a real SecretRef is live.
    const id = crypto.randomUUID();
    await commitApp.call("createDataSource", {
      id,
      type: "notion",
      name: "Keep My Creds",
      apiKey: "do-not-orphan-me",
    });
    const config = await readConfig(db, id);
    const apiKeyRef = config!["apiKey"] as string;
    expect(isSecretRef(apiKeyRef)).toBe(true);
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );
    const deleteCountBefore = deleteCallCount;

    // Act: preview a DeleteNode of that source (execute-then-rollback).
    await buildPreviewDiff(previewApp, db, [cmd("DeleteNode", { id })], {
      vault,
    });

    // Assert: the guard fired — vault.delete() was never called during preview.
    expect(deleteCallCount).toBe(deleteCountBefore);
    // The canonical row survived the rollback...
    const rows = await db.select().from(dataSources);
    expect(rows.find((r) => r.id === id)).toBeDefined();
    // ...and its credential is still resolvable (NOT orphaned by the preview).
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );
  });

  it("commit mode — a real DeleteNode DOES call vault.delete() and releases the ref (calibration)", async () => {
    // Calibration: proves the spy + release path are wired, so the preview
    // 0-assertion above is meaningful, not trivially green.
    const id = crypto.randomUUID();
    await commitApp.call("createDataSource", {
      id,
      type: "notion",
      name: "Delete For Real",
      apiKey: "release-me",
    });
    const config = await readConfig(db, id);
    const apiKeyRef = config!["apiKey"] as string;
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );
    const deleteCountBefore = deleteCallCount;

    // Act: a real (commit-mode) deleteNode.
    await commitApp.call("deleteNode", { id });

    // Assert: vault.delete() fired and the ref is gone.
    expect(deleteCallCount).toBeGreaterThan(deleteCountBefore);
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      false,
    );
  });

  // Preview-mode guard for the CLEAR and ROTATE branches in applyCredentialField.
  // The `!preview` guard in applyCredentialField must prevent vault.delete() from firing
  // in preview mode for SetDataSourceConfig, just as it does for DeleteNode.
  // These tests use the spy on vault.delete() already set up by this describe's beforeEach.

  it("preview mode — SetDataSourceConfig with apiKey clear never calls vault.delete() (prior ref survives)", async () => {
    // Arrange: commit a credentialed source so a real SecretRef is live.
    const id = crypto.randomUUID();
    await commitApp.call("createDataSource", {
      id,
      type: "notion",
      name: "Preview Clear Guard",
      apiKey: "do-not-release-on-preview-clear",
    });
    const configBefore = await readConfig(db, id);
    const apiKeyRef = configBefore!["apiKey"] as string;
    expect(isSecretRef(apiKeyRef)).toBe(true);
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );
    const deleteCountBefore = deleteCallCount;

    // Act: preview a SetDataSourceConfig that clears the apiKey (empty string).
    // The transaction rolls back, so the DB row is unchanged. More importantly,
    // the CLEAR branch in applyCredentialField must not call vault.delete() in preview.
    await buildPreviewDiff(
      previewApp,
      db,
      [cmd("SetDataSourceConfig", { id, apiKey: "" })],
      { vault },
    );

    // Assert: the guard fired — vault.delete() was never called during preview.
    expect(deleteCallCount).toBe(deleteCountBefore);
    // The canonical row still holds the original ref (rollback preserved it)...
    const configAfter = await readConfig(db, id);
    expect(configAfter!["apiKey"]).toBe(apiKeyRef);
    // ...and the credential is still resolvable (NOT orphaned by the preview clear).
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );
  });

  it("preview mode — SetDataSourceConfig with apiKey rotate never calls vault.delete() (prior ref survives)", async () => {
    // Arrange: commit a credentialed source so a real SecretRef is live.
    const id = crypto.randomUUID();
    await commitApp.call("createDataSource", {
      id,
      type: "notion",
      name: "Preview Rotate Guard",
      apiKey: "do-not-release-on-preview-rotate",
    });
    const configBefore = await readConfig(db, id);
    const apiKeyRef = configBefore!["apiKey"] as string;
    expect(isSecretRef(apiKeyRef)).toBe(true);
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );
    const deleteCountBefore = deleteCallCount;

    // Act: preview a SetDataSourceConfig that rotates the apiKey to a new value.
    // The ROTATE branch in applyCredentialField must not call vault.delete() in preview.
    await buildPreviewDiff(
      previewApp,
      db,
      [cmd("SetDataSourceConfig", { id, apiKey: "rotated-preview-value" })],
      { vault },
    );

    // Assert: the guard fired — vault.delete() was never called during preview.
    expect(deleteCallCount).toBe(deleteCountBefore);
    // The canonical row still holds the original ref (rollback preserved it)...
    const configAfter = await readConfig(db, id);
    expect(configAfter!["apiKey"]).toBe(apiKeyRef);
    // ...and the credential is still resolvable (NOT orphaned by the preview rotate).
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// clear/rotate branches release prior SecretRef (applyCredentialField)
// ---------------------------------------------------------------------------
//
// AC1: store → clear → old ref no longer in vault (vault.has false) + config key absent.
// AC2: store → rotate → old ref released, new ref resolves (vault.has new=true, old=false).
// AC3: vault-absent clear with no prior ref is a no-op (no throw).
//
// The fix lives in applyCredentialField (utils.ts): CLEAR captures the prior ref,
// calls releaseCredentialRefs({[field]: prior}, vault) BEFORE deleting the key;
// ROTATE stores the new ref first, THEN releases the old one (store-new-then-release-old
// preserves the new secret on mid-rotate failure). Both skipped in preview mode.
// ---------------------------------------------------------------------------

describe("vault lifecycle: clear releases prior SecretRef (AC1)", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-vault-clear-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault } = makeTestVault());
    const rawApp = await createWyStack({ db, functions });
    // flushSnapshot is required by the fail-closed credential-release gate: refs are
    // only released after a confirmed durable snapshot. Wire a no-op for tests
    // exercising the direct canonical path (no actual snapshot needed here).
    const ctx = { vault, flushSnapshot: async () => {} };
    app = {
      ...rawApp,
      async call(path, args, extraCtx) {
        return rawApp.call(path, args, { ...ctx, ...(extraCtx ?? {}) });
      },
      async runHandler(path, args, tracked, extraCtx) {
        return rawApp.runHandler(path, args, tracked, {
          ...ctx,
          ...(extraCtx ?? {}),
        });
      },
    };
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("AC1 — store credential → clear it → old SecretRef is released from vault and config key is absent", async () => {
    // Arrange: create a source with an apiKey so a real SecretRef is minted.
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "notion",
      name: "Clear Me",
      apiKey: "clear-this-secret",
    });
    const configBefore = await readConfig(db, id);
    const oldRef = configBefore!["apiKey"] as string;
    expect(isSecretRef(oldRef)).toBe(true);
    expect(await vault.has(oldRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );

    // Act: clear the credential by passing an empty string.
    await app.call("setDataSourceConfig", { id, apiKey: "" });

    // Assert AC1a: the old ref is no longer in the vault.
    expect(await vault.has(oldRef as Parameters<typeof vault.has>[0])).toBe(
      false,
    );
    // Assert AC1b: the config key is absent (not just null/undefined in jsonb).
    const configAfter = await readConfig(db, id);
    expect(configAfter!["apiKey"]).toBeUndefined();
  });

  it("a rejected clear (extra-key sink-guard fires) does NOT release the prior ref — validation runs before the irreversible vault.delete", async () => {
    // Regression: the sink-guard that rejects credential keys in `extra` must run
    // BEFORE applyCredentialField does the vault release. Otherwise a request that
    // clears apiKey AND smuggles apiKey via `extra` would delete the live secret,
    // then throw — leaving the surviving DB row pointing at a now-dead ref.
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "notion",
      name: "Reject Me",
      apiKey: "must-survive-a-rejected-write",
    });
    const configBefore = await readConfig(db, id);
    const oldRef = configBefore!["apiKey"] as string;
    expect(isSecretRef(oldRef)).toBe(true);
    expect(await vault.has(oldRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );

    // Act: clear apiKey while illegally smuggling apiKey through `extra`.
    await expect(
      app.call("setDataSourceConfig", {
        id,
        apiKey: "",
        extra: { apiKey: "sneaky" },
      }),
    ).rejects.toThrow(/typed credential fields/i);

    // Assert: the guard rejected before any release fired — the prior ref is intact
    // and the DB row still references it (consistent, no dangling pointer).
    expect(await vault.has(oldRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );
    const configAfter = await readConfig(db, id);
    expect(configAfter!["apiKey"]).toBe(oldRef);
  });

  it("clearing apiKey releases ONLY the apiKey ref — the connectionString sibling stays live in the vault", async () => {
    // Single-field scope: applyCredentialField passes { [field]: prior } to
    // releaseCredentialRefs, so clearing one credential must not touch the other.
    // This is the regression fence for the single-field slice — a full-config
    // release would wrongly delete the sibling's vault entry.
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "postgres",
      name: "Both Creds",
      apiKey: "the-api-key",
      connectionString: "postgresql://u:p@h/db",
    });
    const configBefore = await readConfig(db, id);
    const apiKeyRef = configBefore!["apiKey"] as string;
    const csRef = configBefore!["connectionString"] as string;
    expect(isSecretRef(apiKeyRef)).toBe(true);
    expect(isSecretRef(csRef)).toBe(true);
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );
    expect(await vault.has(csRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );

    // Act: clear ONLY apiKey.
    await app.call("setDataSourceConfig", { id, apiKey: "" });

    // Assert: apiKey ref released, connectionString ref untouched (vault + config).
    expect(await vault.has(apiKeyRef as Parameters<typeof vault.has>[0])).toBe(
      false,
    );
    expect(await vault.has(csRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );
    const configAfter = await readConfig(db, id);
    expect(configAfter!["apiKey"]).toBeUndefined();
    expect(configAfter!["connectionString"]).toBe(csRef);
  });
});

describe("vault lifecycle: rotate releases prior SecretRef (AC2)", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: WyStackApp;
  let vault: SecretVault;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-vault-rotate-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    ({ vault } = makeTestVault());
    const rawApp = await createWyStack({ db, functions });
    // flushSnapshot is required by the fail-closed credential-release gate: refs are
    // only released after a confirmed durable snapshot. Wire a no-op for tests
    // exercising the direct canonical path (no actual snapshot needed here).
    const ctx = { vault, flushSnapshot: async () => {} };
    app = {
      ...rawApp,
      async call(path, args, extraCtx) {
        return rawApp.call(path, args, { ...ctx, ...(extraCtx ?? {}) });
      },
      async runHandler(path, args, tracked, extraCtx) {
        return rawApp.runHandler(path, args, tracked, {
          ...ctx,
          ...(extraCtx ?? {}),
        });
      },
    };
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("AC2 — store credential → rotate to new value → old ref released, new ref resolves", async () => {
    // Arrange: create a source with an initial apiKey.
    const id = crypto.randomUUID();
    await app.call("createDataSource", {
      id,
      type: "notion",
      name: "Rotate Me",
      apiKey: "original-secret",
    });
    const configBefore = await readConfig(db, id);
    const oldRef = configBefore!["apiKey"] as string;
    expect(isSecretRef(oldRef)).toBe(true);
    expect(await vault.has(oldRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );

    // Act: rotate to a new credential value.
    await app.call("setDataSourceConfig", { id, apiKey: "rotated-secret" });

    // Assert AC2a: old ref is released from the vault.
    expect(await vault.has(oldRef as Parameters<typeof vault.has>[0])).toBe(
      false,
    );
    // Assert AC2b: the new ref is live and distinct from the old one.
    const configAfter = await readConfig(db, id);
    const newRef = configAfter!["apiKey"] as string;
    expect(isSecretRef(newRef)).toBe(true);
    expect(newRef).not.toBe(oldRef);
    expect(await vault.has(newRef as Parameters<typeof vault.has>[0])).toBe(
      true,
    );
  });
});

describe("vault lifecycle: vault-absent clear is a no-op (AC3)", () => {
  // AC3 unit anchor: the underlying releaseCredentialRefs early-return semantics.
  it("AC3 unit — releaseCredentialRefs with no prior ref and no vault does not throw (early-return)", async () => {
    // releaseCredentialRefs early-returns when refs.length === 0, so no vault is
    // consulted. This pins the primitive that applyCredentialField relies on for AC3.
    await expect(
      releaseCredentialRefs({ apiKey: undefined }, undefined),
    ).resolves.toBeUndefined();
  });

  // AC3 end-to-end: applyCredentialField with value="" on a source with no prior
  // credential, no vault injected. The full path: handler → applyCredentialField →
  // CLEAR branch → releaseCredentialRefs({apiKey: undefined}, undefined) → early-return.
  it("AC3 e2e — setDataSourceConfig with apiKey clear on a no-credential source succeeds with no vault injected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashframe-vault-ac3-"));
    const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    // No vault injected — this is a vault-absent server.
    const app = await createWyStack({ db, functions });

    try {
      // Arrange: create a source with no credential (allowed without vault).
      const id = crypto.randomUUID();
      await app.call("createDataSource", {
        id,
        type: "csv",
        name: "AC3 Source",
      });
      const configBefore = await readConfig(db, id);
      expect(configBefore!["apiKey"]).toBeUndefined(); // confirm no prior ref

      // Act: clear the (already-absent) apiKey with no vault. Must not throw.
      await expect(
        app.call("setDataSourceConfig", { id, apiKey: "" }),
      ).resolves.toBeDefined();

      // Assert: config still has no apiKey (clear on absent field is a no-op).
      const configAfter = await readConfig(db, id);
      expect(configAfter!["apiKey"]).toBeUndefined();
    } finally {
      await db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
