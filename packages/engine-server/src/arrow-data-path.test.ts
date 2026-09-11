import {
  InMemoryMappingStore,
  makeSecretRef,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { tableFromIPC } from "apache-arrow";
import { describe, expect, it } from "vite-plus/test";

import type { QueryEngine } from "@dashframe/engine";
import { frameTableName } from "@dashframe/engine";
import {
  ARROW_STREAM_CONTENT_TYPE,
  createArrowDataPath,
} from "./arrow-data-path";
import { duckdbColumnsToArrowIpc } from "./arrow-encode";

/**
 * A `QueryEngine` whose every method fails loudly, so a test that reaches a
 * method it did not stub says so instead of quietly succeeding. Tests override
 * only the operations they are about.
 */
function stubEngine(overrides: Partial<QueryEngine>): QueryEngine {
  const unexpected = (method: string) => () => {
    throw new Error(`unexpected QueryEngine.${method}`);
  };
  return {
    initialize: unexpected("initialize"),
    dispose: unexpected("dispose"),
    isReady: () => true,
    queryArrow: unexpected("queryArrow"),
    queryArrowBatches: unexpected("queryArrowBatches"),
    registerArrowTable: unexpected("registerArrowTable"),
    registerArrowStream: unexpected("registerArrowStream"),
    registerArrowBatches: unexpected("registerArrowBatches"),
    unregisterTable: async () => {},
    hasTable: () => false,
    getTableNames: () => [],
    ...overrides,
  };
}

/** A fake engine that echoes a known Arrow table regardless of SQL, recording calls. */
function fakeEngine(): QueryEngine & {
  calls: Array<{ sql: string; params: readonly unknown[] }>;
} {
  const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
  return Object.assign(
    stubEngine({
      queryArrow: async (sql: string, params: readonly unknown[] = []) => {
        calls.push({ sql, params });
        return duckdbColumnsToArrowIpc([
          { name: "id", typeId: 4 /* INTEGER */, values: [1, 2, 3] },
          { name: "label", typeId: 17 /* VARCHAR */, values: ["a", "b", "c"] },
        ]);
      },
    }),
    { calls },
  );
}

const TOKEN = "secret-loopback-token";

/** A frame id these tests address the Mosaic route by. */
const MOSAIC_FRAME_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Storage that owns exactly `MOSAIC_FRAME_ID`, so the Mosaic route's ownership
 * checks pass and a test can be about something else.
 */
function ownedFrameStorage() {
  return {
    save: async () => {},
    load: async () => new Uint8Array([1, 2, 3]),
    delete: async () => {},
    exists: async () => true,
    list: async () => [MOSAIC_FRAME_ID],
    getUsage: async () => ({ count: 1 }),
  };
}

/**
 * Mount the data path with everything the Mosaic route needs, so these cases
 * exercise the transport contracts — auth, Content-Type, body shape, error
 * opacity — over the route that actually exists.
 */
function mosaicPath(
  engine: QueryEngine,
  extra: Partial<Parameters<typeof createArrowDataPath>[0]> = {},
): ReturnType<typeof createArrowDataPath> {
  return createArrowDataPath({
    engine: Object.assign(engine, {
      registerArrowTable: async () => {},
      unregisterTable: async () => {},
    }),
    dataFrameStorage: ownedFrameStorage(),
    ...extra,
  });
}

it.each(["arrow", "exec"] as const)(
  "forwards the request signal through the frame Mosaic route (%s)",
  async (type) => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const app = mosaicPath(
      stubEngine({
        queryArrow: async (_sql, _params, signal) => {
          received = signal;
          return new Uint8Array();
        },
      }),
    );
    const request = new Request(
      `http://localhost/frames/${MOSAIC_FRAME_ID}/mosaic`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          sql: `SELECT * FROM "${frameTableName(MOSAIC_FRAME_ID)}"`,
        }),
        signal: controller.signal,
      },
    );
    expect((await app.fetch(request)).status).toBe(200);
    expect(received).toBe(request.signal);
    controller.abort();
    expect(received?.aborted).toBe(true);
  },
);

/** `POST /frames/:id/mosaic` with the given headers and body. */
async function mosaicRequest(
  app: ReturnType<typeof createArrowDataPath>,
  init: { headers: Record<string, string>; body: unknown },
): Promise<Response> {
  return await app.request(`/frames/${MOSAIC_FRAME_ID}/mosaic`, {
    method: "POST",
    headers: init.headers,
    body: JSON.stringify(init.body),
  });
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const AUTHED_HEADERS = {
  ...JSON_HEADERS,
  Authorization: `Bearer ${TOKEN}`,
};

describe("Arrow data path — host authorization", () => {
  it.each(["/frames/example/tables/example", "/frames/example/mosaic"])(
    "honors host denial before parsing or executing %s",
    async (route) => {
      const engine = fakeEngine();
      for (const authToken of [undefined, TOKEN]) {
        for (const authorizeRequest of [
          () => false,
          () => {
            throw new Error("Session identity is unavailable");
          },
        ]) {
          const app = createArrowDataPath({
            engine,
            authToken,
            authorizeRequest,
          });
          const response = await app.request(route, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ sql: "SELECT 1" }),
          });
          expect(response.status).toBe(401);
        }
      }
      expect(engine.calls).toHaveLength(0);
    },
  );

  it("accepts a request authenticated by the host", async () => {
    const engine = fakeEngine();
    const authed = createArrowDataPath({
      engine: Object.assign(engine, {
        registerArrowTable: async () => {},
        unregisterTable: async () => {},
      }),
      authToken: TOKEN,
      dataFrameStorage: ownedFrameStorage(),
      authorizeRequest: (request) =>
        request.headers.get("cookie") === "session=valid",
    });
    const response = await mosaicRequest(authed, {
      headers: { Cookie: "session=valid", "Content-Type": "application/json" },
      body: { sql: "SELECT 1" },
    });
    expect(response.status).toBe(200);
    expect(engine.calls).toHaveLength(1);
  });
});

describe("Arrow data path — auth + IPC roundtrip", () => {
  it("rejects a request with no Authorization header", async () => {
    const app = mosaicPath(fakeEngine(), { authToken: TOKEN });
    const res = await mosaicRequest(app, {
      headers: JSON_HEADERS,
      body: { sql: "SELECT 1" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a request with a wrong token", async () => {
    const app = mosaicPath(fakeEngine(), { authToken: TOKEN });
    const res = await mosaicRequest(app, {
      headers: { ...JSON_HEADERS, Authorization: "Bearer wrong" },
      body: { sql: "SELECT 1" },
    });
    expect(res.status).toBe(401);
  });

  it("does not run the engine when auth fails", async () => {
    const engine = fakeEngine();
    const app = mosaicPath(engine, { authToken: TOKEN });
    await mosaicRequest(app, {
      headers: JSON_HEADERS,
      body: { sql: "SELECT 1" },
    });
    expect(engine.calls).toHaveLength(0);
  });

  it("rejects a tokenless text/plain query before SQL execution", async () => {
    const engine = fakeEngine();
    const app = mosaicPath(engine);
    const res = await mosaicRequest(app, {
      headers: { "Content-Type": "text/plain" },
      body: { sql: "SELECT 1" },
    });
    expect(res.status).toBe(415);
    expect(engine.calls).toHaveLength(0);
  });

  it("threads params to the engine so parameterized queries are not silently dropped", async () => {
    const engine = fakeEngine();
    const app = mosaicPath(engine, { authToken: TOKEN });
    await mosaicRequest(app, {
      headers: AUTHED_HEADERS,
      body: { sql: "SELECT ? AS v", params: [42] },
    });
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.params).toEqual([42]);
  });

  it("passes the client SQL to the engine unaltered", async () => {
    // The route used to demand that the SQL mention the quoted frame UUID and
    // then substitute the table name into it. Naming is the client's job now
    // and this side is a pass-through — pin that it does not touch the text.
    const engine = fakeEngine();
    const app = mosaicPath(engine, { authToken: TOKEN });
    const sql = `SELECT a FROM "df_totally_unrelated" WHERE b = '${MOSAIC_FRAME_ID}'`;
    await mosaicRequest(app, {
      headers: AUTHED_HEADERS,
      body: { type: "arrow", sql },
    });
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls[0]?.sql).toBe(sql);
  });

  it("rejects params on typed frame requests instead of extending the Mosaic protocol", async () => {
    const engine = fakeEngine();
    const app = mosaicPath(engine, { authToken: TOKEN });
    const res = await mosaicRequest(app, {
      headers: AUTHED_HEADERS,
      body: {
        type: "arrow",
        sql: "SELECT ? AS v",
        params: [42],
      },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "params are not supported for typed requests",
    });
    expect(engine.calls).toHaveLength(0);
  });

  it("streams Arrow IPC for a valid token, roundtrips through apache-arrow", async () => {
    const app = mosaicPath(fakeEngine(), { authToken: TOKEN });
    const res = await mosaicRequest(app, {
      headers: AUTHED_HEADERS,
      body: { sql: "SELECT id, label FROM t", params: [] },
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
    const throwingEngine = stubEngine({
      queryArrow: async () => {
        throw new Error(leakyMessage);
      },
    });
    const app = mosaicPath(throwingEngine, { authToken: TOKEN });
    const res = await mosaicRequest(app, {
      headers: AUTHED_HEADERS,
      body: { sql: "SELECT secret FROM internal_table" },
    });

    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret");
    expect(text).not.toContain("internal_table");
    expect(text).not.toContain("Binder Error");
    expect(JSON.parse(text)).toEqual({ error: "Query execution failed" });
  });

  it("rejects a body with no sql", async () => {
    const app = mosaicPath(fakeEngine(), { authToken: TOKEN });
    const res = await mosaicRequest(app, {
      headers: AUTHED_HEADERS,
      body: { params: [] },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a non-array params with 400 (no silent coercion to [])", async () => {
    // params: 42 silently becoming [] would surface later as an opaque 500
    // binding mismatch — fail clearly at the request boundary instead.
    const engine = fakeEngine();
    const app = mosaicPath(engine, { authToken: TOKEN });
    const res = await mosaicRequest(app, {
      headers: AUTHED_HEADERS,
      body: { sql: "SELECT ? AS v", params: 42 },
    });
    expect(res.status).toBe(400);
    expect(engine.calls).toHaveLength(0);
  });

  it("serves without auth when no token is configured (loopback)", async () => {
    const app = mosaicPath(fakeEngine());
    const res = await mosaicRequest(app, {
      headers: JSON_HEADERS,
      body: { sql: "SELECT 1" },
    });
    expect(res.status).toBe(200);
  });

  it("404s the routes that no longer exist", async () => {
    const app = mosaicPath(fakeEngine());
    for (const path of ["/arrow", "/tables/orders"]) {
      const res = await app.request(path, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ sql: "SELECT 1" }),
      });
      expect(res.status).toBe(404);
    }
  });
});

describe("Arrow data path — server frame registration and Mosaic queries", () => {
  /** Records what was registered, so a route's effect can be asserted. */
  function fakeRegistrar(): QueryEngine & {
    registrations: Array<{ name: string; bytes: Uint8Array }>;
    calls: string[];
  } {
    const registrations: Array<{ name: string; bytes: Uint8Array }> = [];
    const calls: string[] = [];
    return Object.assign(
      stubEngine({
        queryArrow: async (sql: string) => {
          calls.push(sql);
          return new Uint8Array();
        },
        async registerArrowTable(name: string, arrow: Uint8Array) {
          registrations.push({ name, bytes: arrow });
        },
        async unregisterTable(name: string) {
          const index = registrations.findIndex((entry) => entry.name === name);
          if (index >= 0) registrations.splice(index, 1);
        },
      }),
      { registrations, calls },
    );
  }

  it("registers a durable server frame without returning its bytes", async () => {
    const engine = fakeRegistrar();
    const id = "11111111-1111-4111-8111-111111111111";
    const bytes = new Uint8Array([1, 2, 3]);
    const app = createArrowDataPath({
      engine,
      authToken: TOKEN,
      dataFrameStorage: {
        save: async () => {},
        load: async (requested) => (requested === id ? bytes : null),
        delete: async () => {},
        exists: async () => true,
        list: async () => [id],
        getUsage: async () => ({ count: 1 }),
      },
    });

    const response = await app.request(
      `/frames/${id}/tables/${frameTableName(id)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    expect(response.status).toBe(200);
    expect(engine.registrations).toEqual([{ name: frameTableName(id), bytes }]);
    expect(await response.json()).toEqual({
      ok: true,
      id,
      name: frameTableName(id),
    });
  });

  it("rejects a registration under any name but the frame's canonical one", async () => {
    const engine = fakeRegistrar();
    const id = "11111111-1111-4111-8111-111111111111";
    let loads = 0;
    const app = createArrowDataPath({
      engine,
      authToken: TOKEN,
      dataFrameStorage: {
        save: async () => {},
        load: async () => {
          loads += 1;
          return new Uint8Array([1, 2, 3]);
        },
        delete: async () => {},
        exists: async () => true,
        list: async () => [id],
        getUsage: async () => ({ count: 1 }),
      },
    });

    // A valid SQL identifier, so only the canonical-name check can reject it.
    // An alias would survive deletion cleanup, which drops only the canonical
    // name, and could overwrite another frame's table.
    const response = await app.request(`/frames/${id}/tables/stale_alias`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(400);
    expect(engine.registrations).toEqual([]);
    expect(loads).toBe(0);
  });

  it.each([
    ["tables/df_server", true],
    ["mosaic", true],
    ["tables/df_server", false],
    ["mosaic", false],
  ] as const)(
    "returns 404 and removes stale registration before %s opens a vanished frame (native error: %s)",
    async (route, nativeError) => {
      const id = "11111111-1111-4111-8111-111111111111";
      const name =
        route === "mosaic" ? `df_${id.replaceAll("-", "_")}` : "df_server";
      const registered = new Set([name]);
      let exists = true;
      let queries = 0;
      const app = createArrowDataPath({
        engine: stubEngine({
          queryArrow: async () => {
            queries++;
            return new Uint8Array();
          },
          registerArrowTable: async () => {},
          registerArrowBatches: async (_name, batches) => {
            for await (const _batch of batches) {
              throw new Error("Unexpected batch");
            }
          },
          unregisterTable: async (table) => {
            registered.delete(table);
          },
        }),
        dataFrameStorage: {
          save: async () => {},
          load: async () => null,
          delete: async () => {},
          exists: async () => exists,
          list: async () => [id],
          getUsage: async () => ({ count: 1 }),
          loadBatches: async function* () {
            // The frame passed exists(), but deletion wins before lazy open.
            exists = false;
            yield await Promise.reject<Uint8Array>(
              Object.assign(
                new Error("Frame disappeared"),
                nativeError ? { code: "ENOENT" } : {},
              ),
            );
          },
        },
      });
      const response = await app.request(`/frames/${id}/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "arrow", sql: `SELECT * FROM "${id}"` }),
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Frame not found" });
      expect(registered.size).toBe(0);
      expect(queries).toBe(0);
    },
  );

  it("rejects a browser-simple frame registration before loading bytes", async () => {
    const engine = fakeRegistrar();
    const id = "11111111-1111-4111-8111-111111111111";
    let loads = 0;
    const app = createArrowDataPath({
      engine,
      dataFrameStorage: {
        save: async () => {},
        load: async () => {
          loads += 1;
          return new Uint8Array([1]);
        },
        delete: async () => {},
        exists: async () => true,
        list: async () => [id],
        getUsage: async () => ({ count: 1 }),
      },
    });

    const response = await app.request(
      `/frames/${id}/tables/${frameTableName(id)}`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(415);
    expect(loads).toBe(0);
    expect(engine.registrations).toEqual([]);
  });

  it("does not register bytes whose ownership disappears while load is paused", async () => {
    const engine = fakeRegistrar();
    const id = "11111111-1111-4111-8111-111111111111";
    let available = true;
    let releaseLoad!: () => void;
    let signalRead!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      signalRead = resolve;
    });
    const loadReleased = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const app = createArrowDataPath({
      engine,
      isFrameAvailable: async () => available,
      dataFrameStorage: {
        save: async () => {},
        load: async () => {
          signalRead();
          await loadReleased;
          return new Uint8Array([1, 2, 3]);
        },
        delete: async () => {},
        exists: async () => available,
        list: async () => (available ? [id] : []),
        getUsage: async () => ({ count: available ? 1 : 0 }),
      },
    });

    const request = app.request(`/frames/${id}/tables/${frameTableName(id)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "arrow", sql: `SELECT * FROM "${id}"` }),
    });
    await readStarted;
    available = false;
    await engine.unregisterTable(frameTableName(id));
    releaseLoad();

    const response = await request;
    expect(response.status).toBe(404);
    expect(engine.registrations).toEqual([]);
  });

  const FRAME_ID_FIXTURE = "11111111-1111-4111-8111-111111111111";

  it.each([`tables/${frameTableName(FRAME_ID_FIXTURE)}`, "mosaic"])(
    "does not consume a revoked stream while %s registration waits",
    async (route) => {
      const id = "11111111-1111-4111-8111-111111111111";
      let available = true;
      let pulls = 0;
      let releaseRegistration!: () => void;
      let signalRegistration!: () => void;
      const registrationStarted = new Promise<void>((resolve) => {
        signalRegistration = resolve;
      });
      const registrationReleased = new Promise<void>((resolve) => {
        releaseRegistration = resolve;
      });
      const engine = stubEngine({
        queryArrow: async () => new Uint8Array(),
        async registerArrowStream(
          _name: string,
          stream: AsyncIterable<Uint8Array>,
        ) {
          signalRegistration();
          await registrationReleased;
          for await (const _bytes of stream) {
            // A revoked frame must fail before its source reaches this loop body.
          }
        },
      });
      const app = createArrowDataPath({
        engine,
        isFrameAvailable: async () => available,
        dataFrameStorage: {
          save: async () => {},
          load: async () => null,
          delete: async () => {},
          exists: async () => true,
          list: async () => [id],
          getUsage: async () => ({ count: 1 }),
          async *stream() {
            pulls += 1;
            yield new Uint8Array([1, 2, 3]);
          },
        },
      });

      const request = app.request(`/frames/${id}/${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "arrow", sql: `SELECT * FROM "${id}"` }),
      });
      await registrationStarted;
      available = false;
      releaseRegistration();

      const response = await request;
      expect(response.status).toBe(404);
      expect(pulls).toBe(0);
    },
  );

  it("does not consume revoked batches while registration waits", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    let available = true;
    let pulls = 0;
    let releaseRegistration!: () => void;
    let signalRegistration!: () => void;
    const registrationStarted = new Promise<void>((resolve) => {
      signalRegistration = resolve;
    });
    const registrationReleased = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    const engine = stubEngine({
      queryArrow: async () => new Uint8Array(),
      async registerArrowBatches(_name, batches) {
        signalRegistration();
        await registrationReleased;
        for await (const _bytes of batches) {
          // A revoked frame must fail before its source reaches this loop body.
        }
      },
    });
    const app = createArrowDataPath({
      engine,
      isFrameAvailable: async () => available,
      dataFrameStorage: {
        save: async () => {},
        load: async () => null,
        delete: async () => {},
        exists: async () => true,
        list: async () => [id],
        getUsage: async () => ({ count: 1 }),
        async *loadBatches() {
          pulls += 1;
          yield new Uint8Array([1, 2, 3]);
        },
      },
    });

    const request = app.request(`/frames/${id}/tables/df_delayed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "arrow", sql: `SELECT * FROM "${id}"` }),
    });
    await registrationStarted;
    available = false;
    releaseRegistration();

    const response = await request;
    expect(response.status).toBe(404);
    expect(pulls).toBe(0);
  });

  it("removes a Mosaic frame whose ownership disappears during registration", async () => {
    const engine = fakeRegistrar();
    const id = "11111111-1111-4111-8111-111111111111";
    let available = true;
    const register = engine.registerArrowTable.bind(engine);
    engine.registerArrowTable = async (name, bytes) => {
      await register(name, bytes);
      available = false;
    };
    const app = createArrowDataPath({
      engine,
      isFrameAvailable: async () => available,
      dataFrameStorage: {
        save: async () => {},
        load: async () => new Uint8Array([1, 2, 3]),
        delete: async () => {},
        exists: async () => true,
        list: async () => [id],
        getUsage: async () => ({ count: 1 }),
      },
    });

    const response = await app.request(`/frames/${id}/mosaic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "arrow", sql: `SELECT * FROM "${id}"` }),
    });

    expect(response.status).toBe(409);
    expect(engine.registrations).toEqual([]);
    expect(engine.calls).toEqual([]);
  });

  it("discards a Mosaic result when frame ownership disappears during the query", async () => {
    const engine = fakeRegistrar();
    let queryCalls = 0;
    let available = true;
    engine.queryArrow = async () => {
      queryCalls += 1;
      available = false;
      return new Uint8Array();
    };
    const id = "11111111-1111-4111-8111-111111111111";
    const app = createArrowDataPath({
      engine,
      isFrameAvailable: async () => available,
      dataFrameStorage: {
        save: async () => {},
        load: async () => new Uint8Array([1, 2, 3]),
        delete: async () => {},
        exists: async () => true,
        list: async () => [id],
        getUsage: async () => ({ count: 1 }),
      },
    });

    const response = await app.request(`/frames/${id}/mosaic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "arrow", sql: `SELECT * FROM "${id}"` }),
    });

    expect(response.status).toBe(409);
    expect(queryCalls).toBe(1);
    expect(engine.registrations).toEqual([]);
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
    const app = mosaicPath(fakeEngine(), { authRef, vault });
    const res = await mosaicRequest(app, {
      headers: AUTHED_HEADERS,
      body: { sql: "SELECT 1" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a wrong token against the vault-stored token → 401", async () => {
    const { vault, store } = buildVault(TOKEN);
    const authRef = await store();
    const app = mosaicPath(fakeEngine(), { authRef, vault });
    const res = await mosaicRequest(app, {
      headers: { ...JSON_HEADERS, Authorization: "Bearer wrong" },
      body: { sql: "SELECT 1" },
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
    const app = mosaicPath(engine, { authRef: unstoredRef, vault });
    const res = await mosaicRequest(app, {
      headers: AUTHED_HEADERS,
      body: { sql: "SELECT 1" },
    });
    expect(res.status).toBe(401);
    // The engine never ran — auth failed closed before dispatch.
    expect(engine.calls).toHaveLength(0);
  });
});
