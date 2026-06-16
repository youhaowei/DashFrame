/**
 * createDashframeServer — builds and starts the DashFrame WyStack server.
 *
 * Deployment-agnostic: the same factory serves all three surfaces (per the
 * Data Path & Transport Deployment spec). It binds an HTTP+WS host and returns
 * its URL + a stop handle. Callers supply the project's Drizzle DB and the
 * bind address:
 *   - desktop (Electron main): bind 127.0.0.1, port 0 → ephemeral loopback port.
 *   - `dashframe serve`: bind a chosen addr/port standalone.
 *
 * Why this inlines the Node adapter instead of calling `@wystack/server/node`'s
 * `serve()`: the renderer (a localhost web client) is a *different origin* from
 * the loopback server in dev (Vite `localhost:5173` vs `127.0.0.1:<port>`), so
 * the browser requires CORS. WyStack owns the protocol; DashFrame owns the
 * deployment — and "which origins may reach this server" is a deployment
 * concern. The generic `serve()` adapter exposes no middleware hook, so we
 * mirror its composition (`createNodeWebSocket` → `createRoutes` →
 * `nodeServe` + `injectWebSocket`) and add one `cors()` layer in front. If
 * WyStack later exposes a middleware hook, collapse back to `serve()`.
 *
 * @hono/node-server runs under both Node and Bun, so the standalone CLI and
 * tests work too. PGLite is WASM, so the DB layer is runtime-agnostic. (The
 * desktop main runs under Electron's embedded Node 20, where `Bun.serve` does
 * not exist — hence the Node adapter, never `/bun`.)
 *
 * Loopback auth is optional at the factory level because `dashframe serve`
 * still owns its separate remote-bind auth decision. Electron desktop passes a
 * per-launch bearer token, which protects both HTTP calls and WyStack's WS auth
 * frame. Packaged desktop also allows the renderer's `file://` Origin (`null`)
 * through CORS; the bearer token remains the authority.
 */
// Import from the transport-only subpath, NOT the package barrel: the barrel
// re-exports NativeDuckDBEngine, whose module top-level-imports the native
// `@duckdb/node-api` addon. The `dashframe serve` path imports this app without
// passing `arrowEngine`, so pulling the native binding eagerly would break
// startup on platforms without it. arrow-data-path has no native dependency.
import {
  createArrowDataPath,
  type ArrowQueryRunner,
} from "@dashframe/engine-server/arrow-data-path";
import type { ArtifactDb } from "@dashframe/server-core";
import { serve as nodeServe } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import {
  isSecretRef,
  type SecretRef,
  type SecretVault,
} from "@wystack/secret-vault";
import { createRoutes, createWyStack, type WyStackApp } from "@wystack/server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createHash, timingSafeEqual } from "node:crypto";

import { functions } from "./functions";
import { buildPreviewDiff } from "./functions/preview-diff";

type CorsOrigin =
  | string
  | string[]
  | ((
      origin: string,
      c: Context,
    ) => Promise<string | undefined | null> | string | undefined | null);

/**
 * Returns true when `hostname` is a loopback address (127.0.0.0/8, ::1, or
 * the "localhost" name). Loopback-only binds are reachable from this machine
 * alone; no network auth token is required. Undefined / absent hostname
 * defaults to 127.0.0.1 (loopback).
 */
function isLoopbackHost(hostname: string | undefined): boolean {
  return (
    hostname === undefined ||
    hostname === "localhost" ||
    // Entire 127.0.0.0/8 block is loopback (RFC 3330), not just 127.0.0.1.
    hostname.startsWith("127.") ||
    hostname === "::1"
  );
}

/**
 * Secure-by-default bind-auth gate. Throws when a non-loopback bind has no
 * `authToken` (and no explicit `insecure` opt-out) — a non-loopback bind
 * exposes the project to the network, so the server must not serve unauthenticated
 * traffic on it. Loopback binds (127.x / ::1 / localhost) are reachable only from
 * this machine and may omit a token (local dev, Electron). A token always allows
 * any bind.
 *
 * Extracted from `createDashframeServer` so the allow/deny decision is unit-testable
 * on its own — the security-critical token-allows-non-loopback branch can be
 * exercised without binding a real socket. Returns nothing on success; throws on a
 * disallowed bind.
 */
export function assertBindAuthorized(opts: {
  hostname: string | undefined;
  authToken: string | undefined;
  authRef?: SecretRef;
  insecure?: boolean;
}): void {
  const loopback = isLoopbackHost(opts.hostname);
  const hasAuth = Boolean(opts.authToken) || isSecretRef(opts.authRef);
  if (!loopback && !hasAuth && !opts.insecure) {
    throw new Error(
      `createDashframeServer: refusing to bind ${opts.hostname} without an auth token. ` +
        `A non-loopback bind exposes the project to the network. ` +
        `Supply authToken or authRef, or set insecure: true to opt out deliberately.`,
    );
  }
  if (opts.insecure && !hasAuth && !loopback) {
    console.warn(
      "[dashframe] warning: insecure non-loopback bind without authToken or authRef exposes this project to the network",
    );
  }
}

/** Allow localhost Vite/preview origins when a caller has not pinned CORS. */
function allowLocalhostOrigin(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    if (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      return origin;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export interface DashframeServerOptions {
  /** Project artifact DB — a Drizzle/PGLite instance (e.g. `ProjectHandle.db`). */
  db: object;
  /** Bind host. Default `127.0.0.1` (loopback). */
  hostname?: string;
  /** Bind port. Default `0` — the OS assigns an ephemeral port. */
  port?: number;
  /**
   * Allowed CORS origin(s) for the renderer. Defaults to local Vite/preview
   * origins (`localhost` / `127.0.0.1`) for dev and smoke verification.
   */
  corsOrigin?: CorsOrigin;
  /**
   * Bearer token required for every HTTP request and WS auth frame when the
   * server is bound to a non-loopback address. Desktop mints this per launch.
   * Loopback binds (127.x / ::1 / localhost) may omit the token.
   *
   * Security: omitting this on a non-loopback bind causes `createDashframeServer`
   * to throw. Pass `insecure: true` to deliberately opt out of this requirement.
   *
   * Kept for backward compat — existing tests and `dashframe serve` pass
   * plaintext here. Prefer `authRef` + `vault` for new surfaces.
   */
  authToken?: string;
  /**
   * Vault-backed alternative to `authToken`. When both `authRef` and `vault`
   * are present the server resolves the expected token from the vault at each
   * request's auth gate — no plaintext token is stored in a server field.
   *
   * `authToken` is ignored when this pair is set. Satisfies the non-loopback
   * auth gate in the same way a plaintext `authToken` does.
   */
  authRef?: SecretRef;
  /**
   * Opt out of the non-loopback auth requirement. Use only in controlled
   * environments where the network exposure is intentional. The factory will
   * log a warning when this is set with a non-loopback bind and no token.
   */
  insecure?: boolean;
  /**
   * Optional native engine for the dedicated Arrow IPC data path. When supplied
   * (desktop / `dashframe serve` with the native engine), `POST /data/arrow`
   * streams `application/vnd.apache.arrow.stream` for a compiled query — the
   * binary path that never rides WyStack RPC. Web try-it omits it: the
   * result already lives in renderer WASM, so there is no server data path.
   */
  arrowEngine?: ArrowQueryRunner;
  /**
   * Optional hook fired after every SUCCESSFUL artifact-DB write mutation.
   * Called once per committed write (after the DB transaction commits, never
   * on a failed or rolled-back write). The host owns the semantics — desktop
   * passes `() => project?.touchSnapshot()` to drive the debounced snapshot
   * scheduler (#88); other surfaces may omit it entirely.
   *
   * The server does NOT import or depend on ProjectHandle — this narrow
   * callback is the dependency boundary (same injection pattern as
   * `arrowEngine`).
   */
  onWrite?: () => void;
  /**
   * Secret vault for credential storage. The runtime composer (Electron main
   * or `dashframe serve`) registers a backend into a SecretRegistry, builds a
   * SecretVault, and injects it here. The server itself never picks or
   * instantiates a backend — it RECEIVES a fully-composed vault.
   *
   * When supplied, control-plane write mutations (create/update DataSource)
   * call `vault.store(plaintext, { class: "connector-key" }) → ref` instead
   * of persisting the plaintext. Read mutations use `vault.has(ref)` for
   * presence checks (hasApiKey / hasConnectionString).
   *
   * Optional at the factory level — omitting it falls back to the legacy
   * plaintext-in-config path (pre-vault callers, tests that don't exercise
   * the credential boundary). Desktop always injects the keychain vault.
   */
  vault?: SecretVault;
}

export interface DashframeServer {
  /**
   * Base origin the renderer points its WyStack client at, e.g.
   * `http://127.0.0.1:53017`. The client appends its own route prefix
   * (`/api`), so this URL must NOT include it.
   */
  url: string;
  /** Bound port (resolved when `port: 0`). */
  port: number;
  /** Stop the HTTP+WS host. */
  stop(): void;
}

export async function createDashframeServer(
  opts: DashframeServerOptions,
): Promise<DashframeServer> {
  const hostname = opts.hostname ?? "127.0.0.1";
  const requestedPort = opts.port ?? 0;

  // Secure-by-default: refuse to start an unauthenticated server on a
  // non-loopback bind. Runs before any socket bind, so a disallowed config
  // never opens a listener. See assertBindAuthorized for the full rationale.
  assertBindAuthorized({
    hostname,
    authToken: opts.authToken,
    authRef: opts.authRef,
    insecure: opts.insecure,
  });

  const corsOrigin = opts.corsOrigin ?? allowLocalhostOrigin;

  // Resolve the auth context builder: vault-backed ref takes priority over
  // plaintext token. Both produce the same (req) → context shape for WyStack.
  //
  // Defensive invariant: authRef requires vault — the ref is meaningless
  // without the mapping store and backend. A missing vault silently falls
  // through to unauthenticated without this guard; fail loudly instead.
  if (opts.authRef && !opts.vault) {
    throw new Error(
      "createDashframeServer: authRef requires vault — supply a SecretVault " +
        "instance when using vault-backed auth.",
    );
  }
  let resolveContext:
    | ((req: Request) => Promise<Record<string, unknown>>)
    | undefined;
  if (opts.authRef && opts.vault) {
    resolveContext = createVaultTokenResolver(opts.authRef, opts.vault);
  } else if (opts.authToken) {
    resolveContext = createTokenResolver(opts.authToken);
  }

  const rawApp = await createWyStack({ db: opts.db, functions });

  // Wrap the WyStack app to inject the vault into every handler context and
  // to fire `opts.onWrite` after every successful mutation.
  //
  // Vault injection: the vault is a static server-level dependency — the same
  // SecretVault instance for the entire server lifetime. It is injected at the
  // `call`/`runHandler` level (not per-request via resolveContext) because it
  // does not vary per request and the INVARIANT is that the server RECEIVES a
  // fully-composed vault rather than building one itself.
  //
  // `vault` wins over per-request context (static spread LAST so its keys
  // cannot be shadowed by a crafted request context). `ctx.vault` is what
  // handlers read via `(ctx.vault as SecretVault | undefined)`.
  //
  // onWrite: fires after every committed write mutation (tablesWritten.size > 0).
  // Runs AFTER `call` commits — a throw must NOT fail the mutation, so errors
  // are logged and swallowed.
  const { vault, onWrite } = opts;

  // Build the static context additions once so every call shares the same object
  // reference (vault identity is stable for the server lifetime).
  const staticContext: Record<string, unknown> = vault != null ? { vault } : {};
  const hasStaticContext = Object.keys(staticContext).length > 0;

  const app: WyStackApp =
    vault == null && onWrite == null
      ? rawApp
      : {
          ...rawApp,
          async call(path, args, context) {
            // Static context wins over per-request context: spread per-request
            // first so that static keys (vault) cannot be shadowed by a crafted
            // request context. The vault identity must be fixed for the server
            // lifetime; a request-supplied vault key would be ignored.
            const merged = hasStaticContext
              ? { ...(context ?? {}), ...staticContext }
              : context;
            const result = await rawApp.call(path, args, merged);
            if (onWrite != null && result.tablesWritten.size > 0) {
              try {
                onWrite();
              } catch (err) {
                console.error("[dashframe] onWrite hook threw:", err);
              }
            }
            return result;
          },
          async runHandler(path, args, tracked, context) {
            const merged = hasStaticContext
              ? { ...(context ?? {}), ...staticContext }
              : context;
            return rawApp.runHandler(path, args, tracked, merged);
          },
        };

  // Mirror @wystack/server/node's serve() composition, adding CORS in front.
  const honoApp = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({
    app: honoApp,
  });
  honoApp.use(
    "*",
    cors({
      origin: corsOrigin,
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );
  // Mount the dedicated Arrow IPC data path *before* the WyStack catch-all
  // route, so `/data/arrow` is served by the binary path, not WyStack. This is
  // the hard metadata/data boundary: WyStack frames never carry Arrow bytes.
  if (opts.arrowEngine) {
    honoApp.route(
      "/data",
      createArrowDataPath({
        engine: opts.arrowEngine,
        ...(opts.authRef && opts.vault
          ? { authRef: opts.authRef, vault: opts.vault }
          : { authToken: opts.authToken }),
      }),
    );
  }

  // Preview batch endpoint — SPLIT-TIER (settled): returns METADATA ONLY.
  // No row data, no compute slots — those are filled client-side via local DuckDB.
  // Mounted before WyStack so `/preview/batch` isn't shadowed by the catch-all.
  honoApp.route(
    "/preview",
    createPreviewPath({
      app,
      db: opts.db as ArtifactDb,
      authToken: opts.authToken,
    }),
  );

  honoApp.route("/", createRoutes({ app, resolveContext }, upgradeWebSocket));

  const { port, server } = await listen(honoApp, hostname, requestedPort);
  injectWebSocket(server);

  return {
    url: `http://${hostname}:${port}`,
    port,
    stop: () => server.close(),
  };
}

/**
 * Start the Node HTTP server and resolve once it is listening, with the bound
 * port (the OS-assigned one when `requestedPort` is 0).
 */
function listen(
  honoApp: Hono,
  hostname: string,
  requestedPort: number,
): Promise<{ port: number; server: ReturnType<typeof nodeServe> }> {
  return new Promise((resolve, reject) => {
    const server = nodeServe(
      { fetch: honoApp.fetch, hostname, port: requestedPort },
      (info) => resolve({ port: info.port, server }),
    );
    // Without this, a bind failure leaves the promise unsettled — the listen
    // callback never fires, createDashframeServer hangs, and main's try/catch
    // never sees a throw. Surface it so startup fails loudly instead.
    server.on("error", reject);
  });
}

function createTokenResolver(
  expectedToken: string,
): (req: Request) => Promise<Record<string, unknown>> {
  return async (req) => {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ")
      ? auth.slice("Bearer ".length)
      : "";
    if (!tokenMatches(token, expectedToken)) {
      throw new Error("Unauthorized");
    }
    return {};
  };
}

/**
 * Vault-backed token resolver. Resolves the expected token from the vault at
 * each request — no plaintext is held in a server field. Returned resolver has
 * the same signature as the one returned by `createTokenResolver`.
 *
 * FAIL-CLOSED: any failure to resolve the expected token (missing/corrupt
 * keychain blob, vault error) denies the request. The throw propagates to
 * WyStack's route handler, which maps it to 401 — never a 500 that would leak
 * the vault state, and never an allow.
 */
function createVaultTokenResolver(
  authRef: SecretRef,
  vault: SecretVault,
): (req: Request) => Promise<Record<string, unknown>> {
  return async (req) => {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ")
      ? auth.slice("Bearer ".length)
      : "";
    let authorized = false;
    try {
      authorized = await vault.withSecret(authRef, async (expected) =>
        tokenMatches(token, expected),
      );
    } catch {
      // Resolution failed — cannot confirm the token, so deny. Fall through to
      // the Unauthorized throw below (→ 401), never surface a 500 or allow.
      authorized = false;
    }
    if (!authorized) {
      throw new Error("Unauthorized");
    }
    return {};
  };
}

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = createHash("sha256").update(actual).digest();
  const expectedBytes = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualBytes, expectedBytes);
}

/**
 * Hono sub-app for the preview batch endpoint.
 *
 * `POST /batch` accepts a JSON body `{ commands: Command[] }` and returns a
 * `PreviewDiff` (METADATA ONLY — compute slots are always `undefined`). The
 * diff carries the split-tier invariant: no row data, no head samples. Clients
 * fill the compute slot locally via DuckDB-WASM on preview-open.
 *
 * Auth reuses the same optional bearer token as the WyStack server.
 */
function createPreviewPath(opts: {
  app: WyStackApp;
  db: ArtifactDb;
  authToken?: string;
}): Hono {
  const { app, db, authToken } = opts;
  const hono = new Hono();

  hono.post("/batch", async (c) => {
    // Auth guard — same policy as the WyStack server (loopback may omit token).
    if (authToken) {
      const auth = c.req.header("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!tokenMatches(token, authToken)) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (
      !body ||
      typeof body !== "object" ||
      !Array.isArray((body as { commands?: unknown }).commands)
    ) {
      return c.json({ error: "Expected { commands: Command[] }" }, 400);
    }

    const { commands } = body as { commands: unknown[] };

    // Validate each command has a path (minimal guard — handler validation does
    // the rest inside applyCommands).
    for (const cmd of commands) {
      if (
        !cmd ||
        typeof cmd !== "object" ||
        typeof (cmd as { path?: unknown }).path !== "string"
      ) {
        return c.json({ error: "Each command must have a string `path`" }, 400);
      }
    }

    try {
      const diff = await buildPreviewDiff(
        app,
        db,
        commands as Array<{ path: string; args: unknown }>,
      );
      return c.json(diff);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 500);
    }
  });

  return hono;
}

export type { Functions } from "./functions";
