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
  assertFieldMapNoCollision,
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

  // -------------------------------------------------------------------------
  // SECURITY 1. SSRF / credential leak — cross-origin next-link gets NO token
  // -------------------------------------------------------------------------

  describe("SSRF guard: cross-origin Link rel=next does NOT receive the token", () => {
    it("stops pagination and never sends the Bearer token off-origin", async () => {
      const { vault, ref } = await makeTestVaultWithSecret("secret-token");
      const auth = makeBoundResolver(vault, ref);

      const seenRequests: { url: string; auth: string | undefined }[] = [];
      const mockFetch = vi
        .fn()
        .mockImplementationOnce((url: string, opts: RequestInit) => {
          const h = (opts.headers ?? {}) as Record<string, string>;
          seenRequests.push({ url, auth: h["Authorization"] });
          // First (same-origin) page returns a CROSS-ORIGIN next-link.
          return Promise.resolve(
            makeResponse([{ id: 1 }], {
              linkHeader: '<https://attacker.example/harvest>; rel="next"',
            }),
          );
        })
        .mockImplementation((url: string, opts: RequestInit) => {
          const h = (opts.headers ?? {}) as Record<string, string>;
          seenRequests.push({ url, auth: h["Authorization"] });
          return Promise.resolve(makeResponse([{ id: 2 }]));
        });
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(auth, {
        endpoint: "https://api.example.com/data",
        authRef: "secret:placeholder",
        pagination: "link-header",
      });
      await c.query("db", crypto.randomUUID());

      // Only the first (same-origin) request was made; pagination stopped.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // The attacker host NEVER received any request — token not forwarded.
      expect(seenRequests.some((r) => r.url.includes("attacker.example"))).toBe(
        false,
      );
      // The same-origin request did carry the token (sanity: auth was wired).
      expect(seenRequests[0]?.auth).toBe("Bearer secret-token");
    });
  });

  // -------------------------------------------------------------------------
  // SECURITY 2. Fail-closed — authRef set but resolver yields no token
  // -------------------------------------------------------------------------

  describe("fail-closed: authRef set but no token resolved", () => {
    it("throws BEFORE fetch when authRef is configured and the token is empty", async () => {
      // A resolver that yields an empty token (miswired factory / deleted secret).
      const emptyTokenResolver: SecretResolver = (use) => use("");
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(emptyTokenResolver, {
        endpoint: "https://api.example.com/data",
        authRef: "secret:configured-but-unresolvable",
      });

      await expect(c.query("db", crypto.randomUUID())).rejects.toThrow(
        /authRef.*no token|fail-closed/i,
      );
      // No request was issued — fail-closed before any network side-effect.
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("throws BEFORE fetch in connect() when authRef set and token empty", async () => {
      const emptyTokenResolver: SecretResolver = (use) => use("");
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(emptyTokenResolver, {
        endpoint: "https://api.example.com/data",
        authRef: "secret:configured-but-unresolvable",
      });

      await expect(c.connect()).rejects.toThrow(
        /authRef.*no token|fail-closed/i,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // SECURITY 3. Prototype pollution — __proto__ response key is data, not proto
  // -------------------------------------------------------------------------

  describe("prototype pollution: __proto__ response key does not pollute", () => {
    it("drops the __proto__ column and does not pollute Object.prototype", async () => {
      // A response row with an own `__proto__` key. JSON.parse produces an own
      // property, so this models a real malicious/edge API.
      const malicious = JSON.parse(
        '[{"id": 1, "__proto__": "evil", "constructor": "bad"}]',
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(makeResponse(malicious)),
      );

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
      });
      const result = await c.query("db", crypto.randomUUID());

      // The reserved keys are dropped — never become columns (they cannot be
      // legitimate data and would crash the Arrow build). `id` remains.
      expect(result.fields.some((f) => f.name === "id")).toBe(true);
      expect(result.fields.some((f) => f.name === "__proto__")).toBe(false);
      expect(result.fields.some((f) => f.name === "constructor")).toBe(false);
      // fieldIds and fields stay aligned (no phantom dropped column).
      expect(result.fieldIds).toHaveLength(result.fields.length);
      // Object.prototype was NOT polluted.
      expect(({} as Record<string, unknown>)["evil"]).toBeUndefined();
      expect(Object.prototype).not.toHaveProperty("evil");
    });
  });

  // -------------------------------------------------------------------------
  // 5. Honor query limit BEFORE fetching all pages (limit pushdown)
  // -------------------------------------------------------------------------

  describe("limit pushdown: stops paginating once the budget is met", () => {
    it("does not fetch further pages once offset+limit rows are collected", async () => {
      // Each page returns a full page of 100 rows; the API would keep going.
      const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const mockFetch = vi.fn().mockResolvedValue(makeResponse(fullPage));
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        pagination: "offset",
        paginationParams: { pageSize: 100 },
      });
      // Request only 10 rows — one page (100) already satisfies the budget.
      await c.query("db", crypto.randomUUID(), {
        pagination: { offset: 0, limit: 10 },
      });

      // Exactly ONE page fetched, not an unbounded walk.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Relative Link headers resolved against the base URL
  // -------------------------------------------------------------------------

  describe("relative Link header resolution", () => {
    it("resolves a relative rel=next link against the current page URL", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          makeResponse([{ id: 1 }], {
            linkHeader: '</data?page=2>; rel="next"',
          }),
        )
        .mockResolvedValueOnce(makeResponse([{ id: 2 }]));
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        pagination: "link-header",
      });
      await c.query("db", crypto.randomUUID());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // The relative link was resolved to an absolute same-origin URL.
      expect(mockFetch.mock.calls[1]?.[0]).toBe(
        "https://api.example.com/data?page=2",
      );
    });
  });

  // -------------------------------------------------------------------------
  // 7. pageSize supplied as a string is coerced before offset arithmetic
  // -------------------------------------------------------------------------

  describe("pageSize string coercion", () => {
    it("coerces a string pageSize so offset increments numerically", async () => {
      const page1 = Array.from({ length: 3 }, (_, i) => ({ id: i }));
      const page2: unknown[] = [];
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeResponse(page1))
        .mockResolvedValueOnce(makeResponse(page2));
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        pagination: "offset",
        // String pageSize — must be coerced, not string-concatenated.
        paginationParams: { pageSize: "3" },
      });
      await c.query("db", crypto.randomUUID());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Second offset is the NUMERIC 3, not the concatenated "03"/"30".
      expect(mockFetch.mock.calls[1]?.[0]).toContain("offset=3");
      expect(mockFetch.mock.calls[1]?.[0]).not.toContain("offset=03");
    });
  });

  // -------------------------------------------------------------------------
  // 8. Inferred types align with serialized string values
  // -------------------------------------------------------------------------

  describe("type alignment: serialized string values coerced to inferred type", () => {
    it("coerces a string-encoded number so the Arrow column is numeric", async () => {
      // API encodes the number as a string "42"; inference marks it number.
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(makeResponse([{ amount: "42" }])),
      );

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
      });
      const result = await c.query("db", crypto.randomUUID());

      const amountField = result.fields.find((f) => f.name === "amount");
      expect(amountField?.type).toBe("number");
      // The Arrow schema must agree: decode and check the column value is numeric.
      const { tableFromIPC } = await import("apache-arrow");
      const bytes = Uint8Array.from(Buffer.from(result.arrowBuffer, "base64"));
      const table = tableFromIPC(bytes);
      const col = table.getChild("amount");
      expect(typeof col?.get(0)).toBe("number");
      expect(col?.get(0)).toBe(42);
    });

    it("maps an empty-string cell in a numeric column to null, not a fabricated 0", async () => {
      // First row types the column number; second row's "" must become null,
      // NOT 0 (Number("") === 0 would fabricate a real zero reading).
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            makeResponse([{ amount: "42" }, { amount: "" }]),
          ),
      );

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
      });
      const result = await c.query("db", crypto.randomUUID());

      const amountField = result.fields.find((f) => f.name === "amount");
      expect(amountField?.type).toBe("number");
      const { tableFromIPC } = await import("apache-arrow");
      const bytes = Uint8Array.from(Buffer.from(result.arrowBuffer, "base64"));
      const table = tableFromIPC(bytes);
      const col = table.getChild("amount");
      expect(col?.get(0)).toBe(42);
      // The blank cell is a missing reading → null, never 0.
      expect(col?.get(1)).toBeNull();
    });

    it("coerces yes/no boolean strings to boolean (matches engine inference)", async () => {
      // The engine's inferStringColumnType classifies "yes"/"no" as boolean.
      // Coercion must agree — NOT null these values out (data loss).
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            makeResponse([{ active: "yes" }, { active: "no" }]),
          ),
      );

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
      });
      const result = await c.query("db", crypto.randomUUID());

      const activeField = result.fields.find((f) => f.name === "active");
      expect(activeField?.type).toBe("boolean");
      const { tableFromIPC } = await import("apache-arrow");
      const bytes = Uint8Array.from(Buffer.from(result.arrowBuffer, "base64"));
      const table = tableFromIPC(bytes);
      const col = table.getChild("active");
      // "yes" → true, "no" → false — values preserved, not nulled.
      expect(col?.get(0)).toBe(true);
      expect(col?.get(1)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 9. fieldMap collisions are rejected
  // -------------------------------------------------------------------------

  describe("fieldMap collision rejection", () => {
    it("rejects two source keys mapping to the same target (config-static)", () => {
      expect(() => assertFieldMapNoCollision({ a: "name", b: "name" })).toThrow(
        /collision/i,
      );
    });

    it("accepts a fieldMap with all-unique targets", () => {
      expect(() => assertFieldMapNoCollision({ a: "x", b: "y" })).not.toThrow();
    });

    it("rejects a rename that lands on an existing passthrough key in a row", () => {
      // { name, full_name } with { full_name: "name" } → two values collapse.
      expect(() =>
        applyFieldMap({ name: "A", full_name: "B" }, { full_name: "name" }),
      ).toThrow(/collision/i);
    });

    it("query() rejects a colliding fieldMap before fetching", async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        fieldMap: { a: "dup", b: "dup" },
      });
      await expect(c.query("db", crypto.randomUUID())).rejects.toThrow(
        /collision/i,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 4. parseLinkNext correctness when prev precedes next
  // -------------------------------------------------------------------------

  describe("Link header parsing: prev before next", () => {
    it("returns the next URL, not prev, when prev precedes next", async () => {
      const linkHeader =
        '<https://api.example.com/data?page=1>; rel="prev", ' +
        '<https://api.example.com/data?page=3>; rel="next"';
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeResponse([{ id: 1 }], { linkHeader }))
        .mockResolvedValueOnce(makeResponse([{ id: 2 }]));
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        pagination: "link-header",
      });
      await c.query("db", crypto.randomUUID());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Must follow the NEXT url (page=3), NOT prev (page=1).
      expect(mockFetch.mock.calls[1]?.[0]).toBe(
        "https://api.example.com/data?page=3",
      );
    });

    it("follows a next-link whose URL contains a comma (?ids=1,2,3)", async () => {
      // A comma inside the angle-bracketed URL must NOT split the entry.
      const linkHeader =
        '<https://api.example.com/data?ids=1,2,3&page=2>; rel="next"';
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeResponse([{ id: 1 }], { linkHeader }))
        .mockResolvedValueOnce(makeResponse([{ id: 2 }]));
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        pagination: "link-header",
      });
      await c.query("db", crypto.randomUUID());

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1]?.[0]).toBe(
        "https://api.example.com/data?ids=1,2,3&page=2",
      );
    });

    it("does NOT treat rel=nextpage as a next-link (token boundary)", async () => {
      // Unquoted `rel=nextpage` must not match the `next` token.
      const linkHeader = "<https://api.example.com/data?page=2>; rel=nextpage";
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(makeResponse([{ id: 1 }], { linkHeader }));
      vi.stubGlobal("fetch", mockFetch);

      const c = makeRestConnector(noopResolver, {
        endpoint: "https://api.example.com/data",
        pagination: "link-header",
      });
      await c.query("db", crypto.randomUUID());

      // Pagination stops after page 1 — rel=nextpage is not rel=next.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
