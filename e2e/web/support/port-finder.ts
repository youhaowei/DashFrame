import * as net from "net";

/**
 * Finds an available port starting from the given port number.
 * In CI, returns the start port without checking.
 * Locally, tries sequential ports until finding an available one.
 *
 * @param startPort - Port number to start searching from (default: 3100)
 * @returns Available port number
 */
export function findAvailablePortSync(startPort: number = 3100): number {
  // In CI, don't check for available ports - just use the start port
  if (process.env.CI) {
    return startPort;
  }

  // Try sequential ports locally (avoid conflicts with dev:3000, worktrees, etc.)
  for (let port = startPort; port < startPort + 20; port++) {
    try {
      const server = net.createServer();
      server.listen(port, "127.0.0.1");
      server.close();
      return port;
    } catch {
      // Port in use, try next one
      continue;
    }
  }

  // Fallback to start port if all ports busy
  return startPort;
}
