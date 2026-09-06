import type { ApplicationOperations } from "./host/application";
import type { Context } from "hono";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  handleConnectorOAuthCallback,
  handleConnectorResumeLanding,
  handleConnectorSetupResume,
} from "./connector-oauth-callback";
import { ConnectorSetupGateError } from "./connector-setup/session-store";
import { LOCAL_USER_ID } from "./permissions";

function fakeApp(
  execute: ApplicationOperations["execute"],
): ApplicationOperations {
  const app: ApplicationOperations = { execute, forPrincipal: () => app };
  return app;
}

describe("connector OAuth browser routes", () => {
  it("does not accept a caller-selected principal from callback query parameters or headers", async () => {
    const execute = vi.fn(async () => ({ state: "connected" }));
    const hono = new Hono();
    hono.get("/api/connectors/oauth/callback", (c) =>
      handleConnectorOAuthCallback(c, fakeApp(execute)),
    );
    const response = await hono.request(
      "/api/connectors/oauth/callback?state=opaque&code=authorization-code&userId=attacker",
      {
        headers: {
          Authorization: "Bearer attacker-selected-identity",
          "X-User-Id": "attacker",
        },
      },
    );
    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      "completeConnectorOAuth",
      {
        state: "opaque",
        code: "authorization-code",
        oauthError: undefined,
      },
      { principal: { kind: "user", userId: LOCAL_USER_ID } },
    );
  });

  it("requires no bearer and delegates completion with the fixed local principal", async () => {
    const call = vi.fn(async () => ({ state: "connected" }));
    const hono = new Hono();
    hono.get("/api/connectors/oauth/callback", (c) =>
      handleConnectorOAuthCallback(c, fakeApp(call)),
    );

    const response = await hono.request(
      "/api/connectors/oauth/callback?state=opaque&code=authorization-code",
    );
    expect(response.status).toBe(200);
    expect(call).toHaveBeenCalledWith(
      "completeConnectorOAuth",
      {
        state: "opaque",
        code: "authorization-code",
        oauthError: undefined,
      },
      { principal: { kind: "user", userId: LOCAL_USER_ID } },
    );
  });

  it("returns only the minimal public resume DTO", async () => {
    const result = {
      sessionId: crypto.randomUUID(),
      connectorId: "googleAnalytics",
      state: "awaiting-user-auth",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      expiresAt: Date.now() + 60_000,
    };
    const call = vi.fn(async () => result);
    const hono = new Hono();
    hono.get("/api/connectors/setup/:sessionId/resume", (c) =>
      handleConnectorSetupResume(c, fakeApp(call)),
    );
    const response = await hono.request(
      `/api/connectors/setup/${result.sessionId}/resume`,
    );
    await expect(response.json()).resolves.toEqual(result);
  });

  it("turns the standalone resume capability into a fresh authorization redirect", async () => {
    const authorizeUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?state=fresh";
    const call = vi.fn(async () => ({
      sessionId: crypto.randomUUID(),
      connectorId: "googleAnalytics",
      state: "awaiting-user-auth",
      authorizeUrl,
      expiresAt: Date.now() + 60_000,
    }));
    const hono = new Hono();
    hono.get("/", (c) => handleConnectorResumeLanding(c, fakeApp(call)));

    const response = await hono.request("/?resumeConnector=opaque-session", {
      redirect: "manual",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(authorizeUrl);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(call).toHaveBeenCalledWith(
      "reissueConnectorSetupResume",
      { sessionId: "opaque-session" },
      { principal: { kind: "user", userId: LOCAL_USER_ID } },
    );
  });

  it("renders a generic error and logs only a session-free gate code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const call = vi.fn(async () => {
      throw new ConnectorSetupGateError("state-mismatch");
    });
    const hono = new Hono();
    hono.get("/api/connectors/oauth/callback", (c) =>
      handleConnectorOAuthCallback(c, fakeApp(call)),
    );
    const secretState = `${crypto.randomUUID()}.secret-nonce`;
    const response = await hono.request(
      `/api/connectors/oauth/callback?state=${encodeURIComponent(secretState)}&code=secret-code`,
    );
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).not.toContain(secretState);
    expect(html).not.toContain("secret-code");
    expect(warn).toHaveBeenCalledWith(
      "[dashframe] connector OAuth callback rejected: state-mismatch",
    );
    warn.mockRestore();
  });

  // These routes are consumed by a browser, not by our own client, so the
  // status is the entire machine-readable half of the response — the body is
  // prose for a human. Asserting only bodies let every status here be changed
  // to 200 with the suite still green.
  describe("status codes each browser route commits to", () => {
    // Typed against the real handler shape rather than cast through `never`:
    // these tests stand in for mutants, so a handler signature change has to
    // break them rather than slide past on a cast.
    function route(
      handler: (c: Context, app: ApplicationOperations) => Promise<Response>,
      path: string,
      result: unknown,
    ) {
      const call = vi.fn(async () => result);
      const hono = new Hono();
      hono.get(path, (c) => handler(c, fakeApp(call)));
      return hono;
    }

    it("answers a callback that has to restart authorization with 409", async () => {
      const hono = route(
        handleConnectorOAuthCallback,
        "/api/connectors/oauth/callback",
        { state: "awaiting-user-auth" },
      );
      const response = await hono.request(
        "/api/connectors/oauth/callback?state=opaque&code=authorization-code",
      );
      // Not 200: the tab is showing "sign in again", so a cache or a monitor
      // must not read this as a completed connection.
      expect(response.status).toBe(409);
    });

    it("answers a callback for a dead session with 400", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const hono = route(
        handleConnectorOAuthCallback,
        "/api/connectors/oauth/callback",
        { state: "expired" },
      );
      const response = await hono.request(
        "/api/connectors/oauth/callback?state=opaque&code=authorization-code",
      );
      expect(response.status).toBe(400);
      warn.mockRestore();
    });

    it("serves the resume DTO with 200 and an unavailable session with 404", async () => {
      const ok = route(
        handleConnectorSetupResume,
        "/api/connectors/setup/:sessionId/resume",
        { sessionId: "s", connectorId: "googleAnalytics", state: "expired" },
      );
      expect((await ok.request("/api/connectors/setup/s/resume")).status).toBe(
        200,
      );

      const failing = new Hono();
      failing.get("/api/connectors/setup/:sessionId/resume", (c) =>
        handleConnectorSetupResume(
          c,
          fakeApp(
            vi.fn(async () => {
              throw new ConnectorSetupGateError("state-mismatch");
            }),
          ),
        ),
      );
      const response = await failing.request("/api/connectors/setup/s/resume");
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "Connector setup session is unavailable",
      });
    });

    it("answers the landing route with 410 when the session is past resuming", async () => {
      const landing = route(handleConnectorResumeLanding, "/", {
        sessionId: "s",
        connectorId: "googleAnalytics",
        state: "failed",
      });
      // 410, not 404: the session existed and is being reported as gone for
      // good, which is what tells the user to start over rather than retry.
      expect((await landing.request("/?resumeConnector=opaque")).status).toBe(
        410,
      );
    });

    it("answers the landing route with 200 when setup already finished", async () => {
      const landing = route(handleConnectorResumeLanding, "/", {
        sessionId: "s",
        connectorId: "googleAnalytics",
        state: "connected",
      });
      expect((await landing.request("/?resumeConnector=opaque")).status).toBe(
        200,
      );
    });

    it("answers the bare origin root with 404 rather than claiming a session", async () => {
      const landing = route(handleConnectorResumeLanding, "/", {
        state: "connected",
      });
      expect((await landing.request("/")).status).toBe(404);
    });
  });
});
