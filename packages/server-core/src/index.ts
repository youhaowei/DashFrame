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
  type OpenProjectOptions,
  type ProjectHandle,
  type ProjectMetaRow,
} from "./project";

export {
  DASHFRAME_HOME_DIRNAME,
  DEFAULT_PROJECT_DIRNAME,
  PROJECT_DIR_ENV,
  resolveProjectDir,
  type ResolveProjectDirOptions,
} from "./project-dir";
export { schema, type Schema } from "./schema";
export {
  attachTransportDispatcher,
  type TransportDispatcher,
  type TransportProcedure,
  type TransportProcedureContext,
  type TransportProcedureResult,
  type TransportRegistry,
} from "./transport";
export { DASHFRAME_PROJECT_VERSION } from "./version";
