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

/**
 * The DB-handle surface the teardown helpers (`deleteLog`/`sweepShadows`) need:
 * just `.delete()`. Narrowing to this (rather than the full `ArtifactDb`) keeps
 * the publish path's `tx.raw` cast honest — a transaction-bound raw handle does
 * NOT expose `.transaction()`, so widening to `ArtifactDb` would advertise a
 * method that fails at runtime. With this type, any future helper that reaches for
 * `.transaction()` is a compile error, not a latent footgun.
 */
type DeleteExecutor = Pick<ArtifactDb, "delete">;

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
   * longer possible; both land in one commit or both roll back). Other callers
   * (discard) pass the autocommit `db` handle. Defaults to `db`.
   */
  async function deleteLog(
    draftId: string,
    exec: DeleteExecutor = db,
  ): Promise<void> {
    await exec
      .delete(draftCommandLog)
      .where(eq(draftCommandLog.draftId, draftId));
  }

  /**
   * Sweep a draft's `<table>__draft` shadow rows across the closed set. `exec` is
   * the Drizzle handle the DELETEs run against — the publish path passes the outer
   * transaction's `tx.raw` so the sweep commits ATOMICALLY with the canonical
   * replay + log delete (defaults to the autocommit `db` for discard).
   *
   * A sweep failure HARD-FAILS (propagates). Both callers want this:
   *   - discard — the whole draft must be fully gone; a partial sweep must surface.
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
   * Delete every log row + shadow row for a draft. Log-FIRST + hard-fail on any
   * step: used by discard, where the whole draft must be removed atomically-ish
   * (a failure should surface so the caller knows the draft is not fully gone).
   */
  async function dropDraft(draftId: string): Promise<void> {
    await deleteLog(draftId);
    await sweepShadows(draftId);
  }

  return {
    async openDraft(_baseVersion?: unknown): Promise<string> {
      // DashFrame owns the handle. `withDraft` accepts any id, so a UUID is the
      // durable draftId across the shadow tables and the command log.
      return crypto.randomUUID();
    },

    async appendToDraft(draftId, batch, context = {}) {
      // Route writes through the draft overlay by passing a BASE TrackedDb plus a
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
      for (const cmd of batch) {
        const value = await app.runHandler(
          cmd.path,
          cmd.args,
          baseDb,
          draftContext,
        );
        ranSnapshots.push(structuredClone(cmd) as DraftCommand);
        results.push({ id: cmd.id, value });
      }
      // Project the compacted full log into draft_command_log. Read the prior
      // log, concat the snapshots of what just ran, compact (wystack's exported
      // algorithm), replace-all (atomically — see writeLog).
      const prior = await readLog(draftId);
      const compacted = compactLog([...prior, ...ranSnapshots]);
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
      // `TrackedDb.transaction` is generic over its callback's return type, so we
      // capture the CommitResult directly. `tx.raw` is the native Drizzle handle
      // bound to this transaction — passing it to `deleteLog`/`sweepShadows`
      // routes their DELETEs through the same commit boundary as the replay.
      const result = await app.createTracked().transaction(async (tx) => {
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
        return committed;
      });
      // The host flushes result.tablesWritten to invalidation (the controller
      // does not, mirroring applyCommands' posture). No post-commit teardown
      // remains — the outer tx already swept the log + shadow atomically with the
      // replay, so a crash here cannot leave a double-replay window.
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
