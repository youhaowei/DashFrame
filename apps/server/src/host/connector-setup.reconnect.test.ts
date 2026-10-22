/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import schema from "../../../../packages/convex-backend/convex/schema";
import { internal } from "../../../../packages/convex-backend/convex/_generated/api";
import type { ConnectorSetupStore } from "../connector-setup/session-store";
import type { HostContext } from "./context";
import type { HostMetadata } from "./metadata";
import { completeConnectorOAuth } from "./connector-setup";
import { hostOperations } from "./registry";

/** Start through the host registry, the path an HTTP request takes. */
const startConnectorSetup = (ctx: HostContext, input: unknown) =>
  hostOperations.startConnectorSetup.execute(ctx, input);

const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);
const SOURCE_ID = "7c8d7e90-3803-4885-8349-faae10bb829d";
const BOUND_PROPERTY = "properties/123";

function bundle(refreshToken: string) {
  return JSON.stringify({
    version: 1,
    accessToken: `access-${refreshToken}`,
    refreshToken,
    expiresAt: Date.now() + 3_600_000,
    clientId: "client-id",
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
}

/** Google as the sign-in sees it: the new grant reaches `visible` properties. */
function stubGoogle(visible: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({
          access_token: "access-new",
          refresh_token: "refresh-new",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/analytics.readonly",
        });
      }
      if (url.includes("/accountSummaries")) {
        return Response.json({
          accountSummaries: [
            {
              propertySummaries: visible.map((property) => ({
                property,
                displayName: property,
              })),
            },
          ],
        });
      }
      if (url.endsWith(":runReport")) {
        return Response.json({
          dimensionHeaders: [{ name: "date" }],
          metricHeaders: [{ name: "activeUsers" }],
          rowCount: 0,
          rows: [],
        });
      }
      if (url.includes("analyticsadmin.googleapis.com/v1beta/properties/")) {
        return Response.json({ timeZone: "UTC" });
      }
      return new Response(null, { status: 404 });
    }),
  );
}

async function fixture() {
  const t = convexTest(schema, modules);
  const workspaceId = "w";
  const connectorSetup: ConnectorSetupStore = {
    get: (id) => t.query(internal.connectorSetup.get, { workspaceId, id }),
    findByNonce: (stateNonceHash) =>
      t.query(internal.connectorSetup.findByNonce, {
        workspaceId,
        stateNonceHash,
      }),
    insert: async (row) => {
      await t.mutation(internal.connectorSetup.insert, { workspaceId, row });
    },
    compareAndSwap: (id, expected, patch) =>
      t.mutation(internal.connectorSetup.compareAndSwap, {
        workspaceId,
        id,
        expected,
        patch,
      }),
    list: () => Promise.reject(new Error("unused")),
    delete: () => Promise.reject(new Error("unused")),
    getDataSourceKind: async () => null,
  };

  const registry = new SecretRegistry();
  registry.register("test", new TestBackend());
  registry.setClassDefault(CREDENTIAL_CLASS.ConnectorKey, "test");
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  const oldRef = await vault.store(bundle("refresh-old"), {
    class: CREDENTIAL_CLASS.ConnectorKey,
  });

  // The source the user already has: one imported table on property 123.
  let source = {
    id: SOURCE_ID,
    kind: "googleAnalytics",
    revision: 4,
    config: { apiKey: oldRef as string, sourceBindingVersion: "v2" },
  };
  const metadata = {
    connectorSetup,
    getDataSource: async (id: string) => (id === SOURCE_ID ? source : null),
    listDataTableResources: async () => [BOUND_PROPERTY],
    replaceDataSourceConfig: async (input: {
      expectedRevision: number;
      config: typeof source.config;
    }) => {
      if (input.expectedRevision !== source.revision)
        throw new Error("revision conflict");
      source = {
        ...source,
        revision: source.revision + 1,
        config: input.config,
      };
    },
  } as unknown as HostMetadata;

  const ctx = {
    principal: { kind: "user", userId: "u" },
    metadata,
    vault,
    googleOAuth: { clientId: "client-id", clientSecret: "client-secret" },
    getServerEndpoint: () => "http://127.0.0.1:4000",
  } as unknown as HostContext;

  /** Start a sign-in for the existing source and return its OAuth state. */
  const signInAgain = async () => {
    const session = await startConnectorSetup(ctx, {
      connectorId: "googleAnalytics",
      requestedName: "Google Analytics",
      reconnectDataSourceId: SOURCE_ID,
    });
    return new URL(session.authorizeUrl!).searchParams.get("state")!;
  };
  const storedSecret = (ref: string) =>
    vault.withSecret(ref as typeof oldRef, async (value) => value);

  return {
    ctx,
    vault,
    oldRef,
    signInAgain,
    storedSecret,
    source: () => source,
  };
}

describe("signing in again for an existing Google Analytics source", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renews the grant of the same source and retires the old one", async () => {
    const f = await fixture();
    stubGoogle([BOUND_PROPERTY, "properties/456"]);
    const state = await f.signInAgain();

    const result = await completeConnectorOAuth(f.ctx, { state, code: "code" });

    expect(result).toMatchObject({
      state: "connected",
      dataSourceId: SOURCE_ID,
    });
    const { apiKey } = f.source().config;
    expect(apiKey).not.toBe(f.oldRef);
    expect(JSON.parse(await f.storedSecret(apiKey))).toMatchObject({
      refreshToken: "refresh-new",
    });
    expect(await f.vault.has(f.oldRef)).toBe(false);
    expect(f.source().config.sourceBindingVersion).toBe("v2");
  });

  it("refuses a Google account that can't reach the source's properties", async () => {
    const f = await fixture();
    stubGoogle(["properties/999"]);
    const state = await f.signInAgain();
    const before = f.source();

    const result = await completeConnectorOAuth(f.ctx, { state, code: "code" });

    expect(result).toMatchObject({
      state: "failed",
      failureCode: "account-mismatch",
    });
    expect(f.source()).toBe(before);
    expect(JSON.parse(await f.storedSecret(f.oldRef))).toMatchObject({
      refreshToken: "refresh-old",
    });
  });

  it("leaves the source untouched when the user cancels at Google", async () => {
    const f = await fixture();
    stubGoogle([BOUND_PROPERTY]);
    const state = await f.signInAgain();
    const before = f.source();

    const result = await completeConnectorOAuth(f.ctx, {
      state,
      oauthError: "access_denied",
    });

    expect(result).toMatchObject({
      state: "failed",
      failureCode: "authorization-rejected",
    });
    expect(f.source()).toBe(before);
    expect(await f.vault.has(f.oldRef)).toBe(true);
  });

  it("won't start a sign-in for a source that isn't Google Analytics", async () => {
    const f = await fixture();
    await expect(
      startConnectorSetup(f.ctx, {
        connectorId: "googleAnalytics",
        requestedName: "Google Analytics",
        reconnectDataSourceId: crypto.randomUUID(),
      }),
    ).rejects.toThrow("no longer exists");
  });
});
