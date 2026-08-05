import { openArtifactDb } from "@dashframe/server-core";
import type { WyStackApp } from "@wystack/server";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createDashframeServer } from "./app";
import {
  handleConnectorOAuthCallback,
  handleConnectorResumeLanding,
  handleConnectorSetupResume,
} from "./connector-oauth-callback";
import { ConnectorSetupGateError } from "./connector-setup/session-store";
import { LOCAL_USER_ID } from "./permissions";

function fakeApp(call: WyStackApp["call"]): WyStackApp {
  return { call } as WyStackApp;
}

describe("connector OAuth browser routes", () => {
  it("bypasses bearer resolution on the registered callback route", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dashframe-oauth-route-"));
    const db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    let server: Awaited<ReturnType<typeof createDashframeServer>> | undefined;
    try {
      server = await createDashframeServer({
        db,
        authToken: "required-for-normal-api-routes",
      });
      const response = await fetch(
        `${server.url}/api/connectors/oauth/callback?state=invalid`,
      );
      expect(response.status).toBe(400);
    } finally {
      server?.stop();
      await db.$client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires no bearer and delegates completion with the fixed local principal", async () => {
    const call = vi.fn(async () => ({
      result: { state: "connected" },
      tablesRead: new Set<string>(),
      tablesWritten: new Set<string>(),
    }));
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
    const call = vi.fn(async () => ({
      result,
      tablesRead: new Set<string>(),
      tablesWritten: new Set<string>(),
    }));
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
      result: {
        sessionId: crypto.randomUUID(),
        connectorId: "googleAnalytics",
        state: "awaiting-user-auth",
        authorizeUrl,
        expiresAt: Date.now() + 60_000,
      },
      tablesRead: new Set<string>(),
      tablesWritten: new Set<string>(),
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
});
