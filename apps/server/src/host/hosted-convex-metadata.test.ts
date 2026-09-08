import { afterEach, expect, it, vi } from "vite-plus/test";
import { cmd } from "@dashframe/types";
import { createHostedMetadata } from "./hosted-convex-metadata";

afterEach(() => vi.unstubAllGlobals());
it("uses only named public functions with Bearer auth and no body-selected tenant or principal", async () => {
  const requests: {
    path: string;
    args: unknown[];
    authorization: string | null;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        path: string;
        args: unknown[];
      };
      requests.push({
        ...body,
        authorization: new Headers(init.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ status: "success", value: null }), {
        status: 200,
      });
    }),
  );
  const metadata = createHostedMetadata({
    deploymentUrl: "https://metadata.test",
    getToken: async () => "synthetic-host-token",
  });
  await metadata.getDataSource("source");
  await metadata.getDataTable("table");
  await metadata.getDataFrame("frame");
  await metadata.getInsight("insight");
  await metadata.listDataFramesByInsight("insight");
  await metadata.listDataFrames();
  await metadata.getOperation("operation");
  await metadata.commitBatch([
    cmd("CreateDataSource", {
      id: "10000000-0000-4000-8000-000000000001",
      name: "Synthetic",
      type: "csv",
    }),
  ]);
  await metadata.draftBatch([]);
  await metadata.publishMaterialization({
    sources: [],
    target: { kind: "ephemeral" },
    result: { id: "frame", fieldIds: [], schema: [], rowCount: 0 },
    definitionFingerprint: "synthetic",
    provenance: { connectorKind: "local", bindingVersion: "v1" },
    fetchedAt: 1,
  });
  expect(requests.map((request) => request.path)).toEqual([
    "hostedMetadata:getDataSource",
    "hostedMetadata:getDataTable",
    "hostedMetadata:getDataFrame",
    "hostedMetadata:getInsight",
    "hostedMetadata:listDataFramesByInsight",
    "hostedMetadata:listDataFrames",
    "hostedMetadata:getOperation",
    "hostedMetadata:commitBatch",
    "hostedMetadata:draftBatch",
    "hostedMetadata:publishMaterialization",
  ]);
  for (const request of requests) {
    expect(request.authorization).toBe("Bearer synthetic-host-token");
    expect(request.args[0]).not.toHaveProperty("workspaceId");
    expect(request.args[0]).not.toHaveProperty("principal");
  }
  expect(requests[8]!.args).toEqual([{ commands: [] }]);
  expect(Object.keys(metadata)).toHaveLength(10);
});

it("keeps concurrent calls bound to their own token even when token acquisition finishes out of order", async () => {
  let resolveFirst!: (token: string) => void;
  let count = 0;
  const getToken = () =>
    ++count === 1
      ? new Promise<string>((resolve) => {
          resolveFirst = resolve;
        })
      : Promise.resolve("token-b");
  const requests: { id: string; authorization: string | null }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { args: [{ id: string }] };
      requests.push({
        id: body.args[0].id,
        authorization: new Headers(init.headers).get("authorization"),
      });
      return new Response(JSON.stringify({ status: "success", value: null }), {
        status: 200,
      });
    }),
  );
  const metadata = createHostedMetadata({
    deploymentUrl: "https://metadata.test",
    getToken,
  });
  const first = metadata.getDataTable("table-a");
  await metadata.getDataTable("table-b");
  resolveFirst("token-a");
  await first;
  expect(requests).toEqual([
    { id: "table-b", authorization: "Bearer token-b" },
    { id: "table-a", authorization: "Bearer token-a" },
  ]);
});

it("does not send an unauthenticated request when the injected signer fails", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedMetadata({
    deploymentUrl: "https://metadata.test",
    getToken: async () => {
      throw new Error("Signer unavailable");
    },
  });
  await expect(metadata.listDataFrames()).rejects.toThrow("Signer unavailable");
  expect(fetch).not.toHaveBeenCalled();
});
