/**
 * WyStack function registry — the DashFrame server's RPC surface.
 *
 * Defined once here, consumed two ways (the tRPC pattern):
 *   - runtime: the server app (`createDashframeServer`) mounts these defs.
 *   - type-only: the renderer imports `type { Functions }` for the typed client.
 *
 * Handlers read/write artifacts through `ctx.db` — WyStack's DrizzleTracker
 * over the project's PGLite Drizzle instance — so reactive invalidation works.
 */
import { schema } from "@dashframe/server-core";

import { accessCredentialFunctions } from "./functions/access-credentials";
import { appArtifactFunctions } from "./functions/app-artifacts";
import { assistantProviderConfigFunctions } from "./functions/assistant-provider-configs";
import { commandFunctions } from "./functions/commands";
import { connectorCatalogFunctions } from "./functions/connector-catalog";
import { connectorSetupFunctions } from "./functions/connector-setup";
import { dashboardFunctions } from "./functions/dashboards";
import { createDataFetchFunctions } from "./functions/data-fetch";
import { localDataFrameIngestFunctions } from "./functions/data-fetch/local-ingest";
import { createProductionFetchExecutor } from "./functions/data-fetch/production";
import { dataFrameQueryFunctions } from "./functions/data-frame-query";
import { draftBatchFunctions } from "./functions/draft-batch";
import { draftLifecycleFunctions } from "./functions/draft-lifecycle";
import { draftReviseFunctions } from "./functions/draft-revise";
import { draftFunctions } from "./functions/drafts";
import { previewDiffFunctions } from "./functions/preview-diff";
import { wy } from "./wystack";

const { projectMeta } = schema;
const dataFetchFunctions = createDataFetchFunctions(
  createProductionFetchExecutor(),
);

/** Shape returned by `projectInfo`. Mirrors the persisted `project_meta` row. */
export interface ProjectInfoResult {
  projectId: string;
  name: string;
  version: string;
  schemaVersion: number;
  createdAt: string;
  createdBy: string;
}

/**
 * projectInfo — read the singleton `project_meta` row. No args; one project
 * per database (v0.2 single-project), so the first row is the project.
 */
const projectInfo = wy.procedure.input({}).query(async (ctx) => {
  const rows = await ctx.db.from(projectMeta).all();
  const meta = rows[0];
  if (!meta) {
    throw new Error("project_meta row missing — project not initialized");
  }
  return {
    projectId: meta.projectId,
    name: meta.name,
    version: meta.version,
    schemaVersion: meta.schemaVersion,
    createdAt: meta.createdAt.toISOString(),
    createdBy: meta.createdBy,
  };
});

/**
 * The registry. Add functions here; the key is the wire path the client calls
 * (`api.projectInfo`). Keep this object the single source of truth for the API.
 */
export const functions = {
  projectInfo,
  ...appArtifactFunctions,
  ...assistantProviderConfigFunctions,
  ...commandFunctions,
  ...connectorCatalogFunctions,
  ...connectorSetupFunctions,
  ...dashboardFunctions,
  ...dataFetchFunctions,
  ...localDataFrameIngestFunctions,
  ...dataFrameQueryFunctions,
  ...draftLifecycleFunctions,
  ...draftBatchFunctions,
  ...draftFunctions,
  ...draftReviseFunctions,
  ...accessCredentialFunctions,
  ...previewDiffFunctions,
};

/** Public type surface — what the renderer imports to type its client. */
export type Functions = typeof functions;
