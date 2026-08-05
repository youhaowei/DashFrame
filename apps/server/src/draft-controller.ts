/**
 * DraftController — the PERSISTENT draft lifecycle.
 *
 * The draft system has three legs (per @wystack/server's draft-lifecycle.ts):
 *   1. Read overlay  — `withDraft(draftId)` coalesce (canonical ⊕ delta). READ.
 *   2. Write storage — `<table>__draft` shadow + a compacted command log. WRITE.
 *   3. Lifecycle     — open / append / publish / discard. CONDUCTS legs 1 & 2.
 *
 * wystack ships leg 3 as `createDraftLifecycle`, but that object holds its log +
 * touchedTables in an in-memory `Map`: a draft evaporates on process restart and
 * there is no rehydrate seam (`open()` always mints a fresh id; teardown helpers
 * are module-private). DashFrame requires a draft that SURVIVES a restart, with
 * the draftId as the durable handle. So DashFrame owns leg 3 — this controller —
 * and persists it into the durable artifact tables (`draft_command_log` + the
 * six `<table>__draft` shadows in @dashframe/server-core).
 *
 * This CONDUCTS wystack's mechanism, it does NOT reimplement it. The three
 * load-bearing primitives are composed verbatim:
 *   - `withDraft(draftId)` write-path — the ONLY way `<table>__draft` rows are
 *     written. The controller drives `runHandler(..., draftDb, ...)`; it never
 *     authors a shadow-table INSERT/UPDATE itself.
 *   - `compactLog(log)` — wystack's exported net-effect collapse (create+delete
 *     cancel, last-update-wins, create-kept-with-final-update). Never reimplemented.
 *   - `applyCommands(app, log, {commit})` — wystack's publish-is-log-replay engine
 *     (one atomic tracked transaction onto CANONICAL). The same primitive
 *     `createDraftLifecycle.publish` calls.
 * What the controller re-expresses is only BOOKKEEPING — where the log lives and
 * how the shadow is swept — forced by the persistence requirement, not gratuitous.
 * The crux that makes this clean: `withDraft(draftId)` accepts ANY caller-supplied
 * draftId (a pure @wystack/db primitive, no coupling to the lifecycle Map), so the
 * controller mints and owns the handle end to end.
 *
 * Durable-log invariant: `draft_command_log` is a MATERIALIZED PROJECTION of
 * `compactLog(history)`. Each append re-runs `compactLog` over the full log and
 * REPLACE-ALLs the draftId's rows (re-seq 0..n). The table therefore always holds
 * exactly the list `applyCommands` will replay, already compacted, in replay order
 * — one publish source, warm or cold, so publish semantics never fork on whether
 * the opening process is still alive.
 *
 * SECURITY BOUNDARY: credential TABLE STATE is never drafted.
 * `secret_mappings` and `project_meta` have no shadow; the six shadow tables here
 * are the closed set, so a drafted write to a credential table has nowhere to
 * land. NOTE the scope: this closes the at-rest-table channel, NOT a handler's
 * vault SIDE EFFECT — a credentialed command run inside a draft would still call
 * `vault.store` for real (not drafted, not swept on discard, re-run on publish).
 * The seam is live — the assistant host (assistant-host.ts) wires draftId
 * through this controller. The vault-side-effect channel is handled in
 * credential-release.ts: `captureCommandCredentials` (host-injected into
 * `appendToDraft`) stores plaintext to the vault and rewrites the logged command
 * to refs before it runs, and `releaseRefsAtTransition` releases superseded or
 * minted refs after publish/discard commits — see that file's header for the
 * two-seam contract.
 */
import {
  dashboards,
  dashboardsDraft,
  dataFrames,
  dataFramesDraft,
  dataSources,
  dataSourcesDraft,
  dataTables,
  dataTablesDraft,
  draftCommandLog,
  draftMetadata,
  insights,
  insightsDraft,
  visualizations,
  visualizationsDraft,
  type ArtifactDb,
} from "@dashframe/server-core";
import {
  applyCommands,
  compactLog,
  type Cell,
  type Command,
  type CommandResult,
  type CommitResult,
  type ConflictReport,
  type DraftCommand,
  type WyStackApp,
} from "@wystack/server";
import { eq, getTableName, sql } from "drizzle-orm";

import {
  assertPublishLogHasNoLateBound,
  findLateBound,
} from "./draft-late-bound";
import { computeLogSignature } from "./draft-log-signature";
import { assertKnownCommandPaths } from "./functions/commands";

/**
 * The closed set of `<table>__draft` shadows a draft can touch. Discard
 * and post-publish teardown sweep by draftId across exactly these six — a static,
 * schema-owned set, NOT runtime discovery. A new artifact table is a schema
 * change, so this list is the authoritative enumeration. Sweeping the full closed
 * set is strictly more robust than the lifecycle's touchedTables-driven sweep: it
 * cannot miss a table because a write was never recorded.
 */
const DRAFT_SHADOW_TABLES = [
  dataSourcesDraft,
  dataTablesDraft,
  dataFramesDraft,
  insightsDraft,
  visualizationsDraft,
  dashboardsDraft,
] as const;

const DRAFT_CONFLICT_TABLES = [
  { canonical: dataSources, draft: dataSourcesDraft },
  { canonical: dataTables, draft: dataTablesDraft },
  { canonical: dataFrames, draft: dataFramesDraft },
  { canonical: insights, draft: insightsDraft },
  { canonical: visualizations, draft: visualizationsDraft },
  { canonical: dashboards, draft: dashboardsDraft },
] as const;

/**
 * The DB-handle surface the teardown helpers (`deleteLog`/`sweepShadows`) need:
 * just `.delete()`. Narrowing to this (rather than the full `ArtifactDb`) is
 * least authority by construction: any future helper that reaches for
 * `.transaction()` or another surface it wasn't granted is a compile error,
 * regardless of what the runtime handle happens to support.
 */
type DeleteExecutor = Pick<ArtifactDb, "delete">;
type SqlExecutor = Pick<ArtifactDb, "execute">;
export type LogReader = Pick<ArtifactDb, "select">;

function normalizeRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

function normalizeBaseVersion(baseVersion: unknown): Date {
  // No base supplied → the draft's base is "now" (the legitimate default).
  if (baseVersion === undefined) return new Date();
  if (baseVersion instanceof Date && !Number.isNaN(baseVersion.getTime())) {
    return baseVersion;
  }
  if (typeof baseVersion === "number") {
    const date = new Date(baseVersion);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof baseVersion === "string") {
    const date = new Date(baseVersion);
    if (!Number.isNaN(date.getTime())) return date;
  }
  // A value was supplied but is not a valid Date/epoch/ISO string. Silently
  // coercing it to `new Date()` would push the base to "now" and quietly mask
  // every prior canonical write from conflict detection — throw instead.
  throw new Error(
    `openDraft: invalid baseVersion (${typeof baseVersion}); expected a Date, epoch number, or ISO string`,
  );
}

function timestampExpression(tableAlias: string): string {
  return `COALESCE(${tableAlias}."updated_at", ${tableAlias}."created_at")`;
}

/** A persisted log row mapped back to the `DraftCommand` shape replay consumes. */
function rowToDraftCommand(row: {
  path: string;
  args: unknown;
  cmdId: string | null;
  compactionKey: string | null;
  kind: string | null;
}): DraftCommand {
  const cmd: DraftCommand = { path: row.path, args: row.args };
  // Rehydrate the command correlation id so a replay's CommandResult.id matches
  // the originally-emitted command (warm or cold publish behave identically).
  if (row.cmdId !== null) cmd.id = row.cmdId;
  if (row.compactionKey !== null) cmd.compactionKey = row.compactionKey;
  if (row.kind !== null) cmd.kind = row.kind as DraftCommand["kind"];
  return cmd;
}

function asDate(value: unknown, field: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`listDrafts: invalid ${field}`);
  }
  return date;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function asCountRecord(value: unknown): Record<string, number> {
  const parsed = parseJsonValue(value);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(parsed)) {
    const numeric = typeof count === "number" ? count : Number(count);
    if (Number.isFinite(numeric)) counts[key] = numeric;
  }
  return counts;
}

function pathTokens(jsonPath: string): Array<string | number> {
  if (!/^args(?:\.[A-Za-z_$][\w$]*|\[\d+\])*$/.test(jsonPath)) {
    throw new Error("reviseDraft: operand path must target command args");
  }
  return [...jsonPath.matchAll(/([A-Za-z_$][\w$]*)|\[(\d+)\]/g)].map((match) =>
    match[2] === undefined ? match[1]! : Number(match[2]),
  );
}

function bindOperandAtPath(
  command: DraftCommand,
  jsonPath: string,
  value: unknown,
): void {
  const tokens = pathTokens(jsonPath);
  let parent: unknown = command;
  for (const token of tokens.slice(0, -1)) {
    if (parent === null || typeof parent !== "object") {
      throw new Error("reviseDraft: operand path no longer exists");
    }
    parent = (parent as Record<string | number, unknown>)[token];
  }
  const last = tokens.at(-1);
  if (
    last === undefined ||
    parent === null ||
    typeof parent !== "object" ||
    Array.isArray(parent) !== (typeof last === "number")
  ) {
    throw new Error("reviseDraft: operand path no longer exists");
  }
  const current = (parent as Record<string | number, unknown>)[last];
  if (
    current === null ||
    typeof current !== "object" ||
    Array.isArray(current) ||
    (current as Record<string, unknown>).kind !== "lateBound"
  ) {
    throw new Error("reviseDraft: operand path is not late-bound");
  }
  (parent as Record<string | number, unknown>)[last] = {
    kind: "value",
    v: value,
  };
}

function validateRevisionOp(
  log: DraftCommand[],
  candidate: unknown,
): DraftRevisionOp {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    throw new Error("reviseDraft: invalid operation");
  }
  const op = candidate as DraftRevisionOp;
  if (
    !Number.isInteger(op.commandIndex) ||
    op.commandIndex < 0 ||
    op.commandIndex >= log.length
  ) {
    throw new Error("reviseDraft: invalid command index");
  }
  if (op.type === "removeCommand") return op;
  if (
    op.type !== "bindOperand" ||
    typeof op.jsonPath !== "string" ||
    !Object.hasOwn(op, "value")
  ) {
    throw new Error("reviseDraft: invalid operation");
  }
  pathTokens(op.jsonPath);
  const command = log[op.commandIndex];
  if (!command) throw new Error("reviseDraft: invalid command index");
  const lateBound = findLateBound([command]).find(
    (entry) => entry.jsonPath === op.jsonPath,
  );
  if (!lateBound) {
    throw new Error("reviseDraft: operand path is not late-bound");
  }
  if (lateBound.refType !== "placeholder") {
    throw new Error(
      `reviseDraft: ${lateBound.refType} operands cannot be bound`,
    );
  }
  return op;
}

function assertUniqueRevisionOps(ops: DraftRevisionOp[]): void {
  const removals = ops
    .filter((op) => op.type === "removeCommand")
    .map((op) => op.commandIndex);
  if (new Set(removals).size !== removals.length) {
    throw new Error("reviseDraft: duplicate remove operation");
  }
  const bindings = ops
    .filter((op) => op.type === "bindOperand")
    .map((op) => `${op.commandIndex}:${op.jsonPath}`);
  if (new Set(bindings).size !== bindings.length) {
    throw new Error("reviseDraft: duplicate bind operation");
  }
}

function applyRevisionOps(
  log: DraftCommand[],
  ops: DraftRevisionOp[],
): DraftCommand[] {
  const revised = structuredClone(log) as DraftCommand[];
  for (const op of ops) {
    if (op.type !== "bindOperand") continue;
    const command = revised[op.commandIndex];
    if (!command) throw new Error("reviseDraft: invalid command index");
    bindOperandAtPath(command, op.jsonPath, op.value);
  }
  const removals = new Set(
    ops
      .filter((op) => op.type === "removeCommand")
      .map((op) => op.commandIndex),
  );
  return revised.filter((_, index) => !removals.has(index));
}

export interface DraftController {
  /**
   * Open a new draft and return its durable handle. No wystack call, no shadow
   * rows — the draftId is the whole result. `baseVersion` is recorded for a
   * future conflict-detection pass (out of scope for this mechanism slice); it
   * is opaque and not inspected here.
   */
  openDraft(baseVersion?: unknown): Promise<string>;
  /**
   * Apply a batch INSIDE the draft. Routes each command's writes through the
   * `withDraft(draftId)` write-path into `<table>__draft` (durable), then
   * materializes the compacted command log into `draft_command_log`.
   *
   * The log is the source of truth (publish replays only the log). The per-batch
   * shadow writes and the log projection are NOT wrapped in one transaction, so
   * an append interrupted mid-batch (a handler throws, or the process dies before
   * `writeLog`) can leave shadow rows that the log does not yet reference. Those
   * orphans are INERT: publish ignores the shadow entirely and `dropDraft` sweeps
   * the full closed set regardless, so canonical is never corrupted — the draft's
   * recovery posture is "re-append the full batch" (matches wystack's lifecycle,
   * which documents the same non-atomic-across-batch contract). The append is
   * effect-free on canonical until publish.
   *
   * SINGLE-WRITER per draftId. `readLog → compactLog → writeLog` (replace-all) is
   * not atomic, so two concurrent `appendToDraft` calls on the SAME draftId race:
   * both read the same prior log and the last `writeLog` wins, erasing the other
   * batch's log rows while its shadow rows linger (then get swept on publish) —
   * silent command loss. A draft is a single editing session's handle; the
   * consumer must serialize appends per draftId (do not fan out). When the seam
   * is wired into a multi-session host, that host owns the per-draft lock.
   * Returns per-command results (same shape as `applyCommands`).
   */
  appendToDraft(
    draftId: string,
    batch: DraftCommand[],
    context?: Record<string, unknown>,
  ): Promise<CommandResult[]>;
  /** List every open draft from durable metadata, newest activity first. */
  listDrafts(): Promise<DraftListEntry[]>;
  /**
   * True when `draft_metadata` still holds this handle. That table is the
   * registry of record: `openDraft` inserts the row and both lifecycle exits
   * (publish, discard) delete it, so its absence means the handle was never
   * opened or is already gone. Any caller that accepts a CLIENT-SUPPLIED
   * draftId must gate on this — the command log and the shadow tables accept
   * an arbitrary id, so appending under an unregistered handle writes rows
   * that `listDrafts` can never surface and no lifecycle path can ever sweep.
   */
  draftExists(draftId: string): Promise<boolean>;
  /** Atomically replace a reviewed log after guarded remove/bind operations. */
  reviseDraft(
    draftId: string,
    expectedLogSignature: string,
    ops: DraftRevisionOp[],
  ): Promise<DraftRevisionResult>;
  /**
   * Publish = replay the durable command log onto canonical via
   * `applyCommands(app, log, {commit, tx})`, with the log delete + shadow sweep
   * running in the SAME outer transaction. Replay, log delete, and sweep share
   * ONE commit boundary — a crash between them is impossible (both land together
   * or both roll back), closing the double-replay crash window (GH #157). Reads
   * ONLY `draft_command_log` — never the shadow — so it works identically whether
   * or not the opening process is still alive. Returns the CommitResult
   * (`tablesWritten` is what the host flushes to invalidation).
   */
  publishDraft(
    draftId: string,
    context?: Record<string, unknown>,
    options?: PublishDraftOptions,
  ): Promise<CommitResult>;
  /**
   * Discard = drop the draft's deltas: delete every `<table>__draft` row and
   * every `draft_command_log` row for this draftId. Canonical is untouched.
   * Runs in ONE transaction (log reload, optional `beforeDiscard` hook, log
   * delete, shadow sweep) — mirrors `publishDraft`'s outer-tx seam so a host
   * can collect pre-teardown state (e.g. credential-release refs) against the
   * AUTHORITATIVE reloaded log rather than a pre-transaction read. See
   * `DiscardDraftOptions.beforeDiscard`.
   */
  discardDraft(draftId: string, options?: DiscardDraftOptions): Promise<void>;
  /**
   * Detect whether canonical has moved under this draft's base version and
   * whether that movement overlaps cells the draft touched.
   */
  detectConflict(draftId: string): Promise<ConflictReport>;
  /** Read-only peek at a draft's persisted (compacted) command log. */
  getDraftLog(draftId: string): Promise<Command[]>;
}

export interface DraftListEntry {
  draftId: string;
  createdAt: Date;
  commandCount: number;
  updatedAt: Date | null;
  kinds: Record<string, number>;
  paths: string[];
}

export type DraftRevisionOp =
  | { type: "removeCommand"; commandIndex: number }
  | {
      type: "bindOperand";
      commandIndex: number;
      jsonPath: string;
      value: unknown;
    };

export interface DraftRevisionResult {
  draftId: string;
  commandCount: number;
  logSignature: string;
}

/**
 * Per-call guards for `discardDraft`.
 */
export interface DiscardDraftOptions {
  /**
   * Pre-teardown hook, invoked INSIDE the discard transaction — after the log
   * is reloaded via `readLog(draftId, tx)`, before the log delete + shadow
   * sweep run.
   *
   * Mirrors `PublishDraftOptions.beforeReplay`: exists so a host can collect
   * state the teardown is about to remove (DashFrame's credential-release
   * refs — which vault refs the draft's log/shadow hold) against the
   * AUTHORITATIVE reloaded log, never a pre-transaction read. A command
   * appended between an outer `getDraftLog` call and `discardDraft` would
   * make that pre-read stale — the same TOCTOU the publish half's
   * `beforeReplay` closes (see its doc comment). Collection here observes
   * exactly the log/shadow rows that are about to be dropped.
   *
   * Runs BEFORE the log delete and shadow sweep, so `dataSourcesDraft` (and
   * the other five shadow tables) still hold this draft's rows when the hook
   * fires — collectors that read the shadow (e.g. an inherited-only
   * credential ref not present in the log) see them.
   *
   * A throw here aborts the discard transaction — the log and shadow rows
   * survive intact, same abort semantics as a `beforeReplay` throw on the
   * publish side.
   *
   * Typed as `LogReader` — the same narrowed slice `readLog` uses — so the
   * contract "the hook COLLECTS, never mutates" is enforced at compile time:
   * mutation and nested-transaction calls are unrepresentable through the
   * narrowed type, regardless of what the runtime handle supports.
   */
  beforeDiscard?: (log: Command[], tx: LogReader) => Promise<void> | void;
}

/**
 * Per-call guards for `publishDraft`.
 */
export interface PublishDraftOptions {
  /**
   * Review-drift guard, cheap fast-path: the command-log length the reviewer
   * saw. Enforced INSIDE the publish transaction against the reloaded durable
   * log, so a command appended between review and publish aborts the replay
   * atomically — a pre-transaction read cannot provide this guarantee.
   *
   * COUNT ALONE IS NOT SUFFICIENT: `compactLog` can DROP earlier log
   * positions (a create cancelled by a later delete collapses to nothing), so
   * a concurrent append that triggers compaction can leave the length
   * unchanged while the content differs from what the reviewer saw. Kept
   * alongside `expectedLogSignature` as a cheap, distinct-evidence check
   * (a count mismatch and a signature mismatch are different failure modes
   * worth telling apart when debugging), not folded into it.
   */
  expectedCommandCount?: number;
  /**
   * Review-drift guard, content check: the SHA-256 hex signature (see
   * `computeLogSignature`) of the command log the reviewer saw, over
   * `[{path, args}]` in replay order. Enforced INSIDE the publish transaction
   * against the reloaded durable log, same placement and atomicity guarantee
   * as `expectedCommandCount`. Closes the gap the count-only guard misses:
   * same-length, different-content drift caused by compaction (see the
   * `expectedCommandCount` doc above) slips a count check but changes the
   * signature.
   */
  expectedLogSignature?: string;
  /**
   * Pre-replay hook, invoked INSIDE the publish transaction — after the
   * `expectedCommandCount` and late-bound/`validatePublishLog` guards pass,
   * before `applyCommands` replays the log onto canonical.
   *
   * Exists so a host can collect state the replay is about to overwrite (e.g.
   * DashFrame's credential-release refs: which vault refs the replay's writes
   * SUPERSEDE) against the AUTHORITATIVE reloaded log and the pre-replay
   * canonical rows — never a pre-transaction read, which a command appended
   * between review and publish would make stale (the TOCTOU this hook closes).
   * `tx` is the transaction's native handle (same `ArtifactDb` shape queries
   * elsewhere use) — reads through it see the same pre-replay snapshot the
   * replay itself is about to act on.
   *
   * Runs AFTER both guards so an aborted publish (drift or late-bound) never
   * invokes collection — nothing here observes a log that won't actually
   * replay. A throw here aborts the publish transaction like any other guard.
   *
   * Typed as `LogReader` — the same narrowed slice `readLog` uses — so the
   * contract "the hook COLLECTS, never mutates" is enforced at compile time:
   * mutation and nested-transaction calls are unrepresentable through the
   * narrowed type, regardless of what the runtime handle supports.
   */
  beforeReplay?: (log: Command[], tx: LogReader) => Promise<void> | void;
  /**
   * When true, publish checks the draft's base version against canonical writes
   * inside the same transaction as replay and blocks overlapping stale cells.
   */
  blockOnConflict?: boolean;
}

export class DraftPublishConflictError extends Error {
  constructor(readonly conflictReport: ConflictReport) {
    super("publishDraft: draft conflicts with canonical changes");
    this.name = "DraftPublishConflictError";
  }
}

/**
 * Optional hooks the host injects into the controller without coupling it to
 * DashFrame-specific command knowledge.
 */
export interface CreateDraftControllerOptions {
  /**
   * Pre-bind seam: rewrite a command BEFORE it is run + snapshotted into the log.
   * The host uses this to capture plaintext credential args into vault refs so the
   * durable log carries a ref, never plaintext (capture-before-log). Returns the
   * command to run + snapshot, plus a `rollback` the controller invokes if the
   * command's run fails before the batch is logged (so a captured-but-unlogged ref
   * does not orphan). The controller stays free of credential knowledge — the
   * rollback is opaque. Absent → commands are run and logged verbatim.
   */
  captureCredentials?: (
    cmd: DraftCommand,
  ) => Promise<{ command: DraftCommand; rollback: () => Promise<void> }>;
  /**
   * Host-owned publish guard over the exact durable log that will be replayed.
   * Runs inside the publish transaction, after reloading `draft_command_log` and
   * before `applyCommands`, so validation cannot drift from the replay source.
   */
  validatePublishLog?: (log: Command[]) => void;
}

/**
 * Build the persistent draft controller over a WyStack app + the project's
 * artifact DB. The app resolves command paths and backs both the shadow writes
 * (via `withDraft`) and the publish replay; the typed `ArtifactDb` is the durable
 * store for `draft_command_log` + the shadow sweeps.
 */
export function createDraftController(
  app: WyStackApp,
  db: ArtifactDb,
  options: CreateDraftControllerOptions = {},
): DraftController {
  const { captureCredentials } = options;
  const { validatePublishLog } = options;
  /** Read the draft's persisted command log, ordered for replay. */
  async function readLog(
    draftId: string,
    exec: LogReader = db,
  ): Promise<DraftCommand[]> {
    const rows = await exec
      .select({
        path: draftCommandLog.path,
        args: draftCommandLog.args,
        cmdId: draftCommandLog.cmdId,
        compactionKey: draftCommandLog.compactionKey,
        kind: draftCommandLog.kind,
      })
      .from(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId))
      // Order by the durable seq (0..n) — the replace-all dense re-seq in
      // `writeLog` is what makes this the exact replay order publish consumes.
      .orderBy(draftCommandLog.seq);
    return rows.map(rowToDraftCommand);
  }

  /**
   * Replace-all the draftId's log rows with `compacted`, re-seq 0..n. Materializes
   * `compactLog`'s net-effect list so the table always equals what replay consumes
   * — never append-only (compaction can DROP earlier positions, so append-only
   * would drift from the replay source). The unique (draft_id, seq) index is
   * satisfied by the dense re-seq.
   *
   * ATOMIC: the delete + insert run in ONE transaction so an interrupted replace
   * (crash or insert failure after the delete) cannot leave the log erased while
   * shadow rows remain — the swap is all-or-nothing. Without this, the next
   * `publishDraft` could read an empty/partial log and silently drop committed
   * draft history.
   */
  async function writeLog(
    draftId: string,
    compacted: DraftCommand[],
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(draftCommandLog)
        .where(eq(draftCommandLog.draftId, draftId));
      if (compacted.length === 0) return;
      await tx.insert(draftCommandLog).values(
        compacted.map((cmd, seq) => ({
          draftId,
          seq,
          path: cmd.path,
          // `args` is opaque JSON-shaped data the lifecycle never interprets;
          // store it verbatim. `?? null` because jsonb stores SQL NULL for an
          // absent arg.
          args: (cmd.args ?? null) as unknown,
          cmdId: cmd.id ?? null,
          compactionKey: cmd.compactionKey ?? null,
          kind: cmd.kind ?? null,
        })),
      );
    });
  }

  /**
   * Delete a draft's durable command log. This is the publish IDEMPOTENCY GATE:
   * `publishDraft` reads only `draft_command_log`, so once the log is gone a
   * retried publish reads an empty log and is a no-op rather than a second replay
   * onto canonical. A failure here MUST surface (the log still drives publish).
   *
   * `exec` is the Drizzle handle the DELETE runs against. The publish path passes
   * the OUTER transaction's handle (`tx.raw`) so the log delete commits ATOMICALLY
   * with the canonical replay — this is the load-bearing step that closes the
   * crash window (a process death between replay-commit and log-delete is no
   * longer possible; both land in one commit or both roll back). The discard
   * path (`dropDraft`) similarly passes its own transaction's handle, so the log
   * delete commits atomically with the shadow sweep and any `beforeDiscard`
   * hook. Defaults to `db` (autocommit) for a direct call outside either
   * lifecycle path.
   */
  async function deleteLog(
    draftId: string,
    exec: DeleteExecutor = db,
  ): Promise<void> {
    await exec
      .delete(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
  }

  async function deleteDraftMetadata(
    draftId: string,
    exec: DeleteExecutor = db,
  ): Promise<void> {
    await exec.delete(draftMetadata).where(eq(draftMetadata.draftId, draftId));
  }

  async function readBaseVersion(
    draftId: string,
    exec: LogReader = db,
  ): Promise<Date | null> {
    const rows = await exec
      .select({ baseVersion: draftMetadata.baseVersion })
      .from(draftMetadata)
      .where(eq(draftMetadata.draftId, draftId));
    return rows[0]?.baseVersion ?? null;
  }

  /**
   * The canonical id inventory captured at open, as `{ table: id[] }`, or null
   * for a legacy draft opened before the column existed (delete detection then
   * fails open). See {@link snapshotCanonicalInventory} and the `base_inventory`
   * schema note.
   */
  async function readBaseInventory(
    draftId: string,
    exec: LogReader = db,
  ): Promise<Record<string, unknown[]> | null> {
    const rows = await exec
      .select({ baseInventory: draftMetadata.baseInventory })
      .from(draftMetadata)
      .where(eq(draftMetadata.draftId, draftId));
    const inventory = rows[0]?.baseInventory;
    return inventory != null && typeof inventory === "object"
      ? (inventory as Record<string, unknown[]>)
      : null;
  }

  /** Read every canonical id in one conflict table. */
  async function canonicalIds(
    canonicalName: string,
    exec: SqlExecutor = db,
  ): Promise<Set<unknown>> {
    const rows = normalizeRows(
      // `canonicalName` is a static schema table name (getTableName), never
      // caller input — no injection surface.
      await exec.execute(sql.raw(`SELECT "id" AS id FROM "${canonicalName}"`)),
    );
    return new Set(rows.map((row) => row.id));
  }

  /**
   * Delete conflicts the timestamp probe cannot see. A canonical DELETE removes
   * the row, so `hasCanonicalWritesSince`/`overlappingCellsSince` (which read
   * `updated_at` on surviving rows) miss it entirely. Instead, diff each
   * draft-touched id against the base inventory: an id the draft touched that
   * EXISTED at open but is now ABSENT from canonical was deleted underneath the
   * draft — a genuine conflict (the draft edits, or re-deletes, a row that is
   * gone). draft-CREATED ids (not in the base inventory) are correctly ignored.
   */
  async function deletedTouchedCells(
    draftId: string,
    baseInventory: Record<string, unknown[]>,
    exec: SqlExecutor = db,
  ): Promise<Cell[]> {
    const cells: Cell[] = [];
    for (const table of DRAFT_CONFLICT_TABLES) {
      const canonicalName = getTableName(table.canonical);
      const baseIds = baseInventory[canonicalName];
      if (!Array.isArray(baseIds) || baseIds.length === 0) continue;
      const draftName = getTableName(table.draft);
      const prefix = sql.raw(
        `SELECT d."id" AS id FROM "${draftName}" d WHERE d."draft_id" = `,
      );
      const touched = normalizeRows(
        await exec.execute(sql`${prefix}${draftId}`),
      );
      if (touched.length === 0) continue;
      const baseIdSet = new Set(baseIds);
      const surviving = await canonicalIds(canonicalName, exec);
      for (const row of touched) {
        if (baseIdSet.has(row.id) && !surviving.has(row.id)) {
          cells.push({ table: canonicalName, id: row.id });
        }
      }
    }
    return cells;
  }

  /**
   * Probe whether any canonical row advanced after `baseVersion`. Uses strict
   * `>` — not `>=` — so rows written in `baseVersion`'s own millisecond (the
   * draft-open instant) are not mistaken for post-open canonical writes. The
   * trade-off is a same-millisecond false-negative; see
   * {@link overlappingCellsSince} and {@link deletedTouchedCells}.
   */
  async function hasCanonicalWritesSince(
    baseVersion: Date,
    exec: SqlExecutor = db,
  ): Promise<boolean> {
    for (const table of DRAFT_CONFLICT_TABLES) {
      const canonicalName = getTableName(table.canonical);
      const prefix = sql.raw(
        `SELECT 1 FROM "${canonicalName}" c WHERE ${timestampExpression("c")} > `,
      );
      const rows = normalizeRows(
        await exec.execute(sql`${prefix}${baseVersion}${sql.raw(" LIMIT 1")}`),
      );
      if (rows.length > 0) return true;
    }
    return false;
  }

  /**
   * Overlap is ROW-granular by design: a cell is `(table, id)`, so a draft
   * edit and a canonical write touching DIFFERENT COLUMNS of the same row
   * still count as a conflict. That is the safe (false-positive) direction
   * and matches the wystack `Cell` contract — do not "optimize" to
   * column-level.
   *
   * The strict `>` against a wall-clock `baseVersion` has a same-millisecond
   * false-negative: a canonical write landing in the exact ms the draft was
   * opened is not seen (the tests' `delay()` calls dodge this window). A
   * monotonic version token would close it; accepted for now — the window is
   * one clock tick on a local single-writer DB.
   *
   * Covers UPDATEs only: this INNER JOIN matches surviving canonical rows, so a
   * DELETE (the row is gone) is invisible here and detected separately against
   * the base inventory — see {@link deletedTouchedCells}.
   */
  async function overlappingCellsSince(
    draftId: string,
    baseVersion: Date,
    exec: SqlExecutor = db,
  ): Promise<Cell[]> {
    const cells: Cell[] = [];
    for (const table of DRAFT_CONFLICT_TABLES) {
      const canonicalName = getTableName(table.canonical);
      const draftName = getTableName(table.draft);
      const prefix = sql.raw(
        `SELECT d."id" AS id FROM "${draftName}" d ` +
          `INNER JOIN "${canonicalName}" c ON c."id" = d."id" ` +
          `WHERE d."draft_id" = `,
      );
      const rows = normalizeRows(
        await exec.execute(
          sql`${prefix}${draftId}${sql.raw(
            ` AND ${timestampExpression("c")} > `,
          )}${baseVersion}`,
        ),
      );
      for (const row of rows) {
        cells.push({ table: canonicalName, id: row.id });
      }
    }
    return cells;
  }

  async function detectConflictReport(
    draftId: string,
    exec: LogReader & SqlExecutor = db,
  ): Promise<ConflictReport> {
    const baseVersion = await readBaseVersion(draftId, exec);
    if (baseVersion === null) {
      // Fail-open by choice: only legacy drafts opened before draft_metadata
      // existed lack a base version (openDraft always inserts one now), and
      // blocking every such publish would strand them.
      return { staleBase: false, overlappingCells: [] };
    }

    const timestampStale = await hasCanonicalWritesSince(baseVersion, exec);
    const updatedCells = timestampStale
      ? await overlappingCellsSince(draftId, baseVersion, exec)
      : [];
    // Deletes bump no surviving row's timestamp, so they must be detected
    // separately against the base inventory (independent of `timestampStale`).
    const baseInventory = await readBaseInventory(draftId, exec);
    const deletedCells = baseInventory
      ? await deletedTouchedCells(draftId, baseInventory, exec)
      : [];

    // `updatedCells` requires the canonical row to still exist (INNER JOIN);
    // `deletedCells` requires it absent — the two sets are disjoint by
    // construction, so a plain concat cannot double-count a cell.
    const overlappingCells = [...updatedCells, ...deletedCells];
    // A delete IS a canonical advance even when no surviving row's timestamp
    // moved, so a delete-only conflict must still report `staleBase: true`.
    const staleBase = timestampStale || deletedCells.length > 0;

    return { staleBase, overlappingCells };
  }

  /**
   * Sweep a draft's `<table>__draft` shadow rows across the closed set. `exec` is
   * the Drizzle handle the DELETEs run against — BOTH callers now pass their
   * outer transaction's handle (publish: `tx.raw`; discard: `dropDraft`'s own
   * `db.transaction` callback) so the sweep commits ATOMICALLY with the rest of
   * that transaction (defaults to the autocommit `db` only for a direct call
   * outside either lifecycle path, e.g. tests).
   *
   * A sweep failure HARD-FAILS (propagates). Both callers want this:
   *   - discard — the sweep runs inside `dropDraft`'s tx, so a failure rolls
   *     back the whole discard (log delete + any `beforeDiscard` effects
   *     included) and leaves the draft intact for a clean retry, rather than a
   *     partially-torn-down draft.
   *   - publish — the sweep runs inside the outer tx, so a failure must roll back
   *     the whole publish (canonical replay + log delete included) and leave the
   *     draft intact for a clean retry, never canonical-committed with a half-swept
   *     shadow. (Earlier this path swept best-effort AFTER the commit; in-tx, there
   *     is no committed state to preserve, so propagating is strictly correct.)
   */
  async function sweepShadows(
    draftId: string,
    exec: DeleteExecutor = db,
  ): Promise<void> {
    for (const shadow of DRAFT_SHADOW_TABLES) {
      // `draftId` is a BOUND parameter (guard the sink); the table identifiers
      // are static schema objects, not caller input.
      await exec.delete(shadow).where(eq(shadow.draftId, draftId));
    }
  }

  /**
   * Delete every log row + shadow row for a draft, inside ONE transaction, with
   * an optional pre-teardown hook run against the reloaded log.
   *
   * ATOMIC (mirrors `publishDraft`'s outer-tx seam): the log reload, the
   * `beforeDiscard` hook, the log delete, and the shadow sweep all share one
   * commit boundary. A `beforeDiscard` throw rolls back the whole discard —
   * the log and shadow rows survive intact for a clean retry — rather than
   * leaving a partially-torn-down draft. `tx` here is `db.transaction`'s own
   * callback handle — already the native Drizzle handle (no `.raw` unwrap
   * needed, unlike the `DrizzleTracker.transaction` the publish path uses);
   * passing it to `readLog`/`deleteLog`/`sweepShadows` routes all four steps
   * through the same pre-teardown snapshot and commit boundary, closing the
   * same TOCTOU class `PublishDraftOptions.beforeReplay` closes on the
   * publish side (a pre-transaction `getDraftLog` read can miss a
   * command appended between that read and discard; reloading inside the tx
   * cannot).
   */
  async function dropDraft(
    draftId: string,
    options: DiscardDraftOptions = {},
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // `db.transaction`'s callback handle is ALREADY the plain Drizzle
      // handle (unlike `DrizzleTracker.transaction`, whose callback wraps it
      // behind `.raw` — see `writeLog` above for the same pattern). It
      // structurally satisfies both `LogReader` and `DeleteExecutor`.
      const log = await readLog(draftId, tx);
      // Pre-teardown hook: runs on the AUTHORITATIVE reloaded log, BEFORE the
      // log delete and shadow sweep remove the rows it might read (e.g. the
      // `dataSourcesDraft` shadow config for an inherited-only ref). See
      // `DiscardDraftOptions.beforeDiscard` for why this must live here.
      await options.beforeDiscard?.(log, tx);
      await deleteLog(draftId, tx);
      await sweepShadows(draftId, tx);
      await deleteDraftMetadata(draftId, tx);
    });
  }

  /**
   * Snapshot the canonical id inventory across the conflict tables at open, as
   * `{ [canonicalTableName]: id[] }`. This is the base against which delete
   * detection later diffs (see {@link deletedTouchedCells}) — the only way to
   * see a canonical row that a later publish finds already gone. Tables here are
   * small artifact-metadata tables, so a full id scan per table is cheap and
   * open is rare.
   */
  async function snapshotCanonicalInventory(
    exec: SqlExecutor = db,
  ): Promise<Record<string, unknown[]>> {
    const inventory: Record<string, unknown[]> = {};
    for (const table of DRAFT_CONFLICT_TABLES) {
      const canonicalName = getTableName(table.canonical);
      inventory[canonicalName] = [...(await canonicalIds(canonicalName, exec))];
    }
    return inventory;
  }

  return {
    async openDraft(baseVersion?: unknown): Promise<string> {
      // DashFrame owns the handle. `withDraft` accepts any id, so a UUID is the
      // durable draftId across the shadow tables and the command log.
      const draftId = crypto.randomUUID();
      // Capture baseVersion and the id inventory together at open — the paired
      // base for both timestamp- and delete-based conflict detection.
      await db.insert(draftMetadata).values({
        draftId,
        baseVersion: normalizeBaseVersion(baseVersion),
        baseInventory: await snapshotCanonicalInventory(),
      });
      return draftId;
    },

    async draftExists(draftId: string): Promise<boolean> {
      const rows = await db
        .select({ draftId: draftMetadata.draftId })
        .from(draftMetadata)
        .where(eq(draftMetadata.draftId, draftId));
      return rows.length > 0;
    },

    async listDrafts(): Promise<DraftListEntry[]> {
      const rows = normalizeRows(
        await db.execute(
          sql.raw(`
            WITH draft_summary AS (
              SELECT
                draft_id,
                COUNT(*)::int AS command_count,
                MAX(created_at) AS updated_at
              FROM draft_command_log
              GROUP BY draft_id
            )
            SELECT
              metadata.draft_id AS "draftId",
              metadata.created_at AS "createdAt",
              COALESCE(summary.command_count, 0)::int AS "commandCount",
              summary.updated_at AS "updatedAt",
              COALESCE((
                SELECT jsonb_object_agg(kind_counts.kind, kind_counts.count)
                FROM (
                  SELECT COALESCE(log.kind, 'unknown') AS kind, COUNT(*)::int AS count
                  FROM draft_command_log AS log
                  WHERE log.draft_id = metadata.draft_id
                  GROUP BY COALESCE(log.kind, 'unknown')
                ) AS kind_counts
              ), '{}'::jsonb) AS kinds,
              COALESCE((
                SELECT array_agg(path_counts.path ORDER BY path_counts.first_seq)
                FROM (
                  SELECT log.path, MIN(log.seq) AS first_seq
                  FROM draft_command_log AS log
                  WHERE log.draft_id = metadata.draft_id
                  GROUP BY log.path
                  ORDER BY first_seq
                  LIMIT 5
                ) AS path_counts
              ), ARRAY[]::text[]) AS paths
            FROM draft_metadata AS metadata
            LEFT JOIN draft_summary AS summary
              ON summary.draft_id = metadata.draft_id
            ORDER BY COALESCE(summary.updated_at, metadata.created_at) DESC
          `),
        ),
      );
      return rows.map((row) => ({
        draftId: String(row.draftId),
        createdAt: asDate(row.createdAt, "createdAt"),
        commandCount: Number(row.commandCount),
        updatedAt:
          row.updatedAt === null || row.updatedAt === undefined
            ? null
            : asDate(row.updatedAt, "updatedAt"),
        kinds: asCountRecord(row.kinds),
        paths: asStringArray(row.paths),
      }));
    },

    async reviseDraft(draftId, expectedLogSignature, ops) {
      if (!Array.isArray(ops) || ops.length === 0) {
        throw new Error("reviseDraft: at least one operation is required");
      }
      return db.transaction(async (tx) => {
        const log = await readLog(draftId, tx);

        // Validate every address and late-bound type against the authoritative
        // log before checking drift. In particular, a category/column/unknown
        // ref is never allowed to become bindable merely because a client
        // retries with a fresh signature or claims a different refType.
        const validatedOps = (ops as unknown[]).map((op) =>
          validateRevisionOp(log, op),
        );
        assertUniqueRevisionOps(validatedOps);

        if (computeLogSignature(log) !== expectedLogSignature) {
          throw new Error("reviseDraft: draft changed since review");
        }

        const resulting = applyRevisionOps(log, validatedOps);
        assertKnownCommandPaths(resulting, "reviseDraft");

        await tx
          .delete(draftCommandLog)
          .where(eq(draftCommandLog.draftId, draftId));
        if (resulting.length > 0) {
          await tx.insert(draftCommandLog).values(
            resulting.map((cmd, seq) => ({
              draftId,
              seq,
              path: cmd.path,
              args: (cmd.args ?? null) as unknown,
              cmdId: cmd.id ?? null,
              compactionKey: cmd.compactionKey ?? null,
              kind: cmd.kind ?? null,
            })),
          );
        }
        return {
          draftId,
          commandCount: resulting.length,
          logSignature: computeLogSignature(resulting),
        };
      });
    },

    async appendToDraft(draftId, batch, context = {}) {
      // Reject any non-vocabulary path (e.g. a nested `publishDraft`) BEFORE
      // a single command runs. Every command below dispatches with `draftId`
      // in context, and `commands.commit`'s `.authorize` check treats
      // `ctx.draftId != null` as "this is a draft-append step" — a lifecycle
      // procedure (publishDraft/discardDraft/commitBatch) nested in the batch
      // would read that SAME marker and pass, then run its own real
      // transaction using its OWN args (e.g. a different, unrelated draftId
      // to publish for real) — a service principal that can only ever draft
      // would escalate to a real canonical publish. See
      // `assertKnownCommandPaths` in functions/commands.ts.
      assertKnownCommandPaths(batch, "appendToDraft");
      // Route writes through the draft overlay by passing a BASE DrizzleTracker plus a
      // `draftId` in context, so `app.runHandler`'s `withDraftSeam` builds the
      // per-table FALL-THROUGH draft handle (draftable tables → `<table>__draft`,
      // non-draftable like project_meta → canonical). Building the raw
      // `createTracked().withDraft(draftId)` here would bypass that wrapper —
      // `withDraftSeam` returns an already-draft handle unchanged — so a command
      // whose handler reads a non-draftable table would throw on the missing
      // `<table>__draft` relation. Both withDraft entry points (call/runHandler
      // and this append) must go through the same fall-through seam.
      const baseDb = app.createTracked();
      const draftContext = { ...context, draftId };
      const results: CommandResult[] = [];
      // Snapshot each command AS IT SUCCESSFULLY RUNS, before compaction/persist.
      // The handler runs against the live `cmd` (what actually executed); the
      // SNAPSHOT is what we compact + persist. Without this, a caller mutating a
      // command or its nested `args` after `appendToDraft` started (while a
      // handler awaits) would make the durable log replay a command different
      // from the one the shadow reflects. The deep copy freezes the executed
      // form. `structuredClone` handles nested args; commands are plain JSON-ish
      // envelopes (path/args/id/compactionKey/kind) so it round-trips cleanly.
      const ranSnapshots: DraftCommand[] = [];
      // Rollbacks for credentials captured in this batch — invoked if ANYTHING
      // throws before the durable log write succeeds (capture, handler run, OR log
      // persistence). Until writeLog commits, a minted ref is in the vault but in
      // no log, so the log-driven discard release could never find it. The rollback
      // stays armed across the whole append; on success (after writeLog) the refs
      // are legitimately in the log and the rollbacks are dropped.
      const captureRollbacks: Array<() => Promise<void>> = [];
      try {
        for (const cmd of batch) {
          // Capture-before-log: the host may rewrite plaintext credential args
          // into vault refs BEFORE the command runs and is snapshotted, so the
          // durable log never holds plaintext. The rewritten command is what the
          // handler runs AND what we snapshot — shadow, log, handler all see the ref.
          const captured = captureCredentials
            ? await captureCredentials(cmd)
            : { command: cmd, rollback: async () => {} };
          // Defense in depth: `assertKnownCommandPaths(batch, ...)` above
          // already rejected any out-of-vocabulary path in the caller-supplied
          // batch before this loop started. Re-check the CAPTURED command too
          // — `captureCredentials` rewrites `args` (plaintext → vault ref) and
          // is trusted to leave `path` alone, but a future capture
          // implementation that also normalizes/reroutes `path` should not be
          // able to smuggle a lifecycle path past the pre-dispatch gate by
          // producing it only after the batch-level check already passed.
          assertKnownCommandPaths([captured.command], "appendToDraft");
          captureRollbacks.push(captured.rollback);
          const value = await app.runHandler(
            captured.command.path,
            captured.command.args,
            baseDb,
            draftContext,
          );
          ranSnapshots.push(structuredClone(captured.command) as DraftCommand);
          results.push({ id: captured.command.id, value });
        }
        // Project the compacted full log into draft_command_log. Read the prior
        // log, concat the snapshots of what just ran, compact (wystack's exported
        // algorithm), replace-all (atomically — see writeLog). INSIDE the try so a
        // log-persistence failure also triggers the capture rollback below.
        const prior = await readLog(draftId);
        const compacted = compactLog([...prior, ...ranSnapshots]);
        await writeLog(draftId, compacted);
        return results;
      } catch (err) {
        // The batch is non-atomic by contract (recovery = re-append, which
        // re-mints); release the refs captured so far so a failed append leaves
        // no orphaned secret. Best-effort — a release failure leaves an inert orphan.
        for (const rollback of captureRollbacks) {
          await rollback().catch(() => {});
        }
        throw err;
      }
    },

    async publishDraft(draftId, context = {}, options = {}) {
      // ONE publish path, warm or cold: the durable log is always the source.
      // Replay the ordered command log onto CANONICAL, atomically. applyCommands
      // dispatches each command via the (wrapped) `runHandler`, which re-applies
      // `withDraftSeam` to the transaction tracker from THIS context. A `draftId`
      // left in the replay context would therefore re-scope the publish back into
      // `<table>__draft` — the changes would land in the shadow and then be swept
      // by `dropDraft`, silently losing the publish. Strip it so the replay is
      // unambiguously canonical (the log is the read overlay's source, not a
      // draft-scoped write). `publishContext` carries the rest (e.g. vault).
      const publishContext = { ...context };
      delete publishContext.draftId;

      // ATOMIC PUBLISH (closes GH #157): open ONE outer transaction so the
      // canonical command-log replay, the log delete, and the shadow sweep share
      // a single commit boundary. Previously the replay ran in `applyCommands`'s
      // own transaction and the `deleteLog`/`sweepShadows` ran AFTER it returned
      // (separate autocommit statements) — a process death in that gap left
      // canonical committed but the log intact, so a retried publish replayed onto
      // canonical a second time (a duplicate-PK throw for create commands, no
      // clean recovery). Wiring all three into one tx via the `applyCommands`
      // outer-tx seam (its optional `tx` param) eliminates the window: if either
      // teardown step fails, the replay rolls back with it and the draft survives
      // intact for a clean retry. This mirrors wystack's own consumer
      // (draft-lifecycle.ts `publish()`), the reference adoption of the same seam.
      //
      // `DrizzleTracker.transaction` is generic over its callback's return type, so we
      // capture the CommitResult directly. `tx.raw` is the native Drizzle handle
      // bound to this transaction — passing it to `deleteLog`/`sweepShadows`
      // routes their DELETEs through the same commit boundary as the replay.
      const result = await app.createTracked().transaction(async (tx) => {
        const log = await readLog(draftId, tx.raw as LogReader);
        // Review-drift guards first: this log read shares the replay's commit
        // boundary, so a mismatch here means the draft REALLY changed since the
        // reviewed state was taken — abort before content validation.
        //
        // Count is the cheap fast-path; signature is the content check that
        // catches same-length drift the count alone misses (see
        // `PublishDraftOptions` docs for why compaction makes this possible).
        // Both checks read the SAME reloaded log, so their evidence is always
        // consistent with each other — never a case where count passes,
        // signature fails, but on a log that's already been mutated further.
        if (
          options.expectedCommandCount !== undefined &&
          log.length !== options.expectedCommandCount
        ) {
          throw new Error(
            "publishDraft: draft changed since review (count mismatch)",
          );
        }
        if (
          options.expectedLogSignature !== undefined &&
          computeLogSignature(log) !== options.expectedLogSignature
        ) {
          throw new Error(
            "publishDraft: draft changed since review (content drift)",
          );
        }
        assertPublishLogHasNoLateBound(log);
        // Defense in depth: every command in the log was already vetted by
        // `assertKnownCommandPaths` at `appendToDraft` time, so this should
        // never find anything — but replay reads the log fresh from storage
        // inside this transaction, not the in-memory batch that was
        // originally validated. Re-checking here means a hypothetical path
        // that reaches the table some other way (a direct write, a future
        // seam that skips `appendToDraft`) still can't replay a lifecycle
        // command onto canonical state.
        assertKnownCommandPaths(log, "publishDraft replay");
        validatePublishLog?.(log);
        if (options.blockOnConflict === true) {
          const conflictReport = await detectConflictReport(
            draftId,
            tx.raw as LogReader & SqlExecutor,
          );
          if (
            conflictReport.staleBase &&
            conflictReport.overlappingCells.length > 0
          ) {
            throw new DraftPublishConflictError(conflictReport);
          }
        }
        // Pre-replay hook: runs on the AUTHORITATIVE reloaded log, after both
        // guards above, before replay mutates canonical rows. See
        // `PublishDraftOptions.beforeReplay` for why this must live here and
        // not before the transaction opens.
        await options.beforeReplay?.(log, tx.raw as LogReader);
        const committed = (await applyCommands(app, log, {
          mode: "commit",
          context: publishContext,
          tx,
        })) as CommitResult;
        // Teardown INSIDE the same tx, AFTER the replay writes are staged:
        //
        //  1. deleteLog — the idempotency gate. Deleting the log inside the tx is
        //     what makes the fix atomic: once committed, a retried publish reads
        //     an empty log and is a no-op rather than a second canonical replay.
        //  2. sweepShadows — the (now-inert) shadow rows, swept in the same tx.
        //     The sweep hard-fails here (unlike the old post-commit best-effort
        //     posture): a sweep failure must roll back the whole publish so the
        //     draft survives for a clean retry — there is no half-committed state
        //     to preserve, because nothing has committed yet.
        //
        // The `tablesWritten` snapshot is taken by `applyCommands` at its own
        // return (before these DELETEs) and the DELETEs run through `tx.raw`
        // (untracked), so the log/shadow tables never flush to invalidation —
        // matching the wystack consumer's posture.
        const exec = tx.raw as DeleteExecutor;
        await deleteLog(draftId, exec);
        await sweepShadows(draftId, exec);
        await deleteDraftMetadata(draftId, exec);
        return committed;
      });
      // The host flushes result.tablesWritten to invalidation (the controller
      // does not, mirroring applyCommands' posture). No post-commit teardown
      // remains — the outer tx already swept the log + shadow atomically with the
      // replay, so a crash here cannot leave a double-replay window.
      return result;
    },

    async discardDraft(draftId, options = {}) {
      await dropDraft(draftId, options);
    },

    async detectConflict(draftId) {
      return detectConflictReport(draftId);
    },

    async getDraftLog(draftId) {
      return readLog(draftId);
    },
  };
}
