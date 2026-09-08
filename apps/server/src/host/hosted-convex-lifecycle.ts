import { api } from "@dashframe/convex-backend/api";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import {
  createHostedMetadata,
  createHostedMetadataClient,
  type HostedMetadata,
  type HostedMetadataOptions,
} from "./hosted-convex-metadata";
import {
  ImportPublicationRejectedError,
  importPublicationRejection,
} from "./metadata";

type LifecycleOperations = typeof api.hostedLifecycle;
export type HostedLifecycleMetadata = HostedMetadata & {
  [Name in keyof LifecycleOperations]: (
    input: FunctionArgs<LifecycleOperations[Name]>,
  ) => Promise<FunctionReturnType<LifecycleOperations[Name]>>;
};

/** Request-bound capabilities. Recovery calls require exclusive workspace startup fencing. */
export function createHostedLifecycleMetadata(
  options: HostedMetadataOptions,
): HostedLifecycleMetadata {
  const client = createHostedMetadataClient(options);
  return {
    ...createHostedMetadata(options),
    getHostBatch: async (input) =>
      (await client()).query(api.hostedLifecycle.getHostBatch, wire(input)),
    prepareHostBatch: async (input) =>
      (await client()).mutation(
        api.hostedLifecycle.prepareHostBatch,
        wire(input),
      ),
    executeHostBatch: async (input) =>
      (await client()).mutation(
        api.hostedLifecycle.executeHostBatch,
        wire(input),
      ),
    settleHostBatch: async (input) =>
      (await client()).mutation(
        api.hostedLifecycle.settleHostBatch,
        wire(input),
      ),
    beginLocalImport: async (input) =>
      (await client()).mutation(
        api.hostedLifecycle.beginLocalImport,
        wire(input),
      ),
    getLocalImport: async (input) =>
      (await client()).query(api.hostedLifecycle.getLocalImport, wire(input)),
    cancelLocalImport: async (input) =>
      (await client()).mutation(
        api.hostedLifecycle.cancelLocalImport,
        wire(input),
      ),
    commitImportedFrame: async (input) => {
      try {
        return await (
          await client()
        ).mutation(api.hostedLifecycle.commitImportedFrame, wire(input));
      } catch (error) {
        const rejection = importPublicationRejection(error);
        if (rejection)
          throw new ImportPublicationRejectedError(rejection, { cause: error });
        throw error;
      }
    },
    listCleanup: async (input) =>
      (await client()).query(api.hostedLifecycle.listCleanup, wire(input)),
    claimCleanup: async (input) =>
      (await client()).mutation(api.hostedLifecycle.claimCleanup, wire(input)),
    ackCleanup: async (input) =>
      (await client()).mutation(api.hostedLifecycle.ackCleanup, wire(input)),
    listRecoverableHostBatches: async (input) =>
      (await client()).query(
        api.hostedLifecycle.listRecoverableHostBatches,
        wire(input),
      ),
    recoverHostBatch: async (input) =>
      (await client()).mutation(
        api.hostedLifecycle.recoverHostBatch,
        wire(input),
      ),
  };
}
function wire<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
