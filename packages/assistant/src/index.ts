/**
 * @dashframe/assistant — agentic report harness substrate.
 *
 * OAuth credential lifecycle: read the Claude Code subscription token from
 * the OS keychain at runtime; refresh in-memory when expired; never write
 * back. Fail closed on dead credentials.
 *
 * Typed tool-layer helper: the seam all assistant mutation and read tools
 * build through.
 *
 * Assistant run entry point: consumes a single AssistantHost port, opens a draft,
 * assembles tools, and drives pi's loop. Never canonical.
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

// READ layer — privacy-aware graph resolver: 4 fixed read tools, the floor, the
// GraphReader port, and the command vocabulary guide.
export * from "./read/index.js";

// AssistantHost port + run entry point.
export {
  type AssistantCommand,
  type AssistantCommandResult,
  type AssistantHost,
} from "./assistant-host.js";

export {
  createAssistantRun,
  type AssistantRunResult,
  type AssistantRunTerminationReason,
  type CreateAssistantRunOptions,
} from "./assistant-run.js";

// Public constants for server-side drift/security tests; applyCommand itself is package-internal.
export {
  CREDENTIAL_COMMAND_ARG_FIELDS,
  DRAFT_SAFE_COMMANDS,
} from "./apply-command-tool.js";

// Provider measurement harness — live Anthropic/Bedrock streaming smoke.
export {
  installBedrockProvider,
  measureAssistantStream,
  measureProviderRun,
  measureProviderRuns,
  type ProviderMeasurementResult,
  type ProviderMeasurementSpec,
} from "./provider-measurement.js";
