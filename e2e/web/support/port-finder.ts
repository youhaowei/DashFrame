import * as net from "net";

/**
 * Finds an available port starting from the given port number.
 * In CI, returns the start port without checking.
 *
 * @param startPort - Port number to start searching from (default: 3100)
 * @returns Available port number
 */
export async function findAvailablePort(
  startPort: number = 3100,
): Promise<number> {
  if (process.env.CI) return startPort;

  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortFree(port)) return port;
  }
  return startPort;
}

/**
 * Find a base port such that [base, base+count) are all free.
 * Used by the local E2E config to reserve one port per worker without
 * collision-by-assumption (P2 finding from PR #34 review).
 */
export async function findAvailablePortBlock(
  startPort: number,
  count: number,
): Promise<number> {
  if (process.env.CI) return startPort;

  for (let base = startPort; base < startPort + 200; base++) {
    let blockFree = true;
    for (let i = 0; i < count; i++) {
      if (!(await isPortFree(base + i))) {
        blockFree = false;
        break;
      }
    }
    if (blockFree) return base;
  }
  throw new Error(
    `Could not find ${count} contiguous free ports starting near ${startPort}`,
  );
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}
