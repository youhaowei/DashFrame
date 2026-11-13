/**
 * SSRF host-guard tests.
 *
 * The contract under test: `isPrivateHost` returns true for any host that
 * addresses a private, loopback, link-local, or reserved destination, and false
 * for a public host. This is the sink-guard for connector URL validation — the
 * test pins each blocked range so a future edit cannot silently re-open one.
 */
/* oxlint-disable sonarjs/no-hardcoded-ip --
 * Hardcoded IP literals are intrinsic to this file: it tests an IP-range
 * classifier, so each blocked/allowed range MUST be asserted by literal. These
 * are test fixtures, never a runtime connection target. */
import { describe, expect, it } from "vite-plus/test";

import { isPrivateHost } from "./private-host.js";

describe("isPrivateHost (SSRF sink-guard)", () => {
  describe("rejects private / loopback / link-local IPv4", () => {
    it.each([
      ["10.0.0.1", "RFC-1918 10/8"],
      ["127.0.0.1", "loopback 127/8"],
      ["169.254.169.254", "link-local cloud metadata"],
      ["0.0.0.0", "unspecified / loopback bypass"],
    ])("blocks %s (%s)", (host) => {
      expect(isPrivateHost(host)).toBe(true);
    });
  });

  describe("rejects loopback / link-local / unique-local IPv6", () => {
    it.each([
      ["::1", "loopback"],
      ["::", "unspecified"],
      ["fe80::1", "link-local fe80::/10"],
      ["fc00::1", "unique-local fc00::/7 lower"],
      // The HEX-compressed forms are what URL.hostname actually emits for an
      // IPv4-mapped literal — these are the real attack surface. A regex
      // classifier matching only the dotted form let these through (cloud
      // metadata at 169.254.169.254 reachable as ::ffff:a9fe:a9fe).
      ["::ffff:a9fe:a9fe", "IPv4-mapped 169.254.169.254 metadata (hex)"],
      // Deprecated IPv4-compatible (::/96) embeds an IPv4 destination too.
      ["::a00:1", "IPv4-compatible 10.0.0.1 (deprecated ::/96)"],
      // CGNAT shared address space (100.64/10).
      ["100.64.0.1", "carrier-grade NAT 100.64/10"],
    ])("blocks %s (%s)", (host) => {
      expect(isPrivateHost(host)).toBe(true);
    });
  });

  describe("rejects loopback hostnames", () => {
    it.each([
      ["localhost"],
      ["LOCALHOST"],
      ["ip6-localhost"],
      ["ip6-loopback"],
      // Multi-trailing-dot — `new URL()` accepts these; resolvers collapse them.
      ["localhost.."],
    ])("blocks %s", (host) => {
      expect(isPrivateHost(host)).toBe(true);
    });
  });

  describe("allows public hosts", () => {
    it.each([
      ["api.example.com", "DNS hostname"],
      ["8.8.8.8", "public IPv4"],
      ["2606:4700:4700::1111", "public IPv6 (Cloudflare)"],
      ["::ffff:8.8.8.8", "IPv4-mapped public"],
    ])("allows %s (%s)", (host) => {
      expect(isPrivateHost(host)).toBe(false);
    });
  });

  it("treats an empty host as non-public (rejected)", () => {
    expect(isPrivateHost("")).toBe(true);
    expect(isPrivateHost("   ")).toBe(true);
  });

  it("tolerates a bracketed IPv6 literal", () => {
    expect(isPrivateHost("[::1]")).toBe(true);
    expect(isPrivateHost("[2606:4700:4700::1111]")).toBe(false);
  });
});
