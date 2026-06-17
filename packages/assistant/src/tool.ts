/**
 * Typed tool-layer helper for DashFrame assistant tools.
 *
 * Pi's AgentTool interface is deliberately untyped at the args boundary —
 * `beforeToolCall.args` arrives as `unknown`. Every DashFrame tool built
 * through this helper gets:
 *
 *   1. Validated params — `unknown` → `Static<TSchema>` at the boundary,
 *      once, via TypeBox. Tool bodies receive fully-typed params.
 *   2. Standardised result envelope — `details` is always present.
 *   3. Consistent error shaping on validation failure and thrown execute errors.
 *
 * Guard the sink, not provenance: validate at the point of use (here),
 * never rely on "the caller passed safe values already".
 *
 * Error signaling note: per pi's AgentTool contract, execute should throw to
 * signal failure. The helper does so for execute-thrown errors (re-throws
 * with a structured ToolExecutionError). For validation errors the helper
 * returns a result with `details.kind === "validation_error"` — the tool did
 * not even begin executing, so a clean informative return is more appropriate
 * than a throw that looks like a runtime crash to the model.
 */

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static, type TSchema } from "typebox";
import { Check, Errors } from "typebox/value";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Structured payload carried in the result envelope on validation failure. */
export interface ToolArgValidationError {
  kind: "validation_error";
  message: string;
  /** Path → message pairs from TypeBox; empty when the root value is wrong type. */
  errors: Array<{ path: string; message: string }>;
}

/** Error thrown from executeWithDetails when the tool body throws. */
export class ToolExecutionError extends Error {
  readonly kind = "execution_error" as const;
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

/** Discriminant for checking the details payload on a validation-failure result. */
export function isValidationError(
  details: unknown,
): details is ToolArgValidationError {
  return (
    typeof details === "object" &&
    details !== null &&
    (details as ToolArgValidationError).kind === "validation_error"
  );
}

/** Union of error detail shapes produced by defineToolHandler. */
export type ToolHandlerErrorDetails = ToolArgValidationError;

// ---------------------------------------------------------------------------
// defineToolHandler config
// ---------------------------------------------------------------------------

/**
 * Configuration passed to `defineToolHandler`.
 *
 * @typeParam TParams  - TypeBox schema describing the tool's parameters.
 * @typeParam TDetails - Type of the `details` field in a successful result.
 */
export interface ToolHandlerConfig<TParams extends TSchema, TDetails> {
  /** Tool name (must be unique within an agent). */
  name: string;
  /** Human-readable description sent to the model. */
  description: string;
  /** Human-readable label for UI display. */
  label: string;
  /**
   * TypeBox schema for the tool's parameters.
   * Validation runs here, once, before the execute body receives typed params.
   */
  parameters: TParams;
  /**
   * The tool body. Receives fully-typed, validated params.
   *
   * Per pi's AgentTool contract, throw to signal runtime failure — the agent
   * loop catches it and marks the tool result as an error in the conversation.
   * The helper re-throws with a ToolExecutionError wrapper for structured detail.
   */
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult<TDetails>>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Validate raw args against a TypeBox schema and narrow the type. */
function validateArgs<TParams extends TSchema>(
  schema: TParams,
  raw: unknown,
):
  | { ok: true; value: Static<TParams> }
  | { ok: false; error: ToolArgValidationError } {
  if (Check(schema, raw)) {
    return { ok: true, value: raw };
  }

  const errorList = Errors(schema, raw).map((e) => ({
    path: e.instancePath ?? "/",
    message: e.message ?? "invalid value",
  }));

  const parts = errorList.map((e) => `${e.path} ${e.message}`).join("; ");
  return {
    ok: false,
    error: {
      kind: "validation_error",
      message: `Tool argument validation failed: ${parts}`,
      errors: errorList,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Define a DashFrame assistant tool with typed params and a standardised result envelope.
 *
 * Usage:
 * ```ts
 * const myTool = defineToolHandler({
 *   name: "my_tool",
 *   description: "Does something",
 *   label: "My tool",
 *   parameters: Type.Object({ id: Type.String() }),
 *   async execute(_callId, params) {
 *     // `params.id` is `string` — no casts needed
 *     return { content: [{ type: "text", text: params.id }], details: { id: params.id } };
 *   },
 * });
 * ```
 *
 * @returns A pi `AgentTool` ready to pass to `agent.state.tools`.
 */
export function defineToolHandler<TParams extends TSchema, TDetails>(
  config: ToolHandlerConfig<TParams, TDetails>,
): AgentTool<TParams, TDetails | ToolArgValidationError> {
  return {
    name: config.name,
    description: config.description,
    label: config.label,
    parameters: config.parameters,

    execute: async (
      toolCallId,
      params,
      signal,
    ): Promise<AgentToolResult<TDetails | ToolArgValidationError>> => {
      // The execute callback from pi already receives Static<TParams>-typed params
      // because AgentTool<TParams> wires that up. We add a runtime validation
      // guard here regardless — trust the schema, not the caller.
      const validated = validateArgs(config.parameters, params);
      if (!validated.ok) {
        const { error } = validated;
        // Return (not throw) a clean error result; the model sees the message,
        // downstream code reads details.kind to distinguish from success.
        return {
          content: [{ type: "text", text: error.message }],
          details: error,
        };
      }

      // For execute errors, re-throw as ToolExecutionError so pi marks the
      // ToolResultMessage as isError: true (pi's convention: throw = error).
      try {
        return await config.execute(toolCallId, validated.value, signal);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : `Tool execution error: ${String(err)}`;
        throw new ToolExecutionError(message, err);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Re-export TypeBox primitives so tool authors don't need a separate import
// ---------------------------------------------------------------------------
export { Check, Errors, Type, type Static, type TSchema };
