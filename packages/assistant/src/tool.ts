/**
 * Typed tool-layer helper for DashFrame assistant tools.
 *
 * Pi's AgentTool interface is deliberately untyped at the args boundary —
 * `beforeToolCall.args` arrives as `unknown`. Every DashFrame tool built
 * through this helper gets:
 *
 *   1. Typed params — pi validates args against the TypeBox schema before
 *      calling execute; the helper surface exposes a fully-typed execute
 *      callback, so tool bodies never see `unknown` or need `as` casts.
 *   2. Standardised result envelope — `details` is always present.
 *   3. Consistent error shaping — validation failures are handled by pi
 *      (isError: true on the ToolResultMessage); runtime errors thrown from
 *      execute are passed through to pi unchanged (same pi behavior).
 *
 * Guard the sink, not provenance: the TypeBox schema passed to defineToolHandler
 * IS the validation gate. Pi's prepareToolCall runs Value.Convert + Check against
 * the schema before execute is invoked — validate here (the schema declaration),
 * trust the typed params pi delivers.
 */

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static, type TSchema } from "typebox";
import { Check, Errors } from "typebox/value";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Structured validation-error detail for programmatic inspection. */
export interface ToolArgValidationError {
  kind: "validation_error";
  message: string;
  /** Path → message pairs from TypeBox. */
  errors: Array<{ path: string; message: string }>;
}

/** Union of error detail shapes produced by defineToolHandler. */
export type ToolHandlerErrorDetails = ToolArgValidationError;

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
   * Pi validates args against this schema before calling execute — type-safe
   * params arrive already checked; no double-validation inside the execute body.
   */
  parameters: TParams;
  /**
   * The tool body. Receives fully-typed, validated params — no `as` casts needed.
   *
   * Per pi's AgentTool contract, throw to signal runtime failure. Pi catches
   * thrown errors and marks the ToolResultMessage as isError: true.
   *
   * Note: pi's prepareToolCall passes an onUpdate streaming callback as the 4th
   * argument. This helper omits it because YW-279/YW-280 tools are atomic; add
   * onUpdate to the signature if incremental progress becomes needed.
   */
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal?: AbortSignal,
  ) => Promise<AgentToolResult<TDetails>>;
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
): AgentTool<TParams, TDetails> {
  return {
    name: config.name,
    description: config.description,
    label: config.label,
    parameters: config.parameters,

    execute: async (
      toolCallId,
      params,
      signal,
    ): Promise<AgentToolResult<TDetails>> => {
      // params: Static<TParams> — pi validated before calling us.
      // Throw to signal runtime errors (pi catches, marks isError: true).
      return config.execute(toolCallId, params, signal);
    },
  };
}

// ---------------------------------------------------------------------------
// Validation utilities — exported for test/integration use
// ---------------------------------------------------------------------------

/**
 * Run TypeBox validation and return structured errors.
 * Useful in tests and integration harnesses that need to pre-validate args
 * before passing them to a tool (e.g., before calling tool.execute directly).
 */
export function validateToolArgs<TParams extends TSchema>(
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
// Re-export TypeBox primitives so tool authors don't need a separate import
// ---------------------------------------------------------------------------
export { Check, Errors, Type, type Static, type TSchema };
