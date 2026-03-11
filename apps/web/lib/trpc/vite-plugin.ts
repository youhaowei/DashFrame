import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";

/** Read the full request body from a Node IncomingMessage. */
function readBody(req: IncomingMessage) {
  return new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
  });
}

/** Convert a Node IncomingMessage into a Web Request. */
function toWebRequest(
  req: IncomingMessage & { originalUrl?: string },
  body: string | undefined,
) {
  const host = req.headers.host ?? "localhost:3000";
  const url = new URL(req.originalUrl ?? req.url ?? "/", `http://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
  }

  return new Request(url.toString(), {
    method: req.method,
    headers,
    body: body ?? undefined,
  });
}

/** Write a Web Response back to a Node ServerResponse. */
function writeResponse(res: ServerResponse, response: Response, body: string) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(body);
}

/**
 * Vite plugin that mounts tRPC as dev server middleware.
 *
 * In SPA mode, TanStack Start doesn't have a server — so we handle
 * tRPC requests via Vite's dev server middleware. In production (Tauri),
 * tRPC will be handled by the Bun sidecar server instead.
 *
 * Uses `server.ssrLoadModule` instead of bare `import()` so that workspace
 * packages exporting raw TypeScript are transformed through Vite's pipeline
 * (Node's native ESM loader can't resolve extensionless .ts imports).
 */
/** Handle a single tRPC request using Vite's SSR module loader. */
async function handleTrpcRequest(
  viteServer: ViteDevServer,
  req: IncomingMessage & { originalUrl?: string },
  res: ServerResponse,
) {
  const { appRouter } = await viteServer.ssrLoadModule(
    "./lib/trpc/routers/_app",
  );
  const { fetchRequestHandler } = await viteServer.ssrLoadModule(
    "@trpc/server/adapters/fetch",
  );

  const body = req.method === "POST" ? await readBody(req) : undefined;
  const request = toWebRequest(req, body);

  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: () => ({
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [k, v]),
      ),
    }),
  });

  writeResponse(res, response, await response.text());
}

export function trpcDevServer(): Plugin {
  return {
    name: "trpc-dev-server",
    configureServer(server) {
      server.middlewares.use("/api/trpc", async (req, res) => {
        await handleTrpcRequest(
          server,
          req as IncomingMessage,
          res as ServerResponse,
        );
      });
    },
  };
}
