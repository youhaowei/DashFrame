import { afterEach, describe, expect, it, vi } from "vitest";

import { createServerFrameConnector } from "./server-frame-connector";

const FRAME_ID = "018f1a50-7bde-7cde-8dc2-5e308fcec8b4";

describe("createServerFrameConnector", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("routes a Mosaic query through the opaque server frame endpoint", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const connector = createServerFrameConnector({
      serverUrl: "http://127.0.0.1:4000",
      token: "token",
    });

    await connector.query({ type: "json", sql: `SELECT * FROM "${FRAME_ID}"` });

    expect(fetch).toHaveBeenCalledWith(
      `http://127.0.0.1:4000/data/frames/${FRAME_ID}/mosaic`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
        body: JSON.stringify({
          type: "json",
          sql: `SELECT * FROM "${FRAME_ID}"`,
        }),
      }),
    );
  });

  it("rejects queries that do not name exactly one DataFrame UUID", async () => {
    const connector = createServerFrameConnector({
      serverUrl: "http://127.0.0.1:4000",
    });

    await expect(
      connector.query({ type: "json", sql: "SELECT * FROM unrelated" }),
    ).rejects.toThrow("exactly one server DataFrame");
  });
});
