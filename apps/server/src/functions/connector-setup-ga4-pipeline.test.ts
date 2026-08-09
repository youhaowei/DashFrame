import { FileDataFrameStorage } from "@dashframe/engine-server";
import { openArtifactDb, schema } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import type { WyStackApp } from "@wystack/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildDashframeApp } from "../app";
import type { GoogleOAuthConfig } from "../connector-setup/oauth-provider";
import { LOCAL_USER_ID } from "../permissions";

const { dataSources } = schema;

function makeVault(): SecretVault {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend(), { fallback: true });
  registry.setClassDefault("connector-key", "test");
  return new SecretVault(registry, new InMemoryMappingStore());
}

function googleResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GA4 connector setup pipeline", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let flushSnapshot: ReturnType<typeof vi.fn>;
  let reportStatus: number;
  let hasProperties: boolean;
  let googleFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-ga4-pipeline-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    flushSnapshot = vi.fn(async () => {});
    reportStatus = 200;
    hasProperties = true;
    googleFetch = vi.fn(async (url: string | URL | Request) => {
      const target = new URL(String(url));
      if (
        target.origin === "https://oauth2.googleapis.com" &&
        target.pathname === "/token"
      ) {
        return googleResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/analytics.readonly",
        });
      }
      if (
        target.origin === "https://analyticsadmin.googleapis.com" &&
        target.pathname === "/v1beta/accountSummaries"
      ) {
        return googleResponse({
          accountSummaries: hasProperties
            ? [
                {
                  propertySummaries: [
                    {
                      property: "properties/123456789",
                      displayName: "Example Property",
                    },
                  ],
                },
              ]
            : [],
        });
      }
      if (
        target.origin === "https://analyticsdata.googleapis.com" &&
        target.pathname === "/v1beta/properties/123456789:runReport"
      ) {
        return googleResponse(
          {
            dimensionHeaders: [{ name: "date" }],
            metricHeaders: [{ name: "activeUsers", type: "TYPE_INTEGER" }],
            rows: [
              {
                dimensionValues: [{ value: "20260803" }],
                metricValues: [{ value: "41" }],
              },
              {
                dimensionValues: [{ value: "20260804" }],
                metricValues: [{ value: "42" }],
              },
            ],
          },
          reportStatus,
        );
      }
      throw new Error(
        `Unexpected Google request: ${target.origin}${target.pathname}`,
      );
    });
    vi.stubGlobal("fetch", googleFetch as unknown as typeof fetch);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function oauthConfig(): GoogleOAuthConfig {
    return {
      clientId: "client-id",
      clientSecret: "client-secret",
      now: Date.now,
    };
  }

  async function makeApp(): Promise<WyStackApp> {
    const base = await buildDashframeApp({
      db,
      dataFrameStorage: new FileDataFrameStorage(join(dir, "dataframes")),
      vault: makeVault(),
      googleOAuth: oauthConfig(),
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

  // The setup-time probe and a real `queryGa4Property` call both hit
  // `runReport`; picking calls out by URL lets a test pin what one specific
  // call's body looked like without caring how many others also fired.
  function runReportCalls() {
    return googleFetch.mock.calls.filter(([url]) =>
      new URL(String(url)).pathname.endsWith(":runReport"),
    );
  }

  async function start(app: WyStackApp) {
    const call = await app.call(
      "startConnectorSetup",
      { connectorId: "googleAnalytics", requestedName: "Website analytics" },
      { principal: user },
    );
    return call.result as {
      sessionId: string;
      authorizeUrl: string;
      state: string;
    };
  }

  it("verifies reporting access during setup and reads the stored source", async () => {
    const app = await makeApp();
    const session = await start(app);
    const state = new URL(session.authorizeUrl).searchParams.get("state");

    const completed = await app.call(
      "completeConnectorOAuth",
      { state, code: "authorization-code" },
      { principal: user },
    );
    const result = completed.result as {
      state: string;
      dataSourceId?: string;
    };
    expect(result).toMatchObject({ state: "connected" });
    expect(result.dataSourceId).toBeTruthy();

    const [source] = await db.select().from(dataSources);
    expect(source).toMatchObject({
      id: result.dataSourceId,
      kind: "googleAnalytics",
    });

    // The setup-time probe must actually be bounded: a fixture that only
    // matched the runReport URL would also pass a probe requesting the full
    // 10_000-row default, which defeats the point of calling it a "sample".
    const probeCall = runReportCalls()[0];
    expect(probeCall).toBeDefined();
    expect(JSON.parse(String(probeCall?.[1]?.body))).toMatchObject({
      offset: "0",
      limit: "1",
    });

    const added = await app.call(
      "addDataTable",
      {
        dataSourceId: result.dataSourceId,
        name: "Example Property",
        table: "properties/123456789",
      },
      { principal: user },
    );
    const tableId = (added.result as { id: string }).id;
    const inspected = await app.call(
      "queryGa4Property",
      { dataSourceId: result.dataSourceId, tableId },
      { principal: user },
    );
    expect(inspected.result).not.toHaveProperty("dataFrameId");
    const approvedFields = (
      inspected.result as { fields: object[] }
    ).fields.map((field) => ({ ...field, sensitivity: "cleared" }));
    const queried = await app.call(
      "queryGa4Property",
      {
        dataSourceId: result.dataSourceId,
        tableId,
        snapshot: true,
        approvedFields,
      },
      { principal: user },
    );
    expect(queried.result).toMatchObject({
      rowCount: 2,
      fields: [
        { name: "date", type: "date" },
        { name: "activeUsers", type: "number" },
      ],
    });
    expect(queried.result).toHaveProperty("dataFrameId");
    expect(queried.result).not.toHaveProperty("arrowBuffer");
    expect(queried.result).toHaveProperty("fieldIds");
    expect(googleFetch).toHaveBeenCalledTimes(5);
  });

  it("fails setup when the report probe is forbidden", async () => {
    reportStatus = 403;
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
      failureCode: "report-probe-failed",
      failureMessage:
        "Google Analytics could not be verified: reporting access is missing or restricted for this account.",
    });
    expect(await db.select().from(dataSources)).toHaveLength(0);
    const failureMessage = (completed.result as { failureMessage?: string })
      .failureMessage;
    expect(failureMessage).not.toContain("token");
    expect(failureMessage).not.toContain("access-token");
    expect(failureMessage).not.toContain("refresh-token");
  });

  it("completes setup without a report probe when the account has no properties", async () => {
    hasProperties = false;
    const app = await makeApp();
    const session = await start(app);
    const state = new URL(session.authorizeUrl).searchParams.get("state");

    const completed = await app.call(
      "completeConnectorOAuth",
      { state, code: "authorization-code" },
      { principal: user },
    );

    expect(completed.result).toMatchObject({ state: "connected" });
    expect(await db.select().from(dataSources)).toHaveLength(1);
    // Nothing to sample a report against, so the probe must not fire at all
    // — not "fire and pass trivially", an actual absence of the call.
    expect(runReportCalls()).toHaveLength(0);
  });
});
