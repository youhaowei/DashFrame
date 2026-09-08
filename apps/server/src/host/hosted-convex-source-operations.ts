import { api } from "@dashframe/convex-backend/api";
import { parseHostedSourceConfig } from "@dashframe/convex-backend/codecs";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import {
  createHostedMetadataClient,
  type HostedMetadataOptions,
} from "./hosted-convex-metadata";
import {
  createHostedLifecycleMetadata,
  type HostedLifecycleMetadata,
} from "./hosted-convex-lifecycle";

type SourceOperations = typeof api.hostedSourceOperations;
export type HostedSourceMetadata = HostedLifecycleMetadata & {
  [Name in keyof SourceOperations]: (
    input: FunctionArgs<SourceOperations[Name]>,
  ) => Promise<FunctionReturnType<SourceOperations[Name]>>;
};

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
      return (await client()).mutation(
        api.hostedSourceOperations.replaceDataSourceConfig,
        wire({ ...input, config, expectedConfig }),
      );
    },
    prepareRemoteDataTable: async (input) =>
      (await client()).mutation(
        api.hostedSourceOperations.prepareRemoteDataTable,
        wire(input),
      ),
    removeDataFrame: async (input) =>
      (await client()).mutation(
        api.hostedSourceOperations.removeDataFrame,
        input,
      ),
    clearAllData: async (input) =>
      (await client()).mutation(api.hostedSourceOperations.clearAllData, input),
  };
}
function wire<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}
