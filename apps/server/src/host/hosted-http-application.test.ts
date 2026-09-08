import { serve } from "@hono/node-server";
import { once } from "node:events";
import { expect, it, vi } from "vite-plus/test";
import type { ApplicationOperations } from "./application";
import { createHostedHttpApplication } from "./hosted-http-application";
import type { HostedUserTokenSource } from "./hosted-token-issuer";
import { createHostedWorkOSSession } from "./hosted-workos-session";

it("routes the sealed login handshake and denies signed-out workspace allocation", async () => {
  const origin = "https://dashframe.example.test";
  const exchange = vi.fn(async () => ({
    accessToken: "synthetic-access",
    sealedSession: "synthetic-session",
  }));
  const session = createHostedWorkOSSession(
    {
      publicOrigin: origin,
      clientId: "client_test",
      issuer: "https://api.workos.com/",
      apiKey: "sk_synthetic",
      // oxlint-disable-next-line sonarjs/no-hardcoded-passwords -- Synthetic cookie encryption key.
      cookiePassword: "synthetic-cookie-password-32-chars",
    },
    {
      sdk: {
        getAuthorizationUrlWithPKCE: async () => ({
          url: "https://api.workos.com/user_management/authorize?state=synthetic-state",
          state: "synthetic-state",
          codeVerifier: "synthetic-verifier",
        }),
        authenticateWithCode: exchange,
        loadSealedSession: () => ({
          authenticate: async () => ({ authenticated: false }),
          refresh: async () => ({ authenticated: false, retryable: false }),
        }),
      },
      verifier: {
        verify: async () => ({
          identity: { subject: "verified-a" },
          expiresAt: Date.now() + 120_000,
        }),
      },
    },
  );
  const withWorkspace = vi.fn(
    async (
      _workspaceId: string,
      _user: HostedUserTokenSource,
      request: Request,
      operation: (
        application: Pick<ApplicationOperations, "execute">,
        signal: AbortSignal,
      ) => Promise<Response>,
    ) => operation({ execute: async () => null }, request.signal),
  );
  const admission = vi.fn(async () => ({
    status: "admitted" as const,
    workspaceId: "workspace-a",
  }));
  const app = createHostedHttpApplication({
    publicOrigin: origin,
    session,
    admission: { resolve: admission },
    tokens: {
      browser: () => ({ token: "synthetic", expiresAt: Date.now() + 60_000 }),
    },
    withWorkspace,
  });
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Expected TCP address");
  const request = (url: string, init?: RequestInit) =>
    fetch(
      `http://127.0.0.1:${address.port}${new URL(url).pathname}${new URL(url).search}`,
      { ...init, redirect: "manual" },
    );
  try {
    const login = await request(`${origin}/auth/login`);
    expect(login.status).toBe(302);
    expect(login.headers.get("cache-control")).toBe("no-store");
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const callback = await request(
      `${origin}/auth/callback?state=synthetic-state&code=synthetic-code`,
      { headers: { cookie } },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${origin}/`);
    expect(callback.headers.get("set-cookie")).toContain(
      "__Host-dashframe-workos-session=",
    );
    expect(exchange).toHaveBeenCalledOnce();
    const runtime = await request(`${origin}/api/runtime`, {
      method: "POST",
      headers: { origin },
    });
    expect(runtime.status).toBe(401);
    expect(admission).not.toHaveBeenCalled();
    expect(withWorkspace).not.toHaveBeenCalled();
    expect(
      (
        await request(`${origin}/auth/logout`, {
          method: "POST",
          headers: { origin: "https://foreign.invalid" },
        })
      ).status,
    ).toBe(403);
    const logout = await request(`${origin}/auth/logout`, {
      method: "POST",
      headers: { origin },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await request(`${origin}/api/unknown`)).status).toBe(404);
    vi.spyOn(session, "login").mockRejectedValueOnce(
      new Error("sensitive-provider-detail"),
    );
    const unavailable = await request(`${origin}/auth/login`);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).not.toContain("sensitive-provider-detail");
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
  } finally {
    if ("closeAllConnections" in server) server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    vi.restoreAllMocks();
  }
});
