import {
  getAssistantProviderCatalog,
  loginAssistantProviderOAuth,
  resolveAssistantProvider,
  type StoredAssistantProviderConfig,
} from "@dashframe/assistant";
import { CREDENTIAL_CLASS, schema } from "@dashframe/server-core";
import type {
  AssistantProviderAuthKind,
  AssistantProviderCatalogEntry,
  AssistantProviderConfig,
  SaveAssistantProviderConfigInput,
  SetAssistantDefaultModelInput,
} from "@dashframe/types";
import { eq, jsonb, uuid } from "@wystack/db";
import { isSecretRef, type SecretRef } from "@wystack/secret-vault";
import { spawn } from "node:child_process";
import { z } from "zod";

import { wy } from "../wystack";
import {
  flushThenReleaseRefs,
  vaultFromCtx,
  withClassBoundaryMessage,
} from "./utils";

function flushSnapshotFromCtx(ctx: unknown): (() => Promise<void>) | undefined {
  return (ctx as Record<string, unknown>).flushSnapshot as
    | (() => Promise<void>)
    | undefined;
}

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
  expectedDefaultModel: z.string().min(1),
  defaultModel: z.string().min(1),
}) satisfies z.ZodType<SetAssistantDefaultModelInput>;

// Opens the OAuth URL in a browser ON THE SERVER HOST — a desktop-app
// assumption (Electron main runs next to the user's browser). A hosted
// deployment must replace this with a client-side redirect flow.
function openAuthUrl(url: string): Promise<void> {
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
  return new Promise((resolve, reject) => {
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}

function deviceCodeVerificationUrl(info: {
  verificationUri: string;
  userCode: string;
}): string {
  const verificationUriComplete = (
    info as { verificationUriComplete?: unknown }
  ).verificationUriComplete;
  if (
    typeof verificationUriComplete === "string" &&
    verificationUriComplete.trim()
  ) {
    return verificationUriComplete;
  }
  throw new Error(
    "device-code flow requires displaying a user code, not supported in this host flow yet",
  );
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
  const vault = args.vault;
  return withClassBoundaryMessage(() =>
    vault.store(args.plaintext as string, {
      class: CREDENTIAL_CLASS.AssistantProvider,
      locatorHint: args.locatorHint,
    }),
  );
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

const listAssistantProviderCatalog = wy.procedure
  .input({})
  .query(
    async (): Promise<AssistantProviderCatalogEntry[]> =>
      getAssistantProviderCatalog(),
  );

const listAssistantProviderConfigs = wy.procedure
  .input({})
  .query(async (ctx): Promise<AssistantProviderConfig[]> => {
    const rows = (await ctx.db
      .from(assistantProviderConfigs)
      .all()) as AssistantProviderConfigRow[];
    return rows.map(rowToDto);
  });

const saveAssistantProviderConfig = wy.procedure
  .input({ input: jsonb })
  .mutation(async (ctx, { input }): Promise<AssistantProviderConfig> => {
    const parsed = saveInputSchema.parse(input);
    // The schema keeps providerId a plain string (the catalog is runtime
    // data); reject unknown providers here so a bad id can never reach the
    // KnownProvider casts in the model-resolution path.
    if (
      !getAssistantProviderCatalog().some(
        (entry) => entry.providerId === parsed.providerId,
      )
    ) {
      throw new Error(`Unknown assistant provider: ${parsed.providerId}`);
    }
    const vault = vaultFromCtx(ctx);
    const id = parsed.id ?? crypto.randomUUID();
    const current = parsed.id
      ? ((await ctx.db
          .from(assistantProviderConfigs)
          .where(eq("id", parsed.id))
          .first()) as AssistantProviderConfigRow | undefined)
      : undefined;
    const mintedRef = await storeAssistantCredential({
      vault,
      plaintext: parsed.credential,
      locatorHint: `assistant-provider-${id}`,
    });

    // The row write and the default-reset commit atomically; a failure rolls
    // back the whole transaction, so no committed row can reference mintedRef.
    // Only then is the compensating deleteRef(mintedRef) safe — releasing a
    // ref that a committed row references would corrupt the config.
    let row: AssistantProviderConfigRow;
    try {
      row = await ctx.db.transaction(async (tx) => {
        let written: AssistantProviderConfigRow | undefined;
        if (current) {
          const [updated] = (await tx
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
          written = updated;
        } else {
          const [inserted] = (await tx.into(assistantProviderConfigs).insert({
            id,
            providerId: parsed.providerId,
            displayLabel: parsed.displayLabel,
            authKind: parsed.authKind,
            baseUrl: parsed.baseUrl?.trim() || null,
            credentialRef: mintedRef ?? null,
            defaultModel: parsed.defaultModel,
            isDefault: parsed.isDefault ?? false,
          })) as AssistantProviderConfigRow[];
          written = inserted;
        }
        if (!written)
          throw new Error("assistant provider config write returned no row");

        if (written.isDefault) {
          const rows = (await tx
            .from(assistantProviderConfigs)
            .all()) as AssistantProviderConfigRow[];
          for (const candidate of rows) {
            if (candidate.id === written.id || !candidate.isDefault) continue;
            await tx
              .from(assistantProviderConfigs)
              .where(eq("id", candidate.id))
              .update({ isDefault: false });
          }
        }
        return written;
      });
    } catch (error) {
      await deleteRef(vault, mintedRef);
      throw error;
    }

    // Post-commit: the row now references mintedRef, so the replaced ref is
    // superseded. Release only after a durable snapshot (fail-closed,
    // best-effort) — releasing before the snapshot holding the new ref is on
    // disk could leave a restored row pointing at a deleted vault entry.
    // Never mintedRef itself past this point.
    if (mintedRef && isSecretRef(current?.credentialRef)) {
      await flushThenReleaseRefs(
        flushSnapshotFromCtx(ctx),
        [current.credentialRef],
        vault ?? undefined,
        "saveAssistantProviderConfig",
      );
    }
    return rowToDto(row);
  });

const removeAssistantProviderConfig = wy.procedure
  .input({ id: uuid })
  .mutation(async (ctx, { id }): Promise<{ ok: true }> => {
    const vault = vaultFromCtx(ctx);
    // The vault release stays OUTSIDE the transaction: it is not rolled back
    // with the DB, so releasing inside could leave a surviving row with a
    // dangling ref if the transaction aborts afterwards. Worst case post-commit
    // is a leaked (unreferenced) secret, never a dangling reference.
    const removed = await ctx.db.transaction(async (tx) => {
      const current = (await tx
        .from(assistantProviderConfigs)
        .where(eq("id", id))
        .first()) as AssistantProviderConfigRow | undefined;
      if (!current) return undefined;
      await tx.from(assistantProviderConfigs).where(eq("id", id)).delete();
      return current;
    });
    if (removed && isSecretRef(removed.credentialRef)) {
      await flushThenReleaseRefs(
        flushSnapshotFromCtx(ctx),
        [removed.credentialRef],
        vault ?? undefined,
        "removeAssistantProviderConfig",
      );
    }
    return { ok: true };
  });

const setAssistantDefaultModel = wy.procedure
  .input({ input: jsonb })
  .mutation(async (ctx, { input }): Promise<{ ok: true }> => {
    const parsed = setDefaultModelSchema.parse(input);
    const updated = await ctx.db
      .from(assistantProviderConfigs)
      .where([
        eq("id", parsed.id),
        eq("defaultModel", parsed.expectedDefaultModel),
      ])
      .update({ defaultModel: parsed.defaultModel });
    if (updated.length !== 1) {
      throw new Error(
        "Assistant model changed before this update could be saved. Please try again.",
      );
    }
    return { ok: true };
  });

const startAssistantOAuthLogin = wy.procedure
  .input({ id: uuid })
  .mutation(async (ctx, { id }): Promise<AssistantProviderConfig> => {
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
    let rejectOpenerFailure: (error: Error) => void = () => {};
    const openerFailure = new Promise<never>((_, reject) => {
      rejectOpenerFailure = reject;
    });
    const openAndTrack = (url: string): Promise<void> => {
      const opened = openAuthUrl(url);
      opened.catch((error: unknown) => {
        rejectOpenerFailure(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
      return opened;
    };
    const credentials = await Promise.race([
      loginAssistantProviderOAuth(row.providerId, {
        onAuth: (info) => openAndTrack(info.url),
        onDeviceCode: (info) => openAndTrack(deviceCodeVerificationUrl(info)),
        onPrompt: async () => {
          throw new Error(
            "Manual OAuth code entry is not available in this host flow.",
          );
        },
        onSelect: async (prompt) =>
          prompt.options.find((option) => option.id === "browser")?.id ??
          prompt.options[0]?.id,
      }),
      openerFailure,
    ]);
    const ref = await storeAssistantCredential({
      vault,
      plaintext: JSON.stringify(credentials),
      locatorHint: `assistant-provider-${row.id}`,
    });
    if (!ref) {
      throw new Error("OAuth login returned no credential to store");
    }
    let updated: AssistantProviderConfigRow | undefined;
    try {
      [updated] = (await ctx.db
        .from(assistantProviderConfigs)
        .where(eq("id", row.id))
        .update({ credentialRef: ref })) as AssistantProviderConfigRow[];
    } catch (error) {
      // Update never committed → releasing the freshly minted ref is safe.
      await deleteRef(vault, ref);
      throw error;
    }
    // Post-commit: the row references the new ref, so only the replaced one is
    // superseded. Release after a durable snapshot (fail-closed, best-effort);
    // never the new ref past this point.
    if (isSecretRef(row.credentialRef)) {
      await flushThenReleaseRefs(
        flushSnapshotFromCtx(ctx),
        [row.credentialRef],
        vault ?? undefined,
        "startAssistantOAuthLogin",
      );
    }
    return rowToDto(updated ?? { ...row, credentialRef: ref });
  });

export async function resolveAssistantProviderConfigForRun(args: {
  row: AssistantProviderConfigRow;
  vault: ReturnType<typeof vaultFromCtx>;
  updateCredentialRef: (ref: SecretRef) => Promise<void>;
  flushSnapshot?: () => Promise<void>;
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
  // Post-commit: the row references newRef, so only the rotated-out ref is
  // superseded. Release after a durable snapshot (fail-closed, best-effort).
  if (isSecretRef(oldRef)) {
    await flushThenReleaseRefs(
      args.flushSnapshot,
      [oldRef],
      args.vault ?? undefined,
      "resolveAssistantProviderConfigForRun",
    );
  }
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
