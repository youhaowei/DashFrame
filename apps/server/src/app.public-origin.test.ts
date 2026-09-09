import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { openLocalProject } from "@dashframe/server-core";

import { createDashframeServer, type DashframeServer } from "./app";

/**
 * The runtime reply tells a client where Convex is. A proxied client cannot be
 * served the address requests arrive on, and a direct client must not be served
 * its own page origin — so the server names its address explicitly or falls
 * back to the one it was reached on.
 */

const token = "public-origin-token";
const proxyOrigin = "https://proxy-qa.localhost";
const otherOrigin = "https://other-qa.localhost";

describe("public origin validation", () => {
  // These reject inside createDashframeServer before it starts anything, so
  // they need no project and no Convex backend.
  it.each([
    "not a url",
    "https://proxy.localhost/api",
    "https://a.test?b=1",
    // These round-trip through URL.origin, so only a scheme check rejects them.
    "ftp://example.com",
    "ws://example.com",
    "wss://example.com",
  ])("refuses %j before starting anything", async (value) => {
    await expect(
      createDashframeServer({
        project: { dir: "/nonexistent", workspaceId: "w", name: "n" },
        authToken: token,
        publicOrigin: value,
      }),
    ).rejects.toThrow(/publicOrigin/);
  });
});

// Starting a server spawns the pinned local Convex backend, which CI's `check`
// job never provisions — every test that starts one is gated the same way.
const live = process.env.DASHFRAME_CONVEX_INTEGRATION === "1";

describe.runIf(live)("runtime reply addressing", () => {
  let dir: string;
  let project: Awaited<ReturnType<typeof openLocalProject>>;
  let server: DashframeServer | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "dashframe-public-origin-"));
    project = await openLocalProject({ dir, name: "Public origin" });
    server = await createDashframeServer({
      project,
      authToken: token,
      publicOrigin: proxyOrigin,
      // Every Origin the cases send must reach the handler, so the assertions
      // are about addressing rather than about the origin allowlist.
      corsOrigin: [proxyOrigin, otherOrigin, "null"],
    });
  }, 180_000);
  afterAll(async () => {
    await server?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }, 30_000);

  // Each case sends an Origin that is NOT the configured public origin, so the
  // assertion fails if the server goes back to echoing the caller's Origin.
  it.each([
    ["a caller on another origin", { origin: otherOrigin }],
    ["a packaged renderer", { origin: "null" }],
    ["no Origin at all", {}],
  ])("serves the configured public origin to %s", async (_label, headers) => {
    const reply = await fetch(`${server!.url}/api/runtime`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, ...headers },
    });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({
      mode: "local",
      status: "local-ready",
      config: { convexUrl: `${proxyOrigin}/api/convex` },
    });
  });
});
