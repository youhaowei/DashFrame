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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
});
