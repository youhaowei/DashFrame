import { generateKeyPairSync } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createHostedServerSurface } from "./hosted";
import { MAX_LOCAL_ARROW_BYTES } from "@dashframe/types";
import { createHostedTokenIssuer } from "./host/hosted-token-issuer";
import type { HostedBrowserSession } from "./host/hosted-workos-session";
import type { HostedAdmission } from "./host/hosted-admission-service";
import { MAX_HOSTED_MCP_BODY_BYTES } from "./host/hosted-mcp-routes";
import { MAX_HOSTED_ASSISTANT_BODY_BYTES } from "./host/hosted-browser-routes";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it("serves the hosted shell and enforces session/admission before opening workspace resources", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "hosted-surface-"));
  directories.push(directory);
  await writeFile(
    path.join(directory, "index.html"),
    "<!doctype html><title>Hosted fixture</title>",
  );
  await writeFile(
    path.join(directory, "_headers"),
    "/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n",
  );
  const origin = "https://dashframe.example.test";
  let identity: HostedBrowserSession = { status: "signedout" };
  let access: HostedAdmission = { status: "pending", workspaceId: null };
  const resolveAdmission = vi.fn(async () => access);
  const resolveSession = vi.fn(async () => identity);
  const open = vi.fn(async () => {
    throw new Error("private startup diagnostic");
  });
  const surface = await createHostedServerSurface({
    publicOrigin: origin,
    deploymentUrl: "http://127.0.0.1:1",
    allowInsecureLoopbackForTests: true,
    revision: "synthetic-revision",
    staticDirectory: directory,
    tokens: createHostedTokenIssuer({
      issuer: origin,
      privateKey: generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey,
    }),
    session: {
      resolve: resolveSession,
      login: async () => Response.redirect(`${origin}/auth/callback`),
      callback: async () => Response.redirect(origin),
      logout: () => new Response(null, { status: 204 }),
    },
    admission: { resolve: resolveAdmission },
    open,
  });
  const request = (pathname: string, method = "GET", source?: string) =>
    surface.app.request(`${origin}${pathname}`, {
      method,
      headers: source === undefined ? {} : { origin: source },
    });
  let websocketServer: ReturnType<typeof serve> | undefined;
  try {
    expect(await (await request("/reports/example")).text()).toContain(
      "Hosted fixture",
    );
    expect(await (await request("/api/version")).json()).toEqual({
      commit: "synthetic-revision",
      convex: "cloud",
    });
    expect((await request("/api/unknown")).status).toBe(404);
    expect((await request("/api/runtime", "POST", origin)).status).toBe(401);
    expect(
      (await request("/api/convex/api/1.0.0/sync", "GET", origin)).status,
    ).toBe(401);
    expect((await request("/data/frame")).status).toBe(401);
    expect((await request("/assistant/run", "POST", origin)).status).toBe(401);
    expect(
      (
        await surface.app.request(`${origin}/data/frame`, {
          method: "POST",
          headers: {
            origin,
            "content-length": String(MAX_LOCAL_ARROW_BYTES + 1),
          },
          body: "oversized",
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await surface.app.request(`${origin}/workspaces/workspace-a/mcp`, {
          method: "POST",
          headers: {
            "content-length": String(MAX_HOSTED_MCP_BODY_BYTES + 1),
          },
          body: "oversized",
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await surface.app.request(`${origin}/assistant/run`, {
          method: "POST",
          headers: {
            origin,
            "content-length": String(MAX_HOSTED_ASSISTANT_BODY_BYTES + 1),
          },
          body: "oversized",
        })
      ).status,
    ).toBe(413);
    expect(resolveAdmission).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();

    identity = {
      status: "authenticated",
      identity: { subject: "user-a" },
      expiresAt: Date.now() + 60_000,
    };
    expect(
      await (await request("/api/runtime", "POST", origin)).json(),
    ).toEqual({ mode: "hosted", status: "pending" });
    expect(
      (await request("/api/convex/api/1.0.0/sync", "GET", origin)).status,
    ).toBe(403);
    expect((await request("/data/frame")).status).toBe(403);
    expect(open).not.toHaveBeenCalled();

    access = { status: "admitted", workspaceId: "workspace-a" };
    identity = {
      ...identity,
      setCookie:
        "__Host-dashframe-workos-session=rotated; Path=/; HttpOnly; Secure; SameSite=Lax",
    };
    websocketServer = serve({
      fetch: surface.app.fetch,
      hostname: "127.0.0.1",
      port: 0,
    });
    surface.injectWebSocket(websocketServer);
    await once(websocketServer, "listening");
    const address = websocketServer.address();
    if (!address || typeof address === "string")
      throw new Error("Expected WebSocket test address");
    const upgradedCookie = await new Promise<string | string[] | undefined>(
      (resolve, reject) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${address.port}/api/convex/api/1.0.0/sync`,
          { headers: { origin } },
        );
        socket.once("upgrade", (response) => {
          resolve(response.headers["set-cookie"]);
          socket.close();
        });
        socket.once("error", reject);
      },
    );
    expect(upgradedCookie).toEqual([
      "__Host-dashframe-workos-session=rotated; Path=/; HttpOnly; Secure; SameSite=Lax",
    ]);
    expect((await request("/api/runtime", "POST")).status).toBe(403);
    expect(
      (await request("/data/frame", "GET", "https://foreign.example.test"))
        .status,
    ).toBe(403);
    expect(open).not.toHaveBeenCalled();
    const failed = await request("/api/runtime", "POST", origin);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      mode: "hosted",
      status: "unavailable",
    });
    expect(open).toHaveBeenCalledWith("workspace-a", "user-a");
  } finally {
    surface.closeConnections();
    if (websocketServer)
      await new Promise<void>((resolve, reject) => {
        websocketServer!.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    await surface.closeResources();
    await rm(directory, { recursive: true, force: true });
  }
});
