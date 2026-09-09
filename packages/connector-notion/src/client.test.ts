import { describe, expect, it, vi } from "vite-plus/test";
import {
  createNotionClient,
  getDatabaseSchema,
  queryDatabase,
  type NotionTransportFetch,
} from "./client";

function pendingFetch() {
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  const fetch = vi.fn<NotionTransportFetch>((_url, init) => {
    requestStarted();
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        { once: true },
      );
    });
  });
  return { fetch, started };
}

describe("Notion transport cancellation", () => {
  it.each([
    [
      "schema retrieval",
      (client: ReturnType<typeof createNotionClient>, _signal: AbortSignal) =>
        getDatabaseSchema(client, "database-id"),
    ],
    [
      "database page query",
      (client: ReturnType<typeof createNotionClient>, signal: AbortSignal) =>
        queryDatabase(client, "database-id", { signal }),
    ],
  ])("aborts pending %s I/O", async (_name, request) => {
    const controller = new AbortController();
    const { fetch, started } = pendingFetch();
    const client = createNotionClient("secret_test", {
      signal: controller.signal,
      fetch,
    });

    const pending = request(client, controller.signal);
    await started;
    controller.abort(new Error("cancelled"));

    await expect(pending).rejects.toThrow("cancelled");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
