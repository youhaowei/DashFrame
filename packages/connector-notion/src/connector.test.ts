/**
 * Unit tests for NotionConnector
 *
 * Tests cover:
 * - Connector construction (requires a SecretResolver)
 * - Form field configuration
 * - Validation logic (required field, secret_ prefix)
 * - Static properties
 * - Bound resolver: connect() and query() resolve via auth, never via formData
 * - Capability attenuation: makeNotionConnector binds to one ref only
 *
 * The TestBackend (from @wystack/secret-vault) is used here to exercise the
 * full bound-resolver path without a real keychain. TestBackend MUST NOT appear
 * in production or renderer code — only in *.test.ts files.
 */
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { makeNotionConnector, NotionConnector } from "./connector";
import { createNotionClient, queryDatabase } from "./client";

// Mock the Notion client so tests don't hit the network
vi.mock("./client", () => ({
  createNotionClient: vi.fn().mockReturnValue({}),
  listDatabases: vi.fn().mockResolvedValue([]),
  getDatabaseSchema: vi.fn().mockResolvedValue([]),
  queryDatabase: vi.fn().mockResolvedValue({ results: [] }),
}));

// NOTE: query() no longer constructs a DataFrame — it returns a serializable
// result (arrowBuffer + fieldIds + fields). No engine-browser mock is needed;
// the method is Node-safe by design (the host ingests the Arrow bytes).

// ---------------------------------------------------------------------------
// Helpers: build a SecretVault + TestBackend + mint a bound resolver
// ---------------------------------------------------------------------------

function makeTestVaultAndBackend() {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  // register() opts: { fallback?: boolean } — NOT a class array
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault("connector-key", "test");
  const mapping = new InMemoryMappingStore();
  const vault = new SecretVault(registry, mapping);
  return { vault, backend };
}

async function mintBoundResolver(vault: SecretVault, plaintext: string) {
  const ref = await vault.store(plaintext, {
    class: "connector-key",
    locatorHint: "test-key",
  });
  return {
    ref,
    resolver: <T>(use: (p: string) => Promise<T>) => vault.withSecret(ref, use),
  };
}

/**
 * Wrap a resolver so we can capture the plaintext it delivers to the connector.
 * The outer resolver still routes through the vault; the capture is a side-effect
 * inside the `use` wrapper.
 */
function makeSpyingResolver(
  resolver: <T>(use: (p: string) => Promise<T>) => Promise<T>,
  onPlaintext: (p: string) => void,
) {
  return <T>(use: (plaintext: string) => Promise<T>) =>
    resolver((plaintext) => {
      onPlaintext(plaintext);
      return use(plaintext);
    });
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe("NotionConnector — validate", () => {
  let connector: NotionConnector;

  beforeEach(async () => {
    const { vault } = makeTestVaultAndBackend();
    const { resolver } = await mintBoundResolver(vault, "secret_test");
    connector = makeNotionConnector(resolver);
  });

  it("should return invalid when apiKey is undefined", () => {
    expect(connector.validate({}).valid).toBe(false);
  });

  it("should reject API keys without secret_ prefix", () => {
    const result = connector.validate({ apiKey: "ntn_abc123" });
    expect(result.valid).toBe(false);
    expect(result.errors?.apiKey).toContain('start with "secret_"');
  });

  it("should accept API keys with secret_ prefix", () => {
    expect(connector.validate({ apiKey: "secret_abc123" }).valid).toBe(true);
  });

  // Regression: before the typeof guard, non-string values would cause
  // .startsWith() to throw TypeError instead of returning { valid: false }.
  it("should return invalid (not throw) when apiKey is a number", () => {
    const result = connector.validate({ apiKey: 42 });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bound resolver — capability attenuation
// ---------------------------------------------------------------------------

describe("NotionConnector — bound resolver (capability attenuation)", () => {
  it("the bound resolver is invoked exactly once when connect() is called", async () => {
    const { vault, backend } = makeTestVaultAndBackend();
    const { resolver } = await mintBoundResolver(vault, "secret_testkey");

    // Track resolver invocations directly via the TestBackend instrumentation.
    expect(backend.resolveCallCount).toBe(0);

    let capturedPlaintext: string | undefined;
    // Wrap the resolver to capture what plaintext the connector receives.
    const spyingResolver = makeSpyingResolver(resolver, (p) => {
      capturedPlaintext = p;
    });

    const connector = makeNotionConnector(spyingResolver);
    // The client is mocked at the top of this file (vi.mock("./client"))
    const result = await connector.connect();
    // Resolver was called once (resolveCallCount increments in TestBackend.withSecret)
    expect(backend.resolveCallCount).toBe(1);
    // The connector received the exact plaintext stored in the vault
    expect(capturedPlaintext).toBe("secret_testkey");
    // connect() returned the (empty) database list
    expect(result).toEqual([]);
  });

  it("query() resolves once via the bound resolver and returns a serializable result", async () => {
    const { vault, backend } = makeTestVaultAndBackend();
    const { resolver } = await mintBoundResolver(vault, "secret_querykey");

    expect(backend.resolveCallCount).toBe(0);

    let capturedPlaintext: string | undefined;
    const spyingResolver = makeSpyingResolver(resolver, (p) => {
      capturedPlaintext = p;
    });

    const connector = makeNotionConnector(spyingResolver);
    const controller = new AbortController();
    // Clients are mocked; getDatabaseSchema → [], queryDatabase → { results: [] }.
    // query() runs entirely in Node with no browser storage dependency.
    const result = await connector.query(
      "db-id",
      crypto.randomUUID() as Parameters<typeof connector.query>[1],
      { signal: controller.signal },
    );

    // Resolver was invoked exactly once for the query.
    expect(backend.resolveCallCount).toBe(1);
    expect(capturedPlaintext).toBe("secret_querykey");

    // The result is serializable: raw Arrow buffer (base64 string) + ids + fields.
    // No live DataFrame — proves query() is server-safe and crosses IPC as JSON.
    expect(typeof result.arrowBuffer).toBe("string");
    expect(Array.isArray(result.fieldIds)).toBe(true);
    expect(Array.isArray(result.fields)).toBe(true);
    // rowCount accompanies the serializable result so the host can register
    // DataFrame metadata without re-reading the Arrow buffer.
    expect(typeof result.rowCount).toBe("number");
    expect(result).not.toHaveProperty("dataFrame");
    expect(vi.mocked(createNotionClient)).toHaveBeenCalledWith(
      "secret_querykey",
      { signal: controller.signal },
    );
    expect(vi.mocked(queryDatabase)).toHaveBeenCalledWith({}, "db-id", {
      pageSize: undefined,
      signal: controller.signal,
    });
  });
});
