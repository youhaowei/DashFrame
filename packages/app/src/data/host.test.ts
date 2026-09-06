import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./runtime", () => ({
  getRuntimeConfig: () => ({
    url: "http://127.0.0.1:4000",
    token: "host-token",
  }),
  hostHeaders: () => ({ Authorization: "Bearer host-token" }),
}));
import { requestHost, HostOperationError } from "./host";

describe("host resource transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends host credentials and connector arguments without wrapping the response", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ sessionId: "setup-1", state: "connected" }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      requestHost("getConnectorSetupSession", { sessionId: "setup-1" }),
    ).resolves.toMatchObject({ sessionId: "setup-1" });
    expect(fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:4000/api/host/getConnectorSetupSession"),
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer host-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: "setup-1" }),
      }),
    );
  });

  it("surfaces authorization failures instead of treating error payloads as data", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Access credential revoked" },
            { status: 401 },
          ),
        ),
    );
    await expect(requestHost("getAccessCapabilities", {})).rejects.toThrow(
      "Access credential revoked",
    );
  });
  it.each(["network", "unconfirmed", "malformed"])(
    "preserves the batch retry identity after a %s response",
    async (failure) => {
      const fetch = vi.fn();
      if (failure === "network") fetch.mockRejectedValue(new Error("offline"));
      else if (failure === "malformed")
        fetch.mockResolvedValue(new Response("invalid json"));
      else
        fetch.mockResolvedValue(
          Response.json(
            { error: "Unknown outcome", code: "HOST_BATCH_OUTCOME_UNKNOWN" },
            { status: 503 },
          ),
        );
      vi.stubGlobal("fetch", fetch);
      const result = await requestHost("commitBatch", { commands: [] }).catch(
        (error: unknown) => error,
      );
      expect(result).toBeInstanceOf(HostOperationError);
      const sent = JSON.parse(fetch.mock.calls[0]![1].body) as {
        operationId: string;
      };
      expect(result).toMatchObject({
        operationId: sent.operationId,
        code: "HOST_BATCH_OUTCOME_UNKNOWN",
      });
      fetch.mockResolvedValue(
        Response.json({
          mode: "commit",
          commands: [],
          results: [],
          tablesWritten: [],
        }),
      );
      await requestHost("commitBatch", {
        commands: [],
        operationId: sent.operationId,
      });
      expect(JSON.parse(fetch.mock.calls[1]![1].body)).toMatchObject(sent);
    },
  );
});
