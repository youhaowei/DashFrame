import {
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiAccessCredentials } from "./api-access-credentials";
import { FileMappingStore } from "./mapping-store";

function makeVault(
  mappingPath: string,
  backend = new TestBackend(),
): { vault: SecretVault; backend: TestBackend } {
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault("serve-token", "test");
  return {
    vault: new SecretVault(registry, new FileMappingStore(mappingPath)),
    backend,
  };
}

describe("ApiAccessCredentials", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "dashframe-access-"));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("keeps the verifier in SecretVault and only inventory metadata on disk", async () => {
    const { vault, backend } = makeVault(path.join(rootDir, "mappings.json"));
    const credentials = new ApiAccessCredentials(vault, rootDir);
    const issued = await credentials.issue("Codex workstation");

    expect(issued.token).toMatch(/^dfa_[A-Za-z0-9_-]{43}$/);
    expect(issued.credential.name).toBe("Codex workstation");
    expect(await credentials.authenticate(issued.token)).toBe(
      issued.credential.id,
    );
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
    const { vault } = makeVault(path.join(rootDir, "mappings.json"));
    const credentials = new ApiAccessCredentials(vault, rootDir);
    const issued = await credentials.issue("Claude Code");

    expect(await credentials.list()).toEqual([issued.credential]);
    expect(await credentials.revoke(issued.credential.id)).toBe(true);
    expect(await credentials.authenticate(issued.token)).toBeNull();

    const [revoked] = await credentials.list();
    expect(revoked?.revokedAt).toBeTruthy();
    expect(await credentials.revoke(issued.credential.id)).toBe(false);
  });

  it("keeps one workspace credential inventory across module instances", async () => {
    const mappingPath = path.join(rootDir, "mappings.json");
    const backend = new TestBackend();
    const { vault } = makeVault(mappingPath, backend);
    const first = new ApiAccessCredentials(vault, rootDir);
    const issued = await first.issue("Codex");
    const { vault: reopenedVault } = makeVault(mappingPath, backend);
    const reopened = new ApiAccessCredentials(reopenedVault, rootDir);

    expect(await reopened.authenticate(issued.token)).toBe(
      issued.credential.id,
    );
    expect(await reopened.list()).toEqual([issued.credential]);
  });

  it("rejects an empty, whitespace-only, or over-long credential name", async () => {
    const { vault } = makeVault(path.join(rootDir, "mappings.json"));
    const credentials = new ApiAccessCredentials(vault, rootDir);

    await expect(credentials.issue("")).rejects.toThrow(
      "Credential name must be between 1 and 80 characters",
    );
    await expect(credentials.issue("   ")).rejects.toThrow(
      "Credential name must be between 1 and 80 characters",
    );
    await expect(credentials.issue("x".repeat(81))).rejects.toThrow(
      "Credential name must be between 1 and 80 characters",
    );

    const issued = await credentials.issue(`  ${"x".repeat(80)}  `);
    expect(issued.credential.name).toBe("x".repeat(80));
  });

  it("persists revocation before best-effort secret cleanup", async () => {
    class DeleteFailingBackend extends TestBackend {
      override async delete(): Promise<void> {
        throw new Error("keychain unavailable");
      }
    }

    const { vault } = makeVault(
      path.join(rootDir, "mappings.json"),
      new DeleteFailingBackend(),
    );
    const credentials = new ApiAccessCredentials(vault, rootDir);
    const issued = await credentials.issue("Codex");

    expect(await credentials.revoke(issued.credential.id)).toBe(true);
    expect(await credentials.authenticate(issued.token)).toBeNull();
    expect((await credentials.list())[0]?.revokedAt).toBeTruthy();
  });
});
