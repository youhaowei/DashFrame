import { createHostedQueryRuntime } from "./host/hosted-query-runtime";
import { mountHostedMcpRoutes } from "./host/hosted-mcp-routes";
import { mountHostedBrowserRoutes } from "./host/hosted-browser-routes";
import { createHostedServiceAccess } from "./host/hosted-service-access";
import path from "node:path";
import { Hono } from "hono";
import type {
  HostedUserTokenSource,
  HostedPrincipalTokenSource,
} from "./host/hosted-token-issuer";
import type { ApplicationOperations } from "./host/application";
import { readOptionalGoogleOAuthConfig } from "./connector-setup/oauth-provider";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import {
  linuxQuerySandboxReadPaths,
  querySandboxNodeRuntime,
} from "@dashframe/engine-server/query-sandbox";
import { createHostedConnectorSessionStore } from "./connector-setup/hosted-session-store";
import { loadSecretKeyring, readSecureKeyFile } from "./secret-file-backend";
import { createHostedApplication } from "./host/hosted-application";
import { createHostedAdmissionService } from "./host/hosted-admission-service";
import { createHostedSourceMetadata } from "./host/hosted-convex-source-operations";
import { createHostedTokenIssuer } from "./host/hosted-token-issuer";
import { createHostedWorkOSSession } from "./host/hosted-workos-session";
import { HostedWorkspacePool } from "./host/hosted-workspace-pool";
import { createHostedWorkspaceResourceFactory } from "./host/hosted-workspace-resources";
import { createStaticWebSurface } from "./host/web-surface";
import { mountConvexProxy } from "./host/convex-proxy";
import { sweep as sweepConnectorSetupSessions } from "./connector-setup/session-store";

const HOSTED_WS_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

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
    privateKey:
      inlinePrivateKey ?? (await readSecureKeyFile(privateKeyFile as string)),
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
  const runtime = querySandboxNodeRuntime();
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
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
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
  wss.options.maxPayload = HOSTED_WS_MAX_PAYLOAD_BYTES;
  const webSocketHeaders = new WeakMap<object, Headers>();
  wss.on("headers", (headers, request) => {
    const extra = webSocketHeaders.get(request);
    if (!extra) return;
    webSocketHeaders.delete(request);
    extra.forEach((value, name) => headers.push(`${name}: ${value}`));
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
        const connectorSetup = createHostedConnectorSessionStore({
          document: resources.connectorSessionDocument,
          ownerSubject: ownerId,
          getDataSourceKind: async (id) =>
            (await metadata.getDataSource(id))?.kind ?? null,
        });
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
            dataPlaneRuntime: createHostedQueryRuntime(engine, signal),
            getServerEndpoint: () => publicOrigin,
            accessConnectionInfo: {
              endpoint: `${publicOrigin}/workspaces/${encodeURIComponent(workspaceId)}/mcp`,
              transport: "mcp",
              authentication: "Bearer",
            },
            connectorSetup,
          },
        });
        let recovery = recovered.get(resources);
        if (!recovery) {
          recovery = Promise.all([
            hosted.cleanup
              .recoverPendingBatches()
              .then(() => hosted.cleanup.run()),
            sweepConnectorSetupSessions(connectorSetup, new Date(), 0),
          ]).then(() => undefined);
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
  mountHostedMcpRoutes(app, {
    publicOrigin,
    authenticateCredential: options.authenticateCredential,
    serviceAccess,
    withPrincipalContext,
  });
  mountHostedBrowserRoutes(app, {
    publicOrigin,
    session,
    admission,
    tokens,
    withHostedContext,
  });
  app.get("/api/version", (c) =>
    c.json({
      commit: options.revision,
      convex: "cloud",
    }),
  );
  mountConvexProxy(app, upgradeWebSocket, deploymentUrl, {
    applyWebSocketHeaders: (request, headers) =>
      webSocketHeaders.set(request, headers),
    authorizeWebSocket: async (request) => {
      try {
        const identity = await session.resolve(request);
        if (identity.status !== "authenticated") {
          return Response.json(
            { error: "Authentication unavailable" },
            {
              status: identity.status === "signedout" ? 401 : 503,
              headers: { "Cache-Control": "no-store" },
            },
          );
        }
        const access = await admission.resolve({
          userId: identity.identity.subject,
          expiresAt: identity.expiresAt,
        });
        if (access.status !== "admitted") {
          return Response.json(
            { error: "Admission required" },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          );
        }
        return identity.setCookie
          ? { headers: new Headers({ "Set-Cookie": identity.setCookie }) }
          : undefined;
      } catch {
        return Response.json(
          { error: "Hosted service unavailable" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
    },
  });
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
