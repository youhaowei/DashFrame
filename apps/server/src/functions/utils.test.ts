/**
 * Class-boundary translation for `dashframe serve`.
 *
 * `withClassBoundaryMessage` matches on a message thrown by the vault registry,
 * which lives in a package this repo consumes rather than owns. A silent drift
 * in that wording would turn the translation into a no-op and leak a
 * registry-internal message to operators, so these tests drive a real
 * `SecretRegistry` — never a stubbed throw — and are the canary for that drift.
 */
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { describe, expect, it } from "vitest";

import { storeCredential, withClassBoundaryMessage } from "./utils";

/**
 * A vault shaped exactly like the one `dashframe serve` composes today:
 * `serve-token` and `connector-key` both have a backend, `assistant-provider`
 * deliberately does not (apps/server/src/index.ts's
 * createStandaloneSecretServices). `assistant-provider` is the one class this
 * test suite can still exercise the class-boundary translation with.
 */
function serveScopedVault(): SecretVault {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend());
  registry.setClassDefault(CREDENTIAL_CLASS.ServeToken, "test");
  registry.setClassDefault(CREDENTIAL_CLASS.ConnectorKey, "test");
  return new SecretVault(registry, new InMemoryMappingStore());
}

/** A vault with no backend registered for any class, `connector-key` included. */
function unbackedVault(): SecretVault {
  const registry = new SecretRegistry();
  return new SecretVault(registry, new InMemoryMappingStore());
}

describe("withClassBoundaryMessage", () => {
  it("translates the registry's class-boundary throw for a serve-scoped vault", async () => {
    await expect(
      withClassBoundaryMessage(() =>
        serveScopedVault().store("pretend-credential", {
          class: CREDENTIAL_CLASS.AssistantProvider,
          locatorHint: "hint",
        }),
      ),
    ).rejects.toThrow(/requires the desktop app/);
  });

  it("succeeds storing a connector-key credential on a serve-scoped vault (has a backend)", async () => {
    await expect(
      storeCredential(serveScopedVault(), "pretend-credential", "hint"),
    ).resolves.toEqual(expect.any(String));
  });

  // Asserts the translated message on `storeCredential`'s own path, not just
  // on `withClassBoundaryMessage` in isolation. A change that stopped
  // `storeCredential` routing through the wrapper would leak the registry's
  // internal wording to operators while every other test here still passed.
  it("translates on storeCredential's real path, and keeps the registry throw as the cause", async () => {
    const error = await storeCredential(
      unbackedVault(),
      "pretend-credential",
      "hint",
    ).catch((thrown: unknown) => thrown);
    expect((error as Error).message).toMatch(/requires the desktop app/);
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(((error as Error).cause as Error).message).toMatch(
      /No backend configured for class/,
    );
  });

  it("passes unrelated failures through untouched", async () => {
    const boom = new Error("disk on fire");
    await expect(
      withClassBoundaryMessage(() => Promise.reject(boom)),
    ).rejects.toBe(boom);
  });

  it("returns the value when nothing throws", async () => {
    await expect(
      withClassBoundaryMessage(() => Promise.resolve(7)),
    ).resolves.toBe(7);
  });
});
