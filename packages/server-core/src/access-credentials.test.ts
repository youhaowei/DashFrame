import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AccessCredentials } from "./access-credentials";

function makeVault(): { vault: SecretVault; backend: TestBackend } {
  const backend = new TestBackend();
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault("serve-token", "test");
  return {
    vault: new SecretVault(registry, new InMemoryMappingStore()),
    backend,
  };
}

describe("AccessCredentials", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dashframe-access-"));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("keeps the verifier in SecretVault and only inventory metadata on disk", async () => {
    const { vault, backend } = makeVault();
    const credentials = new AccessCredentials(vault, rootDir);
    const issued = await credentials.issue("Codex workstation");

    expect(issued.token).toMatch(/^dfa_[A-Za-z0-9_-]{43}$/);
    expect(issued.credential.name).toBe("Codex workstation");
    expect(await credentials.authenticate(issued.token)).toBe(true);
    expect(backend.resolveCallCount).toBe(1);

    const persisted = await fs.readFile(
      path.join(rootDir, "credentials.json"),
      "utf8",
    );
    expect(persisted).not.toContain(issued.token);
    expect(persisted).not.toContain('"verifier"');
    expect(persisted).not.toContain('"token"');
    expect(persisted).toContain('"verifierRef": "secret:');
  });

  it("lists safe metadata and blocks a revoked credential", async () => {
    const { vault } = makeVault();
    const credentials = new AccessCredentials(vault, rootDir);
    const issued = await credentials.issue("Claude Code");

    expect(await credentials.list()).toEqual([issued.credential]);
    expect(await credentials.revoke(issued.credential.id)).toBe(true);
    expect(await credentials.authenticate(issued.token)).toBe(false);

    const [revoked] = await credentials.list();
    expect(revoked?.revokedAt).toBeTruthy();
    expect(await credentials.revoke(issued.credential.id)).toBe(false);
  });

  it("keeps one workspace credential inventory across module instances", async () => {
    const { vault } = makeVault();
    const first = new AccessCredentials(vault, rootDir);
    const issued = await first.issue("Codex");
    const reopened = new AccessCredentials(vault, rootDir);

    expect(await reopened.authenticate(issued.token)).toBe(true);
    expect(await reopened.list()).toEqual([issued.credential]);
  });
});
