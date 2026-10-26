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
import { persistGa4TokenBundle } from "./connectors";
import { hostOperations } from "./registry";

/** Start through the host registry, the path an HTTP request takes. */
const startConnectorSetup = (ctx: HostContext, input: unknown) =>
  hostOperations.startConnectorSetup.execute(ctx, input);

const modules = import.meta.glob(
  "../../../../packages/convex-backend/convex/**/*.ts",
);
const SOURCE_ID = "7c8d7e90-3803-4885-8349-faae10bb829d";
const BOUND_PROPERTY = "properties/123";
const OTHER_BOUND_PROPERTY = "properties/456";

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
function stubGoogle(visible: string[], reports = true) {
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
        if (!reports) return new Response(null, { status: 403 });
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
  // The source's two tables, plus another source's table it must not see.
  await t.run(async (db) => {
    const row = (id: string, dataSourceId: string, table: string) =>
      db.db.insert("dataTables", {
        workspaceId,
        id,
        revision: 1,
        name: table,
        createdAt: 1,
        dataSourceId,
        table,
      });
    await row("t-1", SOURCE_ID, BOUND_PROPERTY);
    await row("t-2", SOURCE_ID, OTHER_BOUND_PROPERTY);
    await row("t-3", crypto.randomUUID(), "properties/999");
  });
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
    // Small pages, so a source with a few tables already spans several.
    listDataTableResources: (dataSourceId: string, cursor: string | null) =>
      t.query(internal.host.listDataTableResources, {
        workspaceId,
        dataSourceId,
        paginationOpts: { cursor, numItems: 1 },
      }),
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
    // The account's first property is not one the source uses.
    stubGoogle(["properties/999", BOUND_PROPERTY, OTHER_BOUND_PROPERTY]);
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
    // Reporting access is proven on a property the source reads.
    const reports = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => String(url))
      .filter((url) => url.endsWith(":runReport"));
    expect(reports).toEqual([expect.stringContaining(BOUND_PROPERTY)]);
  });

  it("refuses a Google account that can't reach the source's properties", async () => {
    const f = await fixture();
    stubGoogle(["properties/999", BOUND_PROPERTY]);
    const state = await f.signInAgain();
    const before = f.source();

    const result = await completeConnectorOAuth(f.ctx, { state, code: "code" });

    expect(result).toMatchObject({
      state: "failed",
      failureCode: "account-mismatch",
      failureMessage: expect.stringContaining(OTHER_BOUND_PROPERTY),
    });
    expect(result.failureMessage).not.toContain(BOUND_PROPERTY);
    expect(f.source()).toBe(before);
    expect(JSON.parse(await f.storedSecret(f.oldRef))).toMatchObject({
      refreshToken: "refresh-old",
    });
  });

  it("leaves the source untouched when the account can't run reports", async () => {
    const f = await fixture();
    stubGoogle([BOUND_PROPERTY, OTHER_BOUND_PROPERTY], false);
    const state = await f.signInAgain();
    const before = f.source();

    const result = await completeConnectorOAuth(f.ctx, { state, code: "code" });

    expect(result).toMatchObject({
      state: "failed",
      failureCode: "report-probe-failed",
    });
    expect(f.source()).toBe(before);
    expect(await f.vault.has(f.oldRef)).toBe(true);
  });

  it("keeps the old sign-in when the new one can't be saved", async () => {
    const f = await fixture();
    stubGoogle([BOUND_PROPERTY, OTHER_BOUND_PROPERTY]);
    vi.spyOn(f.ctx.metadata, "replaceDataSourceConfig").mockRejectedValue(
      new Error("storage unavailable"),
    );
    const state = await f.signInAgain();
    const before = f.source();

    const result = await completeConnectorOAuth(f.ctx, { state, code: "code" });

    expect(result).toMatchObject({
      state: "failed",
      failureCode: "reconnect-failed",
    });
    expect(f.source()).toBe(before);
    expect(JSON.parse(await f.storedSecret(f.oldRef))).toMatchObject({
      refreshToken: "refresh-old",
    });
  });

  it("leaves the source untouched when the user cancels at Google", async () => {
    const f = await fixture();
    stubGoogle([BOUND_PROPERTY, OTHER_BOUND_PROPERTY]);
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

  it("keeps a new sign-in when a refresh of the old grant lands behind it", async () => {
    const f = await fixture();
    const original = f.source();
    const store = f.vault.store.bind(f.vault);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(f.vault, "store").mockImplementationOnce(async (...args) => {
      await held;
      return store(...args);
    });
    const parse = (raw: string) => JSON.parse(raw) as never;
    const renewal = persistGa4TokenBundle(
      f.ctx,
      SOURCE_ID as never,
      f.vault,
      parse(bundle("refresh-new")),
      original,
      { replacesGrant: true },
    );
    // A request that read the source before the sign-in refreshes the old grant.
    const staleRefresh = persistGa4TokenBundle(
      f.ctx,
      SOURCE_ID as never,
      f.vault,
      parse(bundle("refresh-old")),
      original,
    );
    release();

    await renewal;
    await expect(staleRefresh).rejects.toThrow("DataSource config changed");
    expect(
      JSON.parse(await f.storedSecret(f.source().config.apiKey)),
    ).toMatchObject({ refreshToken: "refresh-new" });
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
