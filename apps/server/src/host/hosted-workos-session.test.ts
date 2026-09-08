import { unsealData } from "iron-session";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createHostedWorkOSSession,
  type HostedWorkOSSdk,
  type HostedWorkOSVerifier,
} from "./hosted-workos-session";

const origin = "https://dashframe.example.test";
// oxlint-disable-next-line sonarjs/no-hardcoded-passwords -- Synthetic encryption fixture, never a live credential.
const cookiePassword = "synthetic-cookie-password-32-chars";
const options = {
  clientId: "client_test",
  issuer: "https://api.workos.com/",
  apiKey: "sk_synthetic",
  cookiePassword,
  publicOrigin: origin,
};

function cookieValue(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`${name}=([^;]*)`));
  if (!match?.[1]) throw new Error(`Missing ${name}`);
  return decodeURIComponent(match[1]);
}

function request(
  path: string,
  cookie?: string,
  method = "GET",
  requestOrigin?: string,
) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  if (requestOrigin) headers.set("origin", requestOrigin);
  return new Request(`${origin}${path}`, { method, headers });
}

function fixture() {
  let loaded: ReturnType<HostedWorkOSSdk["loadSealedSession"]> = {
    authenticate: async () => ({ authenticated: false }),
    refresh: async () => ({ authenticated: false, retryable: false }),
  };
  const authenticateWithCode = vi.fn(async () => ({
    accessToken: "access-from-exchange",
    sealedSession: "sealed-app-session",
  }));
  const sdk: HostedWorkOSSdk = {
    getAuthorizationUrlWithPKCE: vi.fn(async () => ({
      url: "https://api.workos.com/user_management/authorize?state=state-a",
      state: "state-a",
      codeVerifier: "verifier-a",
    })),
    authenticateWithCode,
    loadSealedSession: vi.fn(() => loaded),
  };
  const verifier: HostedWorkOSVerifier = {
    verify: vi.fn(async () => ({
      identity: { subject: "verified-user" },
      expiresAt: 2_000_000,
    })),
  };
  return {
    session: createHostedWorkOSSession(options, { sdk, verifier }),
    sdk,
    verifier,
    authenticateWithCode,
    load(value: typeof loaded) {
      loaded = value;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("hosted WorkOS browser session", () => {
  it("seals ten-minute PKCE state and exchanges only the matching callback", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const h = fixture();
    const login = await h.session.login();
    expect(login.status).toBe(302);
    expect(login.headers.get("cache-control")).toBe("no-store");
    expect(login.headers.get("location")).toContain("api.workos.com");
    const setCookie = login.headers.get("set-cookie")!;
    expect(setCookie).toContain("__Host-dashframe-workos-pkce=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=600");
    const sealed = cookieValue(setCookie, "__Host-dashframe-workos-pkce");
    await expect(
      // oxlint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberately incorrect synthetic fixture password.
      unsealData(sealed, { password: "wrong-password-that-is-long-enough" }),
    ).resolves.toEqual({});

    const callback = await h.session.callback(
      new Request(
        // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- Reproduces the trusted TLS proxy's internal transport URL.
        "http://0.0.0.0:8080/auth/callback?code=code-a&state=state-a",
        {
          headers: {
            cookie: `__Host-dashframe-workos-pkce=${encodeURIComponent(sealed)}`,
          },
        },
      ),
    );
    expect(h.authenticateWithCode).toHaveBeenCalledWith({
      clientId: "client_test",
      code: "code-a",
      codeVerifier: "verifier-a",
      session: { sealSession: true, cookiePassword },
    });
    expect(h.verifier.verify).toHaveBeenCalledWith("access-from-exchange");
    expect(callback.status).toBe(302);
    expect(callback.headers.get("cache-control")).toBe("no-store");
    expect(callback.headers.get("location")).toBe(`${origin}/`);
    const callbackCookies = callback.headers.getSetCookie();
    expect(callbackCookies).toHaveLength(2);
    expect(callbackCookies[0]).toContain("Max-Age=0");
    expect(callbackCookies[1]).toContain(
      "__Host-dashframe-workos-session=sealed-app-session",
    );
    expect(await callback.text()).not.toContain("access-from-exchange");
    expect(await callback.text()).not.toContain("verified-user");
    expect(JSON.stringify([...callback.headers])).not.toContain(
      "access-from-exchange",
    );
  });

  it("rejects tampered, mismatched and expired PKCE cookies before exchange", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    for (const mode of ["tampered", "mismatched", "expired"] as const) {
      const h = fixture();
      const login = await h.session.login();
      let sealed = cookieValue(
        login.headers.get("set-cookie")!,
        "__Host-dashframe-workos-pkce",
      );
      let state = "state-a";
      if (mode === "tampered") {
        const index = Math.floor(sealed.length / 2);
        sealed = `${sealed.slice(0, index)}${sealed[index] === "a" ? "b" : "a"}${sealed.slice(index + 1)}`;
      }
      if (mode === "mismatched") state = "state-b";
      if (mode === "expired") vi.spyOn(Date, "now").mockReturnValue(1_600_001);
      const response = await h.session.callback(
        request(
          `/auth/callback?code=code-a&state=${state}`,
          `__Host-dashframe-workos-pkce=${encodeURIComponent(sealed)}`,
        ),
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(h.authenticateWithCode).not.toHaveBeenCalled();
      vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    }
  });

  it("returns verified identities and handles refresh success, terminal failure and retryable failure", async () => {
    const h = fixture();
    h.load({
      authenticate: async () => ({
        authenticated: true,
        accessToken: "sdk-user-token",
      }),
      refresh: async () => ({ authenticated: false, retryable: false }),
    });
    expect(
      await h.session.resolve(
        request("/api", "__Host-dashframe-workos-session=sealed-a"),
      ),
    ).toEqual({
      status: "authenticated",
      identity: { subject: "verified-user" },
      expiresAt: 2_000_000,
    });
    expect(h.verifier.verify).toHaveBeenCalledWith("sdk-user-token");

    h.load({
      authenticate: async () => ({ authenticated: false }),
      refresh: async () => ({
        authenticated: true,
        sealedSession: "rotated-session",
        session: { accessToken: "refreshed-token" },
      }),
    });
    const refreshed = await h.session.resolve(
      request("/api", "__Host-dashframe-workos-session=sealed-a"),
    );
    expect(refreshed).toMatchObject({
      status: "authenticated",
      identity: { subject: "verified-user" },
      expiresAt: 2_000_000,
    });
    expect(refreshed).toHaveProperty(
      "setCookie",
      expect.stringContaining("rotated-session"),
    );
    expect(h.verifier.verify).toHaveBeenLastCalledWith("refreshed-token");

    h.load({
      authenticate: async () => ({ authenticated: false }),
      refresh: async () => ({ authenticated: false, retryable: false }),
    });
    expect(
      await h.session.resolve(
        request("/api", "__Host-dashframe-workos-session=sealed-a"),
      ),
    ).toEqual({
      status: "signedout",
      setCookie: expect.stringContaining("Max-Age=0"),
    });

    h.load({
      authenticate: async () => ({ authenticated: false }),
      refresh: async () => ({ authenticated: false, retryable: true }),
    });
    expect(
      await h.session.resolve(
        request("/api", "__Host-dashframe-workos-session=sealed-a"),
      ),
    ).toEqual({ status: "unavailable" });
  });

  it("preserves the cookie on verifier outages and protects app-local logout by origin", async () => {
    const h = fixture();
    h.load({
      authenticate: async () => ({
        authenticated: true,
        accessToken: "sdk-user-token",
      }),
      refresh: async () => ({ authenticated: false, retryable: false }),
    });
    vi.mocked(h.verifier.verify).mockRejectedValueOnce(
      new (await import("@wystack/identity")).IdentityProviderUnavailableError(
        "synthetic outage",
      ),
    );
    expect(
      await h.session.resolve(
        request("/api", "__Host-dashframe-workos-session=sealed-a"),
      ),
    ).toEqual({ status: "unavailable" });

    h.load({
      authenticate: async () => {
        throw new Error("synthetic SDK transport failure");
      },
      refresh: async () => ({ authenticated: false, retryable: false }),
    });
    expect(
      await h.session.resolve(
        request("/api", "__Host-dashframe-workos-session=sealed-a"),
      ),
    ).toEqual({ status: "unavailable" });

    h.load({
      authenticate: async () => ({ authenticated: false }),
      refresh: async () => {
        throw new Error("synthetic refresh transport failure");
      },
    });
    expect(
      await h.session.resolve(
        request("/api", "__Host-dashframe-workos-session=sealed-a"),
      ),
    ).toEqual({ status: "unavailable" });

    h.load({
      authenticate: async () => ({ authenticated: false }),
      refresh: async () => ({ authenticated: true }),
    });
    expect(
      await h.session.resolve(
        request("/api", "__Host-dashframe-workos-session=sealed-a"),
      ),
    ).toEqual({ status: "unavailable" });

    expect(
      h.session.logout(request("/auth/logout", undefined, "GET", origin))
        .status,
    ).toBe(403);
    expect(
      h.session.logout(
        request("/auth/logout", undefined, "POST", "https://evil.example"),
      ).status,
    ).toBe(403);
    expect(
      await h.session.callback(
        request("/wrong-callback?code=a&state=b", undefined, "GET"),
      ),
    ).toMatchObject({ status: 400 });
    expect(
      await h.session.callback(
        request("/auth/callback?code=a&state=b", undefined, "POST"),
      ),
    ).toMatchObject({ status: 400 });
    const logout = h.session.logout(
      request("/auth/logout", undefined, "POST", origin),
    );
    expect(logout.status).toBe(204);
    expect(logout.headers.get("cache-control")).toBe("no-store");
    expect(logout.headers.get("set-cookie")).toContain(
      "__Host-dashframe-workos-session=",
    );
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects insecure or ambiguous construction options", () => {
    for (const change of [
      // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- Negative secure-origin construction fixture.
      { publicOrigin: "http://dashframe.example.test" },
      { publicOrigin: `${origin}/path` },
      { publicOrigin: `${origin}/` },
      // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- Negative secure-issuer construction fixture.
      { issuer: "http://api.workos.com/" },
      { clientId: " " },
      { apiKey: " " },
      // oxlint-disable-next-line sonarjs/no-hardcoded-passwords -- Negative minimum-length fixture.
      { cookiePassword: "short" },
    ])
      expect(() =>
        createHostedWorkOSSession(
          { ...options, ...change },
          fixtureDependencies(),
        ),
      ).toThrow();
  });
});

function fixtureDependencies() {
  const h = fixture();
  return { sdk: h.sdk, verifier: h.verifier };
}
