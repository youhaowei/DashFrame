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
 *        - publish ({@link collectSupersededRefs}): release every ref the replay
 *          SUPERSEDES — the prior canonical ref AND any ref minted intra-draft then
 *          overwritten — collected BEFORE replay and released AFTER the publish
 *          transaction commits, so a rolled-back publish never deletes a live secret.
 *        - discard ({@link collectDiscardCandidateRefs}): release the refs the draft
 *          holds, from BOTH its log and its shadow config (so an inherited-only ref
 *          is reconsidered when the draft that pinned it closes), after the draft's
 *          log + shadow are dropped.
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

import { COMMAND_PATHS, CREDENTIAL_COMMAND_FIELDS } from "./functions/commands";
import {
  isRecord,
  storeCredential,
  type DataSourceConfig,
} from "./functions/utils";

// ---------------------------------------------------------------------------
// Seam 1 — capture-before-log
// ---------------------------------------------------------------------------

/**
 * The result of capturing one command's credentials: the command to run + log
 * (with plaintext rewritten to refs), and a rollback that releases the refs this
 * capture MINTED. `appendToDraft` calls `rollback` if the command's run fails
 * before the batch is persisted to the durable log — the minted ref would
 * otherwise be in the vault but in no log, so the discard path (which reads the
 * log) could never find it. Best-effort: a rollback failure leaves an inert orphan.
 */
export interface CapturedCommand {
  command: DraftCommand;
  rollback: () => Promise<void>;
}

/**
 * Throw if ANY string anywhere in `value` is a {@link SecretRef} (recursive over
 * arrays + plain objects). The fail-closed primitive behind the capture seam's
 * caller-supplied-ref refusal: it does not care WHICH field holds the ref, so a
 * ref-shaped connector slot outside the typed credential fields (e.g. a REST
 * source's `extra.authRef`) is caught the same as `apiKey` / `connectionString`.
 */
function assertNoSecretRefDeep(value: unknown, path: string): void {
  if (isSecretRef(value)) {
    throw new Error(
      `[secret-vault] credential command '${path}' must be given the plaintext ` +
        "secret, not a vault ref — refusing to adopt a caller-supplied ref " +
        "(it would skip storeCredential + the fail-closed guard).",
    );
  }
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretRefDeep(item, path);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) assertNoSecretRefDeep(item, path);
  }
}

/**
 * Refuse a fresh-append `SetDataSourceConfig` that would carry an INHERITED
 * canonical credential into a reconfigured source without re-affirming it.
 *
 * The exfil this closes: a `SetDataSourceConfig` that supplies NO credential (just
 * `extra`, e.g. a new `endpoint`) keeps the source's existing canonical credential
 * via `{...current.config}` + `Object.assign(config, extra)` in the handler. An
 * agent could thus redirect a user-authored, credentialed source at an attacker
 * endpoint, and the connector would resolve and send the user's secret there (the
 * REST SSRF guard is a private-range denylist — a public attacker host passes).
 * Same threat class as the foreign-ref hole, the foreign-ENDPOINT variant.
 *
 * Shape (confirmed against the credential-seam review):
 *  - CANONICAL-keyed: reads RAW canonical (not the draft-coalesced handle), so the
 *    create-then-configure happy path — `CreateDataSource` then `SetDataSourceConfig`
 *    in ONE draft — is allowed (the new source isn't canonical yet).
 *  - FRESH-APPEND-only: this runs inside capture, which only the append path calls;
 *    publish replay (`applyCommands`) bypasses it, so replay never trips the guard.
 *  - TRIGGER = `extra` supplied: the untyped connector-config bag is the ONLY
 *    vector that can introduce a new DESTINATION (e.g. a REST `endpoint`) for an
 *    inherited credential. The typed fields (apiKey/connectionString) are
 *    credentials, not destinations — setting one re-affirms a credential, it does
 *    not redirect another (so a typed-only edit, e.g. rotating connectionString
 *    while apiKey is inherited, is NOT a redirect and is allowed). Within `extra`
 *    the check is field-AGNOSTIC (endpoint / baseUrl / webhookUrl all count — no
 *    per-key allow-list, the enumeration trap that let authRef slip).
 *  - CREDENTIAL = ANY canonical `SecretRef` (covers apiKey / connectionString /
 *    authRef without enumeration).
 *  - REQUIRE RE-AFFIRM: every inherited credential must be re-supplied (plaintext)
 *    or cleared in THIS command; an untouched one is carried verbatim → reject.
 */
async function assertNoInheritedCredentialExfil(
  cmd: DraftCommand,
  args: Record<string, unknown>,
  db: ArtifactDb | undefined,
): Promise<void> {
  // Only SetDataSourceConfig reconfigures an EXISTING source. CreateDataSource
  // inserts a new row (a colliding id throws in the handler), so it cannot inherit
  // a canonical credential.
  if (cmd.path !== COMMAND_PATHS.SetDataSourceConfig) return;
  const id = typeof args.id === "string" ? args.id : undefined;
  if (id === undefined) return; // malformed — the handler's own validation rejects it

  // Only an `extra` change can introduce a new destination for an inherited
  // credential; a typed-credential-only update redirects nothing. No `extra` →
  // not a redirect → nothing to guard.
  const extra = isRecord(args.extra) ? args.extra : undefined;
  if (extra === undefined || Object.keys(extra).length === 0) return;

  if (db == null) {
    // Fail-closed: the guard needs canonical state to reason about. Production
    // always injects the artifact db; its absence is a wiring error, not licence
    // to skip a credential guard.
    throw new Error(
      `[secret-vault] cannot verify inherited-credential safety for '${cmd.path}' ` +
        "— no artifact db injected into the capture seam.",
    );
  }

  const rows = await db
    .select({ config: dataSources.config })
    .from(dataSources)
    .where(eq(dataSources.id, id));
  const canonical = rows[0]?.config;
  // No existing canonical source (e.g. created in this same draft) → nothing to
  // inherit, nothing to exfil.
  if (!isRecord(canonical)) return;

  // Field-agnostic credential detection: any canonical config value that is a
  // SecretRef is an inherited credential (apiKey / connectionString / authRef / …).
  const inheritedCredFields = Object.keys(canonical).filter((k) =>
    isSecretRef(canonical[k]),
  );
  if (inheritedCredFields.length === 0) return; // source holds no credential

  // The command must RE-AFFIRM every inherited credential — supply (plaintext) or
  // clear it in THIS command (a typed arg, or the same key under `extra`). A field
  // the command leaves untouched is carried verbatim into the new config: reject.
  const reaffirmed = (k: string): boolean =>
    (k in args && args[k] !== undefined) || k in extra;
  const carried = inheritedCredFields.filter((k) => !reaffirmed(k));
  if (carried.length > 0) {
    throw new Error(
      `[secret-vault] SetDataSourceConfig on credentialed source '${id}' would carry ` +
        `inherited credential(s) [${carried.join(", ")}] unchanged while reconfiguring ` +
        "it — refusing so an inherited secret cannot be silently redirected to a new " +
        "endpoint/target. Re-supply the credential as plaintext, or clear it, in the " +
        "same command.",
    );
  }
}

/** Best-effort delete of refs (idempotent); swallows errors (cleanup path). */
async function releaseRefsBestEffort(
  vault: SecretVault | undefined,
  refs: SecretRef[],
): Promise<void> {
  if (vault == null || refs.length === 0) return;
  await Promise.allSettled(refs.map((ref) => vault.delete(ref)));
}

/**
 * Rewrite a draft command's PLAINTEXT credential args to vault refs, returning a
 * NEW command (the input is never mutated) plus a rollback for the minted refs.
 * Non-credential commands, empty-string (clear), and undefined pass through
 * untouched.
 *
 * Called by `appendToDraft` BEFORE the command is run and snapshotted, so the
 * command that reaches the handler — and the durable log — carries a ref. The
 * vault store is real (a draft append is never a preview): a plaintext credential
 * with no vault throws (fail-closed, via {@link storeCredential}).
 *
 * SECURITY — REFUSE A CALLER-SUPPLIED REF (fail-closed). A ref-shaped credential
 * value reaching capture is never legitimate: capture runs ONLY on a FRESH draft
 * append (publish replay bypasses it — it replays the already-captured durable log
 * via `applyCommands`, never `appendToDraft`), and a fresh credential write must
 * carry plaintext. Adopting a caller-supplied `secret:<uuid>` would let an
 * (untrusted) caller — e.g. the assistant, once `CreateDataSource` /
 * `SetDataSourceConfig` are agent-emittable — point a source at a secret it does
 * NOT own, skipping `storeCredential` and the fail-closed vault guard (the
 * foreign-ref hole). So a ref-shaped value is REJECTED here, mirroring the
 * direct-canonical-path principle ("store/verify a ref-shaped input, never adopt
 * an unverified one"). The agent additionally gets an earlier, clearer rejection
 * at the `applyCommand` tool boundary, but THIS seam is the durable guarantee:
 * every `appendToDraft` caller is covered, not just the tool.
 *
 * ATOMIC per command: if storing a later field throws, the refs already minted for
 * this command are released before the error propagates — a partially-captured
 * command never leaks a ref.
 *
 * INVARIANT (enforced below) — a credential command MUST NOT carry a
 * `compactionKey`. The vocabulary (`cmd()` builder) sets none, so two credential
 * writes to one field are both kept in the log and {@link collectSupersededRefs}
 * releases the intermediate ref. If a credential command carried a `compactionKey`,
 * `compactLog` would DROP the earlier write — orphaning the ref it minted here (the
 * log no longer references it, so no transition releases it). Rather than rely on a
 * convention, we FAIL CLOSED: a credential command with a `compactionKey` is
 * rejected before any ref is minted, so the orphan window cannot open.
 */
export async function captureCommandCredentials(
  cmd: DraftCommand,
  vault: SecretVault | undefined,
  db?: ArtifactDb,
): Promise<CapturedCommand> {
  const fields = CREDENTIAL_COMMAND_FIELDS[cmd.path];
  const args = cmd.args;
  if (!fields || !isRecord(args)) {
    return { command: cmd, rollback: async () => {} };
  }

  // Fail closed on a compacted credential command: `compactLog` would drop a
  // superseded write whose capture already minted a ref, orphaning it (no log row
  // → no transition release). Reject BEFORE minting so nothing leaks.
  if (cmd.compactionKey != null) {
    throw new Error(
      `[secret-vault] credential command '${cmd.path}' must not carry a ` +
        `compactionKey: a compacted-away write would orphan its minted vault ref.`,
    );
  }

  // SECURITY (fail-closed) — refuse a caller-supplied ref ANYWHERE in the args.
  // FIELD-AGNOSTIC + RECURSIVE on purpose: the typed credential fields
  // (apiKey/connectionString) are not the only ref-shaped slots — a connector
  // config carries its own (e.g. a REST source's `extra.authRef`, which the REST
  // connector resolves via the vault). Enumerating fields would let any such slot
  // not in CREDENTIAL_COMMAND_FIELDS slip the guard (authRef did). A fresh
  // credential write must carry plaintext; a ref here would be adopted unverified,
  // letting a caller point a source at a secret it does not own (the foreign-ref
  // hole). Runs BEFORE any mint, so nothing needs releasing on this throw.
  assertNoSecretRefDeep(args, cmd.path);

  // SECURITY (fail-closed) — refuse to silently carry an INHERITED credential
  // into a reconfigured source. The foreign-REF variant above is closed, but a
  // SetDataSourceConfig that supplies NO credential (just `extra`, e.g. a new
  // `endpoint`) keeps the existing canonical credential via `{...current.config}`
  // + `Object.assign` — so an agent could redirect a credentialed source at an
  // attacker endpoint and the connector would send the user's secret there (the
  // SSRF guard is a private-range denylist; a public attacker host passes). Runs
  // ONLY on a fresh append (replay bypasses capture), reads RAW canonical, and is
  // field-agnostic on BOTH sides (credential = any SecretRef in canonical; target
  // = any config change) so a future connector target field cannot reopen it.
  await assertNoInheritedCredentialExfil(cmd, args, db);

  const minted: SecretRef[] = [];
  let nextArgs: Record<string, unknown> | undefined;
  try {
    for (const field of fields) {
      const value = args[field];
      // undefined (not part of this write) and "" (clear) carry no plaintext.
      // Ref-shaped values are already rejected by assertNoSecretRefDeep above, so
      // every non-empty string reaching here is plaintext to store.
      if (typeof value !== "string" || value.length === 0) continue;
      const id = typeof args.id === "string" ? args.id : "unknown";
      const ref = await storeCredential(vault, value, `${field}-${id}`, false);
      minted.push(ref);
      nextArgs ??= { ...args };
      nextArgs[field] = ref;
    }
  } catch (err) {
    await releaseRefsBestEffort(vault, minted);
    throw err;
  }

  const command = nextArgs ? { ...cmd, args: nextArgs } : cmd;
  return { command, rollback: () => releaseRefsBestEffort(vault, minted) };
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

/**
 * The credential ref-bearing fields of `DataSourceConfig` — the SINGLE source of
 * truth every ref-lifecycle reader iterates: {@link refsFromConfig} (cross-draft
 * protection), {@link collectSupersededRefs}, and the simulate seed. Hardcoding the
 * field set in each reader independently was the silent-drift hazard: adding a third
 * field (e.g. `oauthToken`) to one reader but not another would let
 * `collectReferencedRefs` stop protecting it and release a still-live secret.
 *
 * `credential-release.test.ts` BRIDGES this to the command-side truth
 * (`CREDENTIAL_COMMAND_FIELDS`), so a new credential field added to commands but
 * not here (or vice-versa) fails the build, not a production secret.
 */
export const CREDENTIAL_CONFIG_FIELDS = ["apiKey", "connectionString"] as const;
type CredentialField = (typeof CREDENTIAL_CONFIG_FIELDS)[number];
type SimulatedConfig = Partial<Record<CredentialField, SecretRef | undefined>>;

/** Collect the credential refs held in a stored DataSource config. */
function refsFromConfig(config: unknown): SecretRef[] {
  if (!isRecord(config)) return [];
  const c = config as DataSourceConfig;
  const refs: SecretRef[] = [];
  for (const field of CREDENTIAL_CONFIG_FIELDS) {
    if (isSecretRef(c[field])) refs.push(c[field]);
  }
  return refs;
}

/** The data-source id a credential command targets, or undefined if not one. */
function credentialCommandId(cmd: Command): string | undefined {
  if (!CREDENTIAL_COMMAND_FIELDS[cmd.path] || !isRecord(cmd.args))
    return undefined;
  return typeof cmd.args.id === "string" ? cmd.args.id : undefined;
}

/**
 * Refs a DISCARD should release: every ref the draft holds, from BOTH its log AND
 * its `data_sources__draft` shadow config. The shadow is load-bearing — a ref a
 * draft only INHERITED (e.g. it touched connectionString and the coalesced shadow
 * carries the canonical apiKey ref) is not in the draft's log, so a log-only
 * candidate set would leak it forever once the canonical owner moves on. The
 * cross-draft + canonical guard in {@link collectReferencedRefs} is the backstop
 * that keeps a still-referenced ref (incl. the live canonical one) from release.
 *
 * Reads must run BEFORE the discard drops the log + shadow.
 */
export async function collectDiscardCandidateRefs(
  db: ArtifactDb,
  draftId: string,
  log: Command[],
): Promise<SecretRef[]> {
  const refs: SecretRef[] = [];
  for (const cmd of log) refs.push(...refsFromCommandArgs(cmd.path, cmd.args));
  const shadows = await db
    .select({ config: dataSourcesDraft.config })
    .from(dataSourcesDraft)
    .where(eq(dataSourcesDraft.draftId, draftId));
  for (const row of shadows) refs.push(...refsFromConfig(row.config));
  return refs;
}

/**
 * Refs a PUBLISH should release: every ref SUPERSEDED by replaying the log. Seeds a
 * simulated per-source `field → ref` map from the PRE-publish canonical config, then
 * walks the log in replay order; any ref a later write replaces — whether the prior
 * CANONICAL ref OR a ref minted earlier in this same draft (two credential writes to
 * one field, which `compactLog` keeps when no `compactionKey` is set) — is a release
 * candidate. The pre-publish read alone misses the intra-draft case, leaking the
 * intermediate ref. The final surviving ref is protected post-commit by
 * {@link collectReferencedRefs} (it is the one now in canonical). A `CreateDataSource`
 * seeds from an empty canonical, so its first write yields no candidate.
 *
 * Reads committed canonical state via the raw artifact db, BEFORE replay.
 */
export async function collectSupersededRefs(
  db: ArtifactDb,
  log: Command[],
): Promise<SecretRef[]> {
  const simulated = await seedSimulatedConfigs(db, log);
  const candidates: SecretRef[] = [];
  for (const cmd of log) {
    const id = credentialCommandId(cmd);
    const cur = id !== undefined ? simulated.get(id) : undefined;
    if (!cur || !isRecord(cmd.args)) continue;
    for (const field of CREDENTIAL_CONFIG_FIELDS) {
      supersedeField(cur, field, cmd.args[field], candidates);
    }
  }
  return candidates;
}

/** Seed each touched source's simulated field→ref map from pre-publish canonical. */
async function seedSimulatedConfigs(
  db: ArtifactDb,
  log: Command[],
): Promise<Map<string, SimulatedConfig>> {
  const simulated = new Map<string, SimulatedConfig>();
  for (const cmd of log) {
    const id = credentialCommandId(cmd);
    if (id === undefined || simulated.has(id)) continue;
    const rows = await db
      .select({ config: dataSources.config })
      .from(dataSources)
      .where(eq(dataSources.id, id));
    const c = (rows[0]?.config ?? {}) as DataSourceConfig;
    const seed: SimulatedConfig = {};
    for (const f of CREDENTIAL_CONFIG_FIELDS)
      seed[f] = isSecretRef(c[f]) ? c[f] : undefined;
    simulated.set(id, seed);
  }
  return simulated;
}

/**
 * Apply one field write to the simulated config: if it supersedes a prior ref
 * (different from the new value), record that prior ref as a release candidate.
 */
function supersedeField(
  cur: SimulatedConfig,
  field: CredentialField,
  value: unknown,
  candidates: SecretRef[],
): void {
  if (value === undefined) return; // field not set by this command
  const next = isSecretRef(value) ? value : undefined; // ref set, or clear / non-ref
  const prior = cur[field];
  if (prior && prior !== next) candidates.push(prior);
  cur[field] = next;
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
