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
 * applyCommand tool: the assistant's single generic mutation tool — emits
 * commands into the open draft via the draft controller. Never canonical.
 */
export * from "./oauth/index.js";
export { Check, Convert, Errors, Type, defineToolHandler, isValidationError, validateToolArgs, type Static, type TSchema, type ToolArgValidationError, type ToolHandlerConfig, type ToolHandlerErrorDetails, } from "./tool.js";
export * from "./read/index.js";
export { CREDENTIAL_COMMAND_ARG_FIELDS, DRAFT_SAFE_COMMANDS, createApplyCommandTool, type ApplyCommandDetails, type AssistantCommand, type CreateApplyCommandToolOptions, type DraftAppender, } from "./apply-command-tool.js";
export { installBedrockProvider, measureAssistantStream, measureProviderRun, measureProviderRuns, type ProviderMeasurementResult, type ProviderMeasurementSpec, } from "./provider-measurement.js";
//# sourceMappingURL=index.d.ts.map