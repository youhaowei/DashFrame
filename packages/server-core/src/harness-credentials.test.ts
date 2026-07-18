import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FileHarnessCredentialStore } from "./harness-credentials";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

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
    const issued = await store.issue(PROJECT_ID, "Codex workstation");

    expect(issued.token).toMatch(/^dfh_[A-Za-z0-9_-]{43}$/);
    expect(issued.credential.name).toBe("Codex workstation");
    expect(await store.authenticate(PROJECT_ID, issued.token)).toMatchObject({
      id: issued.credential.id,
      name: "Codex workstation",
    });

    const persisted = await fs.readFile(
      path.join(rootDir, `${PROJECT_ID}.json`),
      "utf8",
    );
    expect(persisted).not.toContain(issued.token);
    expect(persisted).toContain('"verifier"');
    expect(persisted).not.toContain('"token"');
  });

  it("lists safe metadata and blocks a revoked credential", async () => {
    const store = new FileHarnessCredentialStore(rootDir);
    const issued = await store.issue(PROJECT_ID, "Claude Code");

    expect(await store.list(PROJECT_ID)).toEqual([issued.credential]);
    expect(await store.revoke(PROJECT_ID, issued.credential.id)).toBe(true);
    expect(await store.authenticate(PROJECT_ID, issued.token)).toBeNull();

    const [revoked] = await store.list(PROJECT_ID);
    expect(revoked?.revokedAt).toBeTruthy();
    expect(await store.revoke(PROJECT_ID, issued.credential.id)).toBe(false);
  });

  it("isolates credentials by project identity", async () => {
    const store = new FileHarnessCredentialStore(rootDir);
    const issued = await store.issue(PROJECT_ID, "Codex");
    const otherProject = "22222222-2222-4222-8222-222222222222";

    expect(await store.authenticate(otherProject, issued.token)).toBeNull();
    expect(await store.list(otherProject)).toEqual([]);
  });
});
