import path from "node:path";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vite-plus/test";

import {
  createStaticWebSurface,
  parseHeadersFile,
  resolveStaticPath,
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
    const serve = await createStaticWebSurface(root);
    const explicitShell = await serve(
      new Request("https://app.invalid/index.html"),
    );
    expect(explicitShell.headers.get("Cache-Control")).toBe("no-cache");
    const response = await serve(new Request("https://app.invalid/leak.txt"));
    expect(await response.text()).toBe("synthetic app shell");
  } finally {
    await rm(fixture, { recursive: true });
  }
});

it("explains which build artifact is missing at startup", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dashframe-static-missing-"));
  try {
    await expect(createStaticWebSurface(root)).rejects.toThrow("No index.html");
    await writeFile(path.join(root, "index.html"), "synthetic shell");
    await expect(createStaticWebSurface(root)).rejects.toThrow(
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
