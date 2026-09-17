interface DesktopOAuthBridge {
  oauth?: {
    openAuthorizationUrl(url: string): Promise<void>;
  };
}

export class OAuthPopupBlockedError extends Error {
  constructor() {
    super(
      "Your browser blocked the Google sign-in window. Allow pop-ups for DashFrame and try again.",
    );
    this.name = "OAuthPopupBlockedError";
  }
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
 * window behind; a blocked popup is reported rather than silently ignored.
 */
export async function openOAuthAuthorizationUrl(url: string): Promise<void> {
  const bridge = desktopBridge();
  if (bridge) {
    if (!bridge.oauth?.openAuthorizationUrl) {
      throw new Error("Desktop browser authorization is unavailable");
    }
    await bridge.oauth.openAuthorizationUrl(url);
    return;
  }

  // `noopener` makes window.open return null even on success, so detach the
  // opener by hand after checking the popup actually exists.
  const authWindow = window.open(url, "_blank");
  if (!authWindow) throw new OAuthPopupBlockedError();
  authWindow.opener = null;
}
