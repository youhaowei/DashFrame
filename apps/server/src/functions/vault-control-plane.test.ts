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
// YW-268: SecretVault lifecycle coupling — delete releases SecretRefs
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
// YW-268: SecretVault lifecycle coupling — preview mode skips vault store
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
