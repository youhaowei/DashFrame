/**
 * Security headers tests
 *
 * These cover the parts of the policy that are computed: the host-derived
 * connect-src entries, the production-only upgrade directive and the custom
 * PostHog host. Two more pin sources the policy must not allow again.
 */
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { getSecurityHeaders } from "./security-headers";

describe("Security Headers", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it("keeps the framing, sniffing, transport and fallback protections", () => {
    const headers = new Map(getSecurityHeaders().map((h) => [h.key, h.value]));

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=");
    const csp = headers.get("Content-Security-Policy") ?? "";
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]) {
      expect(csp).toContain(directive);
    }
  });

  describe("Content Security Policy", () => {
    it("should include script-src with required sources", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("script-src");
      expect(cspHeader?.value).toContain("'self'");
      expect(cspHeader?.value).toContain("'unsafe-inline'");
      expect(cspHeader?.value).not.toContain("'wasm-unsafe-eval'");
      expect(cspHeader?.value).not.toContain("https://cdn.jsdelivr.net");
    });

    it("should include worker-src from the same origin", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("worker-src 'self'");
      expect(cspHeader?.value).not.toContain("worker-src 'self' blob:");
    });

    it("should include ws: DashFrame host in connect-src when VITE_DASHFRAME_URL uses http:", () => {
      // Browser CSP treats ws:/wss: as distinct from http:/https:.  Both must be
      // present so WebSocket connections to the WyStack server are allowed.
      const headers = getSecurityHeaders({
        VITE_DASHFRAME_URL: "http://127.0.0.1:4100/api",
      });
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy",
      );
      const connectSrc = cspHeader?.value
        .split(";")
        .find((d) => d.trim().startsWith("connect-src"));

      expect(connectSrc).toContain("http://127.0.0.1:4100");
      expect(connectSrc).toContain("ws://127.0.0.1:4100");
    });

    it("should include wss: DashFrame host in connect-src when VITE_DASHFRAME_URL uses https:", () => {
      const headers = getSecurityHeaders({
        VITE_DASHFRAME_URL: "https://example.com/api",
      });
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy",
      );
      const connectSrc = cspHeader?.value
        .split(";")
        .find((d) => d.trim().startsWith("connect-src"));

      expect(connectSrc).toContain("https://example.com");
      expect(connectSrc).toContain("wss://example.com");
    });

    it("should not include ws: or wss: entries in connect-src when VITE_DASHFRAME_URL is absent", () => {
      const headers = getSecurityHeaders({});
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy",
      );
      const connectSrc = cspHeader?.value
        .split(";")
        .find((d) => d.trim().startsWith("connect-src"));

      expect(connectSrc).not.toMatch(/\bws:\/\//);
      expect(connectSrc).not.toMatch(/\bwss:\/\//);
    });
  });

  describe("Environment-based Configuration", () => {
    it("should include upgrade-insecure-requests in production", () => {
      (process.env as Record<string, string>).NODE_ENV = "production";
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("upgrade-insecure-requests");
    });

    it("should NOT include upgrade-insecure-requests in development", () => {
      (process.env as Record<string, string>).NODE_ENV = "development";
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).not.toContain("upgrade-insecure-requests");
    });
  });

  describe("PostHog Custom Host Support", () => {
    it("should include custom PostHog host when NEXT_PUBLIC_POSTHOG_HOST is set", () => {
      process.env.NEXT_PUBLIC_POSTHOG_HOST =
        "https://custom.posthog.example.com";
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy",
      );

      expect(cspHeader?.value).toContain("https://custom.posthog.example.com");
    });
  });
});
