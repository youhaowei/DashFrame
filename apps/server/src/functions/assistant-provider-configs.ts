import {
  getAssistantProviderCatalog,
  loginAssistantProviderOAuth,
  resolveAssistantProvider,
  type StoredAssistantProviderConfig,
} from "@dashframe/assistant";
import { schema } from "@dashframe/server-core";
import type {
  AssistantProviderAuthKind,
  AssistantProviderCatalogEntry,
  AssistantProviderConfig,
  SaveAssistantProviderConfigInput,
  SetAssistantDefaultModelInput,
} from "@dashframe/types";
import { eq, jsonb, uuid } from "@wystack/db";
import { isSecretRef, type SecretRef } from "@wystack/secret-vault";
import { mutation, query } from "@wystack/server";
import { spawn } from "node:child_process";
import { z } from "zod";

import { vaultFromCtx } from "./utils";

const { assistantProviderConfigs } = schema;

type AssistantProviderConfigRow = typeof assistantProviderConfigs.$inferSelect;

const authKindSchema = z.enum(["api-key", "local", "oauth"]);

const saveInputSchema = z.object({
  id: z.string().uuid().optional(),
  providerId: z.string().min(1),
  displayLabel: z.string().min(1),
  authKind: authKindSchema,
  baseUrl: z.string().trim().optional(),
  credential: z.string().optional(),
  defaultModel: z.string().min(1),
  isDefault: z.boolean().optional(),
}) satisfies z.ZodType<SaveAssistantProviderConfigInput>;

const setDefaultModelSchema = z.object({
  id: z.string().uuid(),
  defaultModel: z.string().min(1),
}) satisfies z.ZodType<SetAssistantDefaultModelInput>;

function openAuthUrl(url: string): void {
  let opener = "xdg-open";
  if (process.platform === "darwin") {
    opener = "open";
  } else if (process.platform === "win32") {
    opener = "cmd";
  }
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(opener, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function millis(value: Date): number {
  return value.getTime();
}

function rowToDto(row: AssistantProviderConfigRow): AssistantProviderConfig {
  return {
    id: row.id,
    providerId: row.providerId,
    displayLabel: row.displayLabel,
    authKind: row.authKind as AssistantProviderAuthKind,
    baseUrl: row.baseUrl ?? undefined,
    hasCredential: isSecretRef(row.credentialRef),
    defaultModel: row.defaultModel,
    isDefault: row.isDefault,
    createdAt: millis(row.createdAt),
    updatedAt: millis(row.updatedAt),
  };
}

function rowToStored(
  row: AssistantProviderConfigRow,
): StoredAssistantProviderConfig {
  return {
    id: row.id,
    providerId: row.providerId,
    displayLabel: row.displayLabel,
    authKind: row.authKind as AssistantProviderAuthKind,
    baseUrl: row.baseUrl,
    credentialRef: row.credentialRef,
    defaultModel: row.defaultModel,
  };
}

async function storeAssistantCredential(args: {
  vault: ReturnType<typeof vaultFromCtx>;
  plaintext: string | undefined;
  locatorHint: string;
}): Promise<SecretRef | undefined> {
  if (args.plaintext === undefined || args.plaintext.length === 0) {
    return undefined;
  }
  if (args.vault == null) {
    throw new Error(
      "[secret-vault] cannot store assistant provider credential: no vault injected",
    );
  }
  return args.vault.store(args.plaintext, {
    class: "assistant-provider",
    locatorHint: args.locatorHint,
  });
}

async function deleteRef(
  vault: ReturnType<typeof vaultFromCtx>,
  ref: unknown,
): Promise<void> {
  if (!isSecretRef(ref)) return;
  if (vault == null) {
    throw new Error(
      "[secret-vault] cannot release assistant provider credential: no vault injected",
    );
  }
  await vault.delete(ref);
}

const listAssistantProviderCatalog = query({
  args: {},
  handler: async (): Promise<AssistantProviderCatalogEntry[]> =>
    getAssistantProviderCatalog(),
});

const listAssistantProviderConfigs = query({
  args: {},
  handler: async (ctx): Promise<AssistantProviderConfig[]> => {
    const rows = (await ctx.db
      .from(assistantProviderConfigs)
      .all()) as AssistantProviderConfigRow[];
    return rows.map(rowToDto);
  },
});

const saveAssistantProviderConfig = mutation({
  args: { input: jsonb },
  handler: async (ctx, { input }): Promise<AssistantProviderConfig> => {
    const parsed = saveInputSchema.parse(input);
    const vault = vaultFromCtx(ctx);
    const id = parsed.id ?? crypto.randomUUID();
    const mintedRef = await storeAssistantCredential({
      vault,
      plaintext: parsed.credential,
      locatorHint: `assistant-provider-${id}`,
    });
    const current = parsed.id
      ? ((await ctx.db
          .from(assistantProviderConfigs)
          .where(eq("id", parsed.id))
          .first()) as AssistantProviderConfigRow | undefined)
      : undefined;

    try {
      let row: AssistantProviderConfigRow | undefined;
      if (current) {
        const [updated] = (await ctx.db
          .from(assistantProviderConfigs)
          .where(eq("id", current.id))
          .update({
            providerId: parsed.providerId,
            displayLabel: parsed.displayLabel,
            authKind: parsed.authKind,
            baseUrl: parsed.baseUrl?.trim() || null,
            credentialRef: mintedRef ?? current.credentialRef,
            defaultModel: parsed.defaultModel,
            isDefault: parsed.isDefault ?? current.isDefault,
          })) as AssistantProviderConfigRow[];
        row = updated;
      } else {
        const [inserted] = (await ctx.db.into(assistantProviderConfigs).insert({
          id,
          providerId: parsed.providerId,
          displayLabel: parsed.displayLabel,
          authKind: parsed.authKind,
          baseUrl: parsed.baseUrl?.trim() || null,
          credentialRef: mintedRef ?? null,
          defaultModel: parsed.defaultModel,
          isDefault: parsed.isDefault ?? false,
        })) as AssistantProviderConfigRow[];
        row = inserted;
      }
      if (!row)
        throw new Error("assistant provider config write returned no row");

      if (row.isDefault) {
        const rows = (await ctx.db
          .from(assistantProviderConfigs)
          .all()) as AssistantProviderConfigRow[];
        await Promise.all(
          rows
            .filter(
              (candidate) => candidate.id !== row!.id && candidate.isDefault,
            )
            .map((candidate) =>
              ctx.db
                .from(assistantProviderConfigs)
                .where(eq("id", candidate.id))
                .update({ isDefault: false }),
            ),
        );
      }

      if (mintedRef && current?.credentialRef !== mintedRef) {
        await deleteRef(vault, current?.credentialRef);
      }
      return rowToDto(row);
    } catch (error) {
      await deleteRef(vault, mintedRef);
      throw error;
    }
  },
});

const removeAssistantProviderConfig = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    const vault = vaultFromCtx(ctx);
    await ctx.db.transaction(async (tx) => {
      const current = (await tx
        .from(assistantProviderConfigs)
        .where(eq("id", id))
        .first()) as AssistantProviderConfigRow | undefined;
      if (!current) return;
      await tx.from(assistantProviderConfigs).where(eq("id", id)).delete();
      await deleteRef(vault, current.credentialRef);
    });
    return { ok: true };
  },
});

const setAssistantDefaultModel = mutation({
  args: { input: jsonb },
  handler: async (ctx, { input }): Promise<{ ok: true }> => {
    const parsed = setDefaultModelSchema.parse(input);
    await ctx.db
      .from(assistantProviderConfigs)
      .where(eq("id", parsed.id))
      .update({ defaultModel: parsed.defaultModel, isDefault: true });
    const rows = (await ctx.db
      .from(assistantProviderConfigs)
      .all()) as AssistantProviderConfigRow[];
    await Promise.all(
      rows
        .filter((row) => row.id !== parsed.id && row.isDefault)
        .map((row) =>
          ctx.db
            .from(assistantProviderConfigs)
            .where(eq("id", row.id))
            .update({ isDefault: false }),
        ),
    );
    return { ok: true };
  },
});

const startAssistantOAuthLogin = mutation({
  args: { id: uuid },
  handler: async (ctx, { id }): Promise<AssistantProviderConfig> => {
    const vault = vaultFromCtx(ctx);
    const row = (await ctx.db
      .from(assistantProviderConfigs)
      .where(eq("id", id))
      .first()) as AssistantProviderConfigRow | undefined;
    if (!row) {
      throw new Error("Assistant provider config not found");
    }
    if (row.authKind !== "oauth") {
      throw new Error("Assistant provider is not configured for OAuth");
    }
    const credentials = await loginAssistantProviderOAuth(row.providerId, {
      onAuth: (info) => openAuthUrl(info.url),
      onDeviceCode: (info) => openAuthUrl(info.verificationUri),
      onPrompt: async () => {
        throw new Error(
          "Manual OAuth code entry is not available in this host flow.",
        );
      },
      onSelect: async (prompt) =>
        prompt.options.find((option) => option.id === "browser")?.id ??
        prompt.options[0]?.id,
    });
    const ref = await storeAssistantCredential({
      vault,
      plaintext: JSON.stringify(credentials),
      locatorHint: `assistant-provider-${row.id}`,
    });
    if (!ref) {
      throw new Error("OAuth login returned no credential to store");
    }
    try {
      const [updated] = (await ctx.db
        .from(assistantProviderConfigs)
        .where(eq("id", row.id))
        .update({ credentialRef: ref })) as AssistantProviderConfigRow[];
      await deleteRef(vault, row.credentialRef);
      return rowToDto(updated ?? { ...row, credentialRef: ref });
    } catch (error) {
      await deleteRef(vault, ref);
      throw error;
    }
  },
});

export async function resolveAssistantProviderConfigForRun(args: {
  row: AssistantProviderConfigRow;
  vault: ReturnType<typeof vaultFromCtx>;
  updateCredentialRef: (ref: SecretRef) => Promise<void>;
}): Promise<Awaited<ReturnType<typeof resolveAssistantProvider>>> {
  const resolved = await resolveAssistantProvider(
    rowToStored(args.row),
    args.vault,
  );
  if (!resolved.rotatedCredential) return resolved;
  const oldRef = args.row.credentialRef;
  const newRef = await storeAssistantCredential({
    vault: args.vault,
    plaintext: JSON.stringify(resolved.rotatedCredential),
    locatorHint: `assistant-provider-${args.row.id}`,
  });
  if (!newRef) return resolved;
  try {
    await args.updateCredentialRef(newRef);
  } catch (error) {
    await deleteRef(args.vault, newRef);
    throw error;
  }
  await deleteRef(args.vault, oldRef);
  return resolved;
}

export const assistantProviderConfigFunctions = {
  listAssistantProviderCatalog,
  listAssistantProviderConfigs,
  saveAssistantProviderConfig,
  removeAssistantProviderConfig,
  setAssistantDefaultModel,
  startAssistantOAuthLogin,
};
