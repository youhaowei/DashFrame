import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createHostedServerSurface } from "./hosted";
import { createHostedTokenIssuer } from "./host/hosted-token-issuer";
import type { HostedBrowserSession } from "./host/hosted-workos-session";
import type { HostedAdmission } from "./host/hosted-admission-service";

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
  const open = vi.fn(async () => {
    throw new Error("private startup diagnostic");
  });
  const surface = await createHostedServerSurface({
    publicOrigin: origin,
    deploymentUrl: "https://synthetic.convex.cloud",
    revision: "synthetic-revision",
    staticDirectory: directory,
    tokens: createHostedTokenIssuer({
      issuer: origin,
      privateKey: generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey,
    }),
    session: {
      resolve: async () => identity,
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
    expect((await request("/data/frame")).status).toBe(401);
    expect((await request("/assistant/run", "POST", origin)).status).toBe(401);
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
    expect((await request("/data/frame")).status).toBe(403);
    expect(open).not.toHaveBeenCalled();

    access = { status: "admitted", workspaceId: "workspace-a" };
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
    await surface.closeResources();
    await rm(directory, { recursive: true, force: true });
  }
});
