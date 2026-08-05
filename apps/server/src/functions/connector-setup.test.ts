import { openArtifactDb, schema } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
  isSecretRef,
} from "@wystack/secret-vault";
import type { WyStackApp } from "@wystack/server";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const probedBundles: string[] = [];
let probeStarted: (() => void) | undefined;
let probeWait: Promise<void> | undefined;

vi.mock("@dashframe/connector-ga4", () => ({
  makeGa4Connector: (
    auth: <T>(use: (plaintext: string) => Promise<T>) => Promise<T>,
  ) => ({
    id: "googleAnalytics",
    name: "Google Analytics 4",
    description: "Test GA4 connector",
    sourceType: "remote-api",
    icon: "<svg></svg>",
    authKind: "oauth",
    getFormFields: () => [],
    connect: () =>
      auth(async (plaintext) => {
        probedBundles.push(plaintext);
        probeStarted?.();
        await probeWait;
        return [{ id: "properties/123", name: "Example" }];
      }),
  }),
}));

import { buildDashframeApp } from "../app";
import type { AppContext } from "../app-context";
import type { GoogleOAuthConfig } from "../connector-setup/oauth-provider";
import { LOCAL_USER_ID } from "../permissions";

const { connectorSetupSessions, dataSources } = schema;

function makeVault(): { vault: SecretVault; backend: TestBackend } {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault("connector-key", "test");
  return {
    vault: new SecretVault(registry, new InMemoryMappingStore()),
    backend,
  };
}

describe("connector setup functions", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let flushSnapshot: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    probedBundles.length = 0;
    probeStarted = undefined;
    probeWait = undefined;
    dir = mkdtempSync(join(tmpdir(), "dashframe-connector-functions-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    flushSnapshot = vi.fn(async () => {});
  });

  afterEach(async () => {
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function oauthConfig(): GoogleOAuthConfig {
    return {
      clientId: "client-id",
      clientSecret: "client-secret",
      now: () => Date.parse("2026-08-05T12:00:00Z"),
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "access-token",
              refresh_token: "refresh-token",
              expires_in: 3600,
              scope: "https://www.googleapis.com/auth/analytics.readonly",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ) as unknown as typeof fetch,
    };
  }

  async function makeApp(
    vault?: SecretVault,
    googleOAuth: GoogleOAuthConfig | null = oauthConfig(),
  ): Promise<WyStackApp> {
    const base = await buildDashframeApp({
      db,
      vault,
      ...(googleOAuth ? { googleOAuth } : {}),
      getServerEndpoint: () => "http://127.0.0.1:4567/api",
    });
    const app: WyStackApp = {
      ...base,
      call: (path, args, context) =>
        base.call(path, args, {
          ...(context ?? {}),
          wyStackApp: app,
          flushSnapshot,
        }),
    };
    return app;
  }

  const user = { kind: "user" as const, userId: LOCAL_USER_ID };
  const service = {
    kind: "service" as const,
    credentialId: "credential-1",
  };

  async function start(
    app: WyStackApp,
    principal: NonNullable<AppContext["principal"]> = user,
  ) {
    const call = await app.call(
      "startConnectorSetup",
      { connectorId: "googleAnalytics", requestedName: "Website analytics" },
      { principal },
    );
    return call.result as {
      sessionId: string;
      authorizeUrl: string;
      state: string;
    };
  }

  it("accepts user and service principals for API-initiated setup", async () => {
    const app = await makeApp(makeVault().vault);
    await expect(start(app, user)).resolves.toMatchObject({
      state: "awaiting-user-auth",
    });
    await expect(start(app, service)).resolves.toMatchObject({
      state: "awaiting-user-auth",
    });
    await expect(
      app.call("startConnectorSetup", {
        connectorId: "googleAnalytics",
        requestedName: "No principal",
      }),
    ).rejects.toThrow();
  });

  it("probes plaintext first, creates canonically second, and stores only a ref", async () => {
    const { vault } = makeVault();
    const app = await makeApp(vault);
    const session = await start(app);
    const state = new URL(session.authorizeUrl).searchParams.get("state");
    expect(state).toBeTruthy();

    const completed = await app.call(
      "completeConnectorOAuth",
      { state, code: "authorization-code" },
      { principal: user },
    );
    expect(completed.result).toMatchObject({
      state: "connected",
      requestedName: "Website analytics",
    });
    expect(probedBundles).toHaveLength(1);

    const [source] = await db.select().from(dataSources);
    expect(source?.kind).toBe("googleAnalytics");
    const ref = (source?.config as { apiKey?: unknown }).apiKey;
    expect(isSecretRef(ref)).toBe(true);
    await expect(
      vault.withSecret(ref as never, async (value) => value),
    ).resolves.toBe(probedBundles[0]);
    expect(flushSnapshot).toHaveBeenCalledTimes(2);
  });

  it("fails closed without a vault after a successful probe and leaves no source", async () => {
    const app = await makeApp();
    const session = await start(app);
    const state = new URL(session.authorizeUrl).searchParams.get("state");
    const completed = await app.call(
      "completeConnectorOAuth",
      { state, code: "authorization-code" },
      { principal: user },
    );

    expect(completed.result).toMatchObject({
      state: "failed",
      failureCode: "create-failed",
    });
    expect(probedBundles).toHaveLength(1);
    expect(await db.select().from(dataSources)).toHaveLength(0);
    const [row] = await db.select().from(connectorSetupSessions);
    expect(row?.dataSourceId).toBeNull();
  });

  it("does not let cancellation interrupt an already-consumed callback", async () => {
    const { vault } = makeVault();
    const app = await makeApp(vault);
    const session = await start(app);
    const state = new URL(session.authorizeUrl).searchParams.get("state");
    let releaseProbe = () => {};
    probeWait = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const enteredProbe = new Promise<void>((resolve) => {
      probeStarted = resolve;
    });

    const completion = app.call(
      "completeConnectorOAuth",
      { state, code: "authorization-code" },
      { principal: user },
    );
    await enteredProbe;
    const cancellation = await app.call(
      "cancelConnectorSetup",
      { sessionId: session.sessionId },
      { principal: user },
    );
    expect(cancellation.result).toMatchObject({ state: "verifying" });
    releaseProbe();

    await expect(completion).resolves.toMatchObject({
      result: { state: "connected" },
    });
    expect(await db.select().from(dataSources)).toHaveLength(1);
  });

  it("marks provider configuration failures terminal after callback consumption", async () => {
    const app = await makeApp(makeVault().vault);
    const session = await start(app);
    const state = new URL(session.authorizeUrl).searchParams.get("state");
    const restartedWithoutGoogle = await makeApp(makeVault().vault, null);

    const completed = await restartedWithoutGoogle.call(
      "completeConnectorOAuth",
      { state, code: "authorization-code" },
      { principal: user },
    );

    expect(completed.result).toMatchObject({
      state: "failed",
      failureCode: "exchange-failed",
      failureMessage: "Google authorization could not be completed.",
    });
  });

  it("durably returns an expired callback through the procedure boundary", async () => {
    const app = await makeApp(makeVault().vault);
    const session = await start(app);
    const state = new URL(session.authorizeUrl).searchParams.get("state");
    await db
      .update(connectorSetupSessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(connectorSetupSessions.id, session.sessionId));

    const completed = await app.call(
      "completeConnectorOAuth",
      { state, code: "authorization-code" },
      { principal: user },
    );

    expect(completed.result).toMatchObject({ state: "expired" });
    expect(flushSnapshot).toHaveBeenCalledTimes(2);
  });
});
