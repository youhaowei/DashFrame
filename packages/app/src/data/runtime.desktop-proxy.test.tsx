import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { resolveAppConfig } from "./runtime";

describe("desktop Convex runtime bootstrap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("replaces the raw backend endpoint from IPC with the host proxy", async () => {
    vi.stubGlobal("dashframe", {
      getServerInfo: async () => ({
        url: "http://127.0.0.1:4000",
        token: "desktop-host-token",
        convexUrl: "http://127.0.0.1:9137",
      }),
    });
    vi.stubGlobal("fetch", vi.fn());

    await expect(resolveAppConfig()).resolves.toEqual({
      url: "http://127.0.0.1:4000",
      token: "desktop-host-token",
      convexUrl: "http://127.0.0.1:4000/api/convex",
    });
  });
});
