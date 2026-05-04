import * as net from "net";

/**
 * Finds an available port starting from the given port number.
 * In CI, returns the start port without checking.
 * Locally, tries sequential ports until finding an available one.
 *
 * @param startPort - Port number to start searching from (default: 3100)
 * @returns Available port number
 */
export async function findAvailablePort(
  startPort: number = 3100,
): Promise<number> {
  // In CI, don't check for available ports - just use the start port
  if (process.env.CI) {
    return startPort;
  }

  // Try sequential ports locally (avoid conflicts with dev:3000, worktrees, etc.)
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortFree(port)) return port;
  }

  // Fallback to start port if all ports busy
  return startPort;
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
