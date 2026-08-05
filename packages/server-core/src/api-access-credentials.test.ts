import {
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiAccessCredentials } from "./api-access-credentials";
import { CREDENTIAL_CLASS } from "./credential-classes";
import { FileMappingStore } from "./mapping-store";

function makeVault(
  mappingPath: string,
  backend = new TestBackend(),
): { vault: SecretVault; backend: TestBackend } {
  const registry = new SecretRegistry();
  registry.register("test", backend, { fallback: true });
  registry.setClassDefault(CREDENTIAL_CLASS.ServeToken, "test");
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

  it("skips one undecryptable verifier instead of failing authentication for every credential", async () => {
    // A botched rotation (a retired key dropped from the keyring) leaves
    // exactly one verifier unreadable. That must degrade to "this one
    // credential no longer works" rather than 500ing every authenticated
    // request on the host.
    class SelectivelyBrokenBackend extends TestBackend {
      readonly stored: string[] = [];
      readonly poisoned = new Set<string>();

      override async store(
        plaintext: string,
        locatorHint?: string,
      ): Promise<string> {
        const locator = await super.store(plaintext, locatorHint);
        this.stored.push(locator);
        return locator;
      }

      override async withSecret<T>(
        locator: string,
        use: (plaintext: string) => Promise<T>,
      ): Promise<T> {
        if (this.poisoned.has(locator)) {
          throw new Error("simulated undecryptable verifier");
        }
        return super.withSecret(locator, use);
      }
    }

    const backend = new SelectivelyBrokenBackend();
    const { vault } = makeVault(path.join(rootDir, "mappings.json"), backend);
    const credentials = new ApiAccessCredentials(vault, rootDir);

    const broken = await credentials.issue("Stale key");
    const healthy = await credentials.issue("Current key");
    backend.poisoned.add(backend.stored[0] as string);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // The damaged credential fails closed...
      expect(await credentials.authenticate(broken.token)).toBeNull();
      // ...and every other credential still works.
      expect(await credentials.authenticate(healthy.token)).toBe(
        healthy.credential.id,
      );

      const logged = warn.mock.calls.flat().join(" ");
      expect(logged).toContain(broken.credential.id);
      expect(logged).not.toContain(broken.token);
      expect(logged).not.toContain(healthy.token);
    } finally {
      warn.mockRestore();
    }
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
