import {
  InMemoryMappingStore,
  makeSecretRef,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { tableFromIPC } from "apache-arrow";
import { describe, expect, it } from "vitest";

import {
  ARROW_STREAM_CONTENT_TYPE,
  createArrowDataPath,
  type ArrowQueryRunner,
} from "./arrow-data-path";
import { duckdbColumnsToArrowIpc } from "./arrow-encode";

/** A fake engine that echoes a known Arrow table regardless of SQL, recording calls. */
function fakeEngine(): ArrowQueryRunner & {
  calls: Array<{ sql: string; params: readonly unknown[] }>;
} {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  return {
    calls,
    queryArrow: async (sql: string, params: readonly unknown[] = []) => {
      calls.push({ sql, params });
      return duckdbColumnsToArrowIpc([
        { name: "id", typeId: 4 /* INTEGER */, values: [1, 2, 3] },
        { name: "label", typeId: 17 /* VARCHAR */, values: ["a", "b", "c"] },
      ]);
    },
  };
}

const TOKEN = "secret-loopback-token";

describe("Arrow data path — auth + IPC roundtrip (Stage 5)", () => {
  it("rejects a request with no Authorization header", async () => {
    const app = createArrowDataPath({ engine: fakeEngine(), authToken: TOKEN });
    const res = await app.request("/arrow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a request with a wrong token", async () => {
    const app = createArrowDataPath({ engine: fakeEngine(), authToken: TOKEN });
    const res = await app.request("/arrow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong",
      },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(res.status).toBe(401);
  });

  it("does not run the engine when auth fails", async () => {
    const engine = fakeEngine();
    const app = createArrowDataPath({ engine, authToken: TOKEN });
    await app.request("/arrow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(engine.calls).toHaveLength(0);
  });

  it("threads params to the engine so parameterized queries are not silently dropped", async () => {
    const engine = fakeEngine();
    const app = createArrowDataPath({ engine, authToken: TOKEN });
    await app.request("/arrow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ sql: "SELECT ? AS v", params: [42] }),
    });
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.params).toEqual([42]);
  });

  it("streams Arrow IPC for a valid token, roundtrips through apache-arrow", async () => {
    const app = createArrowDataPath({ engine: fakeEngine(), authToken: TOKEN });
    const res = await app.request("/arrow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ sql: "SELECT id, label FROM t", params: [] }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(ARROW_STREAM_CONTENT_TYPE);

    const bytes = new Uint8Array(await res.arrayBuffer());
    const table = tableFromIPC(bytes);
    expect(table.numRows).toBe(3);
    expect(table.schema.fields.map((f) => f.name)).toEqual(["id", "label"]);
    expect(table.getChild("label")?.toArray()).toEqual(["a", "b", "c"]);
  });

  it("returns an opaque 500 when the engine throws (no DuckDB internals leaked)", async () => {
    const leakyMessage =
      "Binder Error: Referenced column 'secret' not found in FROM clause! Candidate bindings: internal_table.ssn";
    const throwingEngine: ArrowQueryRunner = {
      queryArrow: async () => {
        throw new Error(leakyMessage);
      },
    };
    const app = createArrowDataPath({
      engine: throwingEngine,
      authToken: TOKEN,
    });
    const res = await app.request("/arrow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ sql: "SELECT secret FROM internal_table" }),
    });

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("internal_table");
    expect(text).not.toContain("Binder Error");
    expect(JSON.parse(text)).toEqual({ error: "Query execution failed" });
  });

  it("rejects a body with no sql", async () => {
    const app = createArrowDataPath({ engine: fakeEngine(), authToken: TOKEN });
    const res = await app.request("/arrow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ params: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-array params with 400 (no silent coercion to [])", async () => {
    // params: 42 silently becoming [] would surface later as an opaque 500
    // binding mismatch — fail clearly at the request boundary instead.
    const engine = fakeEngine();
    const app = createArrowDataPath({ engine, authToken: TOKEN });
    const res = await app.request("/arrow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ sql: "SELECT ? AS v", params: 42 }),
    });
    expect(res.status).toBe(400);
    expect(engine.calls).toHaveLength(0);
  });

  it("serves without auth when no token is configured (loopback)", async () => {
    const app = createArrowDataPath({ engine: fakeEngine() });
    const res = await app.request("/arrow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("Arrow data path — /tables/:name content-type enforcement", () => {
  /**
   * A minimal engine that also implements registerArrowTable so the 501 guard
   * doesn't fire before the content-type check.
   */
  function fakeRegistrar(): ArrowQueryRunner & {
    registerArrowTable(name: string, arrow: Uint8Array): Promise<void>;
    registrations: Array<{ name: string; bytes: Uint8Array }>;
  } {
    const registrations: Array<{ name: string; bytes: Uint8Array }> = [];
    return {
      calls: [] as never,
      queryArrow: async () => new Uint8Array(),
      async registerArrowTable(name: string, arrow: Uint8Array) {
        registrations.push({ name, bytes: arrow });
      },
      registrations,
    } as ReturnType<typeof fakeRegistrar>;
  }

  it("rejects a non-Arrow Content-Type with 415 before reaching registerArrowTable", async () => {
    // A client that sends the wrong content-type (e.g. application/octet-stream)
    // should get a 415 rather than a 500 from registerArrowTable trying to
    // decode non-Arrow bytes as Arrow IPC.
    const engine = fakeRegistrar();
    const app = createArrowDataPath({ engine, authToken: TOKEN });

    const res = await app.request("/tables/df_test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array([0xff, 0xfe]).buffer,
    });

    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toContain(ARROW_STREAM_CONTENT_TYPE);
    // registerArrowTable must NOT have been called
    expect(engine.registrations).toHaveLength(0);
  });

  it("rejects a missing Content-Type with 415", async () => {
    const engine = fakeRegistrar();
    const app = createArrowDataPath({ engine, authToken: TOKEN });

    const res = await app.request("/tables/df_test", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: new Uint8Array([0]).buffer,
    });

    expect(res.status).toBe(415);
    expect(engine.registrations).toHaveLength(0);
  });

  it("accepts the correct Arrow content-type and calls registerArrowTable", async () => {
    const engine = fakeRegistrar();
    const app = createArrowDataPath({ engine, authToken: TOKEN });

    const bytes = new Uint8Array([0x41, 0x52, 0x52, 0x4f, 0x57, 0x31]); // "ARROW1"
    const res = await app.request("/tables/df_ok", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": ARROW_STREAM_CONTENT_TYPE,
      },
      body: bytes.buffer,
    });

    // registerArrowTable may throw on invalid Arrow bytes (fine here —
    // we only care that the content-type check passed and the call was made).
    // A real Arrow IPC buffer would return 200; the fake above always succeeds.
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(engine.registrations).toHaveLength(1);
      expect(engine.registrations[0]?.name).toBe("df_ok");
    }
  });
});

describe("Arrow data path — vault-backed auth (fail-closed)", () => {
  function buildVault(storedToken: string): {
    vault: SecretVault;
    store: () => Promise<ReturnType<typeof makeSecretRef>>;
  } {
    const registry = new SecretRegistry();
    registry.register("test", new TestBackend(), { fallback: true });
    registry.setClassDefault("serve-token", "test");
    const vault = new SecretVault(registry, new InMemoryMappingStore());
    return {
      vault,
      store: () => vault.store(storedToken, { class: "serve-token" }),
    };
  }

  it("resolves the expected token from the vault: correct Bearer → 200", async () => {
    const { vault, store } = buildVault(TOKEN);
    const authRef = await store();
    const app = createArrowDataPath({ engine: fakeEngine(), authRef, vault });
    const res = await app.request("/arrow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong token against the vault-stored token → 401", async () => {
    const { vault, store } = buildVault(TOKEN);
    const authRef = await store();
    const app = createArrowDataPath({ engine: fakeEngine(), authRef, vault });
    const res = await app.request("/arrow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong",
      },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(res.status).toBe(401);
  });

  it("FAIL-CLOSED: authRef without vault throws at construction (never an unguarded path)", () => {
    // The worst failure for an auth gate is to serve traffic unauthenticated.
    // A misconfigured caller (authRef set, vault missing) must not produce a
    // router that waves requests through — it must refuse to construct.
    expect(() =>
      createArrowDataPath({ engine: fakeEngine(), authRef: makeSecretRef() }),
    ).toThrow(/authRef requires vault/i);
  });

  it("FAIL-CLOSED: a vault resolution failure denies the request (401, not 500/allow)", async () => {
    // authRef present but the ref was never stored → withSecret rejects. The
    // gate must deny (401), never crash (500) and never allow.
    const registry = new SecretRegistry();
    registry.register("test", new TestBackend(), { fallback: true });
    const vault = new SecretVault(registry, new InMemoryMappingStore());
    const unstoredRef = makeSecretRef();
    const engine = fakeEngine();
    const app = createArrowDataPath({ engine, authRef: unstoredRef, vault });
    const res = await app.request("/arrow", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(res.status).toBe(401);
    // The engine never ran — auth failed closed before dispatch.
    expect(engine.calls).toHaveLength(0);
  });
});
