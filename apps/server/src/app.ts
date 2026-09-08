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
import { connectConvexCloud, type ConvexBackend } from "./host/convex-cloud";
import type { HostSessionAuth } from "./host/auth";
import type { WebSurface } from "./host/web-surface";
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
  arrowEngine?: ArrowQueryRunner & Partial<ArrowTableRegistrar>;
  googleOAuth?: GoogleOAuthConfig;
  mcpMode?: McpMode;
  mcpMaxStatefulSessions?: number;
  mcpStatefulSessionTtlMs?: number;
  mcpSessionNow?: () => number;
  convexRuntime?: { binaryPath?: string; functionsDirectory?: string };
  /**
   * Attach to an existing Convex Cloud deployment instead of supervising a
   * local backend. Hosted deployments use this; desktop and loopback web do
   * not, and keep their local-first backend unchanged.
   */
  convexCloud?: { url: string; adminKey: string };
  /** Browser session credential the host accepts in addition to bearer tokens. */
  session?: HostSessionAuth;
  /** Built web app to serve on this origin. Absent on desktop and loopback web. */
  webSurface?: WebSurface;
  /** Commit the running build came from, reported by `GET /api/version`. */
  buildSha?: string;
  /** Public origin the browser reaches this host on, behind a TLS proxy. */
  publicOrigin?: string;
}
export interface DashframeServer {
  url: string;
  port: number;
  convexUrl: string;
  stop(): Promise<void>;
}
/** Paths owned by the host API rather than by the built web app. */
function isHostPath(pathname: string): boolean {
  return (
    pathname === "/mcp" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/data/") ||
    pathname.startsWith("/assistant/")
  );
}

export async function createDashframeServer(
  options: DashframeServerOptions,
): Promise<DashframeServer> {
  const hostname = options.hostname ?? "127.0.0.1";
  // Fails closed on a non-loopback bind without a token before any child
  // process starts.
  const authenticate = createHostAuthenticator({
    ...options,
    hostname,
    session: options.session,
  });
  const identity = await createConvexIdentity(
    path.join(options.project.dir, ".convex"),
    options.project.workspaceId,
  );
  let stop: (() => Promise<void>) | undefined;
  // One host, two backends. The cloud path never spawns a process, never
  // deploys functions and never touches the project directory's Convex state;
  // the local path is byte-for-byte what it was.
  const convex: ConvexBackend = options.convexCloud
    ? await connectConvexCloud(options.convexCloud)
    : await startLocalConvex({
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
      // The origin the app is actually served on is always allowed: behind a
      // TLS-terminating proxy the request URL says `http://0.0.0.0:8080` while
      // the browser says `https://dashframe.dev`, so same-origin cannot be
      // derived from the request and has to be configured.
      if (options.publicOrigin && origin === options.publicOrigin)
        return origin;
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
      // Host responses carry project data and must never be cached. Built app
      // assets are content-hashed and immutable, and the web surface sets its
      // own caching; a blanket no-store there would re-download the entire
      // bundle on every page load.
      if (!options.webSurface || isHostPath(new URL(c.req.url).pathname))
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
        return c.json({ convexUrl: `${new URL(c.req.url).origin}/api/convex` });
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
          // Chart queries are issued by the renderer with no Authorization
          // header (packages/visualization/src/server-frame-connector.ts), so
          // on the hosted surface they arrive carrying only the session cookie.
          // Use the same principal resolution and bearer precedence as host
          // operations; checking the cookie signature alone bypasses admission.
          ...(options.webSurface || options.session
            ? {
                authorizeRequest: async (request: Request) => {
                  await authenticate(request);
                  return true;
                },
              }
            : {}),
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
      handleConnectorOAuthCallback(c, application),
    );
    app.get("/api/connectors/setup/:sessionId/resume", (c) =>
      handleConnectorSetupResume(c, application),
    );
    // Unauthenticated on purpose: this is how a deploy is verified to be
    // serving the commit it claims, from outside. It reveals only a commit of a
    // public repository.
    app.get("/api/version", (c) =>
      c.json({
        name: "dashframe",
        commit: options.buildSha ?? null,
        convex: options.convexCloud ? "cloud" : "local",
      }),
    );
    app.get("/", async (c, next) => {
      // The OAuth resume landing owns `/` only when it is actually a resume;
      // otherwise the root is the app itself.
      if (!options.webSurface || c.req.query("resumeConnector"))
        return handleConnectorResumeLanding(c, application);
      return next();
    });
    const web = options.webSurface;
    if (web) {
      app.get("/login", (c) => web.handleLoginPage(c.req.raw));
      app.post("/login", (c) => web.handleLoginSubmit(c.req.raw));
      app.post("/logout", () => web.handleLogout());
      app.get("*", async (c) => {
        const { pathname } = new URL(c.req.url);
        // A GET that fell through the host routes is a genuine 404, not a
        // client route. Returning the SPA shell for it would turn a typo'd API
        // path into an HTML 200 and hide real integration failures.
        if (isHostPath(pathname)) return c.json({ error: "Not found" }, 404);
        if (!web.isSignedIn(c.req.raw)) return c.redirect("/login", 303);
        return web.serve(c.req.raw);
      });
    }
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
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}
