/**
 * RestConnector tests
 *
 * Pattern: makeRestConnector(auth, config) — the connector is auth-blind.
 * For tests that need real vault resolution, we build a TestBackend vault and
 * mint a bound resolver. For tests without auth, we use noopResolver.
 *
 * WARNING: TestBackend / InMemoryMappingStore / SecretRegistry / SecretVault
 * are CI/dev-only doubles — NEVER import these in production or renderer code.
 */

import type { SecretResolver } from "@dashframe/engine";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RestConnector,
  applyFieldMap,
  extractRows,
  makeRestConnector,
  noopResolver,
} from "./connector.js";

// ---------------------------------------------------------------------------
// Vault factory
// ---------------------------------------------------------------------------

async function makeTestVaultWithSecret(plaintext: string) {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault("connector-key", "test");
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  const ref = await vault.store(plaintext, { class: "connector-key" });
  return { vault, ref };
}

/**
 * Mint a bound SecretResolver from a vault + ref, matching how the
 * server-layer connector factory works.
 */
function makeBoundResolver(
  vault: SecretVault,
  ref: Awaited<ReturnType<SecretVault["store"]>>,
): SecretResolver {
  return (use) => vault.withSecret(ref, use);
}

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

/** Build a minimal Response-like object for vi.stubGlobal('fetch', ...) */
function makeResponse(
  body: unknown,
  opts: { ok?: boolean; status?: number; linkHeader?: string } = {},
): Response {
  const ok = opts.ok ?? true;
  const status = opts.status ?? 200;
  const headers = new Map<string, string>();
  if (opts.linkHeader) {
    headers.set("link", opts.linkHeader);
  }
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
    headers: {
      get: (key: string) => headers.get(key.toLowerCase()) ?? null,
    },
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Unit: extractRows
// ---------------------------------------------------------------------------

describe("extractRows", () => {
  it("returns root array when no rowPath", () => {
    expect(extractRows([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("returns [] for non-array root with no rowPath", () => {
    expect(extractRows({ items: [1] })).toEqual([]);
  });

  it("resolves a dot-path to the array", () => {
    expect(extractRows({ data: { items: [{ id: 1 }] } }, "data.items")).toEqual(
      [{ id: 1 }],
    );
  });

  it("returns [] when dot-path resolves to a non-array", () => {
    expect(extractRows({ data: "not-array" }, "data")).toEqual([]);
  });

  it("returns [] when dot-path is missing", () => {
    expect(extractRows({ a: 1 }, "a.b.c")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unit: applyFieldMap
// ---------------------------------------------------------------------------

describe("applyFieldMap", () => {
  it("returns row as-is when no fieldMap", () => {
    const row = { id: 1, name: "Alice" };
    expect(applyFieldMap(row)).toEqual({ id: 1, name: "Alice" });
  });

  it("renames mapped keys and passes through unmapped ones", () => {
    const row = { full_name: "Alice", age: 30 };
    expect(applyFieldMap(row, { full_name: "name" })).toEqual({
      name: "Alice",
      age: 30,
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: RestConnector
// ---------------------------------------------------------------------------

describe("RestConnector", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Static properties
  // -------------------------------------------------------------------------

  it("has id = 'rest'", () => {
    const c = makeRestConnector(noopResolver, {
      endpoint: "https://api.example.com/data",
    });
    expect(c.id).toBe("rest");
  });

  it("has sourceType = 'remote-api'", () => {
    const c = makeRestConnector(noopResolver, {
      endpoint: "https://api.example.com/data",
    });
    expect(c.sourceType).toBe("remote-api");
  });

  it("is an instance of RestConnector", () => {
    const c = makeRestConnector(noopResolver, {
      endpoint: "https://api.example.com/data",
    });
    expect(c).toBeInstanceOf(RestConnector);
  });

  it("getFormFields returns at least endpoint field", () => {
    const c = makeRestConnector(noopResolver, {
      endpoint: "https://api.example.com/data",
    });
    const fields = c.getFormFields();
    expect(fields.some((f) => f.name === "endpoint")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // validate()
  // -------------------------------------------------------------------------

  describe("validate()", () => {
    const c = makeRestConnector(noopResolver, {
      endpoint: "https://api.example.com/data",
    });

    it("fails when endpoint is missing", () => {
      const result = c.validate({});
      expect(result.valid).toBe(false);
      expect(result.errors?.["endpoint"]).toBeTruthy();
    });

    it("fails when endpoint is not a valid URL", () => {
      const result = c.validate({ endpoint: "not-a-url" });
      expect(result.valid).toBe(false);
    });

    it("passes for a valid URL", () => {
      const result = c.validate({ endpoint: "https://api.example.com/data" });
      expect(result.valid).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 1. Offset pagination
  // -------------------------------------------------------------------------

  describe("offset pagination", () => {
    it("collects rows from both pages and stops when page is empty", async () => {
      const page1 = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const page2: unknown[] = [];
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeResponse(page1))
        .mockResolvedValueOnce(makeResponse(page2));
      vi.stubGlobal("fetch", mockFetch);

      const tableId = crypto.randomUUID();
      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        pagination: "offset",
        paginationParams: { pageSize: 3 },
      });
      const result = await c.query("db", tableId);

      expect(result.fields.length).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // First call: offset=0, limit=3
      expect(mockFetch.mock.calls[0]?.[0]).toContain("offset=0");
      expect(mockFetch.mock.calls[0]?.[0]).toContain("limit=3");
      // Second call: offset=3
      expect(mockFetch.mock.calls[1]?.[0]).toContain("offset=3");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Cursor pagination
  // -------------------------------------------------------------------------

  describe("cursor pagination", () => {
    it("follows next_cursor until absent", async () => {
      const page1 = { data: [{ id: 1 }], next_cursor: "cursor-abc" };
      const page2 = { data: [{ id: 2 }] };
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeResponse(page1))
        .mockResolvedValueOnce(makeResponse(page2));
      vi.stubGlobal("fetch", mockFetch);

      const tableId = crypto.randomUUID();
      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        pagination: "cursor",
        rowPath: "data",
      });
      const result = await c.query("db", tableId);

      expect(result.fields.length).toBeGreaterThan(0);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Second call should include cursor=cursor-abc
      expect(mockFetch.mock.calls[1]?.[0]).toContain("cursor=cursor-abc");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Page-number pagination
  // -------------------------------------------------------------------------

  describe("page-number pagination", () => {
    it("fetches page 1 then page 2, stops when page 2 has fewer than pageSize rows", async () => {
      const page1 = [{ id: 1 }, { id: 2 }];
      const page2 = [{ id: 3 }]; // < pageSize=2 → stop
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeResponse(page1))
        .mockResolvedValueOnce(makeResponse(page2));
      vi.stubGlobal("fetch", mockFetch);

      const tableId = crypto.randomUUID();
      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        pagination: "page-number",
        paginationParams: { pageSize: 2 },
      });
      await c.query("db", tableId);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0]?.[0]).toContain("page=1");
      expect(mockFetch.mock.calls[1]?.[0]).toContain("page=2");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Link-header pagination
  // -------------------------------------------------------------------------

  describe("link-header pagination", () => {
    it("follows Link: rel=next header, stops when absent", async () => {
      const page1Rows = [{ id: 1 }];
      const page2Rows = [{ id: 2 }];
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          makeResponse(page1Rows, {
            linkHeader: '<https://api.example.com/data?page=2>; rel="next"',
          }),
        )
        .mockResolvedValueOnce(makeResponse(page2Rows));
      vi.stubGlobal("fetch", mockFetch);

      const tableId = crypto.randomUUID();
      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        pagination: "link-header",
      });
      await c.query("db", tableId);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1]?.[0]).toBe(
        "https://api.example.com/data?page=2",
      );
    });
  });

  // -------------------------------------------------------------------------
  // 5. rowPath + fieldMap
  // -------------------------------------------------------------------------

  describe("rowPath + fieldMap", () => {
    it("extracts nested rows and renames keys", async () => {
      const body = { results: [{ id: 1, full_name: "Alice" }] };
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(makeResponse(body)));

      const tableId = crypto.randomUUID();
      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        rowPath: "results",
        fieldMap: { full_name: "name" },
      });
      const result = await c.query("db", tableId);

      // Fields should include "name" but not "full_name"
      const fieldNames = result.fields.map((f) => f.name);
      expect(fieldNames).toContain("name");
      expect(fieldNames).not.toContain("full_name");
    });
  });

  // -------------------------------------------------------------------------
  // 6. authRef vault resolution
  // -------------------------------------------------------------------------

  describe("authRef vault resolution", () => {
    it("resolves the token from vault and passes it as Bearer auth header", async () => {
      const { vault, ref } = await makeTestVaultWithSecret("my-api-token");
      const auth = makeBoundResolver(vault, ref);

      let capturedHeaders: Record<string, string> = {};
      const mockFetch = vi
        .fn()
        .mockImplementation((_url: string, opts: RequestInit) => {
          capturedHeaders = (opts.headers ?? {}) as Record<string, string>;
          return Promise.resolve(makeResponse([{ id: 1 }]));
        });
      vi.stubGlobal("fetch", mockFetch);

      const tableId = crypto.randomUUID();
      const c = makeRestConnector(auth, {
        endpoint: "https://api.example.com/data",
      });
      await c.query("db", tableId);

      expect(capturedHeaders["Authorization"]).toBe("Bearer my-api-token");
      // Plaintext never appears in the config or connector's public interface
    });

    it("resolves the token during connect()", async () => {
      const { vault, ref } = await makeTestVaultWithSecret("connect-token");
      const auth = makeBoundResolver(vault, ref);

      let capturedHeaders: Record<string, string> = {};
      const mockFetch = vi
        .fn()
        .mockImplementation((_url: string, opts: RequestInit) => {
          capturedHeaders = (opts.headers ?? {}) as Record<string, string>;
          return Promise.resolve(makeResponse([{ id: 1 }]));
        });
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(auth, {
        endpoint: "https://api.example.com/data",
      });
      const result = await c.connect();

      expect(capturedHeaders["Authorization"]).toBe("Bearer connect-token");
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("https://api.example.com/data");
    });
  });

  // -------------------------------------------------------------------------
  // 7. Fail-closed: resolver throws → no fetch called
  // -------------------------------------------------------------------------

  describe("fail-closed: resolver failure", () => {
    it("throws before calling fetch when the SecretResolver rejects", async () => {
      const failResolver: SecretResolver = async (_use) => {
        throw new Error("No secret available — vault missing or ref invalid");
      };

      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const tableId = crypto.randomUUID();
      const c = makeRestConnector(failResolver, {
        endpoint: "https://api.example.com/data",
      });

      await expect(c.query("db", tableId)).rejects.toThrow(
        /No secret available|vault/i,
      );

      // fetch must NOT have been called — resolver failed before fetch
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws before calling fetch in connect() when resolver rejects", async () => {
      const failResolver: SecretResolver = async (_use) => {
        throw new Error("No secret available");
      };

      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(failResolver, {
        endpoint: "https://api.example.com/data",
      });

      await expect(c.connect()).rejects.toThrow(/No secret available/i);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 8. noopResolver — public endpoint (no auth)
  // -------------------------------------------------------------------------

  describe("noopResolver for public endpoints", () => {
    it("calls fetch without Authorization header for public endpoints", async () => {
      let capturedHeaders: Record<string, string> = {};
      const mockFetch = vi
        .fn()
        .mockImplementation((_url: string, opts: RequestInit) => {
          capturedHeaders = (opts.headers ?? {}) as Record<string, string>;
          return Promise.resolve(makeResponse([{ id: 1 }]));
        });
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/public",
      });
      await c.query("db", crypto.randomUUID());

      expect(mockFetch).toHaveBeenCalledTimes(1);
      // noopResolver passes empty string as token → no Authorization header sent
      expect(capturedHeaders["Authorization"]).toBeUndefined();
    });
  });
});
