/**
 * @dashframe/assistant — agentic report harness substrate.
 *
 * Loop, tools, and UI land in follow-up implementation work.
 */

export const ASSISTANT_VERSION = "0.0.0" as const;

// Typed tool-layer helper — the seam all assistant mutation and read tools build through.
export {
  Check,
  Convert,
  Errors,
  Type,
  defineToolHandler,
  isValidationError,
  validateToolArgs,
  type Static,
  type TSchema,
  type ToolArgValidationError,
  type ToolHandlerConfig,
  type ToolHandlerErrorDetails,
} from "./tool.js";
