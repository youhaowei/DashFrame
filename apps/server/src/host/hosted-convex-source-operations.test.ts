import { afterEach, expect, it, vi } from "vite-plus/test";
import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { createHostedSourceMetadata } from "./hosted-convex-source-operations";

afterEach(() => {
  vi.unstubAllGlobals();
});
it("maps host-facing source calls to the four named Bearer wire operations without body scope", async () => {
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
    credentialVault: { has: async () => true },
  });
  await metadata.replaceDataSourceConfig({
    id: "source",
    expectedRevision: 1,
    expectedConfig: {},
    config: {},
  });
  await metadata.prepareRemoteDataTable({
    id: "table",
    dataSourceId: "source",
    table: "table.csv",
    fields: [],
  });
  await metadata.removeDataFrame("frame");
  await metadata.clearAllData();
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
  expect(requests[2]!.args).toEqual([{ id: "frame" }]);
  expect(requests[3]!.args).toEqual([{}]);
});

it("rejects unsafe replacement and expected configs before token acquisition or network", async () => {
  const fetch = vi.fn(),
    getToken = vi.fn(async () => "synthetic-token");
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedSourceMetadata({
    deploymentUrl: "https://metadata.test",
    getToken,
    credentialVault: { has: async () => true },
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
          expectedRevision: 1,
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
      credentialVault: { has: async () => true },
    });
    await metadata.replaceDataSourceConfig({
      id: "source",
      expectedRevision: 1,
      expectedConfig: config,
      config,
    });
    const request = JSON.parse(String(fetch.mock.calls[0]?.[1].body)) as {
      args: unknown[];
    };
    expect(request.args).toEqual([
      { id: "source", expectedRevision: 1, expectedConfig: config, config },
    ]);
  },
);

it("checks only newly introduced source references in the request workspace vault", async () => {
  const workspaceVault = () => {
    const registry = new SecretRegistry();
    registry.register("test", new TestBackend(), { fallback: true });
    return new SecretVault(registry, new InMemoryMappingStore());
  };
  const a = workspaceVault(),
    b = workspaceVault();
  const aRef = await a.store("source-a", {
    class: CREDENTIAL_CLASS.ConnectorKey,
  });
  const bRef = await b.store("source-b", {
    class: CREDENTIAL_CLASS.ConnectorKey,
  });
  const getToken = vi.fn(async () => "synthetic-token");
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ status: "success", value: null })),
  );
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedSourceMetadata({
    deploymentUrl: "https://metadata.test",
    getToken,
    credentialVault: a,
  });

  await expect(
    metadata.replaceDataSourceConfig({
      id: "source",
      expectedRevision: 1,
      expectedConfig: {},
      config: { apiKey: bRef },
    }),
  ).rejects.toThrow("unavailable in this workspace");
  expect(getToken).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  await metadata.replaceDataSourceConfig({
    id: "source",
    expectedRevision: 1,
    expectedConfig: {},
    config: { apiKey: aRef },
  });
  await metadata.replaceDataSourceConfig({
    id: "source",
    expectedRevision: 1,
    expectedConfig: { apiKey: bRef },
    config: { apiKey: bRef },
  });
  await metadata.replaceDataSourceConfig({
    id: "source",
    expectedRevision: 1,
    expectedConfig: { apiKey: bRef },
    config: {},
  });
  expect(getToken).toHaveBeenCalledTimes(3);
  expect(fetch).toHaveBeenCalledTimes(3);
});
