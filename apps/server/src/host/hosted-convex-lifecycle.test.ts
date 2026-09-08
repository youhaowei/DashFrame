import { afterEach, expect, it, vi } from "vite-plus/test";
import { createHostedLifecycleMetadata } from "./hosted-convex-lifecycle";

afterEach(() => vi.unstubAllGlobals());
it("sends lifecycle operations through fixed Bearer endpoints without caller-selected identity", async () => {
  const requests: {
    path: string;
    args: unknown[];
    authorization: string | null;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(String(init.body)) as {
        path: string;
        args: unknown[];
      };
      requests.push({
        ...request,
        authorization: new Headers(init.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ status: "success", value: null }));
    }),
  );
  const metadata = createHostedLifecycleMetadata({
    deploymentUrl: "https://metadata.test",
    getToken: async () => "synthetic-host-token",
  });
  const identity = { operationId: "batch", requestHash: "a".repeat(64) };
  const paging = { paginationOpts: { cursor: null, numItems: 100 } };
  await metadata.prepareHostBatch({
    ...identity,
    commands: [],
    mode: "commit",
    stagedRefs: [],
    draftId: undefined,
  });
  await metadata.getHostBatch(identity);
  await metadata.executeHostBatch(identity);
  await metadata.settleHostBatch({
    ...identity,
    stagedRefs: [],
    retryable: undefined,
  });
  await metadata.beginLocalImport(identity);
  await metadata.getLocalImport(identity);
  await metadata.cancelLocalImport(identity);
  await metadata.commitImportedFrame({
    ...identity,
    expectedDataSourceRevision: 1,
    dataTableId: "table",
    dataSourceId: "source",
    expectedDataFrameId: null,
    frameRow: {},
    tableUpdate: {},
  });
  await metadata.listCleanup(paging);
  await metadata.claimCleanup({ cleanupId: "cleanup" });
  await metadata.ackCleanup({ cleanupId: "cleanup", claimToken: "claim" });
  await metadata.listRecoverableHostBatches(paging);
  await metadata.recoverHostBatch({ operationId: "batch" });
  expect(requests.map((request) => request.path)).toEqual(
    [
      "prepareHostBatch",
      "getHostBatch",
      "executeHostBatch",
      "settleHostBatch",
      "beginLocalImport",
      "getLocalImport",
      "cancelLocalImport",
      "commitImportedFrame",
      "listCleanup",
      "claimCleanup",
      "ackCleanup",
      "listRecoverableHostBatches",
      "recoverHostBatch",
    ].map((name) => `hostedLifecycle:${name}`),
  );
  for (const request of requests) {
    expect(request.authorization).toBe("Bearer synthetic-host-token");
    expect(request.args[0]).not.toHaveProperty("workspaceId");
    expect(request.args[0]).not.toHaveProperty("principal");
  }
  expect(requests[0]!.args[0]).not.toHaveProperty("draftId");
  expect(requests[3]!.args[0]).not.toHaveProperty("retryable");
  expect(requests[12]!.args).toEqual([{ operationId: "batch" }]);
  expect(Object.keys(metadata)).toHaveLength(23);
});
