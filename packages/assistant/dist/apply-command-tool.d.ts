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
import { Type } from "./tool.js";
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
    appendToDraft(draftId: string, batch: AssistantCommand[], context?: Record<string, unknown>): Promise<Array<{
        id?: string;
        value: unknown;
    }>>;
}
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
export declare const DRAFT_SAFE_COMMANDS: Set<string>;
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
export declare const CREDENTIAL_COMMAND_ARG_FIELDS: Readonly<Record<string, ReadonlyArray<"apiKey" | "connectionString">>>;
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
export declare function createApplyCommandTool(options: CreateApplyCommandToolOptions): import("@earendil-works/pi-agent-core").AgentTool<Type.TObject<{
    type: Type.TString;
    args: Type.TUnknown;
}>, {
    commandType: string;
    commandResult: {} | null;
}>;
//# sourceMappingURL=apply-command-tool.d.ts.map