/**
 * @dashframe/assistant — agentic report harness substrate.
 *
 * OAuth credential lifecycle: read the Claude Code subscription token from
 * the OS keychain at runtime; refresh in-memory when expired; never write
 * back. Fail closed on dead credentials.
 *
 * Typed tool-layer helper: the seam all assistant mutation and read tools
 * build through.
 */

// OAuth credential lifecycle
export * from "./oauth/index.js";

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
