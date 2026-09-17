import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { openOAuthAuthorizationUrl } from "./oauth-authorization-target";

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

afterEach(() => {
  Reflect.deleteProperty(window, "dashframe");
  vi.restoreAllMocks();
});

describe("openOAuthAuthorizationUrl", () => {
  it("uses the Electron bridge without opening an embedded window", async () => {
    const openAuthorizationUrl = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "dashframe", {
      configurable: true,
      value: { oauth: { openAuthorizationUrl } },
    });
    const windowOpen = vi.spyOn(window, "open");

    await openOAuthAuthorizationUrl(AUTHORIZE_URL);

    expect(windowOpen).not.toHaveBeenCalled();
    expect(openAuthorizationUrl).toHaveBeenCalledExactlyOnceWith(AUTHORIZE_URL);
  });

  it("fails closed instead of falling back to an embedded desktop window", async () => {
    Object.defineProperty(window, "dashframe", {
      configurable: true,
      value: {},
    });
    const windowOpen = vi.spyOn(window, "open");

    await expect(openOAuthAuthorizationUrl(AUTHORIZE_URL)).rejects.toThrow(
      "Desktop browser authorization is unavailable",
    );
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("opens the issued URL directly in a detached web popup", async () => {
    const popup = { opener: window } as unknown as Window;
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(popup);

    await expect(openOAuthAuthorizationUrl(AUTHORIZE_URL)).resolves.toBe(true);

    expect(windowOpen).toHaveBeenCalledExactlyOnceWith(AUTHORIZE_URL, "_blank");
    expect(popup.opener).toBeNull();
  });

  it("reports when the browser hands back no window", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);

    await expect(openOAuthAuthorizationUrl(AUTHORIZE_URL)).resolves.toBe(false);
  });
});
