/**
 * WyStack implementation of the app's data-hook surface.
 *
 * The host wires the runtime seam once at startup:
 *   - render `<Provider>` (from `createWyStack`) above the app, and
 *   - call `setWyStackClient(instance.client)` before rendering, so the
 *     imperative getters can reach the live client.
 */

// Runtime client seam (host wires this once).
export { getWyStackClient, setWyStackClient } from "../wystack/client";
export {
  createWyStackRuntime,
  getWyStackRuntimeConfig,
  resolveWyStackConfig,
  type WyStackRuntime,
  type WyStackRuntimeConfig,
} from "../wystack/runtime";

export {
  parseAssistantSseChunk,
  runAssistantPrompt,
  type AssistantRunRequest,
  type AssistantSidebarEvent,
  type RunAssistantPromptOptions,
} from "../wystack/assistant-run";

export {
  useAccessCapabilities,
  useAccessConnectionInfo,
  useAccessCredentialMutations,
  useAccessCredentials,
} from "./access-credentials";

export {
  getAllInsights,
  getInsight,
  useCompiledInsight,
  useInsight,
  useInsightMutations,
  useInsights,
} from "./insights";

export { DatabaseProvider, useDatabase } from "../wystack/compat";
