import { describe, expect, it, vi } from "vite-plus/test";

import { resolveDesktopHost } from "./desktop-host";

describe("resolveDesktopHost", () => {
  it("returns the host and credential the bridge reports", async () => {
    await expect(
      resolveDesktopHost({
        getServerInfo: async () => ({
          url: "http://127.0.0.1:4000",
          token: "loopback-token",
          convexUrl: "http://127.0.0.1:9137",
        }),
      }),
    ).resolves.toEqual({
      url: "http://127.0.0.1:4000",
      token: "loopback-token",
    });
  });

  it("fails closed when there is no bridge, without asking for anything", async () => {
    await expect(resolveDesktopHost(undefined)).rejects.toThrow(
      "Desktop IPC bridge is unavailable",
    );
  });

  it.each([
    ["no token", { url: "http://127.0.0.1:4000", token: "" }],
    ["no host URL", { url: "", token: "loopback-token" }],
  ])("fails closed when desktop IPC reports %s", async (_label, info) => {
    const getServerInfo = vi.fn().mockResolvedValue(info);
    await expect(resolveDesktopHost({ getServerInfo })).rejects.toThrow(
      /omitted its/,
    );
  });
});
