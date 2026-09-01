import { render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import type { ReactNode } from "react";

const { connection, auth } = vi.hoisted(() => ({
  connection: { close: vi.fn().mockResolvedValue(undefined) },
  auth: {
    fetchAccessToken: undefined as undefined | (() => Promise<string | null>),
  },
}));

vi.mock("convex/react", () => ({
  ConvexReactClient: class {
    close = connection.close;
  },
  ConvexProviderWithAuth: ({
    children,
    useAuth,
  }: {
    children: ReactNode;
    useAuth: () => { fetchAccessToken: () => Promise<string | null> };
  }) => {
    auth.fetchAccessToken = useAuth().fetchAccessToken;
    return children;
  },
  Authenticated: ({ children }: { children: ReactNode }) => children,
  Unauthenticated: () => null,
  AuthLoading: () => null,
}));

import {
  createAppRuntime,
  getRuntimeConfig,
  resolveAppConfig,
} from "./runtime";

describe("native Convex runtime bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("dashframe", undefined);
    vi.stubEnv("VITE_DASHFRAME_URL", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses the browser-visible host proxy instead of exposing a loopback backend to remote browsers", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ convexUrl: "http://127.0.0.1:9137" }),
        ),
    );
    const config = await resolveAppConfig();
    expect(config.url).toBe(globalThis.location.origin);
    expect(config.convexUrl).toBe(
      new URL("/api/convex", globalThis.location.origin).toString(),
    );
  });

  it("fails closed when desktop IPC omits its host credential", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("dashframe", {
      getServerInfo: async () => ({ url: "http://127.0.0.1:4000", token: "" }),
    });
    await expect(resolveAppConfig()).rejects.toThrow("no loopback token");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses desktop metadata URLs without a second runtime lookup", async () => {
    const config = {
      url: "http://127.0.0.1:4000",
      token: "desktop-host-token",
      convexUrl: "http://127.0.0.1:9137",
    };
    vi.stubGlobal("dashframe", { getServerInfo: async () => config });
    vi.stubGlobal("fetch", vi.fn());
    await expect(resolveAppConfig()).resolves.toEqual({
      ...config,
      convexUrl: "http://127.0.0.1:4000/api/convex",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("gets fresh scoped tokens from the authenticated host whenever Convex requests refresh", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ token: "first-scoped-jwt" }))
      .mockResolvedValueOnce(Response.json({ token: "refreshed-scoped-jwt" }));
    vi.stubGlobal("fetch", fetch);
    const runtime = createAppRuntime({
      url: "http://127.0.0.1:4000",
      token: "host-token",
      convexUrl: "http://127.0.0.1:9137",
    });
    render(
      <runtime.Provider>
        <span>Application</span>
      </runtime.Provider>,
    );
    expect(screen.getByText("Application")).toBeTruthy();
    await expect(auth.fetchAccessToken!()).resolves.toBe("first-scoped-jwt");
    await expect(auth.fetchAccessToken!()).resolves.toBe(
      "refreshed-scoped-jwt",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      new URL("http://127.0.0.1:4000/api/convex-token"),
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer host-token" },
      }),
    );
    await runtime.close();
    expect(connection.close).toHaveBeenCalledOnce();
    expect(() => getRuntimeConfig()).toThrow("has not started");
  });

  it.each(["malformed", "denied", "network"])(
    "ends authentication loading after a %s host response",
    async (failure) => {
      const response =
        failure === "denied"
          ? new Response("Unauthorized", { status: 401 })
          : Response.json({ token: "" });
      const fetchMock = vi.fn();
      if (failure === "network")
        fetchMock.mockRejectedValue(new Error("offline"));
      else fetchMock.mockResolvedValue(response);
      vi.stubGlobal("fetch", fetchMock);
      const runtime = createAppRuntime({
        url: "http://127.0.0.1:4000",
        convexUrl: "http://127.0.0.1:9137",
      });
      render(
        <runtime.Provider>
          <span>Application</span>
        </runtime.Provider>,
      );
      await expect(auth.fetchAccessToken!()).resolves.toBeNull();
      await runtime.close();
    },
  );
});
