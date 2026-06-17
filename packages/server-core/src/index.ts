/**
 * @dashframe/server-core — shared server runtime primitives.
 *
 * Used by the Electron main process. Provides the artifact database (PGLite)
 * and project lifecycle (folder init + metadata seed). Future: DuckDB
 * workspace orchestration and WyStack transport wiring.
 */

export {
  ARTIFACT_DB_SCHEMA_VERSION,
  openArtifactDb,
  type ArtifactDb,
  type OpenArtifactDbOptions,
} from "./db";
export {
  ARTIFACTS_DB_FILENAME,
  DATA_SOURCES_DIRNAME,
  openProject,
  type CloseResult,
  type OpenProjectOptions,
  type ProjectHandle,
  type ProjectMetaRow,
  type ProjectRecoveryNotice,
} from "./project";
export {
  SNAPSHOTS_DIRNAME,
  SNAPSHOT_DEBOUNCE_MS,
  SNAPSHOT_KEEP_N,
  SNAPSHOT_MAX_WAIT_MS,
  XLOG_BLCKSZ,
  hasCorruptWalSegment,
  listSnapshots,
  writeSnapshot,
  type FailedRestoreAttempt,
  type SnapshotMeta,
} from "./snapshots";

export { DrizzleMappingStore } from "./mapping-store";
export {
  DASHFRAME_HOME_DIRNAME,
  DEFAULT_PROJECT_DIRNAME,
  PROJECT_DIR_ENV,
  resolveProjectDir,
  type ResolveProjectDirOptions,
} from "./project-dir";
export {
  // Constants
  PROJECT_META_ID,
  PROJECT_META_SINGLETON_KEY,
  dashboards,
  dashboardsDraft,
  dataFrames,
  dataFramesDraft,
  dataSources,
  // Draft shadow tables (YW-125)
  dataSourcesDraft,
  dataTables,
  dataTablesDraft,
  // Draft command log (YW-125)
  draftCommandLog,
  insights,
  insightsDraft,
  // Canonical artifact tables
  projectMeta,
  schema,
  secretMappings,
  visualizations,
  visualizationsDraft,
  type ArtifactProvenance,
  type Schema,
} from "./schema";
export { DASHFRAME_PROJECT_VERSION } from "./version";
export { applyDataFrameWriteGate } from "./write-gate";
