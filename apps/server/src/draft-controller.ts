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
 * The seam is dormant in this slice (no host injects a draftId), so this is not
 * yet live; the consumer that wires draftId into request context must enforce the
 * credential-side-effect boundary at THAT seam (deny-list credentialed paths in a
 * draft, or make vault.store draft-aware) before routing untrusted drafts.
 */
import {
  dashboardsDraft,
  dataFramesDraft,
  dataSourcesDraft,
  dataTablesDraft,
  draftCommandLog,
  insightsDraft,
  visualizationsDraft,
  type ArtifactDb,
} from "@dashframe/server-core";
import {
  applyCommands,
  compactLog,
  type Command,
  type CommandResult,
  type CommitResult,
  type DraftCommand,
  type WyStackApp,
} from "@wystack/server";
import { eq } from "drizzle-orm";

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

/** A persisted log row mapped back to the `DraftCommand` shape replay consumes. */
function rowToDraftCommand(row: {
  path: string;
  args: unknown;
  compactionKey: string | null;
  kind: string | null;
}): DraftCommand {
  const cmd: DraftCommand = { path: row.path, args: row.args };
  if (row.compactionKey !== null) cmd.compactionKey = row.compactionKey;
  if (row.kind !== null) cmd.kind = row.kind as DraftCommand["kind"];
  return cmd;
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
  /**
   * Publish = replay the durable command log atomically onto canonical via
   * `applyCommands(app, log, {commit})`, then sweep the (now-inert) shadow + log.
   * Reads ONLY `draft_command_log` — never the shadow — so it works identically
   * whether or not the opening process is still alive. Returns the CommitResult
   * (`tablesWritten` is what the host flushes to invalidation).
   */
  publishDraft(
    draftId: string,
    context?: Record<string, unknown>,
  ): Promise<CommitResult>;
  /**
   * Discard = drop the draft's deltas: delete every `<table>__draft` row and
   * every `draft_command_log` row for this draftId. Canonical is untouched.
   * Pure DELETE-by-draftId; no wystack call needed.
   */
  discardDraft(draftId: string): Promise<void>;
  /** Read-only peek at a draft's persisted (compacted) command log. */
  getDraftLog(draftId: string): Promise<Command[]>;
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
): DraftController {
  /** Read the draft's persisted command log, ordered for replay. */
  async function readLog(draftId: string): Promise<DraftCommand[]> {
    const rows = await db
      .select({
        path: draftCommandLog.path,
        args: draftCommandLog.args,
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
   */
  async function writeLog(
    draftId: string,
    compacted: DraftCommand[],
  ): Promise<void> {
    await db
      .delete(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    if (compacted.length === 0) return;
    await db.insert(draftCommandLog).values(
      compacted.map((cmd, seq) => ({
        draftId,
        seq,
        path: cmd.path,
        // `args` is opaque JSON-shaped data the lifecycle never interprets; store
        // it verbatim. `?? null` because jsonb stores SQL NULL for an absent arg.
        args: (cmd.args ?? null) as unknown,
        compactionKey: cmd.compactionKey ?? null,
        kind: cmd.kind ?? null,
      })),
    );
  }

  /**
   * Delete every log row + shadow row for a draft. Canonical untouched.
   *
   * Log-FIRST is load-bearing for publish idempotency: `publishDraft` reads only
   * `draft_command_log`, so once the log is gone a retried publish reads an empty
   * log and is a no-op rather than a second replay onto canonical. Sweeping the
   * (now-inert) shadow rows after the log means a teardown that fails partway —
   * log deleted, a shadow delete throws — leaves only orphaned shadow rows that
   * publish already ignores; it never leaves a live log that would double-replay.
   */
  async function dropDraft(draftId: string): Promise<void> {
    await db
      .delete(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
    for (const shadow of DRAFT_SHADOW_TABLES) {
      // `draftId` is a BOUND parameter (guard the sink); the table identifiers
      // are static schema objects, not caller input.
      await db.delete(shadow).where(eq(shadow.draftId, draftId));
    }
  }

  return {
    async openDraft(_baseVersion?: unknown): Promise<string> {
      // DashFrame owns the handle. `withDraft` accepts any id, so a UUID is the
      // durable draftId across the shadow tables and the command log.
      return crypto.randomUUID();
    },

    async appendToDraft(draftId, batch, context = {}) {
      // Route writes through the draft handle so each handler's `ctx.db.into/
      // update/delete` lands in `<table>__draft` (the withDraft write-path),
      // exactly as createDraftLifecycle.append does — the controller drives the
      // path, it never authors a shadow-table write.
      const draftDb = app.createTracked().withDraft(draftId);
      const results: CommandResult[] = [];
      for (const cmd of batch) {
        const value = await app.runHandler(
          cmd.path,
          cmd.args,
          draftDb,
          context,
        );
        results.push({ id: cmd.id, value });
      }
      // Project the compacted full log into draft_command_log. Read the prior
      // log, concat this batch, compact (wystack's exported algorithm), replace-all.
      const prior = await readLog(draftId);
      const compacted = compactLog([...prior, ...batch]);
      await writeLog(draftId, compacted);
      return results;
    },

    async publishDraft(draftId, context = {}) {
      // ONE publish path, warm or cold: the durable log is always the source.
      const log = await readLog(draftId);
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
      const result = (await applyCommands(app, log, {
        mode: "commit",
        context: publishContext,
      })) as CommitResult;
      // Teardown AFTER the canonical commit landed durably. `dropDraft` deletes
      // the log first (its own invariant) so a retried publish finds no log and
      // is a no-op rather than a double-replay; then it sweeps the now-inert
      // shadow rows. The host flushes result.tablesWritten to invalidation (the
      // controller does not, mirroring applyCommands' posture).
      //
      // KNOWN DURABILITY WINDOW: the canonical commit and the log delete are two
      // separate transactions — `applyCommands` owns its own tx and does not
      // accept an outer one. A process crash in the gap (canonical committed, log
      // not yet deleted) leaves the log intact, so a retried publish replays onto
      // canonical a second time — a duplicate-PK throw for create commands, with
      // no clean recovery (canonical already holds the row; discard only sweeps
      // the shadow). Closing this needs either an `applyCommands` that accepts an
      // outer transaction (wystack-side) or a durable publish-state marker on a
      // draft record (no draft record exists in this slice). Out of scope for the
      // mechanism slice; tracked as follow-up before the seam is wired live.
      await dropDraft(draftId);
      return result;
    },

    async discardDraft(draftId) {
      await dropDraft(draftId);
    },

    async getDraftLog(draftId) {
      return readLog(draftId);
    },
  };
}
