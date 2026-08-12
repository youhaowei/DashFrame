interface DesktopOAuthBridge {
  oauth?: {
    openAuthorizationUrl(url: string): Promise<void>;
  };
}

export interface OAuthAuthorizationTarget {
  kind: "system-browser" | "popup";
  open(url: string): Promise<void>;
  close(): void;
}

function desktopBridge(): DesktopOAuthBridge | undefined {
  return (
    window as typeof window & {
      dashframe?: DesktopOAuthBridge;
    }
  ).dashframe;
}

/**
 * Reserve the correct authorization surface synchronously from the click.
 * Web needs a placeholder popup to satisfy popup policy. Electron never embeds
 * Google: main opens the issued URL in the user's default system browser.
 */
export function createOAuthAuthorizationTarget(): OAuthAuthorizationTarget | null {
  const bridge = desktopBridge();
  if (bridge) {
    return {
      kind: "system-browser",
      async open(url) {
        if (!bridge.oauth?.openAuthorizationUrl) {
          throw new Error("Desktop browser authorization is unavailable");
        }
        await bridge.oauth.openAuthorizationUrl(url);
      },
      close() {},
    };
  }

  const authWindow = window.open("about:blank", "_blank");
  if (!authWindow) return null;
  authWindow.opener = null;
  authWindow.document.head.innerHTML =
    '<meta name="referrer" content="no-referrer">';
  authWindow.document.body.textContent = "Preparing Google authorization…";

  return {
    kind: "popup",
    async open(url) {
      authWindow.location.replace(url);
    },
    close() {
      authWindow.close();
    },
  };
}
