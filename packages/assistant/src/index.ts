/**
 * @dashframe/assistant — agentic report harness substrate.
 *
 * Loop, tools, and UI land in follow-up implementation work.
 */

export const ASSISTANT_VERSION = "0.0.0" as const;

// Typed tool-layer helper — the seam mutation (YW-279) and read (YW-280) tools build through.
export {
  Check,
  Errors,
  ToolExecutionError,
  Type,
  defineToolHandler,
  isValidationError,
  type Static,
  type TSchema,
  type ToolArgValidationError,
  type ToolHandlerConfig,
  type ToolHandlerErrorDetails,
} from "./tool.js";
