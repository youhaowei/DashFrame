interface DesktopOAuthBridge {
  oauth?: {
    openAuthorizationUrl(url: string): Promise<void>;
  };
}

function desktopBridge(): DesktopOAuthBridge | undefined {
  return (
    window as typeof window & {
      dashframe?: DesktopOAuthBridge;
    }
  ).dashframe;
}

/**
 * Open an issued authorization URL. Electron never embeds Google: main opens
 * the URL in the user's default system browser. The web opens a popup only
 * once the server has issued the URL, so a setup failure never leaves a blank
 * window behind.
 *
 * Resolves false when the browser handed back no window. That is not proof
 * nothing opened: browsers embedded in other apps return null and still load
 * the URL, sometimes in this very tab. The caller keeps the session alive and
 * offers the URL as a link instead of treating it as a failure.
 */
export async function openOAuthAuthorizationUrl(url: string): Promise<boolean> {
  const bridge = desktopBridge();
  if (bridge) {
    if (!bridge.oauth?.openAuthorizationUrl) {
      throw new Error("Desktop browser authorization is unavailable");
    }
    await bridge.oauth.openAuthorizationUrl(url);
    return true;
  }

  // `noopener`/`noreferrer` make window.open return null even on success,
  // which would hide a blocked popup. Detach the opener by hand instead; the
  // page's referrer policy governs what Google sees.
  const authWindow = window.open(url, "_blank");
  if (!authWindow) return false;
  authWindow.opener = null;
  return true;
}
