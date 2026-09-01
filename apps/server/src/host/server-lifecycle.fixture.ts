import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { closeHostServer } from "./server-lifecycle";
import { mountConvexProxy } from "./convex-proxy";

export async function exerciseHostShutdown(
  beforeShutdown?: () => Promise<void>,
): Promise<void> {
  const backend = await launch(() => new Response("ok"));
  const upstream = new WebSocketServer({ server: backend.server });
  upstream.on("connection", (ws) => ws.send("ready"));
  const app = new Hono();
  app.get("/", (c) => c.text("ok"));
  const { upgradeWebSocket, injectWebSocket, wss } = createNodeWebSocket({
    app,
  });
  mountConvexProxy(app, upgradeWebSocket, backend.url);
  const host = await launch(app.fetch);
  injectWebSocket(host.server);
  let browser: WebSocket | undefined;
  try {
    await fetch(host.url).then((response) => response.text());
    browser = new WebSocket(
      `${host.url.replace("http:", "ws:")}/api/convex/api/1.37.0/sync`,
    );
    const browserClosed = new Promise<void>((resolve) =>
      browser!.once("close", resolve),
    );
    await new Promise<void>((resolve, reject) => {
      browser!.once("message", () => resolve());
      browser!.once("error", reject);
    });
    if (wss.clients.size !== 1 || host.sockets.size < 1)
      throw new Error("WebSocket fixture did not connect");
    await beforeShutdown?.();
    await closeHostServer(host.server, wss.clients, host.sockets);
    await browserClosed;
    if (host.sockets.size !== 0 || [...wss.clients].length !== 0)
      throw new Error("Host sockets survived shutdown");
    // Rebinding proves the listener has actually released its port.
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(host.port, "127.0.0.1", resolve);
    });
    await new Promise<void>((resolve) => probe.close(() => resolve()));
  } finally {
    browser?.terminate();
    await closeHostServer(backend.server, upstream.clients, backend.sockets);
  }
}

async function launch(fetch: Parameters<typeof serve>[0]["fetch"]) {
  const sockets = new Set<Socket>();
  return new Promise<{
    server: Server;
    sockets: Set<Socket>;
    port: number;
    url: string;
  }>((resolve, reject) => {
    const server = serve({ fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
      resolve({
        server,
        sockets,
        port: info.port,
        url: `http://127.0.0.1:${info.port}`,
      }),
    ) as Server;
    server.on("error", reject);
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
  });
}

if (import.meta.main) {
  await exerciseHostShutdown(
    process.argv.includes("--signal")
      ? () =>
          new Promise<void>((resolve) => {
            process.once("SIGTERM", resolve);
            console.log("Ready for SIGTERM");
          })
      : undefined,
  );
  console.log("Host and upstream closed; listener port reusable");
}
