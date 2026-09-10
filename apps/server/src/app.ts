/** Native host + local Convex composition, shared by desktop and standalone web. */
import { MAX_LOCAL_ARROW_BYTES } from "@dashframe/types";
import type { DataFrameStorage } from "@dashframe/engine";
import {
  createArrowDataPath,
  type ArrowQueryRunner,
  type ArrowTableRegistrar,
} from "@dashframe/engine-server/arrow-data-path";
import type {
  ApiAccessCredentials,
  LocalProjectHandle,
} from "@dashframe/server-core";
import { startLocalConvex } from "@dashframe/convex-local";
import { internal } from "@dashframe/convex-backend/api";
import { serve as nodeServe } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { SecretRef, SecretVault } from "@wystack/secret-vault";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Socket } from "node:net";
import { createConvexIdentity } from "./convex-identity";
import { createHostAuthenticator } from "./host/auth";
import { createHostMetadata } from "./host/convex-metadata";
import { createApplicationOperations } from "./host/dispatch";
import { hostOperationByName } from "./host/registry";
import { NativeTableLifecycle } from "./host/native-tables";
import { mountConvexProxy } from "./host/convex-proxy";
import { HostBatchOutcomeUnknownError } from "./host/commands";
import { HostResourceCleanup } from "./host/resource-cleanup";
import { closeHostServer } from "./host/server-lifecycle";
import { handleAssistantRunRequest } from "./assistant-run-route";
import { createMcpRoute, type McpMode } from "./mcp/route";
import {
  handleConnectorOAuthCallback,
  handleConnectorSetupResume,
  handleConnectorResumeLanding,
} from "./connector-oauth-callback";
import {
  readOptionalGoogleOAuthConfig,
  type GoogleOAuthConfig,
} from "./connector-setup/oauth-provider";
import { sweep as sweepConnectorSetup } from "./connector-setup/session-store";
import { isLoopbackHost } from "./bind-host";
import { LOCAL_USER_ID } from "./permissions";

type CorsOrigin =
  | string
  | string[]
  | ((
      origin: string,
      c: Context,
    ) => Promise<string | undefined | null> | string | undefined | null);
export interface DashframeServerOptions {
  project: Pick<LocalProjectHandle, "dir" | "workspaceId" | "name">;
  dataFrameStorage?: DataFrameStorage;
  hostname?: string;
  port?: number;
  authToken?: string;
  authRef?: SecretRef;
  vault?: SecretVault;
  accessCredentials?: ApiAccessCredentials;
  corsOrigin?: CorsOrigin;
  /**
   * Address clients should use to reach this server, when that differs from
   * the one requests arrive on — a dev proxy rewrites Host, so the server
   * cannot see it. Its own request origin is used when unset, which is right
   * for every client that connects directly.
   */
  publicOrigin?: string;
  arrowEngine?: ArrowQueryRunner & Partial<ArrowTableRegistrar>;
  googleOAuth?: GoogleOAuthConfig;
  mcpMode?: McpMode;
  mcpMaxStatefulSessions?: number;
  mcpStatefulSessionTtlMs?: number;
  mcpSessionNow?: () => number;
  convexRuntime?: { binaryPath?: string; functionsDirectory?: string };
}
/** Rejects anything that is not an exact origin, so clients never get a path or query. */
function normalizePublicOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`publicOrigin is not a valid URL: ${value}`);
  }
  if (parsed.origin !== value)
    throw new Error(`publicOrigin must be an exact origin: ${value}`);
  // A non-HTTP scheme parses and round-trips through URL.origin, but the client
  // would be handed a Convex URL it cannot fetch — fail at startup instead of
  // on every client's access screen.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error(`publicOrigin must be http or https: ${value}`);
  return parsed.origin;
}

export interface DashframeServer {
  url: string;
  port: number;
  convexUrl: string;
  stop(): Promise<void>;
}
export async function createDashframeServer(
  options: DashframeServerOptions,
): Promise<DashframeServer> {
  const hostname = options.hostname ?? "127.0.0.1";
  // Validate before anything starts: a bad origin must not surface as a
  // client that cannot reach Convex after the server is already up.
  const publicOrigin = normalizePublicOrigin(options.publicOrigin);
  // Fails closed on a non-loopback bind without a token before any child
  // process starts.
  const authenticate = createHostAuthenticator({
    ...options,
    hostname,
  });
  const identity = await createConvexIdentity(
    path.join(options.project.dir, ".convex"),
    options.project.workspaceId,
  );
  let stop: (() => Promise<void>) | undefined;
  const convex = await startLocalConvex({
    projectDir: options.project.dir,
    functionsDirectory:
      options.convexRuntime?.functionsDirectory ??
      path.dirname(
        fileURLToPath(
          import.meta.resolve("@dashframe/convex-backend/package.json"),
        ),
      ),
    binaryPath: options.convexRuntime?.binaryPath,
    auth: identity,
    onUnexpectedExit: () => {
      stop?.().catch(() =>
        console.error("Failed to stop the host after Convex exited"),
      );
    },
  });
  let cleanup: HostResourceCleanup | undefined;
  const native = options.arrowEngine
    ? new NativeTableLifecycle(options.arrowEngine)
    : undefined;
  try {
    await initializeProject(() =>
      convex.internalClient.mutation(internal.host.initializeProject, {
        workspaceId: options.project.workspaceId,
        projectId: options.project.workspaceId,
        name: options.project.name,
      }),
    );
    const metadata = createHostMetadata(
      convex.internalClient,
      options.project.workspaceId,
    );
    const serverState: { endpoint?: string } = {};
    cleanup = new HostResourceCleanup({
      metadata,
      vault: options.vault,
      dataFrameStorage: options.dataFrameStorage,
      dataPlaneRuntime: native?.engine,
    });
    await cleanup.recoverPendingBatches();
    await cleanup.run();
    const application = createApplicationOperations({
      convexUrl: convex.url,
      identity,
      context: (principal) => ({
        principal,
        metadata,
        cleanupResources: () => cleanup!.run(),
        vault: options.vault,
        accessCredentials: options.accessCredentials,
        getServerEndpoint: () => serverState.endpoint,
        dataFrameStorage: options.dataFrameStorage,
        dataPlaneRuntime: native?.engine,
        googleOAuth: options.googleOAuth ?? readOptionalGoogleOAuthConfig(),
      }),
    });
    // Callback and resume requests carry no caller credential. Bind the local
    // server-owned identity at the mount; hosted passes its admitted bound app.
    const connectorCallbackApplication = application.forPrincipal({
      kind: "user",
      userId: LOCAL_USER_ID,
    });
    const resolveContext = async (request: Request) => ({
      principal: await authenticate(request),
    });
    const app = new Hono();
    const sockets = new Set<Socket>();
    const { upgradeWebSocket, injectWebSocket, wss } = createNodeWebSocket({
      app,
    });
    const allowedOrigin = async (
      origin: string,
      c: Context,
    ): Promise<string | undefined> => {
      const configured = options.corsOrigin;
      if (typeof configured === "function")
        return (await configured(origin, c)) ?? undefined;
      if (typeof configured === "string")
        return configured === "*" || configured === origin ? origin : undefined;
      if (Array.isArray(configured))
        return configured.includes(origin) ? origin : undefined;
      try {
        const parsed = new URL(origin);
        return parsed.protocol === "http:" && isLoopbackHost(parsed.hostname)
          ? origin
          : undefined;
      } catch {
        return undefined;
      }
    };
    app.use("*", async (c, next) => {
      // Reject DNS rebinding on tokenless loopback hosts before any public route.
      if (
        isLoopbackHost(hostname) &&
        !options.authToken &&
        !options.authRef &&
        !isLoopbackHost(new URL(c.req.url).hostname.replace(/^\[|\]$/g, ""))
      )
        return c.json({ error: "Invalid host" }, 403);
      const origin = c.req.header("origin");
      if (origin && !(await allowedOrigin(origin, c)))
        return c.json({ error: "Origin is not allowed" }, 403);
      c.header("Cache-Control", "no-store");
      await next();
    });
    app.use(
      "*",
      cors({
        origin: allowedOrigin,
        allowHeaders: [
          "Authorization",
          "Content-Type",
          "Mcp-Session-Id",
          "Mcp-Protocol-Version",
          "Last-Event-ID",
        ],
        allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
        exposeHeaders: ["Mcp-Session-Id", "Mcp-Protocol-Version"],
      }),
    );
    app.use(
      "/api/host/*",
      bodyLimit({
        maxSize: Math.ceil((MAX_LOCAL_ARROW_BYTES * 4) / 3) + 1024 * 1024,
      }),
    );
    mountConvexProxy(app, upgradeWebSocket, convex.url);
    app.get("/api/runtime", async (c) => {
      try {
        await authenticate(c.req.raw);
        return c.json({
          convexUrl: `${publicOrigin ?? new URL(c.req.url).origin}/api/convex`,
        });
      } catch {
        return c.json({ error: "Unauthorized" }, 401);
      }
    });
    app.post("/api/runtime", async (c) => {
      try {
        await authenticate(c.req.raw);
        // The server names its own address. Echoing the caller's Origin was
        // wrong for any client that is not proxied same-origin: a desktop
        // renderer dials the loopback port directly while its page origin is
        // the dev server, and a packaged one sends Origin: null.
        return c.json({
          mode: "local",
          status: "local-ready",
          config: {
            convexUrl: `${publicOrigin ?? new URL(c.req.url).origin}/api/convex`,
          },
        });
      } catch {
        return c.json({ error: "Unauthorized" }, 401);
      }
    });
    app.post("/api/convex-token", async (c) => {
      try {
        return c.json(identity.issue(await authenticate(c.req.raw)));
      } catch {
        return c.json({ error: "Unauthorized" }, 401);
      }
    });
    app.post("/api/host/:operation", async (c) => {
      let principal;
      try {
        principal = await authenticate(c.req.raw);
      } catch {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const operation = c.req.param("operation");
      // Only explicitly published native HTTP operations are reachable here.
      if (!hostOperationByName(operation))
        return c.json({ error: "Unknown host operation" }, 404);
      try {
        return c.json(
          await application.execute(operation, await c.req.json(), {
            principal,
            signal: c.req.raw.signal,
          }),
        );
      } catch (error) {
        if (error instanceof HostBatchOutcomeUnknownError) {
          return c.json(
            {
              error: error.message,
              code: error.code,
              operationId: error.operationId,
            },
            503,
          );
        }
        const message =
          error instanceof Error ? error.message : "Host operation failed";
        return c.json({ error: message }, message === "FORBIDDEN" ? 403 : 400);
      }
    });
    if (native)
      app.route(
        "/data",
        createArrowDataPath({
          engine: native.engine,
          dataFrameStorage: options.dataFrameStorage,
          isFrameAvailable: async (id) => {
            const row = await metadata.getDataFrame(id);
            const location = row?.storage as
              | { type?: string; key?: string }
              | undefined;
            return location?.type === "file" && location.key === id;
          },
          ...(options.authRef && options.vault
            ? { authRef: options.authRef, vault: options.vault }
            : { authToken: options.authToken }),
        }),
      );
    app.post("/assistant/run", (c) =>
      handleAssistantRunRequest(c, {
        app: application,
        metadata,
        vault: options.vault,
        resolveContext,
      }),
    );
    const mcp = createMcpRoute({
      app: application,
      mode: options.mcpMode,
      maxStatefulSessions: options.mcpMaxStatefulSessions,
      statefulSessionTtlMs: options.mcpStatefulSessionTtlMs,
      now: options.mcpSessionNow,
      resolveContext,
    });
    app.all("/mcp", mcp);
    app.get("/api/connectors/oauth/callback", (c) =>
      handleConnectorOAuthCallback(c, connectorCallbackApplication),
    );
    app.get("/api/connectors/setup/:sessionId/resume", (c) =>
      handleConnectorSetupResume(c, connectorCallbackApplication),
    );
    app.get("/", (c) =>
      handleConnectorResumeLanding(c, connectorCallbackApplication),
    );
    await sweepConnectorSetup(metadata.connectorSetup, new Date(), 0);
    const { server, port } = await new Promise<{
      server: ReturnType<typeof nodeServe>;
      port: number;
    }>((resolve, reject) => {
      const server = nodeServe(
        { fetch: app.fetch, hostname, port: options.port ?? 0 },
        (info) => resolve({ server, port: info.port }),
      );
      server.on("error", reject);
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
    });
    injectWebSocket(server);
    cleanup.start();
    const address = hostname.includes(":") ? `[${hostname}]` : hostname;
    const url = `http://${address}:${port}`;
    serverState.endpoint = `${url}/api`;
    let stopping: Promise<void> | undefined;
    stop = () =>
      (stopping ??= (async () => {
        await cleanup?.close();
        native?.close();
        try {
          await closeHostServer(server, wss.clients, sockets);
        } finally {
          await convex.stop();
        }
      })());
    return { url, port, convexUrl: convex.url, stop };
  } catch (error) {
    await cleanup?.close();
    native?.close();
    await convex.stop();
    throw error;
  }
}

/** initializeProject is idempotent; a freshly deployed backend may briefly throttle it. */
async function initializeProject(run: () => Promise<unknown>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await run();
      return;
    } catch (error) {
      if (
        attempt >= 5 ||
        !(error instanceof Error) ||
        error.message !== "Local Convex internal mutation failed (429)."
      )
        throw error;
      await new Promise((resolve) => {
        setTimeout(resolve, 100 * 2 ** attempt);
      });
    }
  }
}
