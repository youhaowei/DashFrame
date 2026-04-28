/**
 * @dashframe/server-core — shared server runtime primitives.
 *
 * Used by the Electron main process and `dashframe serve` alike. Provides the
 * artifact database (PGLite) and project lifecycle (folder init + metadata
 * seed). Future: DuckDB workspace orchestration and WyStack transport wiring.
 */

export const SERVER_CORE_VERSION = "0.2.0-alpha.0";

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
