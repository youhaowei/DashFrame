import type { ServerInfo } from "@dashframe/desktop-types";

/** The IPC bridge main exposes on the renderer's window. */
export interface DesktopBridge {
  getServerInfo(): Promise<ServerInfo>;
}

/**
 * Resolves which host this renderer talks to, and the credential for it.
 *
 * Fails closed: a bridge that is missing, or one that hands back no token,
 * must stop startup rather than let the client fall through to an
 * unauthenticated handshake against the loopback server.
 */
export async function resolveDesktopHost(
  bridge: DesktopBridge | undefined,
): Promise<{ url: string; token: string }> {
  if (!bridge)
    throw new Error("Desktop IPC bridge is unavailable in this renderer");
  const { url, token } = await bridge.getServerInfo();
  if (!url) throw new Error("Desktop server info omitted its host URL");
  if (!token) throw new Error("Desktop server info omitted its loopback token");
  return { url, token };
}
