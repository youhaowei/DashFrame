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
 * No auth is wired here. The loopback token mechanism is an open spec decision
 * (Data Path & Transport Deployment § Open Questions) and out of scope for the
 * v0.2 integration smoke (YW-69) — single-user trunk treats auth as a no-op.
 * Production CORS (renderer loaded from `file://`) defers with that auth item;
 * dev allows only the Vite origin below.
 */
import { serve as nodeServe } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { createRoutes, createWyStack } from "@wystack/server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";

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
   * Production (renderer from `file://`) is not yet handled — see file header.
   */
  corsOrigin?: CorsOrigin;
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

  const app = await createWyStack({ db: opts.db, functions });

  // Mirror @wystack/server/node's serve() composition, adding CORS in front.
  const honoApp = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({
    app: honoApp,
  });
  honoApp.use("*", cors({ origin: corsOrigin }));
  honoApp.route("/", createRoutes({ app }, upgradeWebSocket));

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

export type { Functions } from "./functions";
