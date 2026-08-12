import { afterEach, describe, expect, it, vi } from "vitest";

import { createOAuthAuthorizationTarget } from "./oauth-authorization-target";

afterEach(() => {
  Reflect.deleteProperty(window, "dashframe");
  vi.restoreAllMocks();
});

describe("createOAuthAuthorizationTarget", () => {
  it("uses the Electron bridge without opening an embedded window", async () => {
    const openAuthorizationUrl = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "dashframe", {
      configurable: true,
      value: { oauth: { openAuthorizationUrl } },
    });
    const windowOpen = vi.spyOn(window, "open");

    const target = createOAuthAuthorizationTarget();
    await target?.open("https://accounts.google.com/o/oauth2/v2/auth");

    expect(target?.kind).toBe("system-browser");
    expect(windowOpen).not.toHaveBeenCalled();
    expect(openAuthorizationUrl).toHaveBeenCalledExactlyOnceWith(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
  });

  it("fails closed instead of falling back to an embedded desktop window", async () => {
    Object.defineProperty(window, "dashframe", {
      configurable: true,
      value: {},
    });
    const windowOpen = vi.spyOn(window, "open");

    const target = createOAuthAuthorizationTarget();

    await expect(target?.open("https://accounts.google.com")).rejects.toThrow(
      "Desktop browser authorization is unavailable",
    );
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it("reserves and navigates a popup for the web host", async () => {
    const replace = vi.fn();
    const close = vi.fn();
    const popup = {
      opener: window,
      document: {
        head: { innerHTML: "" },
        body: { textContent: "" },
      },
      location: { replace },
      close,
    } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(popup);

    const target = createOAuthAuthorizationTarget();
    await target?.open("https://accounts.google.com/o/oauth2/v2/auth");
    target?.close();

    expect(target?.kind).toBe("popup");
    expect(popup.opener).toBeNull();
    expect(popup.document.body.textContent).toBe(
      "Preparing Google authorization…",
    );
    expect(replace).toHaveBeenCalledExactlyOnceWith(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns null when the web popup is blocked", () => {
    vi.spyOn(window, "open").mockReturnValue(null);

    expect(createOAuthAuthorizationTarget()).toBeNull();
  });
});
