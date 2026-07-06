import {
  registerOAuthProvider,
  resetOAuthProviders,
  type OAuthCredentials,
} from "@dashframe/assistant";
import { openArtifactDb, schema } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  isSecretRef,
  SecretRegistry,
  SecretVault,
  TestBackend,
  type SecretRef,
} from "@wystack/secret-vault";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AssistantProviderConfig } from "@dashframe/types";
import { buildDashframeApp } from "../app";
import { resolveAssistantProviderConfigForRun } from "./assistant-provider-configs";

function makeTestVault(): SecretVault {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend(), { fallback: true });
  registry.setClassDefault("assistant-provider", "test");
  return new SecretVault(registry, new InMemoryMappingStore());
}

describe("assistant provider config functions", () => {
  let dir: string;
  let db: Awaited<ReturnType<typeof openArtifactDb>>;
  let app: Awaited<ReturnType<typeof buildDashframeApp>>;
  let vault: SecretVault;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "dashframe-assistant-provider-"));
    db = await openArtifactDb({ path: join(dir, "artifacts.db") });
    vault = makeTestVault();
    app = await buildDashframeApp({ db, vault });
  });

  afterEach(async () => {
    resetOAuthProviders();
    await db.$client.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores an API key as a SecretRef and returns only credential presence", async () => {
    const { result } = (await app.call("saveAssistantProviderConfig", {
      input: {
        providerId: "anthropic",
        displayLabel: "Anthropic API",
        authKind: "api-key",
        credential: "test-api-key-input",
        defaultModel: "claude-sonnet-4-5",
        isDefault: true,
      },
    })) as { result: AssistantProviderConfig };

    expect(result.hasCredential).toBe(true);
    expect(JSON.stringify(result)).not.toContain("test-api-key-input");

    const rows = await db.select().from(schema.assistantProviderConfigs);
    expect(rows).toHaveLength(1);
    expect(isSecretRef(rows[0]!.credentialRef)).toBe(true);
    expect(rows[0]!.credentialRef).not.toBe("test-api-key-input");
    await expect(
      vault.withSecret(
        rows[0]!.credentialRef! as SecretRef,
        async (value) => value,
      ),
    ).resolves.toBe("test-api-key-input");
  });

  it("deleting a provider releases the stored SecretRef", async () => {
    const { result } = (await app.call("saveAssistantProviderConfig", {
      input: {
        providerId: "openai",
        displayLabel: "OpenAI",
        authKind: "api-key",
        credential: "openai-secret",
        defaultModel: "gpt-4.1",
      },
    })) as { result: AssistantProviderConfig };
    const rows = await db.select().from(schema.assistantProviderConfigs);
    const ref = rows[0]!.credentialRef! as SecretRef;

    await app.call("removeAssistantProviderConfig", { id: result.id });

    expect(await vault.has(ref)).toBe(false);
    expect(
      await db.select().from(schema.assistantProviderConfigs),
    ).toHaveLength(0);
  });

  it("an error after the row commit never releases the credential the row references", async () => {
    const { result } = (await app.call("saveAssistantProviderConfig", {
      input: {
        providerId: "anthropic",
        displayLabel: "Anthropic API",
        authKind: "api-key",
        credential: "first-secret",
        defaultModel: "claude-sonnet-4-5",
      },
    })) as { result: AssistantProviderConfig };
    const [before] = await db.select().from(schema.assistantProviderConfigs);
    const oldRef = before!.credentialRef! as SecretRef;

    // Fail the post-commit release of the replaced ref. The update row is
    // already committed with the new ref, so the error must propagate WITHOUT
    // the handler releasing that new ref as "compensation".
    vi.spyOn(vault, "delete").mockRejectedValueOnce(
      new Error("vault backend unavailable"),
    );
    await expect(
      app.call("saveAssistantProviderConfig", {
        input: {
          id: result.id,
          providerId: "anthropic",
          displayLabel: "Anthropic API",
          authKind: "api-key",
          credential: "second-secret",
          defaultModel: "claude-sonnet-4-5",
        },
      }),
    ).rejects.toThrow();

    const [after] = await db.select().from(schema.assistantProviderConfigs);
    const newRef = after!.credentialRef! as SecretRef;
    expect(newRef).not.toBe(oldRef);
    await expect(
      vault.withSecret(newRef, async (value) => value),
    ).resolves.toBe("second-secret");
  });

  it("refresh rotation persists a new OAuth credential ref and releases the old ref", async () => {
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
    await app.call("saveAssistantProviderConfig", {
      input: {
        providerId: "anthropic",
        displayLabel: "Anthropic Pro",
        authKind: "oauth",
        credential: JSON.stringify(expired),
        defaultModel: "claude-haiku-4-5",
      },
    });
    const [row] = await db.select().from(schema.assistantProviderConfigs);
    const oldRef = row!.credentialRef! as SecretRef;
    registerOAuthProvider({
      id: "anthropic",
      name: "Test Anthropic",
      login: async () => rotated,
      refreshToken: async () => rotated,
      getApiKey: (credentials) => credentials.access,
    });

    await resolveAssistantProviderConfigForRun({
      row: row!,
      vault,
      updateCredentialRef: async (ref) => {
        await db
          .update(schema.assistantProviderConfigs)
          .set({ credentialRef: ref })
          .where(eq(schema.assistantProviderConfigs.id, row!.id));
      },
    });

    const [updated] = await db.select().from(schema.assistantProviderConfigs);
    expect(updated!.credentialRef).not.toBe(oldRef);
    expect(isSecretRef(updated!.credentialRef)).toBe(true);
    await expect(vault.has(oldRef)).resolves.toBe(false);
    await expect(
      vault.withSecret(updated!.credentialRef! as SecretRef, async (value) =>
        JSON.parse(value),
      ),
    ).resolves.toMatchObject({ access: "new-access" });
  });
});
