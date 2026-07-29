import { describe, expect, it } from "vitest";

import { assertBindIsSafe, parseArgs, printHelp } from "./index";

describe("dashframe serve CLI", () => {
  describe("parseArgs", () => {
    it("should parse the serve subcommand with project, bind, and token", () => {
      expect(
        parseArgs([
          "serve",
          "--project",
          "/Users/example/DashFrameProject",
          "--bind",
          "127.0.0.1:4100",
          "--token",
          "secret",
        ]),
      ).toEqual({
        project: "/Users/example/DashFrameProject",
        hostname: "127.0.0.1",
        port: 4100,
        token: "secret",
      });
    });

    it("should parse port-only and IPv6 bind addresses", () => {
      expect(parseArgs(["--bind", ":4123"])).toEqual({ port: 4123 });
      expect(parseArgs(["--bind", "[::1]:4124"])).toEqual({
        hostname: "::1",
        port: 4124,
      });
    });

    it("should reject an unbracketed IPv6 bind with a bracket hint", () => {
      // eslint-disable-next-line sonarjs/no-hardcoded-ip -- the malformed literal is the input under test
      expect(() => parseArgs(["--bind", "::1:4000"])).toThrow(
        /bracket IPv6 addresses as \[host\]:port/,
      );
    });

    it("should reject malformed bind ports", () => {
      expect(() => parseArgs(["--bind", "127.0.0.1:"])).toThrow(
        'Invalid --port ""',
      );
      expect(() => parseArgs(["--bind", "127.0.0.1:not-a-port"])).toThrow(
        'Invalid --port "not-a-port"',
      );
    });
  });

  describe("printHelp", () => {
    it("should document the security boundary in help", () => {
      const originalLog = console.log;
      const output: string[] = [];
      console.log = (...args: unknown[]) => {
        output.push(args.join(" "));
      };

      try {
        printHelp();
      } finally {
        console.log = originalLog;
      }

      const helpText = output.join("\n");
      expect(helpText).toContain("--bind <addr>");
      expect(helpText).toContain("--token <token>");
      expect(helpText).toContain("Security boundary:");
      expect(helpText).toContain("non-loopback bind");
    });
  });

  describe("assertBindIsSafe", () => {
    it("should allow a loopback bind without a token", () => {
      expect(() => assertBindIsSafe({ hostname: "127.0.0.1" })).not.toThrow();
      // Anywhere in 127.0.0.0/8, not just 127.0.0.1.
      expect(() => assertBindIsSafe({ hostname: "127.0.0.2" })).not.toThrow();
      expect(() => assertBindIsSafe({})).not.toThrow();
    });

    it("should reject a non-loopback bind without a token", () => {
      expect(() => assertBindIsSafe({ hostname: "0.0.0.0" })).toThrow(
        /Refusing to bind 0\.0\.0\.0 without --token/,
      );
    });

    // Regression for #243: the gate used to classify loopback with
    // `hostname.startsWith("127.")`, a string prefix test on a *hostname*.
    it.each([
      // The bypass. Both pass the old prefix test while resolving wherever
      // their owner points them, so each silently waived the token
      // requirement on a network-reachable bind.
      "127.attacker.example",
      "127.0.0.1.evil.example",
      // Already rejected by the old test (no dot after `127`). Pins the
      // adjacent shape so a looser rewrite of the parse can't admit it.
      "127foo",
      // Not a dotted-quad literal, and not attacker-controlled — a genuine
      // loopback shorthand that getaddrinfo widens to 127.0.0.1. The gate
      // fails closed on spellings it cannot parse rather than guessing, so
      // this one is over-strict by design, not a bypass.
      "127.1",
    ])("should reject the non-loopback host %s without a token", (hostname) => {
      expect(() => assertBindIsSafe({ hostname })).toThrow(/without --token/);
    });

    it("should still allow real 127.0.0.0/8 literals without a token", () => {
      // The fix must not narrow loopback to 127.0.0.1 — local dev and Electron
      // bind elsewhere in the block.
      for (const hostname of ["127.0.0.1", "127.0.0.53", "127.1.2.3"]) {
        expect(() => assertBindIsSafe({ hostname })).not.toThrow();
      }
      expect(() => assertBindIsSafe({ hostname: "localhost" })).not.toThrow();
      expect(() => assertBindIsSafe({ hostname: "::1" })).not.toThrow();
    });

    it("should allow a non-loopback bind when a token is set", () => {
      expect(() =>
        assertBindIsSafe({ hostname: "0.0.0.0", token: "secret" }),
      ).not.toThrow();
    });

    it("should allow a non-loopback bind when --insecure opts out", () => {
      expect(() =>
        assertBindIsSafe({ hostname: "0.0.0.0", insecure: true }),
      ).not.toThrow();
    });
  });
});
