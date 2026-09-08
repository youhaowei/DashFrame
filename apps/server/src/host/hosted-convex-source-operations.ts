import { api } from "@dashframe/convex-backend/api";
import {
  parseHostedSourceConfig,
  parseStoredDataTableState,
} from "@dashframe/convex-backend/codecs";
import {
  createHostedMetadataClient,
  type HostedMetadataOptions,
} from "./hosted-convex-metadata";
import type { HostMetadata } from "./metadata";
import {
  createHostedLifecycleMetadata,
  type HostedLifecycleMetadata,
} from "./hosted-convex-lifecycle";

export type HostedSourceMetadata = HostedLifecycleMetadata &
  Pick<
    HostMetadata,
    | "replaceDataSourceConfig"
    | "prepareRemoteDataTable"
    | "removeDataFrame"
    | "clearAllData"
  >;

/** Restricted source capabilities; the caller's admitted identity supplies all scope. */
export function createHostedSourceMetadata(
  options: HostedMetadataOptions,
): HostedSourceMetadata {
  const client = createHostedMetadataClient(options);
  return {
    ...createHostedLifecycleMetadata(options),
    replaceDataSourceConfig: async (input) => {
      const config = parseHostedSourceConfig(input.config);
      const expectedConfig = parseHostedSourceConfig(input.expectedConfig);
      await (
        await client()
      ).mutation(
        api.hostedSourceOperations.replaceDataSourceConfig,
        wire({ ...input, config, expectedConfig }),
      );
    },
    prepareRemoteDataTable: async (input) => {
      const fields = await (
        await client()
      ).mutation(
        api.hostedSourceOperations.prepareRemoteDataTable,
        wire(input),
      );
      return parseStoredDataTableState(
        { sourceSchema: null, fields, metrics: [] },
        "Hosted remote fields",
      ).fields;
    },
    removeDataFrame: async (id) => {
      await (
        await client()
      ).mutation(api.hostedSourceOperations.removeDataFrame, {
        id,
      });
    },
    clearAllData: async () => {
      await (
        await client()
      ).mutation(api.hostedSourceOperations.clearAllData, {});
    },
  };
}
function wire<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
