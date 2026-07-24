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
  useAssistantProviderCatalog,
  useAssistantProviderConfigMutations,
  useAssistantProviderConfigs,
} from "./assistant-provider-configs";

export {
  useAccessCapabilities,
  useAccessConnectionInfo,
  useAccessCredentialMutations,
  useAccessCredentials,
} from "./access-credentials";

export {
  addDataSource,
  getAllDataSources,
  getDataSource,
  getDataSourceByType,
  getOrCreateDataSourceByType,
  removeDataSource,
  updateDataSource,
  useDataSourceMutations,
  useDataSources,
} from "./data-sources";

export {
  addDataTable,
  createDataTable,
  getAllDataTables,
  getDataTable,
  getDataTablesBySource,
  updateDataTable,
  useDataTableMutations,
  useDataTables,
} from "./data-tables";

export {
  getAllInsights,
  getInsight,
  useCompiledInsight,
  useInsight,
  useInsightMutations,
  useInsights,
} from "./insights";

export {
  addDataFrameEntry,
  clearAllData,
  getAllDataFrames,
  getDataFrame,
  getDataFrameByInsight,
  getDataFrameEntry,
  removeDataFrame,
  replaceDataFrame,
  updateDataFrameAnalysis,
  updateDataFrameEntry,
  updateMetadata,
  useDataFrameMutations,
  useDataFrames,
  type DataFrameEntry,
  type DataFrameMutations,
  type UseDataFramesResult,
} from "./data-frames";

export {
  listNotionDatabases,
  useNotionMutations,
  type NotionDatabaseRef,
  type NotionQueryResult,
} from "./notion";

export { DatabaseProvider, useDatabase } from "../wystack/compat";

// Preview batch — SPLIT-TIER: returns metadata only, no row data over the wire.
export { previewBatch, type PreviewCommand } from "./preview-diff";

// Draft lifecycle — publish, discard, and log-read RPCs.
export { discardDraft, getDraftLog, publishDraft } from "./draft-lifecycle";

export {
  getDraftPublishReview,
  useDraftMutations,
  useDraftPublishReview,
  type DraftMutations,
  type DraftPublishReview,
  type LateBoundOperandRef,
  type UseDraftPublishReviewResult,
} from "./drafts";
