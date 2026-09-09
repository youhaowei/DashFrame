import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { lookupHostRuntime } from "./runtime-transport";

const origin = "https://dashframe.test";
const config = { convexUrl: `${origin}/api/convex` };
afterEach(() => vi.unstubAllGlobals());

describe("host runtime transport", () => {
  it.each([
    [{ mode: "local", status: "local-ready", config }, 200, "local-ready"],
    [
      {
        mode: "hosted",
        status: "admitted",
        subject: "user-a",
        workspaceId: "workspace-a",
        config,
      },
      200,
      "admitted",
    ],
    [{ mode: "hosted", status: "signed-out" }, 401, "signed-out"],
    [{ mode: "hosted", status: "pending" }, 200, "pending-admission"],
    [{ mode: "hosted", status: "revoked" }, 200, "pending-admission"],
    [{ mode: "hosted", status: "unavailable" }, 503, "unavailable"],
  ])("maps a validated %j response", async (body, status, expected) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json(body, { status: Number(status) }));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    expect((await lookupHostRuntime(origin, signal)).status).toBe(expected);
    expect(fetcher).toHaveBeenCalledWith(
      new URL(`${origin}/api/runtime`),
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        signal,
      }),
    );
  });

  it("sends the client credential as a bearer header and keeps it on the config", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { mode: "local", status: "local-ready", config },
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const result = await lookupHostRuntime(
      origin,
      new AbortController().signal,
      { token: "host-token" },
    );
    expect(result).toMatchObject({
      status: "local-ready",
      config: { token: "host-token" },
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer host-token",
    });
  });

  it("sends no authorization header when the client has no credential", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { mode: "local", status: "local-ready", config },
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const result = await lookupHostRuntime(
      origin,
      new AbortController().signal,
    );
    expect(result).toMatchObject({ status: "local-ready" });
    expect((result as { config: { token?: string } }).config.token).toBe(
      undefined,
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "Authorization",
    );
  });

  it.each([
    [{ convexUrl: config.convexUrl }, 200],
    [{ mode: "hosted", status: "signed-out" }, 500],
    [
      {
        mode: "hosted",
        status: "admitted",
        workspaceId: "workspace-a",
        config,
      },
      200,
    ],
    [
      {
        mode: "hosted",
        status: "admitted",
        subject: " ",
        workspaceId: "workspace-a",
        config,
      },
      200,
    ],
    [
      {
        mode: "local",
        status: "local-ready",
        config: { convexUrl: "https://other.test/api/convex" },
      },
      200,
    ],
    [
      {
        mode: "local",
        status: "local-ready",
        config,
        token: "unexpected-authority",
      },
      200,
    ],
    [{ mode: "hosted", status: "pending" }, 401],
  ])("fails closed on malformed or inconsistent %j", async (body, status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(body, { status })),
    );
    expect(
      await lookupHostRuntime(origin, new AbortController().signal),
    ).toEqual({ status: "unavailable" });
  });

  it("does not infer signed-out or local from HTML, a redirect, or a network failure", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("<html>Login</html>", {
          headers: { "Content-Type": "text/html" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: { Location: "/auth/login" },
        }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    for (let i = 0; i < 3; i++)
      expect(
        await lookupHostRuntime(origin, new AbortController().signal),
      ).toEqual({ status: "unavailable" });
  });
});
