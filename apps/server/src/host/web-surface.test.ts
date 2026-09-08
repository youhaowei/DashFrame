import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vite-plus/test";

import {
  LoginThrottle,
  parseHeadersFile,
  resolveStaticPath,
  createWebSurface,
} from "./web-surface";

it("does not serve a real symlink target outside the bundle", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "dashframe-static-link-"));
  try {
    const root = path.join(fixture, "dist");
    await mkdir(root);
    await writeFile(path.join(root, "index.html"), "synthetic app shell");
    await writeFile(
      path.join(root, "_headers"),
      "/*\n  X-Content-Type-Options: nosniff\n",
    );
    await writeFile(path.join(fixture, "private.txt"), "outside bundle secret");
    await symlink(
      path.join(fixture, "private.txt"),
      path.join(root, "leak.txt"),
    );
    const surface = await createWebSurface({
      staticRoot: root,
      session: {
        secret: "synthetic-only",
        cookieName: "session",
        ttlMs: 1000,
        cookie: { secure: true },
        subject: "fixture",
        password: randomUUID(),
      },
    });
    const response = await surface.serve(
      new Request("https://app.invalid/leak.txt"),
    );
    expect(await response.text()).toBe("synthetic app shell");
  } finally {
    await rm(fixture, { recursive: true });
  }
});

it("explains which build artifact is missing at startup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dashframe-static-missing-"));
  try {
    const options = {
      staticRoot: root,
      session: {
        secret: randomUUID(),
        cookieName: "session",
        ttlMs: 1000,
        cookie: { secure: true },
        subject: "fixture",
        password: randomUUID(),
      },
    };
    await expect(createWebSurface(options)).rejects.toThrow("No index.html");
    await writeFile(path.join(root, "index.html"), "synthetic shell");
    await expect(createWebSurface(options)).rejects.toThrow(
      "has no _headers file",
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

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
    expect(parseHeadersFile("/*\n  Link: <https://a/b>; rel=x\n")).toEqual([
      ["Link", "<https://a/b>; rel=x"],
    ]);
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
