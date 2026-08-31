import { z } from "zod";
import { COMMAND_PATHS } from "@dashframe/types";
import type { HostContext } from "./context";
import { requireUser } from "./context";
import { executeHostCommandBatch } from "./commands";
import * as access from "./access-credentials";
import * as providers from "./assistant-providers";
import * as connectors from "./connectors";
import * as setup from "./connector-setup";
import { getConnectorCatalog } from "./connector-catalog";
import { queryDataFrame } from "./data-frame-query";
import { ingestLocalDataFrame } from "./local-ingest";
import { removeDataFrameEntry, clearAllData } from "./frame-cleanup";
import { createDataFetchFunctions } from "./data-fetch";
import { createProductionFetchExecutor } from "./data-fetch/production";

const empty = z.object({}).strict();
const id = z.object({ id: z.string().uuid() }).strict();
const sourceId = z.object({ dataSourceId: z.string().uuid() }).strict();
const fetchOperations = createDataFetchFunctions(
  createProductionFetchExecutor(),
);
function operation<Input, Result>(
  schema: z.ZodType<Input>,
  run: (ctx: HostContext, input: Input) => Promise<Result>,
) {
  return {
    schema,
    run,
    execute: (ctx: HostContext, input: unknown) =>
      run(ctx, schema.parse(input)),
  };
}
const batch = z
  .object({
    operationId: z.string().uuid().optional(),
    commands: z
      .array(
        z.object({
          id: z.string().optional(),
          path: z.string(),
          args: z.unknown(),
        }),
      )
      .max(256),
  })
  .strict();

export const hostOperations = {
  commitBatch: operation(batch, async (ctx, input) => {
    requireUser(ctx);
    return executeHostCommandBatch(ctx, input, "commit");
  }),
  draftBatch: operation(
    batch.extend({ draftId: z.string().uuid().optional() }),
    async (ctx, input) => executeHostCommandBatch(ctx, input, "draft"),
  ),
  getOrCreateDataSource: operation(
    z
      .object({ id: z.string().uuid(), type: z.string(), name: z.string() })
      .strict(),
    async (ctx, input) => {
      requireUser(ctx);
      const result = await ctx.metadata.commitBatch(ctx.principal, [
        { path: COMMAND_PATHS.GetOrCreateDataSource, args: input },
      ]);
      return result.results[0]?.value;
    },
  ),
  ingestLocalDataFrame: operation(
    z
      .object({
        dataTableId: z.string().uuid(),
        arrowBase64: z.unknown(),
        primaryKey: z.unknown().optional(),
        replacement: z.unknown().optional(),
        operationId: z.string().uuid().optional(),
      })
      .strict(),
    ingestLocalDataFrame,
  ),
  queryDataFrame: operation(
    z
      .object({
        dataFrameId: z.string().uuid(),
        offset: z.unknown().optional(),
        limit: z.unknown().optional(),
        sort: z.unknown().optional(),
      })
      .strict(),
    queryDataFrame,
  ),
  removeDataFrameEntry: operation(id, removeDataFrameEntry),
  clearAllData: operation(empty, clearAllData),
  fetchData: operation(
    z.object({ insight: z.unknown() }).strict(),
    fetchOperations.fetchData,
  ),
  runInsight: operation(
    z
      .object({ insightId: z.string().uuid(), runtime: z.unknown().optional() })
      .strict(),
    fetchOperations.runInsight,
  ),
  getConnectorCatalog: operation(empty, getConnectorCatalog),
  prepareRemoteDataTable: operation(id, connectors.prepareRemoteDataTable),
  listNotionDatabases: operation(sourceId, connectors.listNotionDatabases),
  listPostgresTables: operation(sourceId, connectors.listPostgresTables),
  listGa4Properties: operation(sourceId, connectors.listGa4Properties),
  listAssistantProviderCatalog: operation(
    empty,
    providers.listAssistantProviderCatalog,
  ),
  listAssistantProviderConfigs: operation(
    empty,
    providers.listAssistantProviderConfigs,
  ),
  saveAssistantProviderConfig: operation(
    z.object({ input: providers.saveInputSchema }).strict(),
    providers.saveAssistantProviderConfig,
  ),
  removeAssistantProviderConfig: operation(
    id,
    providers.removeAssistantProviderConfig,
  ),
  setAssistantDefaultModel: operation(
    z.object({ input: providers.setDefaultModelSchema }).strict(),
    providers.setAssistantDefaultModel,
  ),
  startAssistantOAuthLogin: operation(id, providers.startAssistantOAuthLogin),
  getAccessCapabilities: operation(empty, access.getAccessCapabilities),
  getAccessConnectionInfo: operation(empty, access.getAccessConnectionInfo),
  listAccessCredentials: operation(empty, access.listAccessCredentials),
  issueAccessCredential: operation(
    z.object({ name: z.string() }).strict(),
    access.issueAccessCredential,
  ),
  revokeAccessCredential: operation(id, access.revokeAccessCredential),
  startConnectorSetup: operation(
    z.object({ connectorId: z.string(), requestedName: z.string() }).strict(),
    setup.startConnectorSetup,
  ),
  getConnectorSetupSession: operation(
    z
      .object({
        sessionId: z.string().uuid(),
        publicResume: z.boolean().optional(),
      })
      .strict(),
    setup.getConnectorSetupSession,
  ),
  cancelConnectorSetup: operation(
    z.object({ sessionId: z.string().uuid() }).strict(),
    setup.cancelConnectorSetup,
  ),
};

export function hostOperationByName(name: string) {
  return Object.hasOwn(hostOperations, name)
    ? hostOperations[name as keyof typeof hostOperations]
    : undefined;
}
