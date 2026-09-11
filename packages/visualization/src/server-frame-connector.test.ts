import { frameTableName } from "@dashframe/engine";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createServerFrameConnector } from "./server-frame-connector";

const FRAME_ID = "018f1a50-7bde-7cde-8dc2-5e308fcec8b4";
const FRAME_TABLE = frameTableName(FRAME_ID);

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
          sql: `SELECT * FROM "${FRAME_TABLE}"`,
        }),
      }),
    );
  });

  it("rewrites every occurrence of the frame id to its canonical table name", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const connector = createServerFrameConnector({
      serverUrl: "http://127.0.0.1:4000",
    });

    await connector.query({
      type: "json",
      sql: `SELECT a FROM "${FRAME_ID}" UNION ALL SELECT a FROM "${FRAME_ID}"`,
    });

    const sent = JSON.parse(
      (fetch.mock.calls[0]![1] as { body: string }).body,
    ) as { sql: string };
    expect(sent.sql).toBe(
      `SELECT a FROM "${FRAME_TABLE}" UNION ALL SELECT a FROM "${FRAME_TABLE}"`,
    );
    expect(sent.sql).not.toContain(FRAME_ID);
    // The canonical name is derived, never hand-spelled: hyphens are illegal in
    // a bare identifier, so `df_018f1a50-…` would parse as subtraction.
    expect(FRAME_TABLE).toBe("df_018f1a50_7bde_7cde_8dc2_5e308fcec8b4");
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
