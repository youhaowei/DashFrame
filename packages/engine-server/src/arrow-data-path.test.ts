import { tableFromIPC } from "apache-arrow";
import { describe, expect, it } from "vitest";

import {
  ARROW_STREAM_CONTENT_TYPE,
  createArrowDataPath,
  type ArrowQueryRunner,
} from "./arrow-data-path";
import { duckdbColumnsToArrowIpc } from "./arrow-encode";

/** A fake engine that echoes a known Arrow table regardless of SQL. */
function fakeEngine(): ArrowQueryRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    queryArrow: async (sql: string) => {
      calls.push(sql);
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
