/**
 * createDashframeServer — builds and starts the DashFrame WyStack server.
 *
 * Deployment-agnostic: the same factory serves all three surfaces (per the
 * Data Path & Transport Deployment spec). It binds an HTTP+WS host and returns
 * its URL + a stop handle. Callers supply the project's Drizzle DB and the
 * bind address:
 *   - desktop (Electron main): bind 127.0.0.1, port 0 → ephemeral loopback port.
 *   - `dashframe serve` (YW-73): bind a chosen addr/port standalone.
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
import { createRoutes, createWyStack } from "@wystack/server";
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
   * Optional bearer token required for every HTTP request and WS auth frame.
   * Desktop mints this per launch; standalone `dashframe serve` can remain
   * unauthenticated until its remote-bind auth policy is decided.
   */
  authToken?: string;
  /**
   * Optional native engine for the dedicated Arrow IPC data path. When supplied
   * (desktop / `dashframe serve` with the native engine), `POST /data/arrow`
   * streams `application/vnd.apache.arrow.stream` for a compiled query — the
   * binary path that never rides WyStack RPC (YW-151). Web try-it omits it: the
   * result already lives in renderer WASM, so there is no server data path.
   */
  arrowEngine?: ArrowQueryRunner;
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
  const corsOrigin = opts.corsOrigin ?? allowLocalhostOrigin;
  const resolveContext = opts.authToken
    ? createTokenResolver(opts.authToken)
    : undefined;

  const app = await createWyStack({ db: opts.db, functions });

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
