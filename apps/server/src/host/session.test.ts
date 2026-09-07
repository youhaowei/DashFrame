import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

import {
  clearedSessionCookie,
  loadOrCreateSessionKey,
  readCookie,
  serializeSessionCookie,
  signSession,
  verifySession,
} from "./session";

const KEY = Buffer.from("a".repeat(64), "hex");
const OTHER_KEY = Buffer.from("b".repeat(64), "hex");
const NOW = 1_700_000_000_000;
const claims = {
  subject: "user:abc",
  issuedAt: NOW,
  expiresAt: NOW + 60_000,
};

describe("session cookie signing", () => {
  it("round-trips the claims it was given", () => {
    expect(verifySession(KEY, signSession(KEY, claims), NOW)).toEqual(claims);
  });

  it("rejects a cookie signed by a different key", () => {
    expect(
      verifySession(OTHER_KEY, signSession(KEY, claims), NOW),
    ).toBeUndefined();
  });

  it("rejects a cookie whose payload was edited", () => {
    const [format, payload, signature] = signSession(KEY, claims).split(".");
    const edited = Buffer.from(
      JSON.stringify({ ...claims, subject: "user:someone-else" }),
      "utf8",
    ).toString("base64url");
    expect(edited).not.toBe(payload);
    expect(
      verifySession(KEY, `${format}.${edited}.${signature}`, NOW),
    ).toBeUndefined();
  });

  it("rejects a cookie at and after its expiry, not merely well past it", () => {
    const token = signSession(KEY, claims);
    expect(verifySession(KEY, token, claims.expiresAt - 1)).toEqual(claims);
    expect(verifySession(KEY, token, claims.expiresAt)).toBeUndefined();
    expect(verifySession(KEY, token, claims.expiresAt + 1)).toBeUndefined();
  });

  it("rejects a cookie from an older format version", () => {
    const [, payload, signature] = signSession(KEY, claims).split(".");
    expect(
      verifySession(KEY, `v0.${payload}.${signature}`, NOW),
    ).toBeUndefined();
  });

  // Every malformed shape has to return undefined rather than throw: this
  // function reads an attacker-controlled header, and an exception escaping it
  // would be a 500 on a request that should simply be unauthenticated.
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["wrong arity", "v1.abc"],
    ["non-base64 payload", "v1.!!!.sig"],
    [
      "payload that is not JSON",
      `v1.${Buffer.from("nope").toString("base64url")}.sig`,
    ],
    [
      "payload without a subject",
      `v1.${Buffer.from(JSON.stringify({ issuedAt: NOW, expiresAt: NOW + 1 })).toString("base64url")}.sig`,
    ],
  ])("returns undefined for a %s cookie", (_label, value) => {
    expect(
      verifySession(KEY, value as string | undefined, NOW),
    ).toBeUndefined();
  });

  it("rejects a well-formed payload carrying a non-numeric expiry", () => {
    const payload = Buffer.from(
      JSON.stringify({ subject: "u", issuedAt: NOW, expiresAt: "soon" }),
      "utf8",
    ).toString("base64url");
    const forged = signSession(KEY, claims).split(".")[2];
    expect(verifySession(KEY, `v1.${payload}.${forged}`, NOW)).toBeUndefined();
  });
});

describe("cookie serialization", () => {
  it("marks the cookie HttpOnly, same-site and path-scoped", () => {
    const cookie = serializeSessionCookie("s", "value", {
      secure: true,
      maxAgeSeconds: 60,
    });
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("Max-Age=60");
  });

  it("omits Secure only when explicitly told to, for loopback development", () => {
    expect(serializeSessionCookie("s", "v", { secure: false })).not.toContain(
      "Secure",
    );
  });

  it("expires the cookie in the past when clearing it", () => {
    const cleared = clearedSessionCookie("s", { secure: true });
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Expires=Thu, 01 Jan 1970");
  });

  it("never emits a negative Max-Age", () => {
    expect(
      serializeSessionCookie("s", "v", { secure: true, maxAgeSeconds: -5 }),
    ).toContain("Max-Age=0");
  });
});

describe("reading a cookie out of a header", () => {
  it("finds the named cookie among others and trims surrounding space", () => {
    expect(
      readCookie("a=1; dashframe_session=xyz; b=2", "dashframe_session"),
    ).toBe("xyz");
  });

  it("does not match a cookie whose name merely ends with the one asked for", () => {
    expect(readCookie("not_session=xyz", "session")).toBeUndefined();
  });

  it("keeps base64url padding and separators in the value", () => {
    expect(readCookie("s=v1.abc.def", "s")).toBe("v1.abc.def");
  });

  it("returns undefined for an absent header or an absent cookie", () => {
    expect(readCookie(undefined, "s")).toBeUndefined();
    expect(readCookie(null, "s")).toBeUndefined();
    expect(readCookie("a=1", "s")).toBeUndefined();
  });
});

describe("session key material", () => {
  it("generates a key once and reuses it across restarts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dashframe-session-key-"));
    const first = await loadOrCreateSessionKey(dir, {});
    const second = await loadOrCreateSessionKey(dir, {});
    expect(first).toHaveLength(32);
    expect(second.equals(first)).toBe(true);
    // Durability is the whole point: a redeploy that regenerated this would
    // sign every browser out.
    const mode = (await stat(path.join(dir, "session.key"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("prefers a configured key over the persisted one", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dashframe-session-key-"));
    await loadOrCreateSessionKey(dir, {});
    const configured = randomBytes(32);
    const loaded = await loadOrCreateSessionKey(dir, {
      DASHFRAME_SESSION_KEY: configured.toString("base64"),
    });
    expect(loaded.equals(configured)).toBe(true);
  });

  it("refuses a configured key of the wrong length rather than padding it", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dashframe-session-key-"));
    await expect(
      loadOrCreateSessionKey(dir, {
        DASHFRAME_SESSION_KEY: randomBytes(16).toString("base64"),
      }),
    ).rejects.toThrow(/32 bytes/);
  });

  it("refuses a persisted key of the wrong length instead of silently rotating", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dashframe-session-key-"));
    await writeFile(path.join(dir, "session.key"), randomBytes(8));
    await expect(loadOrCreateSessionKey(dir, {})).rejects.toThrow(
      /not 32 bytes/,
    );
  });

  it("writes the key it returns", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dashframe-session-key-"));
    const key = await loadOrCreateSessionKey(dir, {});
    expect((await readFile(path.join(dir, "session.key"))).equals(key)).toBe(
      true,
    );
  });
});
