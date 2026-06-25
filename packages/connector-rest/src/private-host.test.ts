/**
 * SSRF host-guard tests.
 *
 * The contract under test: `isPrivateHost` returns true for any host that
 * addresses a private, loopback, link-local, or reserved destination, and false
 * for a public host. This is the sink-guard for connector URL validation — the
 * test pins each blocked range so a future edit cannot silently re-open one.
 */
/* eslint-disable sonarjs/no-hardcoded-ip --
 * Hardcoded IP literals are intrinsic to this file: it tests an IP-range
 * classifier, so each blocked/allowed range MUST be asserted by literal. These
 * are test fixtures, never a runtime connection target. */
import { describe, expect, it } from "vitest";

import { isPrivateHost } from "./private-host.js";

describe("isPrivateHost (SSRF sink-guard)", () => {
  describe("rejects private / loopback / link-local IPv4", () => {
    it.each([
      ["10.0.0.1", "RFC-1918 10/8"],
      ["10.255.255.255", "RFC-1918 10/8 upper"],
      ["172.16.0.1", "RFC-1918 172.16/12 lower"],
      ["172.31.255.255", "RFC-1918 172.16/12 upper"],
      ["192.168.0.1", "RFC-1918 192.168/16"],
      ["127.0.0.1", "loopback 127/8"],
      ["127.255.255.255", "loopback 127/8 upper"],
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
      ["febf::1", "link-local fe80::/10 upper"],
      ["fc00::1", "unique-local fc00::/7 lower"],
      ["fdff::1", "unique-local fc00::/7 upper"],
      ["::ffff:10.0.0.1", "IPv4-mapped private (dotted form)"],
      ["::ffff:192.168.1.1", "IPv4-mapped private 192.168 (dotted form)"],
      // The HEX-compressed forms are what URL.hostname actually emits for an
      // IPv4-mapped literal — these are the real attack surface. A regex
      // classifier matching only the dotted form let these through (cloud
      // metadata at 169.254.169.254 reachable as ::ffff:a9fe:a9fe).
      ["::ffff:a00:1", "IPv4-mapped 10.0.0.1 (hex, URL-normalized)"],
      ["::ffff:a9fe:a9fe", "IPv4-mapped 169.254.169.254 metadata (hex)"],
      ["::ffff:7f00:1", "IPv4-mapped 127.0.0.1 loopback (hex)"],
      ["::ffff:c0a8:101", "IPv4-mapped 192.168.1.1 (hex)"],
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
      // Rooted FQDN form: new URL("http://localhost./").hostname === "localhost."
      ["localhost."],
      // Multi-trailing-dot — `new URL()` accepts these; resolvers collapse them.
      ["localhost.."],
      ["localhost..."],
    ])("blocks %s", (host) => {
      expect(isPrivateHost(host)).toBe(true);
    });
  });

  describe("allows public hosts", () => {
    it.each([
      ["api.example.com", "DNS hostname"],
      ["8.8.8.8", "public IPv4"],
      ["1.1.1.1", "public IPv4"],
      ["172.15.0.1", "just below the 172.16/12 range"],
      ["172.32.0.1", "just above the 172.16/12 range"],
      ["192.169.0.1", "adjacent to 192.168/16"],
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

  // End-to-end through the real production path: the connector feeds
  // `new URL(endpoint).hostname` to isPrivateHost, NOT the raw literal. URL
  // normalizes IPv4-mapped/compatible and integer/octal IPv4 forms — these
  // assertions pin the classifier against what URL actually emits (the dotted
  // literal a unit test feeds it never appears in production).
  describe("via new URL().hostname (the production code path)", () => {
    /* eslint-disable sonarjs/no-clear-text-protocols -- SSRF fixtures: internal http targets the classifier must reject; plain http is the realistic attacker form. */
    it.each([
      ["http://[::ffff:10.0.0.1]/data", "IPv4-mapped private"],
      [
        "http://[::ffff:169.254.169.254]/latest/meta-data/",
        "metadata via mapped",
      ],
      ["http://[0:0:0:0:0:ffff:127.0.0.1]/", "IPv4-mapped loopback (expanded)"],
      ["http://[::10.0.0.1]/", "IPv4-compatible private (deprecated)"],
      ["http://2130706433/", "integer IPv4 → 127.0.0.1"],
      ["http://0177.0.0.1/", "octal IPv4 → 127.0.0.1"],
      ["http://0x7f.0.0.1/", "hex IPv4 → 127.0.0.1"],
      ["http://localhost./", "rooted-FQDN localhost (trailing dot)"],
    ])("blocks %s (%s)", (url) => {
      expect(isPrivateHost(new URL(url).hostname)).toBe(true);
    });

    it.each([
      ["https://api.github.com/users", "public DNS host"],
      ["http://[::ffff:8.8.8.8]/", "IPv4-mapped public"],
      ["https://[2606:4700:4700::1111]/", "public IPv6"],
    ])("allows %s (%s)", (url) => {
      expect(isPrivateHost(new URL(url).hostname)).toBe(false);
    });
    /* eslint-enable sonarjs/no-clear-text-protocols */
  });
});
