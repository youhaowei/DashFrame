import {
  registerOAuthProvider,
  resetOAuthProviders,
  type OAuthCredentials,
} from "@dashframe/assistant";
import {
  CREDENTIAL_CLASS,
  openArtifactDb,
  schema,
} from "@dashframe/server-core";
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
  registry.setClassDefault(CREDENTIAL_CLASS.AssistantProvider, "test");
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
    const baseApp = await buildDashframeApp({ db, vault });
    // Mirror createDashframeServer's serverContext seam: production merges a
    // durable flushSnapshot hook into every call context, and the post-commit
    // credential release is gated on it (fail-closed).
    app = {
      ...baseApp,
      call: (path, args, ctx) =>
        baseApp.call(path, args, {
          ...(ctx ?? {}),
          flushSnapshot: async () => {},
        }),
    };
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

  it("switching auth kind without a new credential clears the superseded one", async () => {
    // An omitted credential normally means "keep the stored one". Keeping it
    // across an auth-kind change would leave an `oauth` row pointing at an API
    // key: the row reports a stored credential, and resolving it later fails
    // parsing that key as OAuth JSON.
    const { result: created } = (await app.call("saveAssistantProviderConfig", {
      input: {
        providerId: "anthropic",
        displayLabel: "Anthropic API",
        authKind: "api-key",
        credential: "superseded-api-key",
        defaultModel: "claude-sonnet-4-5",
      },
    })) as { result: AssistantProviderConfig };

    const [before] = await db.select().from(schema.assistantProviderConfigs);
    const oldRef = before!.credentialRef! as SecretRef;
    expect(isSecretRef(oldRef)).toBe(true);

    const { result: switched } = (await app.call(
      "saveAssistantProviderConfig",
      {
        input: {
          id: created.id,
          providerId: "anthropic",
          displayLabel: "Anthropic API",
          authKind: "oauth",
          defaultModel: "claude-sonnet-4-5",
        },
      },
    )) as { result: AssistantProviderConfig };

    expect(switched.hasCredential).toBe(false);
    const [after] = await db.select().from(schema.assistantProviderConfigs);
    expect(after!.authKind).toBe("oauth");
    expect(after!.credentialRef).toBeNull();
    // The old API key is not merely unreferenced — it is released.
    expect(await vault.has(oldRef)).toBe(false);
  });

  it("keeps the stored credential when the auth kind is unchanged", async () => {
    // The clear above must be scoped to an auth-kind change; an ordinary
    // rename that omits the credential must still preserve it.
    const { result: created } = (await app.call("saveAssistantProviderConfig", {
      input: {
        providerId: "openai",
        displayLabel: "OpenAI",
        authKind: "api-key",
        credential: "kept-api-key",
        defaultModel: "gpt-4.1",
      },
    })) as { result: AssistantProviderConfig };

    const { result: renamed } = (await app.call("saveAssistantProviderConfig", {
      input: {
        id: created.id,
        providerId: "openai",
        displayLabel: "OpenAI (work)",
        authKind: "api-key",
        defaultModel: "gpt-4.1",
      },
    })) as { result: AssistantProviderConfig };

    expect(renamed.hasCredential).toBe(true);
    const [after] = await db.select().from(schema.assistantProviderConfigs);
    await expect(
      vault.withSecret(after!.credentialRef! as SecretRef, async (v) => v),
    ).resolves.toBe("kept-api-key");
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

  it("setting a non-default config's model leaves provider defaults untouched", async () => {
    const { result: defaultConfig } = (await app.call(
      "saveAssistantProviderConfig",
      {
        input: {
          providerId: "anthropic",
          displayLabel: "Anthropic API",
          authKind: "api-key",
          credential: "anthropic-secret",
          defaultModel: "claude-sonnet-4-5",
          isDefault: true,
        },
      },
    )) as { result: AssistantProviderConfig };
    const { result: secondaryConfig } = (await app.call(
      "saveAssistantProviderConfig",
      {
        input: {
          providerId: "openai",
          displayLabel: "OpenAI",
          authKind: "api-key",
          credential: "openai-secret",
          defaultModel: "gpt-4.1",
          isDefault: false,
        },
      },
    )) as { result: AssistantProviderConfig };

    await app.call("setAssistantDefaultModel", {
      input: {
        id: secondaryConfig.id,
        expectedDefaultModel: "gpt-4.1",
        defaultModel: "gpt-4.1-mini",
      },
    });

    const rows = await db.select().from(schema.assistantProviderConfigs);
    const defaultRow = rows.find((row) => row.id === defaultConfig.id);
    const secondaryRow = rows.find((row) => row.id === secondaryConfig.id);
    expect(defaultRow?.defaultModel).toBe("claude-sonnet-4-5");
    expect(defaultRow?.isDefault).toBe(true);
    expect(secondaryRow?.defaultModel).toBe("gpt-4.1-mini");
    expect(secondaryRow?.isDefault).toBe(false);
  });

  it("rejects a stale model update instead of overwriting the newer model", async () => {
    const { result: config } = (await app.call("saveAssistantProviderConfig", {
      input: {
        providerId: "openai",
        displayLabel: "OpenAI",
        authKind: "api-key",
        defaultModel: "gpt-4.1",
      },
    })) as { result: AssistantProviderConfig };

    await app.call("setAssistantDefaultModel", {
      input: {
        id: config.id,
        expectedDefaultModel: "gpt-4.1",
        defaultModel: "gpt-4.1-mini",
      },
    });

    await expect(
      app.call("setAssistantDefaultModel", {
        input: {
          id: config.id,
          expectedDefaultModel: "gpt-4.1",
          defaultModel: "gpt-4.1-nano",
        },
      }),
    ).rejects.toThrow(
      "Assistant model changed before this update could be saved",
    );

    const [row] = await db.select().from(schema.assistantProviderConfigs);
    expect(row?.defaultModel).toBe("gpt-4.1-mini");
  });

  it("rejects a providerId that is not in the catalog", async () => {
    await expect(
      app.call("saveAssistantProviderConfig", {
        input: {
          providerId: "not-a-provider",
          displayLabel: "Mystery",
          authKind: "api-key",
          defaultModel: "some-model",
        },
      }),
    ).rejects.toThrow(/Unknown assistant provider/);
    expect(
      await db.select().from(schema.assistantProviderConfigs),
    ).toHaveLength(0);
  });

  it("a release failure after the row commit is swallowed and never touches the committed ref", async () => {
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
    // already committed with the new ref, so the failure must be swallowed
    // (best-effort release — an inert orphan) and the handler must never
    // release that new ref as "compensation".
    vi.spyOn(vault, "delete").mockRejectedValueOnce(
      new Error("vault backend unavailable"),
    );
    await app.call("saveAssistantProviderConfig", {
      input: {
        id: result.id,
        providerId: "anthropic",
        displayLabel: "Anthropic API",
        authKind: "api-key",
        credential: "second-secret",
        defaultModel: "claude-sonnet-4-5",
      },
    });

    const [after] = await db.select().from(schema.assistantProviderConfigs);
    const newRef = after!.credentialRef! as SecretRef;
    expect(newRef).not.toBe(oldRef);
    await expect(
      vault.withSecret(newRef, async (value) => value),
    ).resolves.toBe("second-secret");
    // The failed release leaves the replaced ref as an inert orphan.
    await expect(vault.has(oldRef)).resolves.toBe(true);
  });

  it("a release failure after the OAuth login commit is swallowed and never touches the committed ref", async () => {
    await app.call("saveAssistantProviderConfig", {
      input: {
        providerId: "anthropic",
        displayLabel: "Anthropic Pro",
        authKind: "oauth",
        credential: JSON.stringify({
          access: "old-access",
          refresh: "old-refresh",
          expires: Date.now() + 60_000,
        }),
        defaultModel: "claude-haiku-4-5",
      },
    });
    const [before] = await db.select().from(schema.assistantProviderConfigs);
    const oldRef = before!.credentialRef! as SecretRef;
    registerOAuthProvider({
      id: "anthropic",
      name: "Test Anthropic",
      login: async () => ({
        access: "fresh-access",
        refresh: "fresh-refresh",
        expires: Date.now() + 60_000,
      }),
      refreshToken: async () => {
        throw new Error("not used");
      },
      getApiKey: (credentials) => credentials.access,
    });

    // Fail the post-commit release of the replaced ref. The row is already
    // committed with the new ref, so the failure must be swallowed
    // (best-effort release — an inert orphan) and the handler must never
    // release that new ref as "compensation".
    vi.spyOn(vault, "delete").mockRejectedValueOnce(
      new Error("vault backend unavailable"),
    );
    await app.call("startAssistantOAuthLogin", { id: before!.id });

    const [after] = await db.select().from(schema.assistantProviderConfigs);
    const newRef = after!.credentialRef! as SecretRef;
    expect(newRef).not.toBe(oldRef);
    await expect(
      vault.withSecret(newRef, async (value) => JSON.parse(value)),
    ).resolves.toMatchObject({ access: "fresh-access" });
    // The failed release leaves the replaced ref as an inert orphan.
    await expect(vault.has(oldRef)).resolves.toBe(true);
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
      flushSnapshot: async () => {},
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

  it("rejects device-code OAuth when the host cannot display the user code", async () => {
    const { result } = (await app.call("saveAssistantProviderConfig", {
      input: {
        providerId: "anthropic",
        displayLabel: "Device Code Test",
        authKind: "oauth",
        defaultModel: "test-model",
      },
    })) as { result: AssistantProviderConfig };
    const credentials: OAuthCredentials = {
      access: "access",
      refresh: "refresh",
      expires: Date.now() + 60_000,
    };
    registerOAuthProvider({
      id: "anthropic",
      name: "Device Code Test",
      login: async (callbacks) => {
        callbacks.onDeviceCode({
          userCode: "ABCD-EFGH",
          verificationUri: "https://example.test/device",
        });
        return credentials;
      },
      refreshToken: async () => credentials,
      getApiKey: (value) => value.access,
    });

    await expect(
      app.call("startAssistantOAuthLogin", { id: result.id }),
    ).rejects.toThrow(
      "device-code flow requires displaying a user code, not supported in this host flow yet",
    );
  });
});
