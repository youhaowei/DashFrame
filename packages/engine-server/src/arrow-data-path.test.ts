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
