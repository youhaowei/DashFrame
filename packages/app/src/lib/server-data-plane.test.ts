import type { DataFrame } from "@dashframe/engine";
import {
  clearAllTableCaches,
  ensureTableLoaded,
} from "@dashframe/engine-browser";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerMosaicConnector } from "./server-connector";
import { configureServerDataPlane } from "./server-data-plane";

function connector(
  registerServerFrame = vi.fn().mockResolvedValue(undefined),
): ServerMosaicConnector {
  return {
    query: vi.fn(),
    registerServerFrame,
  } as unknown as ServerMosaicConnector;
}

describe("server data plane", () => {
  afterEach(() => {
    clearAllTableCaches();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("replaces and reopens a GA4 frame with the fresh queryable bytes", async () => {
    const dataFrameId = "55555555-5555-4555-8555-555555555555";
    const oldFrameId = "66666666-6666-4666-8666-666666666666";
    const newFrameId = "77777777-7777-4777-8777-777777777777";
    const tableName = "df_55555555_5555_4555_8555_555555555555";
    let registeredFrameId: string | undefined;
    const arrow = (values: string[]) =>
      tableToIPC(tableFromArrays({ revision: values }), "stream");
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const sql = JSON.parse(String(init.body)).sql as string;
      if (sql.includes("information_schema.tables")) {
        const bytes = arrow(registeredFrameId ? ["exists"] : []);
        return { ok: true, arrayBuffer: async () => bytes.buffer };
      }
      if (sql.startsWith("DROP TABLE")) {
        registeredFrameId = undefined;
        const bytes = arrow([]);
        return { ok: true, arrayBuffer: async () => bytes.buffer };
      }
      const bytes = arrow([registeredFrameId === newFrameId ? "new" : "old"]);
      return { ok: true, arrayBuffer: async () => bytes.buffer };
    });
    vi.stubGlobal("fetch", fetchMock);
    const registerServerFrame = vi.fn(async (frameId: string) => {
      registeredFrameId = frameId;
    });
    const serverConnector = connector(registerServerFrame);
    const frame = (key: string, createdAt: number) =>
      ({
        id: dataFrameId,
        storage: { type: "file", key },
        fieldIds: [],
        createdAt,
      }) as DataFrame;

    const firstConnection = configureServerDataPlane({
      serverUrl: "http://127.0.0.1:4000",
      connector: serverConnector,
    });
    await ensureTableLoaded(frame(oldFrameId, 1), firstConnection);
    await ensureTableLoaded(frame(newFrameId, 2), firstConnection);
    expect(
      (await firstConnection.query(`SELECT * FROM ${tableName}`)).toArray(),
    ).toEqual([expect.objectContaining({ revision: "new" })]);

    await firstConnection.close();
    const reopened = configureServerDataPlane({
      serverUrl: "http://127.0.0.1:4000",
      connector: serverConnector,
    });
    await ensureTableLoaded(frame(newFrameId, 2), reopened);
    expect(
      (await reopened.query(`SELECT * FROM ${tableName}`)).toArray(),
    ).toEqual([expect.objectContaining({ revision: "new" })]);
    expect(registerServerFrame.mock.calls).toEqual([
      [oldFrameId, tableName],
      [newFrameId, tableName],
    ]);
  });

  it("queries Arrow through the server and decodes the result", async () => {
    const bytes = tableToIPC(tableFromArrays({ value: [1, 2] }), "stream");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes.buffer,
    });
    vi.stubGlobal("fetch", fetchMock);
    const connection = configureServerDataPlane({
      serverUrl: "http://127.0.0.1:4000",
      token: "secret",
      connector: connector(),
    });

    const result = await connection.query("SELECT value FROM df_report");

    expect(result.numRows).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/data/arrow",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
        }),
        body: JSON.stringify({ sql: "SELECT value FROM df_report" }),
      }),
    );
  });

  it("delegates file registration by handle without loading bytes", async () => {
    const registerServerFrame = vi.fn().mockResolvedValue(undefined);
    const connection = configureServerDataPlane({
      serverUrl: "http://127.0.0.1:4000",
      connector: connector(registerServerFrame),
    });

    await connection.registerServerFrame("frame-id", "df_report");

    expect(registerServerFrame).toHaveBeenCalledWith("frame-id", "df_report");
  });

  it("uses the real table loader without assuming a WASM prepare method", async () => {
    const empty = tableToIPC(tableFromArrays({ exists: [] }), "stream");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => empty.buffer,
      }),
    );
    const registerServerFrame = vi.fn().mockResolvedValue(undefined);
    const connection = configureServerDataPlane({
      serverUrl: "http://127.0.0.1:4000",
      connector: connector(registerServerFrame),
    });
    const frame = {
      id: "11111111-1111-4111-8111-111111111111",
      storage: {
        type: "file",
        key: "22222222-2222-4222-8222-222222222222",
      },
      fieldIds: [],
      createdAt: 0,
      toJSON() {
        return this;
      },
    } as DataFrame;

    await expect(ensureTableLoaded(frame, connection)).resolves.toBe(
      "df_11111111_1111_4111_8111_111111111111",
    );
    expect(registerServerFrame).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "df_11111111_1111_4111_8111_111111111111",
    );
  });

  it("reloads an existing server table when its storage generation is unknown", async () => {
    // useInsightView mocks ensureTableLoaded, so exercise the real loader here
    // against the actual configured server connection contract.
    const existing = tableToIPC(tableFromArrays({ exists: [1] }), "stream");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => existing.buffer,
    });
    vi.stubGlobal("fetch", fetchMock);
    const registerServerFrame = vi.fn().mockResolvedValue(undefined);
    const connection = configureServerDataPlane({
      serverUrl: "http://127.0.0.1:4000",
      connector: connector(registerServerFrame),
    });
    const frame = {
      id: "33333333-3333-4333-8333-333333333333",
      storage: {
        type: "file",
        key: "44444444-4444-4444-8444-444444444444",
      },
      fieldIds: [],
      createdAt: 0,
      toJSON() {
        return this;
      },
    } as DataFrame;

    await expect(ensureTableLoaded(frame, connection)).resolves.toBe(
      "df_33333333_3333_4333_8333_333333333333",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(registerServerFrame).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
      "df_33333333_3333_4333_8333_333333333333",
    );
  });

  it("fails a stalled server query instead of hanging the consumer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    );
    const connection = configureServerDataPlane({
      serverUrl: "http://127.0.0.1:4000",
      connector: connector(),
    });

    const query = expect(connection.query("SELECT 1")).rejects.toThrow(
      "Server data plane timed out",
    );
    await vi.advanceTimersByTimeAsync(11_000);
    await query;
  });

  it("keeps the timeout active while consuming a stalled response body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) =>
        Promise.resolve({
          ok: true,
          arrayBuffer: () =>
            new Promise<ArrayBuffer>((_resolve, reject) => {
              init.signal?.addEventListener("abort", () => {
                reject(new DOMException("aborted", "AbortError"));
              });
            }),
        }),
      ),
    );
    const connection = configureServerDataPlane({
      serverUrl: "http://127.0.0.1:4000",
      connector: connector(),
    });

    const query = expect(connection.query("SELECT 1")).rejects.toThrow(
      "Server data plane timed out",
    );
    await vi.advanceTimersByTimeAsync(11_000);
    await query;
  });
});
