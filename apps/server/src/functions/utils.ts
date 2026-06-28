/**
 * Helpers shared between the legacy coarse handlers (`app-artifacts.ts`) and
 * the command vocabulary (`commands.ts`) while both write paths coexist
 * (transition window while legacy coarse handlers and the command vocabulary coexist).
 */
import type { ArtifactProvenance } from "@dashframe/server-core";
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
  /** Optional non-credential config for Postgres: default schema to list (default: "public"). */
  defaultSchema?: string;
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
 * Context key marking a handler invocation as the PUBLISH REPLAY of a draft's
 * command log (not a direct canonical call). The draft RPC `publishDraft` passes
 * `{ [PUBLISH_REPLAY_CONTEXT_KEY]: true }` into `DraftController.publishDraft`,
 * which forwards it (minus `draftId`) into the `applyCommands(mode:'commit')`
 * context — so every replayed handler sees it.
 *
 * It is the signal credential command handlers use to recognise the one
 * sanctioned canonical-commit path: {@link shouldDeferRelease} returns true on it,
 * so the replay defers the replaced ref's release to the publish RPC (which runs
 * the release post-commit). A *direct* canonical commit (no draft, no replay)
 * defers nothing and releases the prior ref synchronously.
 */
export const PUBLISH_REPLAY_CONTEXT_KEY = "__publishReplay";

/**
 * True when the handler is running inside a draft append — `appendToDraft` threads
 * the `draftId` into the handler context. On this path credential writes are
 * captured to refs BEFORE the log snapshot and their release is deferred to the
 * publish/discard transition, so synchronous release must NOT fire here.
 */
export function inDraftContext(ctx: FunctionContext): boolean {
  return (ctx as Record<string, unknown>).draftId != null;
}

/** True when the handler is running as the publish replay of a draft log. */
export function isPublishReplay(ctx: FunctionContext): boolean {
  return (ctx as Record<string, unknown>)[PUBLISH_REPLAY_CONTEXT_KEY] === true;
}

/**
 * Whether a credential command should DEFER release of the prior vault ref to a
 * lifecycle transition instead of releasing it synchronously. True on the two
 * transition-backed paths:
 *   - a draft append (`inDraftContext`)  — discard/publish releases later;
 *   - the publish replay (`isPublishReplay`) — the RPC releases post-commit, with
 *     the cross-draft check.
 * A DIRECT canonical call is neither, so it keeps synchronous release (the prior
 * ref is released inline — no transition will run to clean it up).
 */
export function shouldDeferRelease(ctx: FunctionContext): boolean {
  return inDraftContext(ctx) || isPublishReplay(ctx);
}

/**
 * Validate a raw artifact-provenance value (carried in a command's args by the
 * EMITTER) into an {@link ArtifactProvenance}, defaulting to `{ kind: "user" }`.
 *
 * Provenance must travel IN the command, not the handler context: publish replays
 * the durable command log, and the append-time context is not persisted — so a
 * context-only provenance would be lost on publish. The agent enablement emits
 * `createdBy: { kind: "agent" }` as a command arg; it round-trips through the log
 * to the canonical row. A malformed/absent value falls back to user (fail-safe:
 * an unrecognised provenance is never silently trusted as agent).
 *
 * INVARIANT — provenance is CALLER-ASSERTED, not authenticated. `kind` travels in
 * the command (it must, to survive publish replay), so any emitter can claim
 * `agent`. This is a DISPLAY/AUDIT signal ONLY and MUST NEVER gate a privileged
 * operation or a trust decision. Authenticating the emitter belongs with the
 * agent-dispatch seam (a context flag the dispatcher sets, which this would then
 * consult) — that seam is not built yet, so the field stays caller-asserted until
 * it exists. See PR #188 review thread (provenance spoofing).
 */
export function coerceProvenance(value: unknown): ArtifactProvenance {
  if (isRecord(value) && (value.kind === "user" || value.kind === "agent")) {
    const prov: ArtifactProvenance = { kind: value.kind };
    if (typeof value.id === "string") prov.id = value.id;
    if (typeof value.runId === "string") prov.runId = value.runId;
    return prov;
  }
  return { kind: "user" };
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
 * Called in three places: (1) before a data-source row is deleted, (2) when a
 * credential field is cleared (CLEAR branch in {@link applyCredentialField}),
 * (3) when a credential is overwritten with a new value (ROTATE branch). In all
 * cases the goal is to avoid orphaned keychain blobs + mapping rows.
 *
 * Callers may pass a full config or a single-field slice
 * (`{ [field]: prior }`); only fields that satisfy {@link isSecretRef} are
 * included in the delete batch, so an absent or non-ref field is always a no-op.
 *
 * **Vault-absent policy (fail-closed consistency):** `storeCredential` throws
 * when no vault is injected, so a config holding a real `SecretRef` could only
 * have been written with a vault present. If that same vault is absent at
 * release time — which would be a server mis-configuration — we throw rather
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
 *   - `""`        → CLEAR the credential: release the prior vault ref (if any),
 *                   then delete the key so `hasApiKey` reads false.
 *                   (Empty string is an explicit "remove it", never a stored value —
 *                   storing it would make `vault.has(ref)` lie.)
 *   - non-empty   → store via the vault and write the returned `SecretRef`, then
 *                   release the prior ref so the old keychain blob + mapping row
 *                   do not accumulate as permanent orphans (rotate path).
 *
 * **Release ordering (rotate):** the new ref is stored first, then the old one is
 * released. This way a failure mid-rotate does not orphan the newly-stored secret;
 * the worst-case outcome is that the old secret lingers until the next successful
 * rotate (idempotent cleanup, same as the delete-path guarantee).
 *
 * **Preview-mode guard:** vault deletes are keychain side-effects outside the DB
 * transaction. In preview mode the transaction rolls back, so neither the new store
 * nor a release of the old ref should touch the keychain. The clear and rotate
 * release calls are skipped when `preview` is `true`, mirroring the guard that the
 * DeleteNode / removeDataSource paths apply via `modeFromCtx()`.
 *
 * **Vault-absent (clear):** `storeCredential` throws on vault-absent + non-empty
 * plaintext, so a real `SecretRef` in `config[field]` could only have been written
 * with a vault present. A clear with no vault and no prior ref is therefore a valid
 * no-op. `releaseCredentialRefs` early-returns when no `isSecretRef` value is found,
 * so passing a single-field slice is always safe for an already-absent field.
 *
 * The vault-absent refusal lives in {@link storeCredential}, so a clear (`""`) or
 * an untouched field (`undefined`) with no prior ref does NOT require a vault.
 *
 * @param preview When `true` (preview-mode execution) the vault write is skipped
 *   and a no-op placeholder ref is stored instead. See {@link storeCredential}.
 *   Vault releases are also skipped in preview mode.
 * @param deferRelease When `true`, the release of the PRIOR ref (clear / rotate)
 *   is SKIPPED — it is deferred to a lifecycle transition (publish releases the
 *   replaced canonical ref; discard releases the draft-minted ref). The
 *   deferred-release credential commands (CreateDataSource/SetDataSourceConfig)
 *   pass this; the legacy coarse handlers leave it `false` (synchronous release).
 *
 * **Ref pass-through (capture-before-log):** on the deferred path (`deferRelease`
 * — a draft append or publish replay) a `SecretRef` value is ADOPTED verbatim,
 * never re-stored (re-storing double-wraps it as plaintext and writes the ref into
 * the durable log). This is the seam that keeps plaintext out of the log. The gate
 * is deliberate: on a DIRECT canonical call a ref-shaped input is treated as
 * plaintext and stored, so the fail-closed vault guard cannot be bypassed.
 */
export async function applyCredentialField(
  config: DataSourceConfig,
  field: "apiKey" | "connectionString",
  value: string | undefined,
  vault: SecretVault | undefined,
  locatorHint: string,
  preview = false,
  deferRelease = false,
  /**
   * When provided (and `!preview && !deferRelease`), the superseded prior ref
   * is PUSHED into this array instead of being released immediately. The caller
   * is then responsible for: (1) performing the canonical DB write, (2) calling
   * `flushSnapshot()` to ensure the snapshot capturing the new config is durable,
   * and (3) calling `releaseCredentialRefs` (or equivalent) on the collected refs.
   *
   * This deferred-release collector is the fix for the legacy synchronous release
   * path's crash window: previously the prior ref was released inside this function
   * BEFORE the caller wrote the new config to the DB and flushed the snapshot,
   * leaving a window where the ref was gone from the vault but the snapshot could
   * still reference it. With the collector, the caller can guarantee the ordering:
   *   store-new → canonical-write → flush-snapshot → release-old.
   *
   * When `superseded` is `undefined`, behaviour is unchanged: immediate release
   * (backward-compatible for callers not exercising the flush-before-release path).
   */
  superseded?: SecretRef[],
): Promise<void> {
  if (value === undefined) return; // not part of this write
  const prior = config[field];
  if (value.length === 0) {
    // CLEAR branch: release the prior vault ref before dropping the config key.
    // Release is skipped in preview (rolled back) and when deferred to a
    // transition (the publish/discard path releases the prior ref instead).
    // When a collector is provided, push instead of releasing immediately.
    if (!preview && !deferRelease) {
      if (superseded != null && isSecretRef(prior)) {
        superseded.push(prior);
      } else {
        await releaseCredentialRefs({ [field]: prior }, vault);
      }
    }
    delete config[field]; // explicit clear
    return;
  }
  if (isSecretRef(value) && deferRelease) {
    // PASS-THROUGH — ONLY on the deferred (draft / publish-replay) path, where a
    // ref-valued credential was minted by capture-before-log or replayed from the
    // durable log. Adopt it; never re-store (re-storing double-wraps it as plaintext
    // and writes it into the log). The deferRelease gate is load-bearing: on a
    // DIRECT canonical call a ref-shaped input must NOT be adopted — otherwise a
    // user-supplied "secret:<uuid>" string would skip storeCredential, bypassing the
    // fail-closed vault guard and (on rotate) releasing the old live ref while the
    // config points at an unverified secret. Direct calls fall to the store branch.
    config[field] = value;
  } else {
    // ROTATE/SET branch: plaintext (or a ref-shaped input on a direct call) → store,
    // adopt the returned ref. store-new-first preserves the new secret if a later
    // release fails.
    config[field] = await storeCredential(vault, value, locatorHint, preview);
  }
  // Release the prior ref unless it is unchanged (idempotent re-set of the same
  // ref — releasing it would destroy the live secret the new config points at),
  // skipped in preview, or deferred to a lifecycle transition.
  // When a collector is provided, push instead of releasing immediately.
  if (!preview && !deferRelease && prior !== config[field]) {
    if (superseded != null && isSecretRef(prior)) {
      superseded.push(prior);
    } else {
      await releaseCredentialRefs({ [field]: prior }, vault);
    }
  }
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
