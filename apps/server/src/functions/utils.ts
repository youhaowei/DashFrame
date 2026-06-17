/**
 * Helpers shared between the legacy coarse handlers (`app-artifacts.ts`) and
 * the command vocabulary (`commands.ts`) while both write paths coexist
 * (transition window while legacy coarse handlers and the command vocabulary coexist).
 */
import type { SecretRef, SecretVault } from "@wystack/secret-vault";
import { isSecretRef } from "@wystack/secret-vault";
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
 * Extract the execution `mode` flag that `buildPreviewDiff` threads into the
 * handler context via the `context` bag on `applyCommands`.
 *
 * When `mode === "preview"` the handler is running inside an
 * execute-then-rollback preview transaction. Vault writes (keychain blobs +
 * mapping rows) are NOT part of that transaction and therefore survive the
 * rollback — any `vault.store()` call in preview mode mints a permanently
 * orphaned secret. Callers must skip vault writes when this returns `"preview"`.
 *
 * Returns `"commit"` (or `undefined`) for normal mutations.
 */
export function modeFromCtx(
  ctx: FunctionContext,
): "commit" | "preview" | undefined {
  const m = ctx.mode;
  if (m === "preview" || m === "commit") return m;
  return undefined;
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
 * **Preview mode:** when `preview` is `true` the handler is running inside an
 * execute-then-rollback transaction. `vault.store()` is a keychain side-effect
 * that survives the DB rollback, so calling it would permanently orphan a
 * secret for every preview invocation. Instead, synthesise a throwaway
 * placeholder ref — the string `"secret:preview-noop"`. It is recognisably
 * non-canonical (a real ref is a UUID), so it cannot be confused with a real
 * secret, and it is never written to the mapping store or keychain backend.
 * The diff produced by preview still type-checks and renders; it just must not
 * touch the vault.
 *
 * @param vault     The vault from {@link vaultFromCtx}, or `undefined`.
 * @param plaintext The raw credential to store.
 * @param locatorHint A human-readable hint for the backend's locator.
 * @param preview   When `true`, skip the vault write and return a no-op ref.
 * @throws when `vault` is `undefined` and `preview` is false — the write must
 *   abort, persisting nothing.
 */
export async function storeCredential(
  vault: SecretVault | undefined,
  plaintext: string,
  locatorHint: string,
  preview = false,
): Promise<SecretRef> {
  if (preview) {
    // Preview mode: return a non-canonical placeholder. Real refs are UUIDs;
    // this sentinel is intentionally recognisable and never stored.
    return "secret:preview-noop" as SecretRef;
  }
  if (vault == null) {
    throw new Error(
      "[secret-vault] cannot store a credential: this server has no vault " +
        "injected — refusing to persist plaintext.",
    );
  }
  return vault.store(plaintext, { class: "connector-key", locatorHint });
}

/**
 * Release every `SecretRef` present in a `DataSourceConfig` from the vault.
 * Called before a data-source row is deleted so the mapping row and backend
 * blob do not accumulate as permanent orphans in the OS keychain.
 *
 * **Vault-absent policy (fail-closed consistency):** `storeCredential` throws
 * when no vault is injected, so a config holding a real `SecretRef` could only
 * have been written with a vault present. If that same vault is absent at
 * delete time — which would be a server mis-configuration — we throw rather
 * than silently leaving an orphan. This keeps the invariant symmetric: the
 * fail-closed store implies a fail-closed delete.
 *
 * `vault.delete(ref)` is idempotent — a missing ref is a no-op — so calling
 * this on a config with no credential fields is always safe.
 *
 * Every ref is attempted (allSettled), not deleted in a short-circuiting
 * sequence: a sequential `await` loop that threw on the first ref would leave
 * the remaining refs un-deleted while the row is still slated for deletion —
 * a partial orphan. Attempting all of them, then throwing an aggregate if any
 * failed, keeps a single failure from skipping the rest. delete is idempotent,
 * so a later retry safely re-runs the no-op deletes alongside the failed one.
 */
export async function releaseCredentialRefs(
  config: DataSourceConfig,
  vault: SecretVault | undefined,
): Promise<void> {
  const refs: SecretRef[] = [];
  if (isSecretRef(config.apiKey)) refs.push(config.apiKey);
  if (isSecretRef(config.connectionString)) refs.push(config.connectionString);
  if (refs.length === 0) return;
  if (vault == null) {
    throw new Error(
      "[secret-vault] cannot release credential refs: this server has no vault " +
        "injected, but the data-source config holds live SecretRefs. " +
        "A vault that was present at store time must also be present at delete time.",
    );
  }
  const results = await Promise.allSettled(
    refs.map((ref) => vault.delete(ref)),
  );
  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((f) => f.reason),
      `[secret-vault] failed to release ${failures.length} of ${refs.length} credential ref(s)`,
    );
  }
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
 *
 * @param preview When `true` (preview-mode execution) the vault write is skipped
 *   and a no-op placeholder ref is stored instead. See {@link storeCredential}.
 */
export async function applyCredentialField(
  config: DataSourceConfig,
  field: "apiKey" | "connectionString",
  value: string | undefined,
  vault: SecretVault | undefined,
  locatorHint: string,
  preview = false,
): Promise<void> {
  if (value === undefined) return; // not part of this write
  if (value.length === 0) {
    delete config[field]; // explicit clear
    return;
  }
  config[field] = await storeCredential(vault, value, locatorHint, preview);
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
