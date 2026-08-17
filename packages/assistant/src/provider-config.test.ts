import {
  registerOAuthProvider,
  resetOAuthProviders,
  type OAuthCredentials,
} from "@earendil-works/pi-ai/oauth";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { resolveAssistantProvider } from "./provider-config";

function makeVault(): SecretVault {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend(), { fallback: true });
  registry.setClassDefault("assistant-provider", "test");
  return new SecretVault(registry, new InMemoryMappingStore());
}

describe("assistant provider resolution", () => {
  afterEach(() => {
    resetOAuthProviders();
  });

  it("resolves API keys through the vault without exposing the SecretRef", async () => {
    const vault = makeVault();
    const ref = await vault.store("test-api-key-value", {
      class: "assistant-provider",
    });

    const resolved = await resolveAssistantProvider(
      {
        id: crypto.randomUUID(),
        providerId: "anthropic",
        displayLabel: "Anthropic",
        authKind: "api-key",
        credentialRef: ref,
        defaultModel: "claude-haiku-4-5",
      },
      vault,
    );

    expect((resolved.options as { apiKey?: string }).apiKey).toBe(
      "test-api-key-value",
    );
    expect(JSON.stringify(resolved)).not.toContain(ref);
  });

  it("returns rotated OAuth credentials only after pi refresh succeeds", async () => {
    const vault = makeVault();
    const expired: OAuthCredentials = {
      access: "old-access",
      refresh: "old-refresh",
      expires: Date.now() - 1_000,
    };
    const rotated: OAuthCredentials = {
      access: "new-access",
      refresh: "new-refresh",
      expires: Date.now() + 60_000,
    };
    const ref = await vault.store(JSON.stringify(expired), {
      class: "assistant-provider",
    });
    registerOAuthProvider({
      id: "anthropic",
      name: "Test Anthropic",
      login: async () => rotated,
      refreshToken: async (credentials) => {
        expect(credentials.refresh).toBe("old-refresh");
        return rotated;
      },
      getApiKey: (credentials) => credentials.access,
    });

    const resolved = await resolveAssistantProvider(
      {
        id: crypto.randomUUID(),
        providerId: "anthropic",
        displayLabel: "Anthropic Pro",
        authKind: "oauth",
        credentialRef: ref,
        defaultModel: "claude-haiku-4-5",
      },
      vault,
    );

    expect((resolved.options as { apiKey?: string }).apiKey).toBe("new-access");
    expect(resolved.rotatedCredential).toEqual(rotated);
    await expect(vault.has(ref)).resolves.toBe(true);
  });
});
