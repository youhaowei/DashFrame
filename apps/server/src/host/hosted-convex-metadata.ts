import { api } from "@dashframe/convex-backend/api";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs } from "convex/server";
import type { Command } from "@dashframe/types";
import type { HostMetadata } from "./metadata";
import { validateHostedDeploymentUrl } from "./hosted-deployment-url";

/** Restricted hosted capabilities; broader local/admin operations are not exposed. */
export type HostedMetadata = Pick<
  HostMetadata,
  | "getDataSource"
  | "getDataTable"
  | "getDataFrame"
  | "getInsight"
  | "listDataFramesByInsight"
  | "listDataFrames"
  | "getOperation"
  | "publishMaterialization"
> & {
  commitBatch(commands: Command[]): ReturnType<HostMetadata["commitBatch"]>;
  draftBatch(
    commands: Command[],
    draftId?: string,
  ): ReturnType<HostMetadata["draftBatch"]>;
};

export interface HostedMetadataOptions {
  /** Fixed configured deployment URL, never a request-selected backend. */
  deploymentUrl: string;
  /** Disposable synthetic native tests only; permits HTTP on literal 127.0.0.1. */
  allowInsecureLoopbackForTests?: boolean;
  /** Injected request-bound signer: host authority, host-metadata purpose, admitted principal. */
  getToken(): Promise<string>;
}

export function createHostedMetadataClient(options: HostedMetadataOptions) {
  const deploymentUrl = validateHostedDeploymentUrl(
    options.deploymentUrl,
    options.allowInsecureLoopbackForTests,
  );
  const getToken = options.getToken;
  return async () => {
    // setAuth mutates a client. A fresh client per operation prevents concurrent
    // requests from switching each other's identity while refreshing tokens.
    const authenticated = new ConvexHttpClient(deploymentUrl, {
      skipConvexDeploymentUrlCheck: true,
    });
    const token = await getToken();
    if (!token || token.trim() !== token)
      throw new Error("Host metadata token required");
    authenticated.setAuth(token);
    return authenticated;
  };
}

export function createHostedMetadata(
  options: HostedMetadataOptions,
): HostedMetadata {
  const client = createHostedMetadataClient(options);
  return {
    getDataSource: async (id) =>
      (await client()).query(api.hostedMetadata.getDataSource, { id }),
    getDataTable: async (id) =>
      (await client()).query(api.hostedMetadata.getDataTable, { id }),
    getDataFrame: async (id) =>
      (await client()).query(api.hostedMetadata.getDataFrame, { id }),
    getInsight: async (id) =>
      (await client()).query(api.hostedMetadata.getInsight, { id }),
    listDataFramesByInsight: async (insightId) =>
      (await client()).query(api.hostedMetadata.listDataFramesByInsight, {
        insightId,
      }),
    listDataFrames: async () =>
      (await client()).query(api.hostedMetadata.listDataFrames, {}),
    getOperation: async (operationId) =>
      (await client()).query(api.hostedMetadata.getOperation, { operationId }),
    publishMaterialization: async (value) => {
      await (
        await client()
      ).mutation(api.hostedMetadata.publishMaterialization, wire({ value }));
    },
    commitBatch: async (commands) =>
      (await client()).mutation(
        api.hostedMetadata.commitBatch,
        wire({ commands }) as FunctionArgs<
          typeof api.hostedMetadata.commitBatch
        >,
      ),
    draftBatch: async (commands, draftId) =>
      (await client()).mutation(
        api.hostedMetadata.draftBatch,
        wire({ commands, draftId }) as FunctionArgs<
          typeof api.hostedMetadata.draftBatch
        >,
      ),
  };
}

/** The JSON host contract drops optional undefined values before Convex encoding. */
function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
