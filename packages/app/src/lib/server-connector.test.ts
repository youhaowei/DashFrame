import { afterEach, describe, expect, it, vi } from "vitest";

import { createServerConnector } from "./server-connector";

describe("server connector timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the timeout active while consuming an Arrow response body", async () => {
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
    const connector = createServerConnector({
      serverUrl: "http://127.0.0.1:4000",
    });

    const query = expect(
      connector.query({ type: "arrow", sql: "SELECT 1" }),
    ).rejects.toThrow("Server connector timed out");
    await vi.advanceTimersByTimeAsync(11_000);
    await query;
  });

  it("registers frames with JSON and auth but no request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const connector = createServerConnector({
      serverUrl: "http://127.0.0.1:4000",
      token: "secret",
    });

    await connector.registerServerFrame("frame-id", "df_report");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/data/frames/frame-id/tables/df_report",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret",
        },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });
});
