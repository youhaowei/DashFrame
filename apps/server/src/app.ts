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
import { serve as nodeServe } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createRoutes, createWyStack, type WyStackApp } from "@wystack/server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createHash, timingSafeEqual } from "node:crypto";

import { functions } from "./functions";

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
   */
  authToken?: string;
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
  // non-loopback bind. A non-loopback bind exposes the project to the network;
  // without a token every request is implicitly trusted by the server.
  // Loopback (127.x / ::1 / localhost) is reachable only from this machine and
  // may omit a token (local dev, Electron). Pass `insecure: true` to opt out.
  if (!isLoopbackHost(hostname) && !opts.authToken && !opts.insecure) {
    throw new Error(
      `createDashframeServer: refusing to bind ${hostname} without an auth token. ` +
        `A non-loopback bind exposes the project to the network. ` +
        `Supply authToken, or set insecure: true to opt out deliberately.`,
    );
  }
  if (opts.insecure && !opts.authToken && !isLoopbackHost(hostname)) {
    console.warn(
      "[dashframe] warning: insecure non-loopback bind without authToken exposes this project to the network",
    );
  }
  const corsOrigin = opts.corsOrigin ?? allowLocalhostOrigin;
  const resolveContext = opts.authToken
    ? createTokenResolver(opts.authToken)
    : undefined;

  const rawApp = await createWyStack({ db: opts.db, functions });

  // Wrap the WyStack app's `call` method so `opts.onWrite` fires after any
  // successful mutation. This is the single chokepoint: both the HTTP POST
  // handler and the WS `call` frame path in @wystack/server route every
  // mutation through `app.call`. Wrapping here — rather than sprinkling calls
  // across individual handlers — means a new command or mutation added later
  // is covered automatically. The hook fires only on success (tablesWritten
  // is the WyStack signal that the transaction committed a write); a failed or
  // rolled-back call never sets tablesWritten and never reaches this branch.
  //
  // `onWrite` runs AFTER `rawApp.call` has already committed, so a throw from it
  // must NOT fail the mutation — the client would see an error for a write that
  // durably succeeded and might retry, duplicating artifacts. The hook is a
  // best-effort side-channel (it only schedules a debounced snapshot), so we
  // isolate its failure: log and swallow, never propagate. `result` is returned
  // unchanged so the committed call's success is the sole determinant of the
  // response.
  const onWrite = opts.onWrite;
  const app: WyStackApp =
    onWrite == null
      ? rawApp
      : {
          ...rawApp,
          async call(path, args, context) {
            const result = await rawApp.call(path, args, context);
            if (result.tablesWritten.size > 0) {
              try {
                onWrite();
              } catch (err) {
                console.error("[dashframe] onWrite hook threw:", err);
              }
            }
            return result;
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
        authToken: opts.authToken,
      }),
    );
  }

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

function tokenMatches(actual: string, expected: string): boolean {
  const actualBytes = createHash("sha256").update(actual).digest();
  const expectedBytes = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualBytes, expectedBytes);
}

export type { Functions } from "./functions";
