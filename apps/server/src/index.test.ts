import { describe, expect, it } from "vitest";

import { assertBindIsSafe, parseArgs, printHelp } from "./index";

describe("dashframe serve CLI", () => {
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

  it("should reject malformed bind ports", () => {
    expect(() => parseArgs(["--bind", "127.0.0.1:"])).toThrow(
      'Invalid --port ""',
    );
    expect(() => parseArgs(["--bind", "127.0.0.1:not-a-port"])).toThrow(
      'Invalid --port "not-a-port"',
    );
  });

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

  describe("assertBindIsSafe", () => {
    it("should allow a loopback bind without a token", () => {
      expect(() => assertBindIsSafe({ hostname: "127.0.0.1" })).not.toThrow();
      expect(() => assertBindIsSafe({})).not.toThrow();
    });

    it("should reject a non-loopback bind without a token", () => {
      expect(() => assertBindIsSafe({ hostname: "0.0.0.0" })).toThrow(
        /Refusing to bind 0\.0\.0\.0 without --token/,
      );
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
