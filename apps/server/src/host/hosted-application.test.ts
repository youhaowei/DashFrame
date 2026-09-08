import { CREDENTIAL_CLASS } from "@dashframe/server-core";
import {
  InMemoryMappingStore,
  SecretRegistry,
  SecretVault,
  TestBackend,
} from "@wystack/secret-vault";
import { afterEach, expect, it, vi } from "vite-plus/test";
import type { ConnectorSetupStore } from "../connector-setup/session-store";
import { createHostedApplication } from "./hosted-application";

afterEach(() => vi.unstubAllGlobals());

it("runs service-triggered startup cleanup with owner authority", async () => {
  const authorizations: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      authorizations.push(new Headers(init.headers).get("authorization") ?? "");
      const request = JSON.parse(String(init.body)) as { path: string };
      const value =
        request.path.endsWith("listRecoverableHostBatches") ||
        request.path.endsWith("listCleanup")
          ? { page: [], continueCursor: "", isDone: true }
          : null;
      return new Response(JSON.stringify({ status: "success", value }));
    }),
  );
  const sources: Array<{ kind: string; userId?: string }> = [];
  const issued = (token: string) => ({ token, expiresAt: Date.now() + 60_000 });
  const tokens = {
    browser: () => issued("browser-token"),
    service: () => issued("service-token"),
    credentialOwnership: () => issued("ownership-token"),
    metadata: (source: { kind: string; userId?: string }) => {
      sources.push(source);
      return issued(
        source.kind === "user" && source.userId === "owner-a"
          ? "owner-cleanup-token"
          : "request-token",
      );
    },
  };
  const registry = new SecretRegistry();
  registry.register("test", new TestBackend(), { fallback: true });
  const vault = new SecretVault(registry, new InMemoryMappingStore());
  await vault.store("fixture", { class: CREDENTIAL_CLASS.ConnectorKey });
  const connectorSetup = {
    get: vi.fn(),
    findByNonce: vi.fn(),
    insert: vi.fn(),
    compareAndSwap: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    getDataSourceKind: vi.fn(),
  } satisfies ConnectorSetupStore;
  const hosted = createHostedApplication({
    deploymentUrl: "https://metadata.test",
    source: {
      kind: "service",
      credentialId: "service-a",
      expiresAt: Date.now() + 60_000,
    },
    workspaceId: "workspace-a",
    workspaceOwnerId: "owner-a",
    tokens,
    resources: {
      vault,
      connectorSetup,
      getServerEndpoint: () => undefined,
    },
  });

  await hosted.cleanup.recoverPendingBatches();
  await hosted.cleanup.run();

  expect(authorizations).toEqual([
    "Bearer owner-cleanup-token",
    "Bearer owner-cleanup-token",
  ]);
  expect(sources).toEqual([
    expect.objectContaining({ kind: "user", userId: "owner-a" }),
    expect.objectContaining({ kind: "user", userId: "owner-a" }),
  ]);
});
