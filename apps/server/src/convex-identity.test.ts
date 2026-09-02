import { createPublicKey, verify } from "node:crypto";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { createConvexIdentity } from "./convex-identity";

describe("host Convex identity", () => {
  it("persists the signing identity and issues a scoped short-lived service token", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "dashframe-convex-identity-"),
    );
    const first = await createConvexIdentity(directory, "workspace-a");
    const restarted = await createConvexIdentity(directory, "workspace-a");
    expect(restarted.jwksDataUri).toBe(first.jwksDataUri);
    const { token, expiresAt } = restarted.issue(
      { kind: "service", credentialId: "credential-a" },
      1_000_000,
    );
    const [header, payload, signature] = token.split(".");
    const decoded: Record<string, unknown> = JSON.parse(
      Buffer.from(payload!, "base64url").toString(),
    );
    expect(decoded).toMatchObject({
      aud: "dashframe",
      workspaceId: "workspace-a",
      sub: "service:credential-a",
      principalKind: "service",
      iat: 1000,
      exp: 1060,
    });
    expect(expiresAt).toBe(1_060_000);
    const key = createPublicKey(
      await readFile(path.join(directory, "convex-identity.pem")),
    );
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        key,
        Buffer.from(signature!, "base64url"),
      ),
    ).toBe(true);
    expect(
      (await stat(path.join(directory, "convex-identity.pem"))).mode & 0o777,
    ).toBe(0o600);
    expect(first.jwksDataUri).not.toContain("PRIVATE");
  });
});
