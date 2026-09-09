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
describe("runtime reply addressing", () => {
  const token = "public-origin-token";
  const proxyOrigin = "https://proxy-qa.localhost";
  let dir: string;
  let project: Awaited<ReturnType<typeof openLocalProject>>;
  let server: DashframeServer | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "dashframe-public-origin-"));
    project = await openLocalProject({ dir, name: "Public origin" });
  }, 120_000);
  afterAll(async () => {
    await server?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }, 30_000);

  it.each(["not a url", "https://proxy.localhost/api", "https://a.test?b=1"])(
    "refuses %j before starting anything",
    async (value) => {
      await expect(
        createDashframeServer({
          project,
          authToken: token,
          publicOrigin: value,
        }),
      ).rejects.toThrow(/publicOrigin/);
    },
  );

  it("serves the configured public origin rather than the request's own", async () => {
    server = await createDashframeServer({
      project,
      authToken: token,
      publicOrigin: proxyOrigin,
      corsOrigin: [proxyOrigin],
    });
    const reply = await fetch(`${server.url}/api/runtime`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        origin: proxyOrigin,
      },
    });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({
      mode: "local",
      status: "local-ready",
      config: { convexUrl: `${proxyOrigin}/api/convex` },
    });
  }, 120_000);
});
