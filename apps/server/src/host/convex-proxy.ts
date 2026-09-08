import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { WebSocket } from "ws";

/** Proxy only Convex's public client protocol, never deployment/admin routes. */
export function mountConvexProxy(
  app: Hono,
  upgrade: UpgradeWebSocket,
  backendUrl: string,
  options?: {
    authorizeWebSocket?: (request: Request) => Promise<Response | undefined>;
  },
): void {
  const prefix = "/api/convex";
  for (const operation of ["query", "mutation", "action"] as const) {
    app.post(`${prefix}/api/${operation}`, async (c) => {
      const headers = new Headers({ "content-type": "application/json" });
      const authorization = c.req.header("authorization");
      // Admin credentials have a different authorization scheme. They never
      // belong on the browser-visible proxy even if supplied accidentally.
      if (authorization?.startsWith("Bearer "))
        headers.set("authorization", authorization);
      const result = await fetch(`${backendUrl}/api/${operation}`, {
        method: "POST",
        headers,
        body: c.req.raw.body,
        duplex: "half",
        signal: c.req.raw.signal,
      } as RequestInit);
      return new Response(result.body, {
        status: result.status,
        headers: {
          "content-type":
            result.headers.get("content-type") ?? "application/json",
        },
      });
    });
  }
  const authorizeWebSocket = options?.authorizeWebSocket;
  if (authorizeWebSocket) {
    app.use(`${prefix}/api/:version/sync`, async (c, next) => {
      const denied = await authorizeWebSocket(c.req.raw);
      return denied ?? next();
    });
  }
  app.get(
    `${prefix}/api/:version/sync`,
    upgrade((c) => {
      const version = c.req.param("version");
      if (!version || !/^\d+\.\d+\.\d+$/.test(version))
        throw new Error("Unsupported Convex protocol");
      const target = new URL(`/api/${version}/sync`, backendUrl);
      // Carry the backend's transport security across to the WebSocket scheme.
      // A hosted deployment is an https Convex Cloud origin, and forcing `ws:`
      // there both downgrades the hop and points at a port that is not
      // listening — the sync socket never opens and the app hangs on
      // AuthLoading. Local backends stay http/ws exactly as before.
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
      let upstream: WebSocket | undefined;
      const pending: Array<string | ArrayBuffer> = [];
      return {
        onOpen(_event, downstream) {
          upstream = new WebSocket(target, { maxPayload: 16 * 1024 * 1024 });
          upstream.on("open", () => {
            for (const data of pending) {
              upstream!.send(data);
            }
            pending.length = 0;
          });
          upstream.on("message", (data, binary) =>
            downstream.send(
              binary ? new Uint8Array(data as Buffer) : data.toString(),
            ),
          );
          upstream.on("close", () => downstream.close(1000));
          upstream.on("error", () => downstream.close(1011));
        },
        onMessage(event, downstream) {
          const data = event.data;
          if (typeof data !== "string" && !(data instanceof ArrayBuffer)) {
            downstream.close(1003);
            return;
          }
          if (upstream?.readyState === WebSocket.OPEN) upstream.send(data);
          else if (pending.length < 32) pending.push(data);
          else downstream.close(1009);
        },
        onClose() {
          upstream?.close();
        },
        onError() {
          upstream?.terminate();
        },
      };
    }),
  );
}
