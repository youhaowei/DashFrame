/**
 * Security headers verification tests
 *
 * These tests ensure that all expected security headers are present
 * and properly configured for both development and production environments.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
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

  describe("getSecurityHeaders", () => {
    it("should return an array of header objects", () => {
      const headers = getSecurityHeaders();
      expect(Array.isArray(headers)).toBe(true);
      expect(headers.length).toBeGreaterThan(0);
    });

    it("should return headers with key-value structure", () => {
      const headers = getSecurityHeaders();
      for (const header of headers) {
        expect(header).toHaveProperty("key");
        expect(header).toHaveProperty("value");
        expect(typeof header.key).toBe("string");
        expect(typeof header.value).toBe("string");
      }
    });
  });

  describe("Required Security Headers", () => {
    it("should include Content-Security-Policy header", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader).toBeDefined();
      expect(cspHeader?.value).toBeTruthy();
    });

    it("should include X-Frame-Options header", () => {
      const headers = getSecurityHeaders();
      const xFrameHeader = headers.find((h) => h.key === "X-Frame-Options");

      expect(xFrameHeader).toBeDefined();
      expect(xFrameHeader?.value).toBe("DENY");
    });

    it("should include X-Content-Type-Options header", () => {
      const headers = getSecurityHeaders();
      const xContentTypeHeader = headers.find(
        (h) => h.key === "X-Content-Type-Options"
      );

      expect(xContentTypeHeader).toBeDefined();
      expect(xContentTypeHeader?.value).toBe("nosniff");
    });

    it("should include Strict-Transport-Security header", () => {
      const headers = getSecurityHeaders();
      const hstsHeader = headers.find(
        (h) => h.key === "Strict-Transport-Security"
      );

      expect(hstsHeader).toBeDefined();
      expect(hstsHeader?.value).toContain("max-age=");
      expect(hstsHeader?.value).toContain("includeSubDomains");
      expect(hstsHeader?.value).toContain("preload");
    });

    it("should include Referrer-Policy header", () => {
      const headers = getSecurityHeaders();
      const referrerHeader = headers.find((h) => h.key === "Referrer-Policy");

      expect(referrerHeader).toBeDefined();
      expect(referrerHeader?.value).toBe("strict-origin-when-cross-origin");
    });

    it("should include Permissions-Policy header", () => {
      const headers = getSecurityHeaders();
      const permissionsHeader = headers.find(
        (h) => h.key === "Permissions-Policy"
      );

      expect(permissionsHeader).toBeDefined();
      expect(permissionsHeader?.value).toBeTruthy();
    });
  });

  describe("Content Security Policy", () => {
    it("should include default-src directive", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("default-src 'self'");
    });

    it("should include script-src with required sources", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("script-src");
      expect(cspHeader?.value).toContain("'self'");
      expect(cspHeader?.value).toContain("'unsafe-inline'");
      expect(cspHeader?.value).toContain("'wasm-unsafe-eval'");
      expect(cspHeader?.value).toContain("blob:");
      expect(cspHeader?.value).toContain("https://cdn.jsdelivr.net");
    });

    it("should include worker-src with blob: for DuckDB", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("worker-src");
      expect(cspHeader?.value).toContain("'self'");
      expect(cspHeader?.value).toContain("blob:");
    });

    it("should include connect-src with required sources", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("connect-src");
      expect(cspHeader?.value).toContain("'self'");
      expect(cspHeader?.value).toContain("blob:");
      expect(cspHeader?.value).toContain("https://cdn.jsdelivr.net");
    });

    it("should include PostHog hosts in script-src and connect-src", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("https://*.posthog.com");
      expect(cspHeader?.value).toContain("https://*.i.posthog.com");
    });

    it("should include style-src with unsafe-inline", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("style-src");
      expect(cspHeader?.value).toContain("'self'");
      expect(cspHeader?.value).toContain("'unsafe-inline'");
    });

    it("should include img-src with data: and blob:", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("img-src");
      expect(cspHeader?.value).toContain("'self'");
      expect(cspHeader?.value).toContain("data:");
      expect(cspHeader?.value).toContain("blob:");
    });

    it("should include font-src with data:", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("font-src");
      expect(cspHeader?.value).toContain("'self'");
      expect(cspHeader?.value).toContain("data:");
    });

    it("should include object-src 'none'", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("object-src 'none'");
    });

    it("should include base-uri 'self'", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("base-uri 'self'");
    });

    it("should include form-action 'self'", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("form-action 'self'");
    });

    it("should include frame-ancestors 'none'", () => {
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("frame-ancestors 'none'");
    });
  });

  describe("Environment-based Configuration", () => {
    it("should include unsafe-eval in development mode", () => {
      process.env.NODE_ENV = "development";
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("'unsafe-eval'");
    });

    it("should NOT include unsafe-eval in production mode", () => {
      process.env.NODE_ENV = "production";
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).not.toContain("'unsafe-eval'");
    });

    it("should include upgrade-insecure-requests in production", () => {
      process.env.NODE_ENV = "production";
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("upgrade-insecure-requests");
    });

    it("should NOT include upgrade-insecure-requests in development", () => {
      process.env.NODE_ENV = "development";
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).not.toContain("upgrade-insecure-requests");
    });
  });

  describe("PostHog Custom Host Support", () => {
    it("should include custom PostHog host when NEXT_PUBLIC_POSTHOG_HOST is set", () => {
      process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://custom.posthog.example.com";
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toContain("https://custom.posthog.example.com");
    });

    it("should work without custom PostHog host", () => {
      delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
      const headers = getSecurityHeaders();
      const cspHeader = headers.find(
        (h) => h.key === "Content-Security-Policy"
      );

      expect(cspHeader?.value).toBeTruthy();
      expect(cspHeader?.value).toContain("https://*.posthog.com");
    });
  });

  describe("Permissions Policy", () => {
    it("should disable camera permission", () => {
      const headers = getSecurityHeaders();
      const permissionsHeader = headers.find(
        (h) => h.key === "Permissions-Policy"
      );

      expect(permissionsHeader?.value).toContain("camera=()");
    });

    it("should disable microphone permission", () => {
      const headers = getSecurityHeaders();
      const permissionsHeader = headers.find(
        (h) => h.key === "Permissions-Policy"
      );

      expect(permissionsHeader?.value).toContain("microphone=()");
    });

    it("should disable geolocation permission", () => {
      const headers = getSecurityHeaders();
      const permissionsHeader = headers.find(
        (h) => h.key === "Permissions-Policy"
      );

      expect(permissionsHeader?.value).toContain("geolocation=()");
    });

    it("should disable FLoC tracking", () => {
      const headers = getSecurityHeaders();
      const permissionsHeader = headers.find(
        (h) => h.key === "Permissions-Policy"
      );

      expect(permissionsHeader?.value).toContain("interest-cohort=()");
    });
  });

  describe("Integration Test", () => {
    it("should return all 6 required security headers", () => {
      const headers = getSecurityHeaders();
      const headerKeys = headers.map((h) => h.key);

      const requiredHeaders = [
        "Content-Security-Policy",
        "X-Frame-Options",
        "X-Content-Type-Options",
        "Strict-Transport-Security",
        "Referrer-Policy",
        "Permissions-Policy",
      ];

      for (const required of requiredHeaders) {
        expect(headerKeys).toContain(required);
      }
    });

    it("should have no duplicate header keys", () => {
      const headers = getSecurityHeaders();
      const headerKeys = headers.map((h) => h.key);
      const uniqueKeys = new Set(headerKeys);

      expect(headerKeys.length).toBe(uniqueKeys.size);
    });

    it("should have no empty header values", () => {
      const headers = getSecurityHeaders();

      for (const header of headers) {
        expect(header.value.length).toBeGreaterThan(0);
      }
    });
  });
});
