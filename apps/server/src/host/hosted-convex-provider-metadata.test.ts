import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createHostedProviderMetadata } from "./hosted-convex-provider-metadata";

afterEach(() => vi.unstubAllGlobals());

function vault() {
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend(), { fallback: true });
  return new SecretVault(registry, new InMemoryMappingStore());
}

function row(credentialRef: string | null) {
  return {
    id: crypto.randomUUID(),
    providerId: "openai",
    displayLabel: "OpenAI",
    authKind: "api-key" as const,
    baseUrl: "https://api.openai.com/v1",
    credentialRef,
    defaultModel: "gpt-5",
    isDefault: true,
    createdAt: 1,
    updatedAt: 2,
  };
}

it("checks newly introduced references in the injected workspace vault before signing", async () => {
  const a = vault(),
    b = vault();
  const aRef = await a.store("a", {
    class: CREDENTIAL_CLASS.AssistantProvider,
  });
  const bRef = await b.store("b", {
    class: CREDENTIAL_CLASS.AssistantProvider,
  });
  const requests: Array<{ path: string; args: unknown[] }> = [];
  const fetch = vi.fn(
    async (
      _url: Parameters<typeof globalThis.fetch>[0],
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body)) as {
        path: string;
        args: Array<{ row: unknown }>;
      };
      requests.push(request);
      return new Response(
        JSON.stringify({ status: "success", value: request.args[0]!.row }),
      );
    },
  );
  const getToken = vi.fn(async () => "synthetic-token");
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedProviderMetadata({
    deploymentUrl: "https://metadata.test",
    getToken,
    credentialVault: a,
  });

  await expect(
    metadata.saveAssistantProviderConfig({
      row: row(bRef),
      expected: null,
    }),
  ).rejects.toThrow("unavailable in this workspace");
  expect(getToken).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();

  const owned = row(aRef);
  expect(
    await metadata.saveAssistantProviderConfig({ row: owned, expected: null }),
  ).toEqual(owned);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    path: "hostedProviderMetadata:save",
    args: [{ row: owned, expected: null }],
  });
  expect(getToken).toHaveBeenCalledTimes(1);
});

it("rejects raw references, unknown fields, unsafe base URLs, and mismatched removal before signing", async () => {
  const getToken = vi.fn(async () => "synthetic-token"),
    fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedProviderMetadata({
    deploymentUrl: "https://metadata.test",
    getToken,
    credentialVault: vault(),
  });
  const valid = row(null);
  for (const invalid of [
    { ...valid, credentialRef: "plaintext" },
    { ...valid, baseUrl: "https://user:password@example.com/v1" },
    { ...valid, baseUrl: "https://example.com/v1?apiKey=plaintext" },
    { ...valid, baseUrl: "https://example.com/v1#credential" },
    { ...valid, baseUrl: "https://example.com\\@other.example/v1" },
    { ...valid, baseUrl: "https://localhost/v1" },
    { ...valid, baseUrl: "https://10.0.0.5/v1" },
    { ...valid, baseUrl: "https://169.254.169.254/latest" },
    { ...valid, baseUrl: "https://[::1]/v1" },
    {
      ...valid,
      baseUrl: "http://public.example.com/v1",
      credentialRef: `secret:${crypto.randomUUID()}`,
    },
    { ...valid, arbitraryConfig: { apiKey: "plaintext" } },
  ])
    await expect(
      metadata.saveAssistantProviderConfig({
        row: invalid as never,
        expected: null,
      }),
    ).rejects.toThrow();
  await expect(
    metadata.removeAssistantProviderConfig({
      id: crypto.randomUUID(),
      expected: valid,
    }),
  ).rejects.toThrow("identity mismatch");
  await expect(
    metadata.getAssistantProviderConfig("not-a-uuid"),
  ).rejects.toThrow();
  expect(getToken).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("allows public HTTP only when no provider credential can cross it", async () => {
  const fetch = vi.fn(
    async (_url: unknown, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          status: "success",
          value: (
            JSON.parse(String(init?.body)) as {
              args: Array<{ row: unknown }>;
            }
          ).args[0]!.row,
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedProviderMetadata({
    deploymentUrl: "https://metadata.test",
    getToken: async () => "synthetic-token",
    credentialVault: vault(),
  });
  const publicHttp = {
    ...row(null),
    authKind: "local" as const,
    baseUrl: "http://public.example.com/v1",
  };
  await metadata.saveAssistantProviderConfig({
    row: publicHttp,
    expected: null,
  });
  expect(fetch).toHaveBeenCalledOnce();
});

it("does not require a vault lookup for unchanged or cleared references", async () => {
  const credentialVault = { has: vi.fn(async () => false) };
  const fetch = vi.fn(
    async (
      _url: Parameters<typeof globalThis.fetch>[0],
      init?: RequestInit,
    ) => {
      const request = JSON.parse(String(init?.body)) as {
        args: Array<{ row: unknown }>;
      };
      return new Response(
        JSON.stringify({ status: "success", value: request.args[0]!.row }),
      );
    },
  );
  vi.stubGlobal("fetch", fetch);
  const metadata = createHostedProviderMetadata({
    deploymentUrl: "https://metadata.test",
    getToken: async () => "synthetic-token",
    credentialVault,
  });
  const ref = `secret:${crypto.randomUUID()}`;
  const before = row(ref);
  await metadata.saveAssistantProviderConfig({
    row: { ...before, displayLabel: "Renamed", updatedAt: 3 },
    expected: before,
  });
  await metadata.saveAssistantProviderConfig({
    row: { ...before, credentialRef: null, updatedAt: 3 },
    expected: before,
  });
  expect(credentialVault.has).not.toHaveBeenCalled();
});
