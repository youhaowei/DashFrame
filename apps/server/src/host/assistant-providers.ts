import {
  getAssistantProviderCatalog,
  loginAssistantProviderOAuth,
  resolveAssistantProvider,
  type StoredAssistantProviderConfig,
} from "@dashframe/assistant";
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import type {
  AssistantProviderAuthKind,
  AssistantProviderConfig,
  SaveAssistantProviderConfigInput,
  SetAssistantDefaultModelInput,
} from "@dashframe/types";
import { isSecretRef, type SecretRef } from "@wystack/secret-vault";
import { spawn } from "node:child_process";
import { z } from "zod";

import { requireLocalOperator, type HostContext } from "./context";
import type { AssistantProviderConfigRow } from "./metadata";
const vaultFromCtx = (ctx: HostContext) => ctx.vault;
const withClassBoundaryMessage = <T>(operation: () => Promise<T>) =>
  operation();
const authKindSchema = z.enum(["api-key", "local", "oauth"]);

export const saveInputSchema = z.object({
  id: z.string().uuid().optional(),
  providerId: z.string().min(1),
  displayLabel: z.string().min(1),
  authKind: authKindSchema,
  baseUrl: z.string().trim().optional(),
  credential: z.string().optional(),
  defaultModel: z.string().min(1),
  isDefault: z.boolean().optional(),
}) satisfies z.ZodType<SaveAssistantProviderConfigInput>;

export const setDefaultModelSchema = z.object({
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

function millis(value: number): number {
  return value;
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

function assertVaultPresentForStoredCredential(
  credentialRef: unknown,
  vault: ReturnType<typeof vaultFromCtx>,
  operation: string,
): void {
  if (!isSecretRef(credentialRef) || vault != null) return;
  throw new Error(
    `[secret-vault] cannot ${operation}: assistant provider config holds a credential ref ` +
      "but no vault is injected. The vault that was present at store time must also " +
      "be present when the credential is cleared or removed.",
  );
}

export async function listAssistantProviderCatalog() {
  return getAssistantProviderCatalog();
}

export async function listAssistantProviderConfigs(ctx: HostContext) {
  return (await ctx.metadata.listAssistantProviderConfigs()).map(rowToDto);
}

export async function saveAssistantProviderConfig(
  ctx: HostContext,
  args: { input: SaveAssistantProviderConfigInput },
) {
  requireLocalOperator(ctx);
  const input = saveInputSchema.parse(args.input);
  if (
    !getAssistantProviderCatalog().some(
      (entry) => entry.providerId === input.providerId,
    )
  ) {
    throw new Error("Unknown assistant provider");
  }
  const current = input.id
    ? await ctx.metadata.getAssistantProviderConfig(input.id)
    : null;
  const id = input.id ?? crypto.randomUUID();
  const mintedRef = await storeAssistantCredential({
    vault: ctx.vault,
    plaintext: input.credential,
    locatorHint: `assistant-provider-${id}`,
  });
  const changedKind = current !== null && current.authKind !== input.authKind;
  const clearCredential = changedKind || input.credential === "";
  if (clearCredential)
    assertVaultPresentForStoredCredential(
      current?.credentialRef,
      ctx.vault,
      "clear credential",
    );
  const now = Date.now();
  const row: AssistantProviderConfigRow = {
    id,
    providerId: input.providerId,
    displayLabel: input.displayLabel,
    authKind: input.authKind,
    baseUrl: input.baseUrl?.trim() || null,
    credentialRef:
      mintedRef ?? (clearCredential ? null : (current?.credentialRef ?? null)),
    defaultModel: input.defaultModel,
    isDefault: input.isDefault ?? current?.isDefault ?? false,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  // Convex atomically validates the prior row and changes the default selection.
  // An uncertain HTTP outcome cannot justify deleting the new credential.
  const written = await ctx.metadata.saveAssistantProviderConfig({
    row,
    expected: current,
  });
  if (current?.credentialRef !== written.credentialRef)
    await deleteRef(ctx.vault, current?.credentialRef);
  return rowToDto(written);
}

export async function removeAssistantProviderConfig(
  ctx: HostContext,
  args: { id: string },
) {
  requireLocalOperator(ctx);
  const id = z.string().uuid().parse(args.id);
  const current = await ctx.metadata.getAssistantProviderConfig(id);
  if (!current) throw new Error("Assistant provider config not found");
  assertVaultPresentForStoredCredential(
    current.credentialRef,
    ctx.vault,
    "remove provider",
  );
  await ctx.metadata.removeAssistantProviderConfig({ id, expected: current });
  await deleteRef(ctx.vault, current.credentialRef);
  return { ok: true as const };
}

export async function setAssistantDefaultModel(
  ctx: HostContext,
  args: { input: SetAssistantDefaultModelInput },
) {
  requireLocalOperator(ctx);
  const input = setDefaultModelSchema.parse(args.input);
  const current = await ctx.metadata.getAssistantProviderConfig(input.id);
  if (!current || current.defaultModel !== input.expectedDefaultModel)
    throw new Error("Assistant model changed before this update");
  await ctx.metadata.saveAssistantProviderConfig({
    row: {
      ...current,
      defaultModel: input.defaultModel,
      updatedAt: Date.now(),
    },
    expected: current,
  });
  return { ok: true as const };
}

export async function startAssistantOAuthLogin(
  ctx: HostContext,
  args: { id: string },
) {
  requireLocalOperator(ctx);
  const id = z.string().uuid().parse(args.id);
  const current = await ctx.metadata.getAssistantProviderConfig(id);
  if (!current || current.authKind !== "oauth")
    throw new Error("Assistant provider is not configured for OAuth");
  let rejectOpener: (error: unknown) => void = () => {};
  const failedOpener = new Promise<never>((_resolve, reject) => {
    rejectOpener = reject;
  });
  const open = (url: string) => {
    const result = openAuthUrl(url);
    result.catch(rejectOpener);
    return result;
  };
  const credentials = await Promise.race([
    loginAssistantProviderOAuth(current.providerId, {
      onAuth: (info) => open(info.url),
      onDeviceCode: (info) => open(deviceCodeVerificationUrl(info)),
      onPrompt: async () => {
        throw new Error(
          "Manual OAuth code entry is not available in this host flow.",
        );
      },
      onSelect: async (prompt) =>
        prompt.options.find((option) => option.id === "browser")?.id ??
        prompt.options[0]?.id,
    }),
    failedOpener,
  ]);
  const ref = await storeAssistantCredential({
    vault: ctx.vault,
    plaintext: JSON.stringify(credentials),
    locatorHint: `assistant-provider-${id}`,
  });
  if (!ref) throw new Error("OAuth returned no credential");
  const written = await ctx.metadata.saveAssistantProviderConfig({
    row: { ...current, credentialRef: ref, updatedAt: Date.now() },
    expected: current,
  });
  await deleteRef(ctx.vault, current.credentialRef);
  return rowToDto(written);
}

export async function resolveAssistantProviderConfigForRun(args: {
  row: AssistantProviderConfigRow;
  vault?: HostContext["vault"];
  updateCredentialRef: (ref: SecretRef) => Promise<void>;
}) {
  const resolved = await resolveAssistantProvider(
    rowToStored(args.row),
    args.vault,
  );
  if (resolved.rotatedCredential) {
    const ref = await storeAssistantCredential({
      vault: args.vault,
      plaintext: JSON.stringify(resolved.rotatedCredential),
      locatorHint: `assistant-provider-${args.row.id}`,
    });
    if (ref) {
      await args.updateCredentialRef(ref);
      await deleteRef(args.vault, args.row.credentialRef);
    }
  }
  return resolved;
}
