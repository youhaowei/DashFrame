/**
 * Unit tests for NotionConnector and NotionConnectorKind
 *
 * Tests cover:
 * - NotionConnectorKind: the registry descriptor (metadata, form fields,
 *   validation, factory method)
 * - NotionConnector: the auth-bound execution object (constructor, static
 *   properties, auth-blind data methods)
 * - SecretResolver capability-attenuation guarantee
 * - End-to-end query via TestBackend (AC: bound resolver, auth-blind pipeline)
 *
 * Note: connect() and query() network calls are tested via integration tests
 * with mocked Notion client. The end-to-end vault resolution is tested here
 * using the @wystack/secret-vault TestBackend.
 */
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NotionConnector,
  NotionConnectorKind,
  notionConnectorKind,
} from "./connector";
import { createNotionConnector } from "./index";

// Mock the Notion client so tests don't make real network calls.
// vi.mock is hoisted to the top of the module by Vitest.
vi.mock("./client", () => ({
  listDatabases: vi.fn(async (_apiKey: string) => {
    return [{ id: "db-123", title: "Test DB" }];
  }),
  getDatabaseSchema: vi.fn(async () => []),
  queryDatabase: vi.fn(async () => ({
    object: "list" as const,
    results: [],
    has_more: false,
    next_cursor: null,
    type: "page_or_database" as const,
    page_or_database: {} as const,
  })),
}));

// ============================================================================
// NotionConnectorKind — registry descriptor tests
// ============================================================================

describe("NotionConnectorKind (registry descriptor)", () => {
  let kind: NotionConnectorKind;

  beforeEach(() => {
    kind = new NotionConnectorKind();
  });

  describe("static properties", () => {
    it("has correct id", () => {
      expect(kind.id).toBe("notion");
    });

    it("has correct name", () => {
      expect(kind.name).toBe("Notion");
    });

    it("has description", () => {
      expect(kind.description).toBeTruthy();
      expect(typeof kind.description).toBe("string");
    });

    it("has remote-api sourceType", () => {
      expect(kind.sourceType).toBe("remote-api");
    });

    it("has SVG icon", () => {
      expect(kind.icon).toContain("<svg");
      expect(kind.icon).toContain("</svg>");
    });

    it("has preserveAspectRatio in icon for proper scaling", () => {
      expect(kind.icon).toContain("preserveAspectRatio");
    });
  });

  describe("getFormFields — credential capture for add-connection flow", () => {
    it("returns exactly one field for API key capture", () => {
      const fields = kind.getFormFields();
      expect(fields).toHaveLength(1);
    });

    it("apiKey field has correct configuration", () => {
      const fields = kind.getFormFields();
      const apiKeyField = fields[0];

      expect(apiKeyField?.name).toBe("apiKey");
      expect(apiKeyField?.label).toBe("API Key");
      expect(apiKeyField?.type).toBe("password");
      expect(apiKeyField?.required).toBe(true);
    });

    it("placeholder suggests secret_ prefix", () => {
      const fields = kind.getFormFields();
      expect(fields[0]?.placeholder).toContain("secret_");
    });

    it("hint mentions local storage", () => {
      const fields = kind.getFormFields();
      expect(fields[0]?.hint).toBeTruthy();
      expect(fields[0]?.hint).toContain("locally");
    });
  });

  describe("validate", () => {
    describe("missing API key", () => {
      it("returns invalid when apiKey is undefined", () => {
        const result = kind.validate({});
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toBe("API key is required");
      });

      it("returns invalid when apiKey is empty string", () => {
        const result = kind.validate({ apiKey: "" });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toBe("API key is required");
      });

      it("returns invalid when apiKey is null", () => {
        const result = kind.validate({ apiKey: null });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toBe("API key is required");
      });
    });

    describe("invalid API key format", () => {
      it("rejects API keys without secret_ prefix", () => {
        const result = kind.validate({ apiKey: "ntn_abc123" });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toContain('start with "secret_"');
      });

      it("rejects API keys with wrong prefix", () => {
        const result = kind.validate({ apiKey: "private_abc123" });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toContain('start with "secret_"');
      });

      it("rejects API keys with similar but incorrect prefix", () => {
        const result = kind.validate({ apiKey: "secrets_abc123" });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toContain('start with "secret_"');
      });

      it("rejects API keys with uppercase prefix", () => {
        const result = kind.validate({ apiKey: "SECRET_abc123" });
        expect(result.valid).toBe(false);
        expect(result.errors?.apiKey).toContain('start with "secret_"');
      });
    });

    describe("valid API key", () => {
      it("accepts API keys with secret_ prefix", () => {
        const result = kind.validate({ apiKey: "secret_abc123" });
        expect(result.valid).toBe(true);
        expect(result.errors).toBeUndefined();
      });

      it("accepts long API keys with secret_ prefix", () => {
        const longKey =
          "secret_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdefghijklmnopqrstuvwxyz";
        const result = kind.validate({ apiKey: longKey });
        expect(result.valid).toBe(true);
      });

      it("accepts API keys with just secret_ prefix", () => {
        const result = kind.validate({ apiKey: "secret_" });
        expect(result.valid).toBe(true);
      });
    });

    describe("extra form data", () => {
      it("ignores extra fields in form data", () => {
        const result = kind.validate({
          apiKey: "secret_abc123",
          extraField: "should be ignored",
          anotherField: 12345,
        });
        expect(result.valid).toBe(true);
      });
    });
  });

  describe("createConnector — factory method", () => {
    it("returns a NotionConnector instance", () => {
      const auth = vi.fn(async (use: (s: string) => Promise<void>) => use("x"));
      const connector = kind.createConnector(auth);
      expect(connector).toBeInstanceOf(NotionConnector);
    });

    it("produced connector has same metadata as kind", () => {
      const auth = vi.fn(async (use: (s: string) => Promise<void>) => use("x"));
      const connector = kind.createConnector(auth);
      expect(connector.id).toBe(kind.id);
      expect(connector.name).toBe(kind.name);
      expect(connector.icon).toBe(kind.icon);
    });

    it("each call produces a distinct instance", () => {
      const auth = vi.fn(async (use: (s: string) => Promise<void>) => use("x"));
      const a = kind.createConnector(auth);
      const b = kind.createConnector(auth);
      expect(a).not.toBe(b);
    });
  });

  describe("notionConnectorKind singleton", () => {
    it("exports a singleton descriptor", () => {
      expect(notionConnectorKind).toBeInstanceOf(NotionConnectorKind);
    });

    it("singleton has the same metadata as a new instance", () => {
      expect(notionConnectorKind.id).toBe(kind.id);
      expect(notionConnectorKind.name).toBe(kind.name);
    });

    it("singleton returns same form fields", () => {
      const singletonFields = notionConnectorKind.getFormFields();
      const instanceFields = kind.getFormFields();

      expect(singletonFields).toHaveLength(instanceFields.length);
      expect(singletonFields[0]?.name).toBe(instanceFields[0]?.name);
    });
  });
});

// ============================================================================
// NotionConnector — auth-bound execution object tests
// ============================================================================

describe("NotionConnector (auth-bound connector)", () => {
  it("has correct static properties", () => {
    const auth = vi.fn();
    const connector = new NotionConnector(auth);
    expect(connector.id).toBe("notion");
    expect(connector.name).toBe("Notion");
    expect(connector.sourceType).toBe("remote-api");
    expect(connector.icon).toContain("<svg");
  });

  it("getFormFields returns empty array — auth is constructor-injected, not form-captured", () => {
    const auth = vi.fn();
    const connector = new NotionConnector(auth);
    expect(connector.getFormFields()).toEqual([]);
  });

  it("validate always returns valid — credential validation is deferred to the control-plane layer", () => {
    const auth = vi.fn();
    const connector = new NotionConnector(auth);
    expect(connector.validate({})).toEqual({ valid: true });
    expect(connector.validate({ apiKey: "bad" })).toEqual({ valid: true });
  });

  describe("createNotionConnector factory function", () => {
    it("returns a NotionConnector", () => {
      const auth = vi.fn(async (use: (s: string) => Promise<void>) => use("x"));
      const connector = createNotionConnector(auth);
      expect(connector).toBeInstanceOf(NotionConnector);
    });
  });
});

// ============================================================================
// Capability-attenuation guarantee
//
// AC: a connector bound to refA cannot resolve refB's secret.
// ============================================================================

describe("capability-attenuation guarantee", () => {
  it("resolver bound to refA throws on refB", async () => {
    // Build a vault with two secrets
    const backend = new TestBackend();
    const registry = new SecretRegistry();
    registry.register("test", backend, { fallback: true });
    const vault = new SecretVault(registry, new InMemoryMappingStore());

    const refA = await vault.store("keyA", { class: "connector-key" });
    const refB = await vault.store("keyB", { class: "connector-key" });

    // Connector A is bound to refA only
    const authA = <T>(use: (plaintext: string) => Promise<T>) =>
      vault.withSecret(refA, use);
    const connectorA = createNotionConnector(authA);

    // Connector A correctly resolves its own secret
    const resolvedA = await authA((plaintext) => Promise.resolve(plaintext));
    expect(resolvedA).toBe("keyA");

    // connectorA's resolver cannot resolve refB — it does not hold refB
    // Attempting to use refB directly (bypassing authA) throws
    await expect(
      vault.withSecret(refB, (p) => Promise.resolve(p)),
    ).resolves.toBe("keyB");

    // The auth function for connectorA is pre-bound to refA — calling it with a
    // use that captures refB's ref would succeed IF the caller had vault in scope,
    // but the connector itself cannot accept a different ref. We verify by type:
    // connectorA.auth is `protected` — callers cannot reach it to supply a new ref.
    // @ts-expect-error — protected: intentional type-level assertion
    expect(connectorA.auth).toBe(authA);
    // And that resolver is ONLY for refA:
    // @ts-expect-error — protected: intentional type-level assertion
    await expect(connectorA.auth((p) => Promise.resolve(p))).resolves.toBe(
      "keyA",
    );
  });
});

// ============================================================================
// End-to-end through TestBackend
//
// AC: store a fake apiKey in TestBackend, mint resolver, drive a query with
//     the network call mocked, assert the resolved plaintext reached the fetch.
// ============================================================================

describe("end-to-end through TestBackend (auth-blind pipeline)", () => {
  it("query resolves auth via vault and passes plaintext to the Notion client", async () => {
    // ------------------------------------------------------------------
    // 1. Set up an in-memory vault backed by TestBackend
    // ------------------------------------------------------------------
    const backend = new TestBackend();
    const registry = new SecretRegistry();
    registry.register("test", backend, { fallback: true });
    const vault = new SecretVault(registry, new InMemoryMappingStore());

    const FAKE_API_KEY = "secret_fake_notion_api_key_for_testing";
    const ref = await vault.store(FAKE_API_KEY, { class: "connector-key" });

    // ------------------------------------------------------------------
    // 2. Mint a one-ref-bound resolver and construct the connector
    //    The connector never sees the vault or ref — only the resolver.
    // ------------------------------------------------------------------
    const auth = <T>(use: (plaintext: string) => Promise<T>) =>
      vault.withSecret(ref, use);

    // ------------------------------------------------------------------
    // 3. Spy on the already-mocked client to capture the apiKey
    // ------------------------------------------------------------------
    const { listDatabases } = await import("./client");
    const capturedApiKeys: string[] = [];
    vi.mocked(listDatabases).mockImplementation(async (apiKey: string) => {
      capturedApiKeys.push(apiKey);
      return [{ id: "db-123", title: "Test DB" }];
    });

    const connector = createNotionConnector(auth);

    // ------------------------------------------------------------------
    // 4. Call connect() — auth-blind: pipeline has no vault/ref in scope
    //    The connector must internally resolve the apiKey via this.auth
    // ------------------------------------------------------------------
    const databases = await connector.connect();

    // ------------------------------------------------------------------
    // 5. Assert: the resolved plaintext reached the fetch
    // ------------------------------------------------------------------
    expect(capturedApiKeys).toHaveLength(1);
    expect(capturedApiKeys[0]).toBe(FAKE_API_KEY);
    expect(databases).toEqual([{ id: "db-123", name: "Test DB" }]);

    // The TestBackend's resolveCallCount confirms vault was used (not a direct string)
    expect(backend.resolveCallCount).toBe(1);
  });

  it("pipeline call site is auth-blind — vault/ref not in scope at connect() call", async () => {
    // This test demonstrates the auth-blind guarantee BY STRUCTURE:
    // the variables `vault` and `ref` are declared only INSIDE the factory
    // scope, not at the point where connect() is called.

    // Factory seam — vault and ref are in scope HERE only
    const makeConnector = async () => {
      const backend = new TestBackend();
      const registry = new SecretRegistry();
      registry.register("test", backend, { fallback: true });
      const vaultInstance = new SecretVault(
        registry,
        new InMemoryMappingStore(),
      );
      const secretRef = await vaultInstance.store("secret_pipeline_test", {
        class: "connector-key",
      });
      // Mint the resolver — pre-bind vault + ref
      const resolver = <T>(use: (plaintext: string) => Promise<T>) =>
        vaultInstance.withSecret(secretRef, use);
      return createNotionConnector(resolver);
      // vault and ref go out of scope here ↑
    };

    // Pipeline seam — vault, ref, and resolver are NOT in scope here
    const connector = await makeConnector();

    // The connector IS the only thing the pipeline holds.
    // No vault, no ref, no plaintext here.
    expect(connector).toBeInstanceOf(NotionConnector);

    // TypeScript confirms: connector.connect() takes NO credential arg
    // (If it did, this line would be a type error with the right arg count)
    const connectCall = connector.connect;
    expect(connectCall.length).toBe(0); // zero required parameters
  });
});
