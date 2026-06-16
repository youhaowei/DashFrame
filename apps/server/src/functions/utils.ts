/**
 * Helpers shared between the legacy coarse handlers (`app-artifacts.ts`) and
 * the command vocabulary (`commands.ts`) while both write paths coexist
 * (transition window while legacy coarse handlers and the command vocabulary coexist).
 */
import type { SecretVault } from "@wystack/secret-vault";
import type { FunctionContext } from "@wystack/server";

/**
 * The shape of the `config` jsonb column on `data_sources`.
 *
 * Post-YW-264: credential fields hold a `SecretRef` string (`secret:<uuid>`)
 * rather than plaintext. The plaintext is stored in the SecretVault and never
 * persisted here. The ref is `undefined` when the credential has not been set.
 */
export type DataSourceConfig = {
  /** SecretRef for the API key (format: `secret:<uuid>`). Never plaintext. */
  apiKey?: string;
  /** SecretRef for the connection string (format: `secret:<uuid>`). Never plaintext. */
  connectionString?: string;
};

/**
 * Extract the `SecretVault` from a handler context.
 * Returns `undefined` when no vault was injected (e.g. in legacy or vault-free
 * test paths). Handlers that need the vault MUST handle the undefined case
 * gracefully (fall back to legacy plaintext behaviour in non-vault paths).
 */
export function vaultFromCtx(ctx: FunctionContext): SecretVault | undefined {
  return ctx.vault as SecretVault | undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRecordWithId(
  value: unknown,
  label: string,
): { id: string } {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error(`${label} must be an object with an id`);
  }
  return value as { id: string };
}
