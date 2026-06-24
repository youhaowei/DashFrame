/**
 * `applyCommand` — the assistant's single generic mutation tool.
 *
 * ONE tool, generic over `{ type, args }`:
 *   - `type`  — a command name string (e.g. "CreateInsight", "AddDashboardItem").
 *     The full vocabulary is described in the command guide (YW-280). The agent
 *     constructs commands by name + args; this tool delegates to `buildCommand`
 *     (injected by the host) to map the name to the wire-path envelope and then
 *     emits into the draft via the controller.
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
 *   (YW-281) is a separate, human-gated step; this tool MUST NOT call
 *   publishDraft or touch canonical.
 *
 * Factory pattern: `createApplyCommandTool(options)`. The draftId is the handle
 * minted by `openDraft` (YW-260) at assistant session start — captured once in
 * the factory, not passed per-call. This keeps the per-call surface minimal
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
   * consult the command guide (YW-280) for the per-command shape.
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
   * The host MUST throw a descriptive error for unknown command types. The
   * `cmd()` helper in commands.ts is typed at compile time only — at runtime
   * `cmd(unknownName, args)` silently produces `{ path: undefined, args }`, which
   * reaches `runHandler` as `"Unknown function: undefined"` — a cryptic error.
   * Wrap `cmd()` with a runtime key-guard at the injection site:
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
 * import { createApplyCommandTool } from "@dashframe/assistant";
 *
 * // The set of valid command names (build from CommandPayloads keys at compile time).
 * const KNOWN_COMMANDS = new Set<string>([
 *   "CreateInsight", "CreateVisualization", "AddDashboardItem", // ... all CommandName values
 * ]);
 *
 * const applyCommandTool = createApplyCommandTool({
 *   controller,
 *   draftId,
 *   // Runtime guard: cmd() is typed at compile time only — unknown names silently
 *   // produce { path: undefined }, which reaches runHandler as "Unknown function: undefined".
 *   // Guard the type first so the agent gets a clear error to fix+retry.
 *   buildCommand: (type, args) => {
 *     if (!KNOWN_COMMANDS.has(type)) {
 *       throw new Error(
 *         `applyCommand: unknown command type "${type}". ` +
 *         `Known: ${[...KNOWN_COMMANDS].join(", ")}`
 *       );
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
      "object for that command. On validation failure the error is returned so you " +
      "can correct the args and retry. NEVER emits to canonical.",
    label: "Apply Command",
    // Mutating — serialise against other tool calls in the same batch so the
    // single-writer-per-draftId contract (documented in draft-controller.ts) is
    // satisfied when pi dispatches a multi-tool turn.
    executionMode: "sequential",
    parameters: Type.Object({
      type: Type.String({
        description:
          "The command name from the DashFrame vocabulary, e.g. " +
          '"CreateInsight", "CreateVisualization", "AddDashboardItem". ' +
          "Must be a valid CommandName from the command guide.",
      }),
      args: Type.Unknown({
        description:
          "The payload object for the named command. Shape depends on `type` — " +
          "see the command guide for per-command schemas.",
      }),
    }),

    async execute(_toolCallId, params) {
      const { type, args } = params;

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
