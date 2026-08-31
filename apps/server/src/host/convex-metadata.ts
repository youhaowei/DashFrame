import { internal } from "@dashframe/convex-backend/api";
import type { LocalConvex } from "@dashframe/convex-local";
import type { FunctionArgs } from "convex/server";
import type { Field } from "@dashframe/types";
import type { HostMetadata } from "./metadata";

/** Translate host domain operations to private, generated Convex functions. */
export function createHostMetadata(
  client: LocalConvex["internalClient"],
  workspaceId: string,
): HostMetadata {
  return {
    beginLocalImport: (input) =>
      client.mutation(internal.host.beginLocalImport, {
        workspaceId,
        ...input,
      }),
    getLocalImport: (input) =>
      client.query(internal.host.getLocalImport, { workspaceId, ...input }),
    getOperation: (operationId) =>
      client.query(internal.host.getOperation, { workspaceId, operationId }),
    connectorSetup: {
      get: (id) =>
        client.query(internal.connectorSetup.get, { workspaceId, id }),
      findByNonce: (stateNonceHash) =>
        client.query(internal.connectorSetup.findByNonce, {
          workspaceId,
          stateNonceHash,
        }),
      insert: async (row) => {
        await client.mutation(internal.connectorSetup.insert, {
          workspaceId,
          row,
        });
      },
      compareAndSwap: (id, expected, patch) =>
        client.mutation(internal.connectorSetup.compareAndSwap, {
          workspaceId,
          id,
          expected,
          patch,
        }),
      list: (cursor) =>
        client.query(internal.connectorSetup.list, {
          workspaceId,
          paginationOpts: { cursor, numItems: 100 },
        }),
      delete: (id, updatedBefore) =>
        client.mutation(internal.connectorSetup.remove, {
          workspaceId,
          id,
          updatedBefore,
        }),
      getDataSourceKind: async (id) =>
        (await client.query(internal.host.getDataSource, { workspaceId, id }))
          ?.kind ?? null,
    },
    getDataSource: (id) =>
      client.query(internal.host.getDataSource, { workspaceId, id }),
    getDataTable: (id) =>
      client.query(internal.host.getDataTable, { workspaceId, id }),
    getDataFrame: (id) =>
      client.query(internal.host.getDataFrame, { workspaceId, id }),
    getInsight: (id) =>
      client.query(internal.host.getInsight, { workspaceId, id }),
    listDataFramesByInsight: (insightId) =>
      client.query(internal.host.listDataFramesByInsight, {
        workspaceId,
        insightId,
      }),
    listDataFrames: () =>
      client.query(internal.host.listDataFrames, { workspaceId }),
    removeDataFrame: async (id) => {
      await client.mutation(internal.host.removeDataFrame, { workspaceId, id });
    },
    clearAllData: async () => {
      await client.mutation(internal.host.clearAllData, { workspaceId });
    },
    commitImportedFrame: async (input) => {
      await client.mutation(
        internal.host.commitImportedFrame,
        wire({ workspaceId, ...input }) as FunctionArgs<
          typeof internal.host.commitImportedFrame
        >,
      );
    },
    publishMaterialization: async (value) => {
      await client.mutation(
        internal.host.publishMaterialization,
        wire({ workspaceId, value }) as FunctionArgs<
          typeof internal.host.publishMaterialization
        >,
      );
    },
    revokeCredential: async (credentialId) => {
      await client.mutation(internal.host.revokeCredential, {
        workspaceId,
        credentialId,
      });
    },
    replaceDataSourceConfig: async (input) => {
      await client.mutation(
        internal.host.replaceDataSourceConfig,
        wire({ workspaceId, ...input }) as FunctionArgs<
          typeof internal.host.replaceDataSourceConfig
        >,
      );
    },
    prepareRemoteDataTable: async (input) =>
      (await client.mutation(
        internal.host.prepareRemoteDataTable,
        wire({ workspaceId, ...input }) as FunctionArgs<
          typeof internal.host.prepareRemoteDataTable
        >,
      )) as unknown as Field[],
    listAssistantProviderConfigs: () =>
      client.query(internal.host.listAssistantProviderConfigs, { workspaceId }),
    getAssistantProviderConfig: (id) =>
      client.query(internal.host.getAssistantProviderConfig, {
        workspaceId,
        id,
      }),
    saveAssistantProviderConfig: (input) =>
      client.mutation(internal.host.saveAssistantProviderConfig, {
        workspaceId,
        ...input,
      }),
    removeAssistantProviderConfig: async (input) => {
      await client.mutation(internal.host.removeAssistantProviderConfig, {
        workspaceId,
        ...input,
      });
    },
    commitBatch: (principal, commands) =>
      client.mutation(
        internal.host.commitBatch,
        wire({ workspaceId, principal, commands }) as FunctionArgs<
          typeof internal.host.commitBatch
        >,
      ),
    draftBatch: (principal, commands, draftId) =>
      client.mutation(
        internal.host.draftBatch,
        wire({ workspaceId, principal, commands, draftId }) as FunctionArgs<
          typeof internal.host.draftBatch
        >,
      ),
  };
}

/** Drop optional JS undefined fields at the JSON transport boundary. */
function wire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}
