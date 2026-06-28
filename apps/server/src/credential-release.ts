/**
 * Credential vault-ref lifecycle for the draft command path — capture-before-log
 * and transition-time release.
 *
 * The model (owner decision 2026-06-28): a connector credential is stored as a
 * vault REF; the draft carries the ref, never plaintext; ref RELEASES happen at
 * lifecycle TRANSITIONS (publish / discard), never synchronously inside a draft
 * append and never via a vault-wide scan (the SecretVault `No list()` invariant
 * stays intact — this module enumerates DRAFTS and SOURCES, not vault secrets).
 *
 * Two seams:
 *
 *   1. CAPTURE-BEFORE-LOG ({@link captureCommandCredentials}) — host-injected into
 *      `DraftController.appendToDraft`. Before a credential command is run +
 *      snapshotted into `draft_command_log`, its plaintext credential args are
 *      stored to the vault and rewritten to refs. The command that lands in the
 *      log therefore carries a ref, not plaintext (the plaintext-never-at-rest
 *      invariant rides on this).
 *
 *   2. TRANSITION-TIME RELEASE ({@link releaseRefsAtTransition} + collectors) —
 *      orchestrated by the draft RPC handlers, POST the authoritative transition:
 *        - publish: release the canonical ref each command REPLACES, collected
 *          BEFORE replay (the replay overwrites it) and released AFTER the publish
 *          transaction commits — so a rolled-back publish never deletes a still-
 *          live secret.
 *        - discard: release the refs the draft MINTED (read from its log), after
 *          the draft's log + shadow are dropped.
 *      Both are gated by {@link collectReferencedRefs}: a ref still referenced by
 *      canonical or by another OPEN draft's shadow/log is never released.
 *
 * Shares its release mechanism (transaction-aware credential cleanup) with the
 * commit-mode batch-rollback orphan case tracked separately; kept as standalone
 * helpers so that work can reuse them.
 */
import {
  dataSources,
  dataSourcesDraft,
  draftCommandLog,
  type ArtifactDb,
} from "@dashframe/server-core";
import type { SecretRef, SecretVault } from "@wystack/secret-vault";
import { isSecretRef } from "@wystack/secret-vault";
import type { Command, DraftCommand } from "@wystack/server";
import { eq, ne } from "drizzle-orm";

import { CREDENTIAL_COMMAND_FIELDS } from "./functions/commands";
import {
  isRecord,
  storeCredential,
  type DataSourceConfig,
} from "./functions/utils";

// ---------------------------------------------------------------------------
// Seam 1 — capture-before-log
// ---------------------------------------------------------------------------

/**
 * Rewrite a draft command's PLAINTEXT credential args to vault refs, returning a
 * new command (the input is never mutated). Non-credential commands, empty-string
 * (clear), undefined, and already-ref values pass through untouched.
 *
 * Called by `appendToDraft` BEFORE the command is run and snapshotted, so the
 * command that reaches the handler — and the durable log — carries a ref. The
 * vault store is real (a draft append is never a preview): a plaintext credential
 * with no vault throws (fail-closed, via {@link storeCredential}).
 */
export async function captureCommandCredentials(
  cmd: DraftCommand,
  vault: SecretVault | undefined,
): Promise<DraftCommand> {
  const fields = CREDENTIAL_COMMAND_FIELDS[cmd.path];
  if (!fields) return cmd;
  const args = cmd.args;
  if (!isRecord(args)) return cmd;

  let nextArgs: Record<string, unknown> | undefined;
  for (const field of fields) {
    const value = args[field];
    // undefined (not part of this write) and "" (clear) carry no plaintext.
    if (typeof value !== "string" || value.length === 0) continue;
    // Already a ref (idempotent re-capture / pre-bound) — leave it.
    if (isSecretRef(value)) continue;
    const id = typeof args.id === "string" ? args.id : "unknown";
    const ref = await storeCredential(vault, value, `${field}-${id}`, false);
    nextArgs ??= { ...args };
    nextArgs[field] = ref;
  }
  if (!nextArgs) return cmd;
  return { ...cmd, args: nextArgs };
}

// ---------------------------------------------------------------------------
// Seam 2 — transition-time release: candidate collection
// ---------------------------------------------------------------------------

/** Collect the credential refs carried in one command's args (by command path). */
function refsFromCommandArgs(path: string, args: unknown): SecretRef[] {
  const fields = CREDENTIAL_COMMAND_FIELDS[path];
  if (!fields || !isRecord(args)) return [];
  const refs: SecretRef[] = [];
  for (const field of fields) {
    const v = args[field];
    if (isSecretRef(v)) refs.push(v);
  }
  return refs;
}

/** Collect the credential refs held in a stored DataSource config. */
function refsFromConfig(config: unknown): SecretRef[] {
  if (!isRecord(config)) return [];
  const c = config as DataSourceConfig;
  const refs: SecretRef[] = [];
  if (isSecretRef(c.apiKey)) refs.push(c.apiKey);
  if (isSecretRef(c.connectionString)) refs.push(c.connectionString);
  return refs;
}

/**
 * Refs a DISCARD should release: the refs this draft MINTED, read from its own
 * compacted command log. (A captured plaintext arg becomes a fresh ref in the
 * log; an existing canonical ref never enters a draft's log via capture.) The
 * cross-draft + canonical guard in {@link collectReferencedRefs} is the backstop
 * that prevents releasing any ref still in use elsewhere.
 */
export function extractDraftMintedRefs(log: Command[]): SecretRef[] {
  const refs: SecretRef[] = [];
  for (const cmd of log) refs.push(...refsFromCommandArgs(cmd.path, cmd.args));
  return refs;
}

/**
 * Refs a PUBLISH should release: the canonical ref each command in the log will
 * REPLACE. Read BEFORE replay (replay overwrites canonical). A ref is a candidate
 * only for a credential field the command actually SETS (non-undefined — a
 * connectionString-only command must not trigger an apiKey release; `apiKey: ""`
 * (clear) counts as set). A CreateDataSource targets a not-yet-existing row, so it
 * yields no candidate. Reads committed canonical state via the raw artifact db.
 */
export async function collectOldCanonicalRefs(
  db: ArtifactDb,
  log: Command[],
): Promise<SecretRef[]> {
  const refs: SecretRef[] = [];
  for (const cmd of log) {
    const fields = CREDENTIAL_COMMAND_FIELDS[cmd.path];
    const args = cmd.args;
    if (!fields || !isRecord(args)) continue;
    const id = args.id;
    if (typeof id !== "string") continue;
    // Only read canonical when at least one credential field is actually set.
    const setFields = fields.filter((f) => args[f] !== undefined);
    if (setFields.length === 0) continue;
    const rows = await db
      .select({ config: dataSources.config })
      .from(dataSources)
      .where(eq(dataSources.id, id));
    const config = rows[0]?.config;
    if (config == null) continue; // no canonical row yet (e.g. a fresh create)
    const c = (config ?? {}) as DataSourceConfig;
    for (const field of setFields) {
      if (isSecretRef(c[field])) refs.push(c[field]);
    }
  }
  return refs;
}

/**
 * Every credential ref still referenced anywhere it must SURVIVE a release:
 *   - canonical `data_sources` config;
 *   - any OTHER open draft's `data_sources__draft` shadow config (the shadow holds
 *     the coalesced config, so it carries inherited refs a draft's log omits —
 *     this is the load-bearing cross-draft check);
 *   - any OTHER open draft's `draft_command_log` args (covers a crash-divergence
 *     where a log row outlives its shadow).
 *
 * The published/discarded draft is excluded by `excludeDraftId` (and is usually
 * already gone by the time this runs). No `vault.list()` — drafts and sources are
 * enumerated, not vault secrets.
 */
export async function collectReferencedRefs(
  db: ArtifactDb,
  excludeDraftId: string,
): Promise<Set<string>> {
  const referenced = new Set<string>();

  const canonical = await db
    .select({ config: dataSources.config })
    .from(dataSources);
  for (const row of canonical) {
    for (const ref of refsFromConfig(row.config)) referenced.add(ref);
  }

  const shadows = await db
    .select({ config: dataSourcesDraft.config })
    .from(dataSourcesDraft)
    .where(ne(dataSourcesDraft.draftId, excludeDraftId));
  for (const row of shadows) {
    for (const ref of refsFromConfig(row.config)) referenced.add(ref);
  }

  const logs = await db
    .select({ path: draftCommandLog.path, args: draftCommandLog.args })
    .from(draftCommandLog)
    .where(ne(draftCommandLog.draftId, excludeDraftId));
  for (const row of logs) {
    for (const ref of refsFromCommandArgs(row.path, row.args)) {
      referenced.add(ref);
    }
  }

  return referenced;
}

// ---------------------------------------------------------------------------
// Seam 2 — transition-time release: the release itself
// ---------------------------------------------------------------------------

/**
 * Delete every candidate ref that is NOT in the `referenced` set. Deduped;
 * `vault.delete` is idempotent (a missing ref is a no-op). Every delete is
 * attempted (allSettled) so one failure does not skip the rest; an aggregate
 * error is thrown if any failed (the caller decides whether to surface it).
 *
 * Throws if a ref must be released but no vault is injected — symmetric with the
 * fail-closed store (a ref can only exist because a vault was present at store).
 */
export async function releaseUnreferenced(
  vault: SecretVault | undefined,
  candidates: SecretRef[],
  referenced: ReadonlySet<string>,
): Promise<void> {
  const toRelease = [...new Set(candidates)].filter((r) => !referenced.has(r));
  if (toRelease.length === 0) return;
  if (vault == null) {
    throw new Error(
      "[secret-vault] cannot release credential refs at transition: no vault " +
        "injected, but refs are slated for release. A vault present at store " +
        "time must also be present at release time.",
    );
  }
  const results = await Promise.allSettled(
    toRelease.map((ref) => vault.delete(ref)),
  );
  const failures = results.filter(
    (r): r is PromiseRejectedResult => r.status === "rejected",
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((f) => f.reason),
      `[secret-vault] failed to release ${failures.length} of ${toRelease.length} credential ref(s) at transition`,
    );
  }
}

/**
 * Release `candidates` that are referenced nowhere else — the post-transition
 * (post-commit / post-discard) cleanup step. BEST-EFFORT BY DESIGN: the
 * authoritative transition has already committed, so a release failure must NOT
 * fail the RPC. The worst case of a failure is an inert, idempotent-recoverable
 * orphan; the worst case of failing the RPC would be reporting a committed
 * publish as failed. So failures are logged, not thrown.
 */
export async function releaseRefsAtTransition(
  db: ArtifactDb,
  vault: SecretVault | undefined,
  candidates: SecretRef[],
  excludeDraftId: string,
): Promise<void> {
  if (candidates.length === 0) return;
  try {
    const referenced = await collectReferencedRefs(db, excludeDraftId);
    await releaseUnreferenced(vault, candidates, referenced);
  } catch (err) {
    console.error(
      "[dashframe] credential transition release failed " +
        "(orphaned ref left behind — inert, recoverable):",
      err,
    );
  }
}
