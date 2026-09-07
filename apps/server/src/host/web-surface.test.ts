import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  LoginThrottle,
  parseHeadersFile,
  resolveStaticPath,
} from "./web-surface";

describe("parsing the build's _headers file", () => {
  const source = [
    "/*",
    "  Content-Security-Policy: default-src 'self'; script-src 'self' blob:",
    "  X-Frame-Options: DENY",
    "  Cross-Origin-Embedder-Policy: require-corp",
    "",
  ].join("\n");

  it("returns the catch-all block's headers in order", () => {
    expect(parseHeadersFile(source)).toEqual([
      [
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' blob:",
      ],
      ["X-Frame-Options", "DENY"],
      ["Cross-Origin-Embedder-Policy", "require-corp"],
    ]);
  });

  it("keeps colons inside a header value", () => {
    const [[, value]] = parseHeadersFile("/*\n  Link: <https://a/b>; rel=x\n");
    expect(value).toBe("<https://a/b>; rel=x");
  });

  it("ignores blocks scoped to another path", () => {
    const scoped = "/admin/*\n  X-Secret: yes\n\n/*\n  X-Public: yes\n";
    expect(parseHeadersFile(scoped)).toEqual([["X-Public", "yes"]]);
  });

  it("returns nothing when there is no catch-all block", () => {
    expect(parseHeadersFile("/admin/*\n  X-Secret: yes\n")).toEqual([]);
  });
});

describe("resolving a request path inside the build directory", () => {
  const root = "/srv/dist";

  it("resolves a normal asset", () => {
    expect(resolveStaticPath(root, "/assets/app-abc123.js")).toBe(
      path.join(root, "assets/app-abc123.js"),
    );
  });

  it("resolves the root itself", () => {
    expect(resolveStaticPath(root, "/")).toBe(root);
  });

  // Each of these is a real traversal shape, not a variation on one: literal
  // dot-dot, percent-encoded dot-dot, an absolute-looking path, and a NUL that
  // could truncate the name inside a syscall.
  it.each([
    ["literal traversal", "/../etc/passwd"],
    ["nested traversal", "/assets/../../etc/passwd"],
    ["encoded traversal", "/%2e%2e/%2e%2e/etc/passwd"],
    ["NUL byte", "/app.js%00.png"],
  ])("refuses %s", (_label, urlPath) => {
    expect(resolveStaticPath(root, urlPath)).toBeUndefined();
  });

  it("refuses a malformed percent-encoding rather than passing it through", () => {
    expect(resolveStaticPath(root, "/%zz")).toBeUndefined();
  });

  it("does not let a sibling directory sharing the root's prefix escape", () => {
    // `/srv/dist-secrets` starts with `/srv/dist` as a string but is a
    // different directory; only a separator-aware check catches this.
    expect(resolveStaticPath(root, "/../dist-secrets/key.txt")).toBeUndefined();
  });
});

describe("sign-in throttle", () => {
  it("allows attempts up to the limit and refuses the next one", () => {
    const throttle = new LoginThrottle(3, 1000);
    expect(throttle.check(0)).toBe(true);
    expect(throttle.check(0)).toBe(true);
    expect(throttle.check(0)).toBe(true);
    expect(throttle.check(0)).toBe(false);
  });

  it("opens a fresh window once the old one has elapsed", () => {
    const throttle = new LoginThrottle(1, 1000);
    expect(throttle.check(0)).toBe(true);
    expect(throttle.check(500)).toBe(false);
    expect(throttle.check(1000)).toBe(true);
  });

  it("forgets accumulated failures after a successful sign-in", () => {
    const throttle = new LoginThrottle(2, 1000);
    throttle.check(0);
    throttle.succeed();
    expect(throttle.check(0)).toBe(true);
    expect(throttle.check(0)).toBe(true);
  });
});
