import type { ServerType } from "@hono/node-server";
import type { Socket } from "node:net";

/** Stop accepting requests and force owned transports closed before disposing services. */
export async function closeHostServer(
  server: ServerType,
  clients: Iterable<{ terminate(): void }>,
  sockets: ReadonlySet<Socket>,
): Promise<void> {
  // Bun's node:http close() discards the underlying server handle, making a
  // subsequent closeAllConnections() a no-op. With an upgraded WebSocket its
  // graceful close callback can remain pending even after socket.destroy().
  // Force-close directly on Bun; Node keeps its normal close callback barrier.
  const bun = typeof process.versions.bun === "string";
  const closed = bun
    ? undefined
    : new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  const transports = [...sockets].map(
    (socket) => new Promise<void>((resolve) => socket.once("close", resolve)),
  );
  if (bun) {
    if (!("closeAllConnections" in server))
      throw new Error("Bun host does not support forced connection shutdown");
    server.closeAllConnections();
  }
  for (const client of clients) client.terminate();
  for (const socket of sockets) socket.destroy();
  if (!bun && "closeAllConnections" in server) server.closeAllConnections();
  await Promise.all([closed, ...transports]);
}
