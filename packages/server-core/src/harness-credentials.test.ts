import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileHarnessCredentialStore } from "./harness-credentials";

describe("FileHarnessCredentialStore", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dashframe-harness-"));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("issues a one-time token while persisting only its verifier", async () => {
    const store = new FileHarnessCredentialStore(rootDir);
    const issued = await store.issue("Codex workstation");

    expect(issued.token).toMatch(/^dfh_[A-Za-z0-9_-]{43}$/);
    expect(issued.credential.name).toBe("Codex workstation");
    expect(await store.authenticate(issued.token)).toMatchObject({
      id: issued.credential.id,
      name: "Codex workstation",
    });

    const persisted = await fs.readFile(
      path.join(rootDir, "credentials.json"),
      "utf8",
    );
    expect(persisted).not.toContain(issued.token);
    expect(persisted).toContain('"verifier"');
    expect(persisted).not.toContain('"token"');
  });

  it("lists safe metadata and blocks a revoked credential", async () => {
    const store = new FileHarnessCredentialStore(rootDir);
    const issued = await store.issue("Claude Code");

    expect(await store.list()).toEqual([issued.credential]);
    expect(await store.revoke(issued.credential.id)).toBe(true);
    expect(await store.authenticate(issued.token)).toBeNull();

    const [revoked] = await store.list();
    expect(revoked?.revokedAt).toBeTruthy();
    expect(await store.revoke(issued.credential.id)).toBe(false);
  });

  it("keeps one workspace credential registry across store instances", async () => {
    const first = new FileHarnessCredentialStore(rootDir);
    const issued = await first.issue("Codex");
    const reopened = new FileHarnessCredentialStore(rootDir);

    expect(await reopened.authenticate(issued.token)).toMatchObject({
      id: issued.credential.id,
      name: "Codex",
    });
    expect(await reopened.list()).toEqual([issued.credential]);
  });
});
