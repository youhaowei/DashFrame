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

it.each([
  ["http://metadata.test", false],
  ["http://metadata.test", true],
  ["http://127.0.0.1:3210", false],
  ["http://localhost:3210", true],
  // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- Negative transport fixture: this URL must be rejected.
  ["http://[::1]:3210", true],
  ["http://127.1:3210", true],
  ["http://2130706433:3210", true],
  ["https://user:password@metadata.test", false],
  ["https://@metadata.test", false],
  ["https://meta\ndata.test", false],
  ["https://metadata.test\\path", false],
  ["http://user@127.0.0.1:3210", true],
  ["ftp://metadata.test", false],
  ["file:///tmp/metadata", false],
  ["not a URL", false],
  ["https://metadata.test/path", false],
  ["https://metadata.test/?query=value", false],
  ["https://metadata.test/#fragment", false],
  ["https://metadata.test?", false],
  ["https://metadata.test#", false],
  ["http://127.0.0.1:3210/path", true],
  ["https:///metadata.test", false],
  [" https://metadata.test", false],
  // oxlint-disable-next-line sonarjs/no-clear-text-protocols -- Negative transport fixture: this malformed URL must be rejected.
  ["http://127.0.0.1:99999", true],
])(
  "rejects unsafe deployment %s before requesting a token or accessing the network",
  (deploymentUrl, allowInsecureLoopbackForTests) => {
    const fetch = vi.fn(),
      getToken = vi.fn(async () => "synthetic-host-token");
    vi.stubGlobal("fetch", fetch);
    expect(() =>
      createHostedMetadata({
        deploymentUrl,
        allowInsecureLoopbackForTests,
        getToken,
      }),
    ).toThrow();
    expect(getToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("allows only explicitly opted-in literal loopback HTTP for disposable fixtures", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ status: "success", value: null })),
  );
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedMetadata({
    deploymentUrl: "http://127.0.0.1:3210",
    allowInsecureLoopbackForTests: true,
    getToken: async () => "synthetic-test-token",
  });
  await metadata.getDataTable("table");
  expect(fetch).toHaveBeenCalledOnce();
});

it.each([
  "https://metadata.test",
  "https://metadata.test/",
  "HTTPS://metadata.test:443/",
])("uses the canonical HTTPS origin for %s", async (deploymentUrl) => {
  const fetch = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ status: "success", value: null })),
  );
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedMetadata({
    deploymentUrl,
    getToken: async () => "synthetic-token",
  });
  await metadata.getDataTable("table");
  expect(fetch.mock.calls[0]?.[0]).toBe("https://metadata.test/api/query");
});
