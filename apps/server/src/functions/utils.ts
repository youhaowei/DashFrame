/**
 * Helpers shared between the legacy coarse handlers (`app-artifacts.ts`) and
 * the command vocabulary (`commands.ts`) while both write paths coexist
 * (transition window while legacy coarse handlers and the command vocabulary coexist).
 */
import type { SecretRef, SecretVault } from "@wystack/secret-vault";
import type { FunctionContext } from "@wystack/server";

/**
 * The shape of the `config` jsonb column on `data_sources`.
 *
 * Credential fields hold a `SecretRef` string (`secret:<uuid>`) rather than
 * plaintext. The plaintext is stored in the SecretVault and never persisted
 * here. The ref is `undefined` when the credential has not been set.
 */
export type DataSourceConfig = {
  /** SecretRef for the API key (format: `secret:<uuid>`). Never plaintext. */
  apiKey?: string;
  /** SecretRef for the connection string (format: `secret:<uuid>`). Never plaintext. */
  connectionString?: string;
};

/**
 * Extract the `SecretVault` from a handler context.
 * Returns `undefined` when no vault was injected into this server.
 *
 * Storing a credential REQUIRES the vault — see {@link storeCredential}. There
 * is no plaintext path: persisting a raw credential to `data_sources.config`
 * would violate the plaintext-never-at-rest invariant. A write that sets no
 * credential does not consult the vault and is unaffected by its absence.
 */
export function vaultFromCtx(ctx: FunctionContext): SecretVault | undefined {
  return ctx.vault as SecretVault | undefined;
}

/**
 * Store one connector credential and return its `SecretRef`.
 *
 * The server's contract: a credential can only be persisted as a vault ref. No
 * injected vault → refuse the write (throw); never persist plaintext.
 * Plaintext-never-at-rest is an invariant, not a feature with a degraded mode,
 * so refusal is the only correct vault-absent behaviour. (Mirrors the keychain
 * backend, which throws on an unavailable / `basic_text` store rather than
 * writing an unprotected secret.)
 *
 * This is the single choke point every credential write routes through, so the
 * invariant is enforced by construction: no write path can forget the guard.
 * The rule is host-agnostic — this code never knows or cares which host
 * composed the server; it knows only "vault present → store ref" / "vault
 * absent → throw".
 *
 * @param vault     The vault from {@link vaultFromCtx}, or `undefined`.
 * @param plaintext The raw credential to store.
 * @param locatorHint A human-readable hint for the backend's locator.
 * @throws when `vault` is `undefined` — the write must abort, persisting nothing.
 */
export async function storeCredential(
  vault: SecretVault | undefined,
  plaintext: string,
  locatorHint: string,
): Promise<SecretRef> {
  if (vault == null) {
    throw new Error(
      "[secret-vault] cannot store a credential: this server has no vault " +
        "injected — refusing to persist plaintext.",
    );
  }
  return vault.store(plaintext, { class: "connector-key", locatorHint });
}

/**
 * Apply an inbound credential value to a config slice, in place. Three-way:
 *
 *   - `undefined` → leave the existing config key untouched (not part of this write).
 *   - `""`        → CLEAR the credential: delete the key so `hasApiKey` reads false.
 *                   (Empty string is an explicit "remove it", never a stored value —
 *                   storing it would make `vault.has(ref)` lie.) The old vault ref
 *                   is orphaned, not deleted — same deferred cleanup as rotation.
 *   - non-empty   → store via the vault and write the returned `SecretRef`.
 *
 * The vault-absent refusal lives in {@link storeCredential}, so a clear (`""`) or
 * an untouched field (`undefined`) does NOT require a vault — only a real store does.
 */
export async function applyCredentialField(
  config: DataSourceConfig,
  field: "apiKey" | "connectionString",
  value: string | undefined,
  vault: SecretVault | undefined,
  locatorHint: string,
): Promise<void> {
  if (value === undefined) return; // not part of this write
  if (value.length === 0) {
    delete config[field]; // explicit clear
    return;
  }
  config[field] = await storeCredential(vault, value, locatorHint);
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
