import { createHostedServiceAccess } from "./host/hosted-service-access";
import { createMcpRoute } from "./mcp/route";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { createArrowDataPath } from "@dashframe/engine-server/arrow-data-path";
import type {
  HostedUserTokenSource,
  HostedPrincipalTokenSource,
} from "./host/hosted-token-issuer";
import type { ApplicationOperations } from "./host/application";
import { handleAssistantRunRequest } from "./assistant-run-route";
import {
  handleConnectorOAuthCallback,
  handleConnectorSetupResume,
  handleConnectorResumeLanding,
} from "./connector-oauth-callback";
import { readOptionalGoogleOAuthConfig } from "./connector-setup/oauth-provider";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { linuxQuerySandboxReadPaths } from "@dashframe/engine-server/query-sandbox";
import { createHostedConnectorSessionStore } from "./connector-setup/hosted-session-store";
import { loadSecretKeyring } from "./secret-file-backend";
import { createHostedApplication } from "./host/hosted-application";
import { createHostedAdmissionService } from "./host/hosted-admission-service";
import { createHostedHttpApplication } from "./host/hosted-http-application";
import { createHostedSourceMetadata } from "./host/hosted-convex-source-operations";
import { createHostedTokenIssuer } from "./host/hosted-token-issuer";
import { createHostedWorkOSSession } from "./host/hosted-workos-session";
import { HostedWorkspacePool } from "./host/hosted-workspace-pool";
import { createHostedWorkspaceResourceFactory } from "./host/hosted-workspace-resources";
import { createStaticWebSurface } from "./host/web-surface";
import { mountConvexProxy } from "./host/convex-proxy";
import { isHostedOriginAllowed } from "./host/hosted-origin";

function guardApplication(
  application: ApplicationOperations,
  signal: AbortSignal,
): ApplicationOperations {
  return {
    async execute(...args) {
      signal.throwIfAborted();
      return application.execute(...args);
    },
    forPrincipal(principal) {
      signal.throwIfAborted();
      return guardApplication(application.forPrincipal(principal), signal);
    },
  };
}

function runHostedAssistant(
  request: Request,
  hosted: ReturnType<typeof createHostedApplication>,
  signal: AbortSignal,
) {
  const assistant = new Hono();
  assistant.post("/assistant/run", (context) =>
    handleAssistantRunRequest(context, {
      app: hosted.application,
      metadata: hosted.context.metadata,
      vault: hosted.context.vault,
      resolveContext: async () => ({ principal: hosted.context.principal }),
    }),
  );
  return assistant.fetch(new Request(request, { signal }));
}

/** Explicit hosted entry; the local CLI never imports this module. Start under the volume-lock wrapper. */
export async function startHostedServer(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const required = (name: string) => {
    const value = environment[name];
    if (!value?.trim())
      throw new Error(`Missing hosted configuration: ${name}`);
    return value;
  };
  const publicOrigin = required("DASHFRAME_PUBLIC_ORIGIN");
  const deploymentUrl = required("DASHFRAME_CONVEX_DEPLOYMENT_URL");
  const keyring = await loadSecretKeyring(environment);
  if (!keyring) throw new Error("Hosted workspace encryption key is required");
  const inlinePrivateKey = environment.DASHFRAME_AUTH_PRIVATE_KEY;
  const privateKeyFile = environment.DASHFRAME_AUTH_PRIVATE_KEY_FILE;
  if (Boolean(inlinePrivateKey) === Boolean(privateKeyFile))
    throw new Error("Set exactly one hosted signing key value or key file");
  const tokens = createHostedTokenIssuer({
    issuer: required("DASHFRAME_AUTH_ISSUER"),
    privateKey: inlinePrivateKey ?? (await readFile(privateKeyFile!)),
  });
  const session = createHostedWorkOSSession({
    clientId: required("DASHFRAME_WORKOS_CLIENT_ID"),
    issuer: required("DASHFRAME_WORKOS_ISSUER"),
    apiKey: required("DASHFRAME_WORKOS_API_KEY"),
    cookiePassword: required("DASHFRAME_WORKOS_COOKIE_PASSWORD"),
    publicOrigin,
  });
  const admission = createHostedAdmissionService({ deploymentUrl, tokens });
  const googleOAuth = readOptionalGoogleOAuthConfig(environment);
  const workerDirectory = "/opt/dashframe-query";
  const runtime = "/usr/local/bin/node";
  const open = await createHostedWorkspaceResourceFactory({
    dataRoot: path.join(required("RAILWAY_VOLUME_MOUNT_PATH"), "host-data"),
    keyring,
    sandbox: {
      launcher: path.join(workerDirectory, "query-launcher"),
      runtime,
      worker: path.join(workerDirectory, "worker.cjs"),
      readPaths: await linuxQuerySandboxReadPaths(runtime, workerDirectory),
      uid: 65534,
      gid: 65534,
      addressSpaceBytes: 2 * 1024 * 1024 * 1024,
      cpuSeconds: 30,
      uidTaskLimit: 4096,
    },
  });
  const port = Number(required("PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid hosted PORT");
  const surface = await createHostedServerSurface({
    publicOrigin,
    deploymentUrl,
    session,
    admission,
    tokens,
    googleOAuth,
    open,
    authenticateCredential: open.authenticateCredential,
    staticDirectory: path.resolve("apps/web/dist"),
    revision: environment.RAILWAY_GIT_COMMIT_SHA ?? null,
  });
  const server = serve({ fetch: surface.app.fetch, hostname: "0.0.0.0", port });
  surface.injectWebSocket(server);
  return {
    app: surface.app,
    server,
    async close() {
      surface.closeConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await surface.closeResources();
    },
  };
}

/** The production route assembly, with external services supplied explicitly. */
export async function createHostedServerSurface(options: {
  publicOrigin: string;
  deploymentUrl: string;
  session: ReturnType<typeof createHostedWorkOSSession>;
  admission: ReturnType<typeof createHostedAdmissionService>;
  tokens: Parameters<typeof createHostedApplication>[0]["tokens"];
  allowInsecureLoopbackForTests?: boolean;
  googleOAuth?: ReturnType<typeof readOptionalGoogleOAuthConfig>;
  open: (
    workspaceId: string,
  ) => ReturnType<
    Awaited<ReturnType<typeof createHostedWorkspaceResourceFactory>>
  >;
  authenticateCredential?: Awaited<
    ReturnType<typeof createHostedWorkspaceResourceFactory>
  >["authenticateCredential"];
  staticDirectory: string;
  revision: string | null;
}) {
  const {
    publicOrigin,
    deploymentUrl,
    session,
    admission,
    tokens,
    googleOAuth,
    open,
  } = options;
  const pool = new HostedWorkspacePool(8, open);
  const recovered = new WeakMap<object, Promise<void>>();
  const app = new Hono();
  const { upgradeWebSocket, injectWebSocket, wss } = createNodeWebSocket({
    app,
  });
  const withPrincipalContext = (
    workspaceId: string,
    ownerId: string,
    source: HostedPrincipalTokenSource,
    request: Request,
    operation: (
      hosted: ReturnType<typeof createHostedApplication>,
      signal: AbortSignal,
    ) => Promise<Response>,
  ) =>
    pool.runRequest(
      workspaceId,
      ownerId,
      request,
      source.expiresAt,
      async (resources, signal) => {
        const metadata = createHostedSourceMetadata({
          deploymentUrl,
          allowInsecureLoopbackForTests: options.allowInsecureLoopbackForTests,
          credentialVault: resources.vault,
          getToken: async () => tokens.metadata(source, workspaceId).token,
        });
        const engine = await resources.getEngine();
        const hosted = createHostedApplication({
          deploymentUrl,
          allowInsecureLoopbackForTests: options.allowInsecureLoopbackForTests,
          workspaceId,
          workspaceOwnerId: ownerId,
          source: source,
          tokens,
          resources: {
            vault: resources.vault,
            accessCredentials: resources.accessCredentials,
            googleOAuth,
            dataFrameStorage: resources.dataFrameStorage,
            dataPlaneRuntime: {
              queryArrow: (sql, params) =>
                engine.queryArrow(sql, params, signal),
              registerArrowTable: (name, bytes) =>
                engine.registerArrowTable(name, bytes, signal),
              unregisterTable: (name) => engine.unregisterTable(name),
            },
            getServerEndpoint: () => publicOrigin,
            connectorSetup: createHostedConnectorSessionStore({
              document: resources.connectorSessionDocument,
              ownerSubject: ownerId,
              getDataSourceKind: async (id) =>
                (await metadata.getDataSource(id))?.kind ?? null,
            }),
          },
        });
        let recovery = recovered.get(resources);
        if (!recovery) {
          recovery = hosted.cleanup.recoverPendingBatches();
          recovered.set(resources, recovery);
          recovery.catch(() => {
            if (recovered.get(resources) === recovery)
              recovered.delete(resources);
          });
        }
        await recovery;
        return operation(
          {
            ...hosted,
            application: guardApplication(hosted.application, signal),
          },
          signal,
        );
      },
      120_000,
    );
  const withHostedContext = (
    workspaceId: string,
    user: HostedUserTokenSource,
    request: Request,
    operation: Parameters<typeof withPrincipalContext>[4],
  ) =>
    withPrincipalContext(
      workspaceId,
      user.userId,
      { kind: "user", ...user },
      request,
      operation,
    );
  const serviceAccess = createHostedServiceAccess({
    deploymentUrl,
    tokens,
    allowInsecureLoopbackForTests: options.allowInsecureLoopbackForTests,
  });
  app.all("/workspaces/:workspaceId/mcp", async (c) => {
    c.header("Cache-Control", "no-store");
    const origin = c.req.header("Origin");
    if (origin && origin !== publicOrigin)
      return c.json({ error: "Origin is not allowed" }, 403);
    const bearer = /^Bearer (dfa_[a-z0-9_-]+)$/i.exec(
      c.req.header("Authorization") ?? "",
    );
    if (!bearer) return c.json({ error: "Unauthorized MCP request" }, 401);
    if (!options.authenticateCredential)
      return c.json({ error: "Agent access unavailable" }, 503);
    const workspaceId = c.req.param("workspaceId");
    let source: HostedPrincipalTokenSource;
    let ownerId: string;
    try {
      const credentialId = await options.authenticateCredential(
        workspaceId,
        bearer[1]!,
      );
      if (!credentialId)
        return c.json({ error: "Unauthorized MCP request" }, 401);
      source = {
        kind: "service",
        credentialId,
        expiresAt: Date.now() + 60_000,
      };
      const binding = await serviceAccess.resolve(workspaceId, source);
      if (
        binding.workspaceId !== workspaceId ||
        binding.credentialId !== credentialId
      )
        return c.json({ error: "Unauthorized MCP request" }, 401);
      ownerId = binding.subject;
    } catch {
      return c.json({ error: "Unauthorized MCP request" }, 401);
    }
    try {
      return await withPrincipalContext(
        workspaceId,
        ownerId,
        source,
        c.req.raw,
        async (hosted, signal) => {
          const mcp = new Hono();
          mcp.all(
            "*",
            createMcpRoute({
              app: hosted.application,
              mode: "stateless",
              resolveContext: async () => ({
                principal: hosted.context.principal,
              }),
            }),
          );
          return mcp.fetch(new Request(c.req.raw, { signal }));
        },
      );
    } catch {
      return c.json({ error: "Agent request unavailable" }, 503);
    }
  });
  for (const route of ["/api/*", "/data/*", "/assistant/*"]) {
    app.use(route, async (c, next) => {
      if (!isHostedOriginAllowed(c.req.raw, publicOrigin))
        return c.json({ error: "Origin is not allowed" }, 403);
      await next();
    });
  }
  app.route(
    "/",
    createHostedHttpApplication({
      publicOrigin,
      session,
      admission,
      tokens,
      withWorkspace: (workspaceId, user, request, operation) =>
        withHostedContext(workspaceId, user, request, (hosted, signal) =>
          operation(hosted.application, signal),
        ),
    }),
  );
  const authenticated = async (
    request: Request,
    operation: (
      hosted: ReturnType<typeof createHostedApplication>,
      signal: AbortSignal,
    ) => Promise<Response>,
  ): Promise<Response> => {
    let cookie: string | undefined;
    try {
      const identity = await session.resolve(request);
      if ("setCookie" in identity) cookie = identity.setCookie;
      let response: Response;
      if (identity.status !== "authenticated") {
        response = Response.json(
          { error: "Authentication unavailable" },
          {
            status: identity.status === "signedout" ? 401 : 503,
          },
        );
      } else {
        const user = {
          userId: identity.identity.subject,
          expiresAt: identity.expiresAt,
        };
        const access = await admission.resolve(user);
        response =
          access.status === "admitted"
            ? await withHostedContext(
                access.workspaceId,
                user,
                request,
                operation,
              )
            : Response.json({ error: "Admission required" }, { status: 403 });
      }
      response.headers.set("Cache-Control", "no-store");
      if (cookie) response.headers.append("Set-Cookie", cookie);
      return response;
    } catch {
      return Response.json(
        { error: "Hosted service unavailable" },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            ...(cookie ? { "Set-Cookie": cookie } : {}),
          },
        },
      );
    }
  };
  app.all("/data/*", (c) =>
    authenticated(c.req.raw, async (hosted, signal) => {
      const data = createArrowDataPath({
        engine: hosted.context.dataPlaneRuntime!,
        dataFrameStorage: hosted.context.dataFrameStorage,
        authorizeRequest: async () => {
          signal.throwIfAborted();
          return true;
        },
        isFrameAvailable: async (id) => {
          const frame = await hosted.context.metadata.getDataFrame(id);
          const storage = frame?.storage;
          return storage?.type === "file" && storage.key === id;
        },
      });
      const url = new URL(c.req.url);
      const target = new URL(
        url.pathname.slice("/data".length) + url.search,
        publicOrigin,
      );
      return data.fetch(
        new Request(target, new Request(c.req.raw, { signal })),
      );
    }),
  );
  app.post("/assistant/run", (c) =>
    authenticated(c.req.raw, async (hosted, signal) =>
      runHostedAssistant(c.req.raw, hosted, signal),
    ),
  );
  app.get("/api/connectors/oauth/callback", (c) =>
    authenticated(c.req.raw, async (hosted) =>
      handleConnectorOAuthCallback(c, hosted.application),
    ),
  );
  app.get("/api/connectors/setup/:sessionId/resume", (c) =>
    authenticated(c.req.raw, async (hosted) =>
      handleConnectorSetupResume(c, hosted.application),
    ),
  );
  app.get("/", (c, next) =>
    c.req.query("resumeConnector")
      ? authenticated(c.req.raw, async (hosted) =>
          handleConnectorResumeLanding(c, hosted.application),
        )
      : next(),
  );
  app.get("/api/version", (c) =>
    c.json({
      commit: options.revision,
      convex: "cloud",
    }),
  );
  mountConvexProxy(app, upgradeWebSocket, deploymentUrl);
  const staticSurface = await createStaticWebSurface(options.staticDirectory);
  app.get("/health", (c) => c.json({ status: "ok", mode: "hosted" }));
  app.get("*", (c) => {
    if (/^\/(api|data|assistant|mcp|auth)(\/|$)/.test(c.req.path))
      return c.json({ error: "Not found" }, 404);
    return staticSurface(c.req.raw);
  });
  return {
    app,
    injectWebSocket,
    closeConnections() {
      for (const client of wss.clients)
        client.close(1001, "Server shutting down");
    },
    closeResources: () => pool.close(),
  };
}

if (import.meta.main) {
  startHostedServer()
    .then(({ close }) => {
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        close().then(
          () => process.exit(0),
          () => process.exit(1),
        );
      };
      process.once("SIGTERM", stop);
      process.once("SIGINT", stop);
    })
    .catch(() => {
      console.error(
        "Hosted startup failed; check configuration and runtime artifacts.",
      );
      process.exitCode = 1;
    });
}
