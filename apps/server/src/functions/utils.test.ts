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

/** A vault shaped exactly like the one `dashframe serve` composes. */
function serveScopedVault(): SecretVault {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend());
  registry.setClassDefault(CREDENTIAL_CLASS.ServeToken, "test");
  return new SecretVault(registry, new InMemoryMappingStore());
}

describe("withClassBoundaryMessage", () => {
  it("translates the registry's class-boundary throw for a serve-scoped vault", async () => {
    await expect(
      storeCredential(serveScopedVault(), "pretend-credential", "hint"),
    ).rejects.toThrow(/require the desktop app/);
  });

  it("keeps the registry throw as the cause", async () => {
    const error = await storeCredential(
      serveScopedVault(),
      "pretend-credential",
      "hint",
    ).catch((thrown: unknown) => thrown);
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
