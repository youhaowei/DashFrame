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

import { isSecretRef } from "@wystack/secret-vault";

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
 * 1. Credential commands — `CreateDataSource` and `SetDataSourceConfig` are
 *    draft-safe ON THE CREDENTIAL WRITE PATH built for them: their plaintext
 *    credential args are captured to vault refs BEFORE the draft log snapshot
 *    (plaintext-never-at-rest), and ref RELEASE is deferred to a lifecycle
 *    transition (publish/discard) gated by a cross-draft reference check — so a
 *    discarded draft leaves no orphaned keychain blob and a draft credential is
 *    never released while still live. They are therefore in the allow-list, BUT
 *    only when the agent supplies PLAINTEXT: a caller-supplied ref-shaped value
 *    (`secret:<uuid>`) is REJECTED at the credential-ref gate below (see
 *    {@link CREDENTIAL_COMMAND_ARG_FIELDS}) so the agent cannot adopt a foreign /
 *    arbitrary ref and bypass `storeCredential` + the fail-closed vault guard.
 *
 * 2. Draft-overlay-unsafe deletes — `DeleteNode` on a DataSource calls
 *    `vault.delete` / `releaseCredentialRefs` as an OS-keychain side effect that
 *    the draft overlay does NOT draft or roll back, and `DeleteNode` on Insight
 *    or DataTable uses non-PK-filtered cascade operations (e.g. DataFrame cleanup
 *    by `insightId`, Visualization scan by `insightId`) the draft overlay cannot
 *    safely replicate. So `DeleteNode` stays DENIED.
 *
 * `GetOrCreateDataSource` (no vault, PK-only insert) is excluded from the
 * allow-list because its create half is the legacy coarse path that lacks the
 * capture-before-log credential treatment; the assistant authors via the typed
 * `CreateDataSource` / `SetDataSourceConfig` commands instead.
 *
 * This set is the exhaustive additive/update artifact vocabulary the assistant
 * can safely draft. New commands must be reviewed against the categories above
 * before being added here — and any command with credential-bearing args must
 * also be registered in {@link CREDENTIAL_COMMAND_ARG_FIELDS}.
 */
export const DRAFT_SAFE_COMMANDS = new Set([
  // DataSource (credential write path — capture-before-log + transition-time
  // release; agent-supplied refs are REJECTED at the credential-ref gate, agent
  // must supply plaintext which routes through storeCredential + fail-closed guard)
  "CreateDataSource",
  "SetDataSourceConfig",
  // DataTable
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
  "FanOutDashboardItems",
  // Cross-cutting rename (PK-addressed, no vault, no cascade)
  "RenameNode",
  //
  // NOT ALLOWED (default-deny for unlisted commands):
  //   GetOrCreateDataSource — legacy coarse create, no capture-before-log path
  //   DeleteNode            — vault.delete (DataSource path) + non-PK cascade
  //                           (Insight/DataTable paths); draft-overlay-unsafe
]);

// ---------------------------------------------------------------------------
// Credential-ref gate — agent must supply plaintext, never a ref
// ---------------------------------------------------------------------------

/**
 * Commands that author connector credentials, mapped to their TYPED credential
 * fields (`apiKey` / `connectionString`). This map serves two purposes:
 *   - membership: a command listed here is credential-bearing, so the
 *     credential-ref gate ({@link assertNoCallerSuppliedRefs}) runs on it;
 *   - drift guard: it MIRRORS the server's `CREDENTIAL_COMMAND_FIELDS` (the
 *     capture/release lifecycle source of truth), bridged by a server-side test
 *     so the two cannot diverge.
 *
 * NOTE the gate's reject is field-AGNOSTIC (see {@link assertNoCallerSuppliedRefs})
 * — it does not rely on this field list. The typed fields here only document the
 * plaintext-capture lifecycle; the reject scans the whole args, because a connector
 * config carries ref-shaped slots beyond these (e.g. a REST source's
 * `extra.authRef`) that must be guarded too.
 */
export const CREDENTIAL_COMMAND_ARG_FIELDS: Readonly<
  Record<string, ReadonlyArray<"apiKey" | "connectionString">>
> = {
  CreateDataSource: ["apiKey", "connectionString"],
  SetDataSourceConfig: ["apiKey", "connectionString"],
};

/** True if any string anywhere in `value` is a SecretRef (recursive). */
function hasSecretRefDeep(value: unknown): boolean {
  if (isSecretRef(value)) return true;
  if (Array.isArray(value)) return value.some(hasSecretRefDeep);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(hasSecretRefDeep);
  }
  return false;
}

/**
 * Reject a credential command whose args carry a caller-supplied vault ref —
 * ANYWHERE, recursively (a typed field OR a nested connector slot like
 * `extra.authRef`). No-op for non-credential commands.
 *
 * **WHY (the foreign-ref threat)** — the server's draft credential path stores a
 * PLAINTEXT credential to a vault ref before the log snapshot. The agent has NO
 * legitimate reason to supply a pre-existing ref — it authors fresh credentials —
 * and a caller-supplied `secret:<uuid>` would let it point a source at a secret it
 * does NOT own (e.g. a REST `extra.authRef` the connector resolves and sends to an
 * agent-controlled endpoint), skipping `storeCredential` + the fail-closed guard.
 * So we FORBID caller-supplied refs on the agent path: plaintext only.
 *
 * Field-agnostic on purpose — enumerating credential fields is what let `authRef`
 * (not in the typed field map) slip past an earlier version of this guard.
 *
 * This is the agent's EARLY, clear error; the server capture seam enforces the
 * same rule as the durable guarantee for every `appendToDraft` caller. Thrown as a
 * tool error so the agent can correct and retry.
 */
function assertNoCallerSuppliedRefs(type: string, args: unknown): void {
  if (!(type in CREDENTIAL_COMMAND_ARG_FIELDS)) return;
  if (hasSecretRefDeep(args)) {
    throw new Error(
      `applyCommand: command "${type}" must carry the plaintext credential, not a ` +
        "vault ref. The assistant cannot adopt a pre-existing secret ref (in any " +
        "field, including nested connector config) — supply the raw secret value " +
        "and it will be stored securely.",
    );
  }
}

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
      "object for that command. Only draft-safe commands are available. To author a " +
      "data source, supply its credential (apiKey / connectionString) as the raw " +
      "PLAINTEXT secret — never a vault ref; it is stored securely on your behalf. " +
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
          "For data-source credentials, pass the raw plaintext secret, not a vault ref.",
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

      // CREDENTIAL-REF GATE: for a credential command, the agent must supply the
      // PLAINTEXT secret — a caller-supplied ref (`secret:<uuid>`) is rejected
      // here, before buildCommand / appendToDraft, so the agent cannot adopt a
      // foreign / arbitrary vault ref and bypass storeCredential + the
      // fail-closed guard. See CREDENTIAL_COMMAND_ARG_FIELDS for the threat model.
      assertNoCallerSuppliedRefs(type, args);

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
