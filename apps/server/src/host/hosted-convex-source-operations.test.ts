import { afterEach, expect, it, vi } from "vite-plus/test";
import { createHostedSourceMetadata } from "./hosted-convex-source-operations";

afterEach(() => vi.unstubAllGlobals());
it("uses only the four named Bearer operations without body scope", async () => {
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
  const metadata = createHostedSourceMetadata({
    deploymentUrl: "https://metadata.test",
    getToken: async () => "synthetic-token",
  });
  await metadata.replaceDataSourceConfig({
    id: "source",
    expectedConfig: {},
    config: {},
  });
  await metadata.prepareRemoteDataTable({
    id: "table",
    dataSourceId: "source",
    table: "table.csv",
    fields: [],
  });
  await metadata.removeDataFrame({ id: "frame" });
  await metadata.clearAllData({});
  expect(requests.map((request) => request.path)).toEqual(
    [
      "replaceDataSourceConfig",
      "prepareRemoteDataTable",
      "removeDataFrame",
      "clearAllData",
    ].map((name) => `hostedSourceOperations:${name}`),
  );
  for (const request of requests) {
    expect(request.authorization).toBe("Bearer synthetic-token");
    expect(request.args[0]).not.toHaveProperty("workspaceId");
    expect(request.args[0]).not.toHaveProperty("principal");
  }
  expect(Object.keys(metadata)).toHaveLength(27);
});

it("rejects unsafe replacement and expected configs before token acquisition or network", async () => {
  const fetch = vi.fn(),
    getToken = vi.fn(async () => "synthetic-token");
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedSourceMetadata({
    deploymentUrl: "https://metadata.test",
    getToken,
  });
  const invalid = [
    // oxlint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberately rejected synthetic input; never sent to the network.
    { password: "synthetic-plaintext" },
    { token: "synthetic-plaintext" },
    { apiKey: "synthetic-plaintext" },
    { connectionString: "synthetic-plaintext" },
    { sourceBindingVersion: "v3" },
    null,
  ];
  for (const value of invalid)
    for (const slot of ["config", "expectedConfig"] as const)
      await expect(
        metadata.replaceDataSourceConfig({
          id: "source",
          config: {},
          expectedConfig: {},
          [slot]: value,
        } as never),
      ).rejects.toThrow();
  expect(getToken).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["v1", "v2"] as const)(
  "accepts the producer-supported four-field config with binding %s",
  async (sourceBindingVersion) => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ status: "success", value: null })),
    );
    vi.stubGlobal("fetch", fetch);
    const config = {
      apiKey: `secret:${crypto.randomUUID()}`,
      connectionString: `secret:${crypto.randomUUID()}`,
      defaultSchema: "public",
      sourceBindingVersion,
    };
    const metadata = createHostedSourceMetadata({
      deploymentUrl: "https://metadata.test",
      getToken: async () => "synthetic-token",
    });
    await metadata.replaceDataSourceConfig({
      id: "source",
      expectedConfig: config,
      config,
    });
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1].body)) as {
      args: unknown[];
    };
    expect(request.args).toEqual([
      { id: "source", expectedConfig: config, config },
    ]);
  },
);
