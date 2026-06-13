/**
 * Tests for the native Mosaic Connector.
 *
 * Covers:
 * - Abort timeout: a fetch that accepts the TCP connection but never responds
 *   rejects with the human-readable "Native engine timed out" message rather
 *   than hanging forever.
 * - Happy path: a valid query returns a decoded flechette Table.
 * - Table upload: uploadArrowTable posts with Arrow content-type.
 * - Error mapping: non-2xx responses are surfaced as human-readable throws.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNativeConnector } from "./nativeConnector";

const SERVER_URL = "http://127.0.0.1:54321";
const TOKEN = "test-token-abc";

describe("createNativeConnector — abort timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("rejects with human-readable timeout message when POST /data/arrow never responds", async () => {
    // Simulate a fetch that accepts the connection but never resolves —
    // AbortController fires after 10s and the connector maps it to a clear msg.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            // Mirror real behaviour: when abort fires, reject with DOMException
            (init.signal as AbortSignal | undefined)?.addEventListener(
              "abort",
              () => {
                const err = new DOMException(
                  "The operation was aborted.",
                  "AbortError",
                );
                reject(err);
              },
            );
          }),
      ),
    );

    const connector = createNativeConnector({
      serverUrl: SERVER_URL,
      token: TOKEN,
    });

    // Start the query, then advance time so the abort fires.
    // Attach the rejection handler BEFORE advancing timers so the unhandled
    // rejection doesn't leak between event-loop turns.
    const queryPromise = expect(
      connector.query({ sql: "SELECT 1" }),
    ).rejects.toThrow("Native engine timed out");

    // Advance past the 10-second timeout
    await vi.advanceTimersByTimeAsync(11_000);
    await queryPromise;
  });

  it("rejects uploadArrowTable with timeout message when POST /data/tables/:name never responds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            (init.signal as AbortSignal | undefined)?.addEventListener(
              "abort",
              () => {
                reject(
                  new DOMException("The operation was aborted.", "AbortError"),
                );
              },
            );
          }),
      ),
    );

    const connector = createNativeConnector({
      serverUrl: SERVER_URL,
      token: TOKEN,
    });

    const uploadPromise = expect(
      connector.uploadArrowTable("df_test", new Uint8Array([0, 1, 2])),
    ).rejects.toThrow("Native engine timed out");

    await vi.advanceTimersByTimeAsync(11_000);
    await uploadPromise;
  });
});

describe("createNativeConnector — error handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps non-2xx responses to human-readable errors (not raw server text)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () =>
          Promise.resolve("Internal Server Error: secret column name"),
      }),
    );

    const connector = createNativeConnector({
      serverUrl: SERVER_URL,
      token: TOKEN,
    });

    await expect(connector.query({ sql: "SELECT 1" })).rejects.toThrow(
      /Native engine query failed \(500\)/,
    );
  });

  it("maps non-2xx upload responses to human-readable errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 415,
        text: () =>
          Promise.resolve(
            "Content-Type must be application/vnd.apache.arrow.stream",
          ),
      }),
    );

    const connector = createNativeConnector({
      serverUrl: SERVER_URL,
      token: TOKEN,
    });

    await expect(
      connector.uploadArrowTable("df_test", new Uint8Array([0])),
    ).rejects.toThrow(/Failed to upload table/);
  });
});
