/**
 * `applyCommand` — the assistant's single generic mutation tool.
 *
 * ONE tool, generic over `{ type, args }`:
 *   - `type`  — a command name string from the DRAFT-SAFE ALLOW-LIST below.
 *     The full vocabulary is described in the assistant command guide (see the
 *     read layer package). The agent constructs commands by name + args; this
 *     tool delegates to `buildCommand` (injected by the host) to map the name
 *     to the wire-path envelope and emits into the draft.
 *   - `args`  — the payload object for the named command, opaque to this tool.
 *     Validation is handled by the backing mutation handler inside appendToDraft
 *     (the same path an RPC call validates). A malformed payload surfaces as a
 *     thrown error (no swallow, no false success) so the agent can fix + retry.
 *
 * Invariants (load-bearing, restated in code):
 *
 *   TRANSPARENT — every call is a visible plan step: a DraftCommand appended to
 *   the compacted log before anything canonical is touched.
 *
 *   VERIFIABLE — routes through the real `applyCommands` seam (inside
 *   appendToDraft → runHandler → mutation handler) so the command produces the
 *   same effect whether the agent or the UI emitted it.
 *
 *   NEVER CANONICAL — appendToDraft writes the draft overlay only. Publish
 *   is a separate, human-gated step; this tool MUST NOT call publishDraft or
 *   touch canonical.
 *
 *   DRAFT-SAFE SUBSET — the assistant's vocabulary is NOT the full human
 *   command vocabulary. Commands with vault/credential side-effects or
 *   draft-overlay-unsafe cascade operations are denied at the tool boundary
 *   before reaching buildCommand or appendToDraft (see DRAFT_SAFE_COMMANDS).
 *
 * Factory pattern: `createApplyCommandTool(options)`. The draftId is the handle
 * minted by `openDraft` at assistant session start — captured once in the
 * factory, not passed per-call. This keeps the per-call surface minimal
 * (type + args only) and makes it impossible for the agent to steer writes to a
 * different draft.
 *
 * Dependency direction: `@dashframe/assistant` must NOT import from
 * `@dashframe/server` (server depends on assistant, not the other way). The
 * `buildCommand` callback lets the host inject the `cmd()` factory from
 * commands.ts without creating a circular dependency. The `DraftAppender`
 * interface captures only the one method this tool calls (`appendToDraft`) so
 * the assistant package carries no server import.
 */

import { defineToolHandler, Type } from "./tool.js";

// ---------------------------------------------------------------------------
// Minimal dependency interfaces (no server import)
// ---------------------------------------------------------------------------

/**
 * The `Command` envelope shape `applyCommands` dispatches. Inlined here so the
 * assistant package does not import from @wystack/server.
 */
export interface AssistantCommand {
  /** The wire path the app's function registry dispatches against. */
  path: string;
  /** Handler args, opaque at this layer — the mutation validates shape. */
  args: unknown;
  /** Optional correlation id echoed in the CommandResult. */
  id?: string;
}

/**
 * Minimal interface capturing only the one DraftController method this tool
 * calls. The server host injects its `DraftController`; structural compatibility
 * means no import of the server type is needed here.
 */
export interface DraftAppender {
  appendToDraft(
    draftId: string,
    batch: AssistantCommand[],
    context?: Record<string, unknown>,
  ): Promise<Array<{ id?: string; value: unknown }>>;
}

// ---------------------------------------------------------------------------
// Draft-safe command allow-list
// ---------------------------------------------------------------------------

/**
 * The assistant's vocabulary: the DRAFT-SAFE subset of the full command
 * vocabulary. DEFAULT-DENY — any command not in this set is rejected at the
 * tool boundary before reaching `buildCommand` or `appendToDraft`.
 *
 * **WHY a separate allow-list (not the full vocabulary)**
 *
 * Two command categories are NOT safe for agent-driven draft execution:
 *
 * 1. Credential commands — `CreateDataSource`, `SetDataSourceConfig`, and
 *    `DeleteNode` on a DataSource call `vault.store` / `vault.delete` /
 *    `releaseCredentialRefs` as OS-keychain side effects OUTSIDE the DB
 *    transaction. The draft overlay only drafts DB writes; vault ops are NOT
 *    drafted and NOT rolled back on discard. Allowing the agent to invoke these
 *    would create real credential state from a supposed sandbox operation.
 *
 * 2. Draft-overlay-unsafe deletes — `DeleteNode` on Insight or DataTable
 *    uses non-PK-filtered cascade operations (e.g. DataFrame cleanup by
 *    `insightId`, Visualization scan by `insightId`) that the draft overlay
 *    cannot safely replicate. The draft handle does not emulate FK cascades,
 *    so delete cascades inside a draft can produce incorrect results.
 *
 * `GetOrCreateDataSource` (no vault, PK-only insert) is excluded from the
 * allow-list because DataSource creation is a human-owned credential setup
 * step — even without a vault side-effect today, it creates a data-access
 * reference that the human must review. The assistant works with existing
 * DataSources/DataTables, not mint new ones.
 *
 * This set is the exhaustive additive/update artifact vocabulary the
 * assistant can safely draft. New commands must be reviewed against the two
 * categories above before being added here.
 */
export const DRAFT_SAFE_COMMANDS = new Set([
  // DataTable (existing — assistant does not create/configure data sources)
  "CreateDataTable",
  "SetDataTableSchema",
  "RefreshDataTable",
  // Fields & Metrics (additive/update, PK-addressed, no vault)
  "AddField",
  "UpdateField",
  "RemoveField",
  "AddMetric",
  "UpdateMetric",
  "RemoveMetric",
  // Insight (additive/update, PK-addressed, no vault)
  "CreateInsight",
  "SetInsightSource",
  "SelectFields",
  "SetInsightFilter",
  "SetInsightSort",
  "AddJoin",
  "UpdateJoin",
  "RemoveJoin",
  // Visualization (additive/update, PK-addressed, no vault)
  "CreateVisualization",
  "SetChartType",
  "SetChartEncoding",
  // Dashboard (additive/update, PK-addressed, no vault)
  "CreateDashboard",
  "AddDashboardItem",
  "UpdateDashboardItem",
  "SetDashboardLayout",
  "RemoveDashboardItem",
  // Cross-cutting rename (PK-addressed, no vault, no cascade)
  "RenameNode",
  //
  // NOT ALLOWED (default-deny for unlisted commands):
  //   GetOrCreateDataSource — human-owned data-source creation step
  //   CreateDataSource      — vault.store side-effect (not drafted)
  //   SetDataSourceConfig   — vault.store side-effect (not drafted)
  //   DeleteNode            — vault.delete (DataSource path) + non-PK cascade
  //                           (Insight/DataTable paths); draft-overlay-unsafe
]);

// ---------------------------------------------------------------------------
// applyCommand result detail
// ---------------------------------------------------------------------------

/**
 * The details payload on a successful applyCommand call. `commandResult` is the
 * raw value returned by the backing mutation handler — opaque at this layer (the
 * vocabulary is the source of truth, not this tool). `commandType` echoes the
 * command name so the caller can log / inspect without re-parsing `args`.
 */
export interface ApplyCommandDetails {
  /** Echo of the command type that was applied. */
  commandType: string;
  /**
   * The raw value returned by the backing mutation handler (e.g. `{ id }` for a
   * Create command, `{ ok: true }` for an update). Opaque — callers should
   * consult the assistant command guide for the per-command shape.
   */
  commandResult: unknown;
}

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

export interface CreateApplyCommandToolOptions {
  /**
   * The draft controller bound to the current project. Only `appendToDraft` is
   * called — the interface is intentionally minimal (structural duck-typing).
   */
  controller: DraftAppender;
  /**
   * The draft handle minted by `controller.openDraft()` at assistant session
   * start. Captured once so the agent cannot redirect writes per-call.
   */
  draftId: string;
  /**
   * Maps a command name string (e.g. "CreateInsight") to a `{ path, args }`
   * Command envelope the app's function registry can dispatch. Injected by the
   * server host so this package carries no direct dependency on @dashframe/server.
   *
   * Only called for command types that pass the DRAFT_SAFE_COMMANDS allow-list
   * gate (enforced in execute() before this function is invoked). The host does
   * not need to re-validate the type — the gate already runs.
   *
   * **Unknown-type guard** — The `cmd()` helper in commands.ts is typed at
   * compile time only; at runtime `cmd(unknownName, args)` silently produces
   * `{ path: undefined, args }`, which reaches `runHandler` as the cryptic
   * error `"Unknown function: undefined"`. Wrap `cmd()` with a runtime
   * key-guard so the agent sees a clear error to fix+retry:
   *
   * ```ts
   * buildCommand: (type, args) => {
   *   if (!(type in COMMAND_PATHS)) throw new Error(`Unknown command: "${type}"`);
   *   return cmd(type as CommandName, args as CommandPayloads[CommandName]);
   * }
   * ```
   *
   * Thrown errors propagate honestly to the agent (no swallow).
   */
  buildCommand: (type: string, args: unknown) => AssistantCommand;
  /**
   * Optional extra context forwarded to `appendToDraft` as the third positional
   * argument alongside the draftId (first) and batch (second). Supplemental
   * session metadata — e.g. vault resolver, session id. The draftId is already
   * passed as a separate positional arg; it is NOT merged into this object.
   */
  context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the `applyCommand` AgentTool bound to a draft controller + draftId.
 *
 * @example
 * ```ts
 * // In the server host (where cmd() is available):
 * import { cmd, type CommandName, type CommandPayloads } from "./functions/commands.js";
 * import { createApplyCommandTool, DRAFT_SAFE_COMMANDS } from "@dashframe/assistant";
 *
 * const applyCommandTool = createApplyCommandTool({
 *   controller,
 *   draftId,
 *   // Only called for types that pass the DRAFT_SAFE_COMMANDS gate.
 *   // Add a runtime key-guard so cmd() maps the name to a real path
 *   // (cmd() is compile-time-only typed; unknown names silently produce
 *   // { path: undefined } which reaches runHandler as a cryptic error).
 *   buildCommand: (type, args) => {
 *     if (!(type in COMMAND_PATHS)) {
 *       throw new Error(`Unknown command: "${type}"`);
 *     }
 *     return cmd(type as CommandName, args as CommandPayloads[CommandName]);
 *   },
 * });
 *
 * // Then pass to the agent's tool set:
 * agent.state.tools = [applyCommandTool, ...readTools];
 * ```
 */
export function createApplyCommandTool(options: CreateApplyCommandToolOptions) {
  const { controller, draftId, buildCommand, context } = options;

  return defineToolHandler({
    name: "applyCommand",
    description:
      "Apply one command to the open draft. The command is appended to the draft's " +
      "plan as a visible step — nothing is written to canonical until the draft is " +
      "published (a separate, human-gated action). Supply `type` as a command name " +
      '(e.g. "CreateInsight", "AddDashboardItem") and `args` as the matching payload ' +
      "object for that command. Only draft-safe artifact commands are available — " +
      "credential and data-source configuration commands are human-only operations. " +
      "On validation failure the error is returned so you can correct the args and retry. " +
      "NEVER emits to canonical.",
    label: "Apply Command",
    // Mutating — serialise against other tool calls in the same batch so the
    // single-writer-per-draftId contract (documented in draft-controller.ts) is
    // satisfied when pi dispatches a multi-tool turn.
    executionMode: "sequential",
    parameters: Type.Object({
      type: Type.String({
        description:
          "The command name from the draft-safe DashFrame vocabulary, e.g. " +
          '"CreateInsight", "CreateVisualization", "AddDashboardItem". ' +
          "Must be one of the allowed command names from the command guide. " +
          "Data-source and credential commands are not available to the assistant.",
      }),
      args: Type.Unknown({
        description:
          "The payload object for the named command. Shape depends on `type` — " +
          "see the command guide for per-command schemas.",
      }),
    }),

    async execute(_toolCallId, params) {
      const { type, args } = params;

      // SECURITY GATE: enforce the draft-safe allow-list BEFORE calling
      // buildCommand or appendToDraft. This is a default-deny boundary:
      //
      //   - Credential commands (CreateDataSource, SetDataSourceConfig,
      //     DeleteNode on DataSource) call vault.store/vault.delete as
      //     OS-keychain side effects OUTSIDE the DB transaction. These ops are
      //     NOT drafted and NOT rolled back on discard — allowing the agent to
      //     trigger them would create real credential state from a sandbox.
      //
      //   - Draft-overlay-unsafe deletes (DeleteNode on Insight/DataTable)
      //     use non-PK-filtered cascade operations that the draft overlay
      //     cannot safely replicate.
      //
      // Rejecting here — before buildCommand — means no vault call, no append,
      // no draft mutation: a clean, auditable deny at the tool seam.
      if (!DRAFT_SAFE_COMMANDS.has(type)) {
        throw new Error(
          `applyCommand: command type "${type}" is not available to the assistant. ` +
            "Credential operations and data-source configuration are human-only. " +
            `Available commands: ${[...DRAFT_SAFE_COMMANDS].sort().join(", ")}`,
        );
      }

      // Build the Command envelope. `buildCommand` is the host-injected bridge
      // to cmd() in commands.ts — the single source of truth for name→path
      // mapping. An unknown command type throws here with a clear error before
      // appendToDraft is called, so the agent gets a useful message to fix+retry.
      //
      // TRANSPARENT: the command is constructed and emitted as an explicit plan
      // step visible in the draft log — no behind-the-scenes canonical write.
      const command = buildCommand(type, args);

      // Emit into the draft via the controller's sanctioned write path.
      // NEVER CANONICAL: appendToDraft → runHandler → withDraft overlay.
      //
      // Validation failures inside the mutation handler surface as thrown
      // errors. defineToolHandler lets them propagate so pi marks the
      // ToolResultMessage as isError: true — NO silent swallowing.
      // The agent receives the honest error and can retry with corrected args.
      const results = await controller.appendToDraft(
        draftId,
        [command],
        context,
      );

      // appendToDraft returns one CommandResult per command in the batch.
      // We passed exactly one command; the contract requires exactly one result.
      // A shorter array is a host implementation bug — surface it loudly rather
      // than silently returning null, which would look like success to the agent.
      if (results.length === 0) {
        throw new Error(
          `appendToDraft returned 0 results for 1 command (draftId=${draftId}, type="${type}") ` +
            "— host DraftAppender contract violation: expected one result per batch element",
        );
      }
      const result = results[0]!;

      return {
        content: [
          {
            type: "text" as const,
            text:
              `Command "${type}" applied to draft. ` +
              `Result: ${JSON.stringify(result.value ?? null)}`,
          },
        ],
        details: {
          commandType: type,
          commandResult: result.value ?? null,
        } satisfies ApplyCommandDetails,
      };
    },
  });
}
